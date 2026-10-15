"""Veogen GPU job: one still image per scene (Z-Image-Turbo), then an image-to-video clip per scene,
then lip sync (LatentSync) on the clips where someone speaks on screen.

Runs as a Kaggle script on a 16 GB T4. The scene list is injected by src/stages/render.ts.
Outputs: images/scene-XX.png, clips/scene-XX.mp4, raw/scene-XX.mp4 (a lip-synced clip before the sync), timings.json
"""

import base64
import gc
import json
import math
import os
import shutil
import subprocess
import sys
import time
import traceback

CONFIG = json.loads(base64.b64decode("__VEOGEN_CONFIG_B64__").decode("utf-8"))
MODEL = CONFIG["model"]
SCENES = CONFIG["scenes"]
SEED = int(CONFIG.get("seed", 1234))
# Which parts of the work this job does: scene images, motion clips, or both.
STAGES = CONFIG.get("stages") or ["images", "clips"]
# Scene images sent along with the job (scene number -> base64 JPEG), used when only clips are wanted.
IMAGES = json.loads(r'''__VEOGEN_IMAGES_JSON__'''.strip() or "{}")
# Clips to lip-sync: [{"index": scene number, "audio": base64 MP3 of what is said aloud, as long as the clip}].
LIPSYNC = CONFIG.get("lipsync") or []
# The version of LatentSync this job was tested with.
LIPSYNC_REPO = "https://github.com/bytedance/LatentSync"
LIPSYNC_COMMIT = "a229c3948406bc2cf6eaf4873e662e70c6a04746"
LIPSYNC_WEIGHTS = "ByteDance/LatentSync-1.5"
LIPSYNC_FPS = 25

OUT = "/kaggle/working" if os.path.isdir("/kaggle/working") else os.path.abspath("out")
CACHE = "/tmp/hf"
os.environ["HF_HOME"] = CACHE
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

IMAGE_W, IMAGE_H = 1280, 704

# fps / max_frames follow what each model was trained on.
MODELS = {
    "wan5b": {"width": 1280, "height": 704, "fps": 24, "max_frames": 121, "steps": 3},
    "wan14b": {"width": 832, "height": 480, "fps": 16, "max_frames": 81, "steps": 4},
}

# Each stage runs as its own process (see main), so they share progress through this file.
STAGE = sys.argv[1] if len(sys.argv) > 1 else "main"
TIMINGS_PATH = os.path.join(OUT, "timings.json")
RESTART_CODE = 75
# The clips process is restarted before the 31 GB machine runs out. Memory creeps up by a few GB per clip and
# decoding a clip needs about 8 GB more on top, so a clip may only start below this: one started at 22.6 GB
# took the whole machine down while decoding, and every clip finished in that job was lost with it.
RAM_RESTART_GB = 21.5

timings = {"model": MODEL, "setup_seconds": 0, "images": [], "clips": [], "notes": []}
if STAGE != "main" and os.path.exists(TIMINGS_PATH):
    with open(TIMINGS_PATH) as handle:
        timings = json.load(handle)


def log(message):
    print(f"[veogen {time.strftime('%H:%M:%S')}] {message}", flush=True)


def sh(command, cwd=None):
    log(f"$ {command}")
    return subprocess.run(command, shell=True, check=False, cwd=cwd).returncode


def save_timings():
    with open(TIMINGS_PATH, "w") as handle:
        json.dump(timings, handle, indent=2)


def free():
    import ctypes

    import torch

    gc.collect()
    torch.cuda.empty_cache()
    # Hands freed memory back to the system, which Python otherwise keeps; it is what creeps up between clips.
    try:
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    except OSError:
        pass


def drop_cache(repo_id):
    # Kaggle disk is limited; a finished stage's weights are not needed again.
    shutil.rmtree(os.path.join(CACHE, "hub", "models--" + repo_id.replace("/", "--")), ignore_errors=True)


def frames_for(seconds, spec):
    wanted = math.ceil(float(seconds) * spec["fps"])
    # Wan needs 4k+1 frames.
    frames = ((max(wanted, 17) - 1 + 3) // 4) * 4 + 1
    return min(frames, spec["max_frames"])


def cover_resize(image, width, height):
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)))
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def is_blank(frames):
    import numpy as np

    array = np.asarray(frames, dtype="float32")
    if array.max() > 1.5:
        array = array / 255.0
    return (not np.isfinite(array).all()) or float(array.mean()) < 0.01


