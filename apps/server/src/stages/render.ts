import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { requireKaggle, video } from "../config";
import { ffmpeg } from "../lib/ffmpeg";
import { loadStory, paths, sceneName } from "../lib/project";
import {
  downloadOutputFile,
  formatJobLog,
  getJobOutput,
  getJobStatus,
  pushJob,
  slugify,
  type JobStatus,
} from "../services/kaggle";
import { buildImagePrompt, NARRATOR, type Scene } from "../schemas/story";
import { loadSceneVoice } from "./voice";

export const MOTION_MODELS = ["wan5b", "wan14b"] as const;
export type MotionModel = (typeof MOTION_MODELS)[number];
export type RenderStage = "images" | "clips";

const TEMPLATE_PATH = resolve(import.meta.dir, "../../kaggle/render.py");
const CONFIG_PLACEHOLDER = "__VEOGEN_CONFIG_B64__";
const IMAGES_PLACEHOLDER = "__VEOGEN_IMAGES_JSON__";
const POLL_SECONDS = 60;
// Extra clip length beyond the narration, so a clip never has to be stretched.
const CLIP_MARGIN_SECONDS = 0.25;
const DEFAULT_SCENE_SECONDS = 5;
// Width each motion model renders at (must match MODELS in kaggle/render.py).
const CLIP_WIDTH: Record<MotionModel, number> = { wan5b: 1280, wan14b: 832 };

// Kaggle rejects job sources over 1 MB; lip-sync voices are only sent while the job stays under this.
const MAX_SOURCE_BYTES = 950_000;
// JPEG quality numbers tried in turn for the pictures sent with a clips job (2 is best, 31 worst).
const JPEG_QUALITIES = [5, 7, 9, 12];

const jobSchema = z.object({
  slug: z.string(),
  url: z.string().nullable(),
  pushedAt: z.string(),
});

export type PushRenderOptions = {
  // Which work the job does; both when omitted.
  stages?: RenderStage[];
  // Scene numbers to render; every scene when omitted.
  scenes?: number[];
  // A model whose already-downloaded scene images are sent along, so the job does not generate them.
  reuseImagesFrom?: string;
  // Added to the image seed, so a rejected image comes back different.
  imageSeedBump?: number;
  // Added to the motion seed, so a rejected clip comes back different.
  clipSeedBump?: number;
  // Names the job (and its record under jobs/); defaults to the model.
  jobName?: string;
  // Redraw the mouth of whoever speaks on screen to match their voice, after the clips are made.
  lipSync?: boolean;
};

// Who is seen saying their line in the scene, or null when lip sync does not apply: nobody speaks aloud,
// more than one person does, or the speaker is not the one person in the picture.
function speakerOnScreen(scene: Scene): string | null {
  const aloud = [...new Set(scene.lines.filter((line) => line.speaker !== NARRATOR).map((line) => line.speaker))];
  if (aloud.length !== 1 || scene.shows?.length !== 1) return null;
  return scene.shows[0] === aloud[0] ? (aloud[0] ?? null) : null;
}

// The scene's voice with everything but the on-screen speaker silenced, padded to the clip's length, as a small MP3.
async function lipSyncAudio(dir: string, jobName: string, number: number, speaker: string, seconds: number): Promise<string | null> {
  const voice = await loadSceneVoice(dir, number).catch(() => null);
  if (!voice || !voice.words.some((word) => word.speaker === speaker)) return null;
  const silenced = voice.words
    .filter((word) => word.speaker !== speaker)
    .map((word) => `volume=0:enable='between(t,${word.start.toFixed(3)},${word.end.toFixed(3)})'`);
  const output = join(paths.workDir(dir, jobName), `${sceneName(number)}-lips.mp3`);
  await mkdir(dirname(output), { recursive: true });
  await ffmpeg([
    "-i", paths.voiceAudio(dir, number),
    "-af", [...silenced, `apad=whole_dur=${seconds.toFixed(3)}`].join(","),
    "-t", seconds.toFixed(3),
    "-ar", "16000", "-ac", "1", "-b:a", "16k",
    output,
  ]);
  return Buffer.from(await Bun.file(output).arrayBuffer()).toString("base64");
}

