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
import { buildImagePrompt } from "../schemas/story";
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
const CLIP_WIDTH: Record<MotionModel, number> = { wan5b: 704, wan14b: 480 };

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
};

export async function pushRender(dir: string, model: MotionModel, options: PushRenderOptions = {}): Promise<string> {
  const { username } = requireKaggle();
  const story = await loadStory(dir);
  const jobName = options.jobName ?? model;

  const scenes = [];
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

  const images: Record<number, string> = {};
  if (options.reuseImagesFrom) {
    for (const scene of scenes) {
      const source = join(paths.renderDir(dir, options.reuseImagesFrom), "images", `${sceneName(scene.index)}.png`);
      if (!(await Bun.file(source).exists())) throw new Error(`No image to reuse: ${source}`);
      // Kaggle rejects job sources over 1 MB, so images go as JPEGs at the size the motion model works at.
      const jpeg = join(paths.workDir(dir, jobName), `${sceneName(scene.index)}.jpg`);
      await mkdir(dirname(jpeg), { recursive: true });
      await ffmpeg(["-i", source, "-vf", `scale=${CLIP_WIDTH[model]}:-2:flags=lanczos`, "-q:v", "5", jpeg]);
      images[scene.index] = Buffer.from(await Bun.file(jpeg).arrayBuffer()).toString("base64");
    }
  }

  const jobConfig = { model, seed: story.seed + (options.clipSeedBump ?? 0), scenes, stages: options.stages ?? ["images", "clips"] };
  const template = await Bun.file(TEMPLATE_PATH).text();
  if (!template.includes(CONFIG_PLACEHOLDER) || !template.includes(IMAGES_PLACEHOLDER)) {
    throw new Error("kaggle/render.py is missing a placeholder");
  }
  const code = template
    .replace(CONFIG_PLACEHOLDER, Buffer.from(JSON.stringify(jobConfig)).toString("base64"))
    .replace(IMAGES_PLACEHOLDER, JSON.stringify(images));

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