def image_path(scene):
    return os.path.join(OUT, "images", f"scene-{scene['index']:02d}.png")


def clip_path(scene):
    return os.path.join(OUT, "clips", f"scene-{scene['index']:02d}.mp4")


def build_image_pipe(strategy):
    import torch
    from diffusers import ZImagePipeline

    pipe = ZImagePipeline.from_pretrained("Tongyi-MAI/Z-Image-Turbo", torch_dtype=torch.bfloat16)
    if strategy == "fp8":
        # Stores the 12 GB transformer as 8-bit floats so it fits a 16 GB card with room to run.
        pipe.transformer.enable_layerwise_casting(
            storage_dtype=torch.float8_e4m3fn, compute_dtype=torch.bfloat16
        )
        pipe.enable_model_cpu_offload()
    else:
        pipe.enable_sequential_cpu_offload()
    return pipe


def generate_images():
    import torch

    strategies = ["fp8", "sequential"]
    pipe = None
    for scene in SCENES:
        while True:
            try:
                if pipe is None:
                    log(f"image pipeline: {strategies[0]}")
                    pipe = build_image_pipe(strategies[0])
                started = time.time()
                image = pipe(
                    prompt=scene["imagePrompt"],
                    height=IMAGE_H,
                    width=IMAGE_W,
                    num_inference_steps=9,
                    guidance_scale=0.0,
                    generator=torch.Generator("cpu").manual_seed(int(scene.get("imageSeed", SEED))),
                ).images[0]
                if is_blank(image):
                    raise RuntimeError("blank image")
                break
            except Exception:  # noqa: BLE001
                log(f"image {scene['index']} failed with {strategies[0]}\n{traceback.format_exc()[-1500:]}")
                timings["notes"].append(f"image strategy {strategies[0]} failed")
                pipe = None
                free()
                strategies.pop(0)
                if not strategies:
                    save_timings()
                    raise
        image.save(image_path(scene))
        seconds = round(time.time() - started, 1)
        timings["images"].append({"scene": scene["index"], "seconds": seconds, "strategy": strategies[0]})
        save_timings()
        log(f"image {scene['index']} done in {seconds}s")
    del pipe
    free()
    drop_cache("Tongyi-MAI/Z-Image-Turbo")


def memory_note():
    import psutil
    import torch

    ram = psutil.virtual_memory()
    gpu = torch.cuda.memory_allocated() / 2**30 if torch.cuda.is_available() else 0
    return f"RAM {ram.used / 2**30:.1f}/{ram.total / 2**30:.0f} GB, GPU {gpu:.1f} GB"


def encode_prompts(repo, dtype):
    """Encodes every scene's motion prompt, then frees the 11 GB text encoder so it is not held during rendering."""
    import torch
    from diffusers import WanImageToVideoPipeline

    text_pipe = WanImageToVideoPipeline.from_pretrained(
        repo, transformer=None, transformer_2=None, vae=None, torch_dtype=torch.bfloat16
    )
    text_pipe.text_encoder.to("cuda")
    embeds = {}
    with torch.no_grad():
        for scene in SCENES:
            prompt_embeds, _ = text_pipe.encode_prompt(
                prompt=scene["motionPrompt"],
                do_classifier_free_guidance=False,
                max_sequence_length=512,
                device="cuda",
            )
            embeds[scene["index"]] = prompt_embeds.to("cpu", dtype)
    text_pipe.text_encoder.to("cpu")
    del text_pipe
    free()
    log(f"prompts encoded; {memory_note()}")
    return embeds


def build_wan5b(dtype_name, low_vram):
    import torch
    from diffusers import AutoencoderKLWan, WanImageToVideoPipeline

    repo = "FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers"
    dtype = getattr(torch, dtype_name)
    embeds = encode_prompts(repo, dtype)
    vae = AutoencoderKLWan.from_pretrained(repo, subfolder="vae", torch_dtype=torch.float32)
    pipe = WanImageToVideoPipeline.from_pretrained(
        repo, vae=vae, text_encoder=None, tokenizer=None, torch_dtype=dtype
    )
    log(f"wan5b transformer dtype: {pipe.transformer.dtype}, low_vram: {low_vram}")
    if low_vram:
        # The 10 GB transformer plus its working memory does not fit a 16 GB card; 8-bit storage does.
        pipe.transformer.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=dtype)
    pipe.enable_model_cpu_offload()
    try:
        pipe.vae.enable_tiling()
    except Exception as error:  # noqa: BLE001
        log(f"vae tiling unavailable: {error}")

    def on_step(_pipe, step, _timestep, kwargs):
        log(f"step {step + 1} done; {memory_note()}")
        return kwargs

    def run(scene, image, frames, spec):
        return pipe(
            image=image,
            prompt_embeds=embeds[scene["index"]].to("cuda"),
            height=spec["height"],
            width=spec["width"],
            num_frames=frames,
            num_inference_steps=spec["steps"],
            guidance_scale=1.0,
            generator=torch.Generator("cpu").manual_seed(SEED + scene["index"]),
            callback_on_step_end=on_step,
        ).frames[0]

    return pipe, run