export async function pushRender(dir: string, model: MotionModel, options: PushRenderOptions = {}): Promise<string> {
  const { username } = requireKaggle();
  const story = await loadStory(dir);
  const jobName = options.jobName ?? model;

  const scenes: { index: number; imagePrompt: string; motionPrompt: string; seconds: number; imageSeed: number }[] = [];
  for (const [index, scene] of story.scenes.entries()) {
    const number = index + 1;
    if (options.scenes && !options.scenes.includes(number)) continue;
    // Narration can be made after the clips: without it the clip gets the model's full five seconds.
    const voice = await loadSceneVoice(dir, number).catch(() => ({ duration: DEFAULT_SCENE_SECONDS }));
    scenes.push({
      index: number,
      imagePrompt: buildImagePrompt(story, scene),
      motionPrompt: scene.motionPrompt,
      seconds: voice.duration + video.sceneTailSeconds + CLIP_MARGIN_SECONDS,
      imageSeed: story.seed + (options.imageSeedBump ?? 0),
    });
  }
  if (scenes.length === 0) throw new Error("No scenes to render");

  let images: Record<number, string> = {};
  // Kaggle rejects job sources over 1 MB, so images go as JPEGs at the size the motion model works at,
  // compressed harder (a higher JPEG quality number) when a whole chapter of them does not fit.
  const encodeImages = async (quality: number) => {
    const encoded: Record<number, string> = {};
    for (const scene of scenes) {
      const source = join(paths.renderDir(dir, options.reuseImagesFrom as string), "images", `${sceneName(scene.index)}.png`);
      if (!(await Bun.file(source).exists())) throw new Error(`No image to reuse: ${source}`);
      const jpeg = join(paths.workDir(dir, jobName), `${sceneName(scene.index)}.jpg`);
      await mkdir(dirname(jpeg), { recursive: true });
      await ffmpeg(["-i", source, "-vf", `scale=${CLIP_WIDTH[model]}:-2:flags=lanczos`, "-q:v", String(quality), jpeg]);
      encoded[scene.index] = Buffer.from(await Bun.file(jpeg).arrayBuffer()).toString("base64");
    }
    return encoded;
  };
  if (options.reuseImagesFrom) images = await encodeImages(JPEG_QUALITIES[0] as number);

  const stages = options.stages ?? ["images", "clips"];
  const lipsync: { index: number; audio: string }[] = [];
  if (options.lipSync && stages.includes("clips")) {
    for (const scene of scenes) {
      const speaker = speakerOnScreen(story.scenes[scene.index - 1]!);
      const audio = speaker ? await lipSyncAudio(dir, jobName, scene.index, speaker, scene.seconds) : null;
      if (audio) lipsync.push({ index: scene.index, audio });
    }
  }

  const template = await Bun.file(TEMPLATE_PATH).text();
  if (!template.includes(CONFIG_PLACEHOLDER) || !template.includes(IMAGES_PLACEHOLDER)) {
    throw new Error("kaggle/render.py is missing a placeholder");
  }
  const build = () => {
    const jobConfig = { model, seed: story.seed + (options.clipSeedBump ?? 0), scenes, stages, lipsync };
    return template
      .replace(CONFIG_PLACEHOLDER, Buffer.from(JSON.stringify(jobConfig)).toString("base64"))
      .replace(IMAGES_PLACEHOLDER, JSON.stringify(images));
  };
  let code = build();
  // First the pictures are compressed harder, which barely shows at the motion model's size...
  for (const quality of JPEG_QUALITIES.slice(1)) {
    if (code.length <= MAX_SOURCE_BYTES || !options.reuseImagesFrom) break;
    images = await encodeImages(quality);
    code = build();
    console.log(`pictures sent at JPEG quality ${quality} to fit Kaggle's 1 MB limit`);
  }
  // ...then, as the last resort, the clips matter more than their lip sync: voices are dropped from the end.
  while (code.length > MAX_SOURCE_BYTES && lipsync.length > 0) {
    lipsync.pop();
    code = build();
  }
  if (lipsync.length > 0) console.log(`lip sync for scenes ${lipsync.map((item) => item.index).join(", ")}`);
  if (code.length > MAX_SOURCE_BYTES) throw new Error(`The job is ${Math.round(code.length / 1024)} KB, over Kaggle's 1 MB limit even with the pictures fully compressed`);

  const title = `veogen ${basename(resolve(dir))} ${jobName}`;
  const response = await pushJob({ username, title, code });
  const job = { slug: slugify(title), url: response.url ?? null, pushedAt: new Date().toISOString() };
  await mkdir(dirname(paths.job(dir, jobName)), { recursive: true });
  await Bun.write(paths.job(dir, jobName), JSON.stringify(job, null, 2));
  console.log(`pushed ${jobName} job: ${job.url ?? job.slug}`);
  return job.url ?? job.slug;
}

export type FetchRenderResult = {
  status: JobStatus;
  // Last lines of the job log, filled when the job ended in an error.
  logTail: string;
};

export async function fetchRender(
  dir: string,
  model: MotionModel,
  options: { wait?: boolean; jobName?: string } = {},
): Promise<FetchRenderResult> {
  const { username } = requireKaggle();
  const jobName = options.jobName ?? model;
  const jobFile = Bun.file(paths.job(dir, jobName));
  if (!(await jobFile.exists())) throw new Error(`No ${jobName} job has been pushed for ${dir}`);
  const job = jobSchema.parse(await jobFile.json());

  let status = await getJobStatus(username, job.slug);
  while (options.wait && (status.status === "queued" || status.status === "running")) {
    console.log(`${new Date().toLocaleTimeString()} ${jobName}: ${status.status}`);
    await Bun.sleep(POLL_SECONDS * 1000);
    // A dropped connection during a long wait should not abandon the job.
    status = await getJobStatus(username, job.slug).catch((error: Error) => {
      console.log(`status check failed, retrying: ${error.message}`);
      return status;
    });
  }
  console.log(`${jobName}: ${status.status}${status.failureMessage ? ` (${status.failureMessage})` : ""}`);
  if (status.status !== "complete" && status.status !== "error") return { status: status.status, logTail: "" };

  const output = await getJobOutput(username, job.slug);
  // Every job of a project downloads into the same folder, so a re-render of some scenes replaces just those files.
  const target = paths.renderDir(dir, model);
  await mkdir(target, { recursive: true });
  const log = formatJobLog(output.log);
  await Bun.write(join(target, `${jobName}.log`), log);
  for (const file of output.files) {
    if (file.fileName === "timings.json") {
      await downloadOutputFile({ ...file, fileName: `${jobName}-timings.json` }, target);
      continue;
    }
    await downloadOutputFile(file, target);
    console.log(`downloaded ${file.fileName}`);
  }

  const veogenLines = log.split("\n").filter((line) => line.includes("[veogen") || /Error|Killed/.test(line));
  return { status: status.status, logTail: status.status === "error" ? veogenLines.slice(-12).join("\n") : "" };
}