def build_wan14b(dtype_name, low_vram):
    import torch
    from diffusers import (
        AutoencoderKLWan,
        GGUFQuantizationConfig,
        UniPCMultistepScheduler,
        WanImageToVideoPipeline,
        WanTransformer3DModel,
    )

    base = "Wan-AI/Wan2.2-I2V-A14B-Diffusers"
    gguf_repo = "QuantStack/Wan2.2-I2V-A14B-GGUF"
    lora_repo = "lightx2v/Wan2.2-Lightning"
    lora_dir = "Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1"
    quant = CONFIG.get("gguf_quant", "Q4_K_M")
    dtype = getattr(torch, dtype_name)

    # The text encoder does not fit in RAM next to both transformers.
    embeds = encode_prompts(base, dtype)

    def load_transformer(noise, subfolder):
        url = f"https://huggingface.co/{gguf_repo}/blob/main/{noise}Noise/Wan2.2-I2V-A14B-{noise}Noise-{quant}.gguf"
        return WanTransformer3DModel.from_single_file(
            url,
            quantization_config=GGUFQuantizationConfig(compute_dtype=dtype),
            config=base,
            subfolder=subfolder,
            torch_dtype=dtype,
        )

    vae = AutoencoderKLWan.from_pretrained(base, subfolder="vae", torch_dtype=torch.float32)
    pipe = WanImageToVideoPipeline.from_pretrained(
        base,
        transformer=load_transformer("High", "transformer"),
        transformer_2=load_transformer("Low", "transformer_2"),
        vae=vae,
        text_encoder=None,
        tokenizer=None,
        torch_dtype=dtype,
    )
    pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config, flow_shift=8.0)
    pipe.load_lora_weights(lora_repo, weight_name=f"{lora_dir}/high_noise_model.safetensors", adapter_name="high")
    pipe.load_lora_weights(
        lora_repo,
        weight_name=f"{lora_dir}/low_noise_model.safetensors",
        adapter_name="low",
        load_into_transformer_2=True,
    )
    pipe.enable_model_cpu_offload()
    try:
        pipe.vae.enable_tiling()
    except Exception as error:  # noqa: BLE001
        log(f"vae tiling unavailable: {error}")

    def run(scene, image, frames, spec):
        return pipe(
            image=image,
            prompt_embeds=embeds[scene["index"]].to("cuda"),
            height=spec["height"],
            width=spec["width"],
            num_frames=frames,
            num_inference_steps=spec["steps"],
            guidance_scale=1.0,
            generator=torch.Generator("cpu").manual_seed(SEED + scene["index"]),
        ).frames[0]

    return pipe, run


BUILDERS = {"wan5b": build_wan5b, "wan14b": build_wan14b}


# Tried in order; a blank result or an error (such as running out of GPU memory) moves to the next one.
CLIP_CONFIGS = {
    "wan5b": [("float16", True), ("bfloat16", True)],
    "wan14b": [("float16", False), ("bfloat16", False)],
}


def generate_clips():
    from diffusers.utils import export_to_video
    from PIL import Image

    spec = MODELS[MODEL]
    configs = list(CLIP_CONFIGS[MODEL])
    built = None

    import psutil

    for scene in SCENES:
        if os.path.exists(clip_path(scene)):
            continue
        if built is not None and psutil.virtual_memory().used / 2**30 > RAM_RESTART_GB:
            log(f"memory is high ({memory_note()}); restarting the clips process")
            sys.exit(RESTART_CODE)
        image = cover_resize(Image.open(image_path(scene)).convert("RGB"), spec["width"], spec["height"])
        frames = frames_for(scene["seconds"], spec)
        while True:
            dtype_name, low_vram = configs[0]
            try:
                if built is None:
                    built = BUILDERS[MODEL](dtype_name, low_vram)
                started = time.time()
                log(f"clip {scene['index']} starting; {memory_note()}")
                video = built[1](scene, image, frames, spec)
                log(f"clip {scene['index']} decoded; {memory_note()}")
                if is_blank(video):
                    raise RuntimeError("blank frames")
                # Written under a temporary name so a process killed mid-write never leaves a half clip behind.
                partial = clip_path(scene).replace(".mp4", ".partial.mp4")
                export_to_video(video, partial, fps=spec["fps"])
                os.replace(partial, clip_path(scene))
                seconds = round(time.time() - started, 1)
                timings["clips"].append(
                    {
                        "scene": scene["index"],
                        "seconds": seconds,
                        "frames": frames,
                        "fps": spec["fps"],
                        "dtype": dtype_name,
                        "low_vram": low_vram,
                    }
                )
                log(f"clip {scene['index']} done in {seconds}s ({frames} frames)")
                video = None
                free()
                break
            except Exception:  # noqa: BLE001
                error = traceback.format_exc()
            # Outside the except block: the traceback kept the failed pipeline alive until here.
            log(f"clip {scene['index']} failed with {configs[0]}\n{error[-3000:]}")
            timings["notes"].append(f"clip config {configs[0]} failed: {error.strip().splitlines()[-1][:200]}")
            built = None
            video = None
            free()
            save_timings()
            if len(configs) > 1:
                configs.pop(0)
                continue
            timings["clips"].append({"scene": scene["index"], "error": error[-2000:]})
            break
        save_timings()


def sync_lips():
    """Redraws the mouth of each listed clip to match its voice. A clip that cannot be synced stays as it was."""
    done = {entry["scene"] for entry in timings.get("lipsync", [])}
    todo = [item for item in LIPSYNC if item["index"] not in done and os.path.exists(clip_path(item))]
    if not todo:
        return
    repo, venv, work = "/tmp/LatentSync", "/tmp/lipsync-env", "/tmp/lipsync"
    python = f"{venv}/bin/python"
    os.makedirs(work, exist_ok=True)
    os.makedirs(os.path.join(OUT, "raw"), exist_ok=True)
    # The motion models are no longer needed, and the disk is.
    shutil.rmtree(CACHE, ignore_errors=True)

    started = time.time()
    if not os.path.exists(python):
        sh(f"{sys.executable} -m pip install -q uv")
        sh(f"rm -rf {repo} && git clone -q {LIPSYNC_REPO} {repo} && git -C {repo} checkout -q {LIPSYNC_COMMIT}")
        # Its own Python and pinned packages, so nothing clashes with the notebook's.
        sh(f"{sys.executable} -m uv venv {venv} --python 3.10")
        installed = sh(f"{sys.executable} -m uv pip install -q --python {python} -r requirements.txt", cwd=repo)
        fetched = sh(
            f"{python} -c \"from huggingface_hub import hf_hub_download as d; "
            f"[d('{LIPSYNC_WEIGHTS}', f, local_dir='{repo}/checkpoints') for f in ('latentsync_unet.pt', 'whisper/tiny.pt')]\""
        )
        if installed != 0 or fetched != 0:
            log("lip sync could not be set up; the clips stay as they are")
            timings["notes"].append("lip sync setup failed")
            save_timings()
            return
    timings["notes"].append(f"lip sync set up in {round(time.time() - started)}s")

    for item in todo:
        number = item["index"]
        clip = clip_path(item)
        raw = os.path.join(OUT, "raw", os.path.basename(clip))
        smooth = os.path.join(work, f"scene-{number:02d}-smooth.mp4")
        audio = os.path.join(work, f"scene-{number:02d}.mp3")
        synced = os.path.join(work, f"scene-{number:02d}-synced.mp4")
        began = time.time()
        if not os.path.exists(raw):
            shutil.copyfile(clip, raw)
        with open(audio, "wb") as handle:
            handle.write(base64.b64decode(item["audio"]))
        # LatentSync works at 25 fps and would repeat frames to get there; building the in-between frames keeps the motion even.
        sh(
            f"ffmpeg -y -loglevel error -i {raw} -vf minterpolate=fps={LIPSYNC_FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1 "
            f"-an -c:v libx264 -crf 14 -pix_fmt yuv420p {smooth}"
        )
        code = 1
        if os.path.exists(smooth):
            code = sh(
                f"{python} -m scripts.inference --unet_config_path configs/unet/stage2.yaml "
                f"--inference_ckpt_path checkpoints/latentsync_unet.pt --inference_steps 20 --guidance_scale 1.5 "
                f"--video_path {smooth} --audio_path {audio} --video_out_path {synced}",
                cwd=repo,
            )
        ok = code == 0 and os.path.exists(synced) and os.path.getsize(synced) > 10_000
        if ok:
            shutil.copyfile(synced, clip + ".partial")
            os.replace(clip + ".partial", clip)
        timings.setdefault("lipsync", []).append({"scene": number, "seconds": round(time.time() - began, 1), "synced": ok})
        save_timings()
        log(f"lip sync {number}: {'done' if ok else 'not possible, clip kept as it was'} in {round(time.time() - began)}s")


def reuse_images():
    """Writes scene images that were sent along with the job, if every scene has one."""
    images = IMAGES
    if not images or any(str(scene["index"]) not in images for scene in SCENES):
        return False
    from io import BytesIO

    from PIL import Image

    for scene in SCENES:
        data = base64.b64decode(images[str(scene["index"])])
        Image.open(BytesIO(data)).convert("RGB").save(image_path(scene))
    log(f"reused {len(SCENES)} images sent with the job")
    timings["notes"].append("images reused")
    return True


def check_session():
    # Kaggle silently starts the job without GPU or internet when the account is not phone-verified.
    import socket

    problems = []
    if shutil.which("nvidia-smi") is None:
        problems.append("no GPU")
    try:
        socket.create_connection(("huggingface.co", 443), timeout=15).close()
    except OSError:
        problems.append("no internet")
    if problems:
        log(f"SESSION UNUSABLE: {', '.join(problems)}. Verify the Kaggle account's phone number, then re-run.")
        sys.exit(1)


def main():
    started = time.time()
    os.makedirs(os.path.join(OUT, "images"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "clips"), exist_ok=True)
    sh("nvidia-smi --query-gpu=name,memory.total --format=csv")
    sh("df -h / /tmp /kaggle/working 2>/dev/null; free -g | head -2")
    check_session()
    sh(
        f"{sys.executable} -m pip install -q -U diffusers transformers accelerate peft gguf ftfy "
        "sentencepiece imageio imageio-ffmpeg"
    )
    # The preinstalled torchao is older than the upgraded diffusers expects and breaks its imports; it is not used here.
    sh(f"{sys.executable} -m pip uninstall -y -q torchao")
    sh(f"{sys.executable} -m pip list 2>/dev/null | grep -iE '^(torch|diffusers|transformers|accelerate|peft|gguf) '")
    timings["setup_seconds"] = round(time.time() - started, 1)
    save_timings()

    # Separate processes: the image model's memory is fully returned before the motion model loads,
    # and a clips process that dies (or asks for a restart) resumes at the next missing clip.
    reused = reuse_images()
    save_timings()
    if not reused and "images" in STAGES:
        run_stage("images")
    if not all(os.path.exists(image_path(scene)) for scene in SCENES):
        log("scene images are missing")
        sys.exit(1)

    stalled = 0
    while "clips" in STAGES and stalled < 2:
        before = clips_done()
        if before == len(SCENES):
            break
        code = run_stage("clips")
        log(f"clips process ended with code {code}; {clips_done()}/{len(SCENES)} clips")
        stalled = stalled + 1 if clips_done() == before else 0

    if "clips" in STAGES and LIPSYNC and clips_done() == len(SCENES):
        code = run_stage("lipsync")
        log(f"lip sync process ended with code {code}")

    with open(TIMINGS_PATH) as handle:
        final = json.load(handle)
    final["total_seconds"] = round(time.time() - started, 1)
    with open(TIMINGS_PATH, "w") as handle:
        json.dump(final, handle, indent=2)
    log(json.dumps(final, indent=2))
    for leftover in os.listdir(os.path.join(OUT, "clips")):
        if leftover.endswith(".partial.mp4"):
            os.remove(os.path.join(OUT, "clips", leftover))
    if "clips" in STAGES and clips_done() < len(SCENES):
        sys.exit(1)


def clips_done():
    return sum(os.path.exists(clip_path(scene)) for scene in SCENES)


def run_stage(name):
    script = globals().get("__file__") or "/kaggle/src/script.py"
    log(f"starting {name} process")
    return subprocess.run([sys.executable, os.path.abspath(script), name], check=False).returncode


if STAGE == "images":
    generate_images()
elif STAGE == "clips":
    generate_clips()
elif STAGE == "lipsync":
    sync_lips()
else:
    main()
