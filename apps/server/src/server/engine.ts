import { mkdir, rm } from "node:fs/promises";
import { addDays, addHours, format, set } from "date-fns";
import { config } from "../config";
import { ffmpeg } from "../lib/ffmpeg";
import { paths, saveStory } from "../lib/project";
import { publishPagePost, publishReel } from "../services/facebook";
import { sendAlert, type SendAlertPayload } from "../services/ntfy";
import { QuotaExceededError } from "../services/gemini";
import { addToPlaylist, createPlaylist, refreshAccessToken, setThumbnail, uploadVideo } from "../services/youtube";
import { collectReport, collectYoutube, summarizeReport } from "../stages/analytics";
import { runFullStory, runShort } from "../stages/fullstory";
import { hearScenes } from "../stages/hear";
import { runThumbnail } from "../stages/thumbnail";
import { runAssemble, type MusicMood } from "../stages/assemble";
import { checkScenes, type SceneFlag } from "../stages/check";
import { directMotion } from "../stages/motion";
import { AI_NOTE, writePagePost, type PostStill } from "../stages/posts";
import { getGpuQuota, type GpuQuotaResponse } from "../services/kaggle";
import { fetchRender, pushRender, type MotionModel } from "../stages/render";
import { writeArabicNames, writePlaces, writeSeriesBible, writeSeriesPart } from "../stages/series";
import { runStoryVoice, runVoice } from "../stages/voice";
import { chapterGpuSeconds, estimateStep } from "./estimates";
import {
  createEpisode,
  createPost,
  addCorrections,
  createSeries,
  getEpisode,
  getPost,
  getSeries,
  getSettings,
  getStep,
  getSteps,
  listCorrections,
  listEpisodes,
  listPosts,
  listReports,
  listSeries,
  OUTPUT_DIR,
  POST_ANGLES,
  reportBefore,
  saveEpisodeStory,
  saveReport,
  setEpisodeStatus,
  setSeriesFullStoryUrl,
  saveSeriesBible,
  setSeriesStatus,
  STEP_NAMES,
  STEP_NEEDS,
  stepsBuiltOn,
  updatePost,
  updateStep,
  type Episode,
  type Post,
  type PostAngle,
  type Report,
  type Series,
  type StepMeta,
  type StepName,
} from "./store";

export const MODEL: MotionModel = "wan14b";
// Lip sync is off: on the cartoon faces it was not visible, and it costs GPU time and room in each job.
// The motion description already has whoever speaks move their mouth.
const LIP_SYNC = false;
const KAGGLE_POLL_MS = 60_000;
// The music is Kevin MacLeod's under CC BY 4.0, which asks for this credit wherever a track is used.
const MUSIC_CREDIT = `Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/`;
const musicCredit = (tracks: string[]) => tracks.map((track) => `Music: "${track}" ${MUSIC_CREDIT}`);

// The track a chapter's video was made with, as its title (no file extension); "" before it is made.
async function musicTrack(episode: Episode): Promise<string> {
  const file = Bun.file(`${episode.dir}/music.txt`);
  return (await file.exists()) ? (await file.text()).trim().replace(/\.[^.]+$/, "") : "";
}

// Asks viewers to subscribe; worded to fit any chapter of a story, the last one included.
function followLine(): string {
  const brand = getSettings().brandName;
  return `اشتركوا في ${brand || "القناة"} عشان كل حدوتة جديدة توصلكم أول ما تنزل 🌟`;
}

// Steps running inside this process; anything marked running but missing here was cut off by a restart.
const localTasks = new Set<string>();
const lastPoll = new Map<string, number>();
let creating = false;
let ticking = false;

const taskKey = (episodeId: number, step: StepName) => `${episodeId}:${step}`;
const sceneNumbers = (episode: Episode) => (episode.story?.scenes ?? []).map((_, index) => index + 1);
// Scenes with nobody in them (a place, an object) get no GPU clip: the video moves slowly over their still
// picture instead, which looks the same for a landscape and saves about a quarter of an hour of GPU each.
// Older stories without "shows" animate every scene.
const isStill = (episode: Episode, number: number) => episode.story?.scenes[number - 1]?.shows?.length === 0;
// The scenes a step makes on the GPU: every scene's picture, but clips only where someone is in it.
const gpuScenes = (episode: Episode, step: "images" | "clips", scenes = sceneNumbers(episode)) =>
  step === "images" ? scenes : scenes.filter((number) => !isStill(episode, number));

// Network errors that mean "no connection right now", as opposed to a refusal by the service.
const OFFLINE = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNRESET|ETIMEDOUT/;

export const alertsConfigured = Boolean(config.NTFY_TOPIC);

// Sends an alert to the owner's phone. A failed alert is logged and never stops the work that raised it.
export async function alert(payload: Omit<SendAlertPayload, "topic">, options: { force?: boolean } = {}): Promise<boolean> {
  if (!config.NTFY_TOPIC || (!options.force && !getSettings().notifications)) return false;
  try {
    await sendAlert({ topic: config.NTFY_TOPIC, ...payload });
    return true;
  } catch (error) {
    console.error(`alert not sent: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

const STEP_LABELS: Record<StepName, string> = { story: "Script", voice: "Voice", images: "Images", clips: "Motion", video: "Final cut", publish: "Publish" };

// Tells the owner a step failed. Steps ready for review are looked at by the director, not the owner.
function alertStep(episodeId: number, step: StepName, outcome: "review" | "failed", detail?: string): void {
  if (outcome === "review") return;
  const part = getEpisode(episodeId)?.partNumber ?? episodeId;
  const title =
    outcome === "failed" ? `Part ${part}: ${STEP_LABELS[step]} failed` : step === "publish" ? `Part ${part} is ready to publish` : `Part ${part}: ${STEP_LABELS[step]} ready for review`;
  void alert({
    title,
    message: outcome === "failed" ? (detail ?? "Open the part to see what went wrong.").slice(0, 300) : `${detail ? `${detail} ` : ""}Open Veogen to review it.`,
    click: `veogen://episodes/${episodeId}`,
    tags: [outcome === "failed" ? "warning" : "clapper"],
    priority: outcome === "failed" ? 4 : 3,
  });
}

function fail(episodeId: number, step: StepName, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`episode ${episodeId} ${step} failed: ${message}`);
  updateStep(episodeId, step, { status: "failed", error: message.slice(0, 2000) });
  alertStep(episodeId, step, "failed", message.split("\n")[0]);
}

// The work may return a line for the "ready for review" alert.
function runLocal(episode: Episode, step: StepName, work: () => Promise<string | void>): void {
  const key = taskKey(episode.id, step);
  localTasks.add(key);
  updateStep(episode.id, step, { status: "running", error: null, meta: { startedAt: new Date().toISOString(), waitingFor: undefined } });
  work()
    .then((detail) => {
      updateStep(episode.id, step, { status: "review" });
      alertStep(episode.id, step, "review", detail || undefined);
    })
    .catch((error) => {
      // With the laptop offline nothing is wrong with the step: it waits and tries again on a later tick.
      if (OFFLINE.test(error instanceof Error ? error.message : String(error))) {
        updateStep(episode.id, step, { status: "queued", error: "Waiting for the internet connection" });
        return;
      }
      fail(episode.id, step, error);
    })
    .finally(() => localTasks.delete(key));
}

// A few stills from the parts already made, so places described later match what viewers have seen.
async function publishedStills(seriesId: number): Promise<Buffer[]> {
  const stills: Buffer[] = [];
  const made = listEpisodes({ seriesId }).filter((other) => other.status !== "cancelled" && other.story).sort((a, b) => b.partNumber - a.partNumber);
  for (const other of made.slice(0, 2)) {
    for (const scene of [2, 5, 9, 14]) {
      const source = `${paths.renderDir(other.dir, MODEL)}/images/scene-${String(scene).padStart(2, "0")}.png`;
      if (!(await Bun.file(source).exists())) continue;
      const jpeg = `${paths.workDir(other.dir, "places")}/scene-${String(scene).padStart(2, "0")}.jpg`;
      await mkdir(paths.workDir(other.dir, "places"), { recursive: true });
      await ffmpeg(["-i", source, "-vf", "scale=384:-2", "-q:v", "6", jpeg]);
      stills.push(Buffer.from(await Bun.file(jpeg).arrayBuffer()));
    }
  }
  return stills;
}

async function writeStory(episode: Episode, meta: StepMeta): Promise<string | undefined> {
  const series = getSeries(episode.seriesId);
  if (!series) throw new Error("The episode's series no longer exists");
  const previous = listEpisodes({ seriesId: series.id })
    .filter((other) => other.partNumber < episode.partNumber && other.status !== "cancelled" && other.story)
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((other) => ({
      number: other.partNumber,
      narration: (other.story?.scenes ?? []).map((scene) => scene.narration).join(" "),
    }));
  // A series planned before places and objects had fixed looks gets them once, and keeps them for every later part.
  let bible = series.bible;
  if (bible.places.length === 0) {
    bible = { ...bible, ...(await writePlaces(bible, previous, await publishedStills(series.id))) };
    saveSeriesBible(series.id, bible);
  }
  // Likewise a series planned before places and objects had Arabic names gets them once.
  if ([...bible.places, ...bible.props].some((thing) => !thing.nameArabic)) {
    bible = await writeArabicNames(bible);
    saveSeriesBible(series.id, bible);
  }
  const { story, flags } = await writeSeriesPart({
    bible,
    partNumber: episode.partNumber,
    scenes: getSettings().scenesPerPart,
    previous,
    seed: series.seed,
    current: meta.note ? (episode.story ?? undefined) : undefined,
    note: meta.note,
    corrections: listCorrections(),
  });
  saveEpisodeStory(episode.id, story);
  await saveStory(episode.dir, story);
  updateStep(episode.id, "story", { meta: { flags } });
  if (flags.length === 0) return undefined;
  const scenes = flags.filter((flag) => flag.scene > 0).map((flag) => flag.scene);
  return flags.some((flag) => flag.scene === 0)
    ? "It was not proofread."
    : `The proofreader flagged ${scenes.length === 1 ? "scene" : "scenes"} ${scenes.join(", ")}.`;
}

// Kaggle is asked for the GPU allowance at most every few minutes, however often it is needed.
const QUOTA_TTL_MS = 5 * 60_000;
let quotaCache: { at: number; value: GpuQuotaResponse | null } = { at: 0, value: null };

export async function cachedGpuQuota(): Promise<GpuQuotaResponse | null> {
  if (Date.now() - quotaCache.at > QUOTA_TTL_MS) {
    quotaCache = { at: Date.now(), value: await getGpuQuota().catch(() => quotaCache.value) };
  }
  return quotaCache.value;
}

// When the weekly GPU allowance is too small for this much work: when it resets, else null.
// An allowance that cannot be read never holds anything up.
async function gpuShortfall(seconds: number): Promise<string | null> {
  const quota = await cachedGpuQuota();
  if (!quota || quota.allowedSeconds === 0) return null;
  return quota.allowedSeconds - quota.usedSeconds >= seconds ? null : (quota.refreshesAt ?? "the weekly reset");
}

async function startRender(episode: Episode, step: "images" | "clips", meta: StepMeta): Promise<void> {
  const scenes = gpuScenes(episode, step, meta.scenes?.length ? meta.scenes : sceneNumbers(episode));
  // Only still scenes asked for: nothing to make on the GPU.
  if (scenes.length === 0) {
    updateStep(episode.id, step, { status: "review", error: null, meta: { waitingFor: undefined } });
    return;
  }
  // Marked first, so the next tick does not start the same job while this one prepares.
  updateStep(episode.id, step, { status: "running", error: null, meta: { startedAt: new Date().toISOString(), waitingForGpu: undefined, waitingFor: undefined } });
  if (step === "clips" && episode.story) {
    // Each motion description is rewritten against the approved image. If that fails, the script's own is used.
    try {
      const story = await directMotion(episode.dir, episode.story, { model: MODEL, scenes, note: meta.note });
      saveEpisodeStory(episode.id, story);
      await saveStory(episode.dir, story);
    } catch (error) {
      console.error(`episode ${episode.id} motion direction: ${error instanceof Error ? error.message : error}`);
    }
  }
  // The old files go first, so "all files present" afterwards really means the new ones arrived.
  for (const scene of scenes) {
    const file =
      step === "images"
        ? `${paths.renderDir(episode.dir, MODEL)}/images/scene-${String(scene).padStart(2, "0")}.png`
        : paths.clip(episode.dir, MODEL, scene);
    await rm(file, { force: true });
  }
  try {
    const jobUrl = await pushRender(episode.dir, MODEL, {
      stages: [step],
      scenes,
      jobName: step,
      imageSeedBump: step === "images" ? meta.attempt : 0,
      clipSeedBump: step === "clips" ? meta.attempt : 0,
      reuseImagesFrom: step === "clips" ? MODEL : undefined,
      lipSync: step === "clips" && LIP_SYNC,
    });
    // The clock for the estimate starts when the job is really on Kaggle, not while it was being prepared.
    updateStep(episode.id, step, { meta: { jobUrl, startedAt: new Date().toISOString() } });
  } catch (error) {
    fail(episode.id, step, error);
  }
}

// Has the scenes that were just made looked at; flags for scenes that were not redone are kept.
// A check that cannot run never holds up the review: the step simply arrives without new flags.
async function checkRender(episode: Episode, step: "images" | "clips"): Promise<SceneFlag[]> {
  const meta = getStep(episode.id, step).meta;
  const redone = gpuScenes(episode, step, meta.scenes?.length ? meta.scenes : sceneNumbers(episode));
  const kept = (meta.flags ?? []).filter((flag) => !redone.includes(flag.scene));
  if (!episode.story) return kept;
  try {
    const found = await checkScenes(episode.dir, episode.story, { model: MODEL, kind: step, scenes: redone });
    return [...kept, ...found].sort((a, b) => a.scene - b.scene);
  } catch (error) {
    console.error(`episode ${episode.id} ${step} check: ${error instanceof Error ? error.message : error}`);
    return kept;
  }
}

async function pollRender(episode: Episode, step: "images" | "clips"): Promise<void> {
  const key = taskKey(episode.id, step);
  if (Date.now() - (lastPoll.get(key) ?? 0) < KAGGLE_POLL_MS) return;
  lastPoll.set(key, Date.now());
  try {
    const result = await fetchRender(episode.dir, MODEL, { jobName: step });
    if (result.status === "queued" || result.status === "running") return;
    const missing: number[] = [];
    for (const scene of gpuScenes(episode, step)) {
      const file =
        step === "images"
          ? `${paths.renderDir(episode.dir, MODEL)}/images/scene-${String(scene).padStart(2, "0")}.png`
          : paths.clip(episode.dir, MODEL, scene);
      if (!(await Bun.file(file).exists())) missing.push(scene);
    }
    if (missing.length === 0) {
      const flags = await checkRender(episode, step);
      updateStep(episode.id, step, { status: "review", error: null, meta: { flags } });
      alertStep(episode.id, step, "review", flags.length ? `The check flagged ${flags.length === 1 ? "scene" : "scenes"} ${flags.map((flag) => flag.scene).join(", ")}.` : undefined);
    } else {
      fail(episode.id, step, `The Kaggle job ended (${result.status}) without scenes ${missing.join(", ")}.\n${result.logTail}`);
    }
  } catch (error) {
    // A dropped connection is not a failed job; the next poll tries again.
    console.error(`episode ${episode.id} ${step} poll: ${error instanceof Error ? error.message : error}`);
  }
}

// Notes why a queued step has not started, once, so the apps can show it.
function wait(episode: Episode, name: StepName, meta: StepMeta, reason: string): void {
  if (meta.waitingFor !== reason) updateStep(episode.id, name, { meta: { waitingFor: reason } });
}

// The Kaggle account runs one GPU job at a time, so a job only starts when no chapter has one running.
function gpuBusy(): boolean {
  return listEpisodes({ status: "in_progress" }).some((episode) =>
    getSteps(episode.id).some((step) => (step.name === "images" || step.name === "clips") && step.status === "running"),
  );
}

// The GPU job that goes next: the earliest chapter's, so a redo of chapter 1 (and then its clips) goes before
// chapter 3's first pictures, and chapters are finished in story order.
function nextGpuJob(): string | null {
  const chapters = listEpisodes({ status: "in_progress" }).sort((a, b) => a.seriesId - b.seriesId || a.partNumber - b.partNumber);
  for (const episode of chapters) {
    for (const name of ["images", "clips"] as const) {
      if (getStep(episode.id, name).status === "queued") return taskKey(episode.id, name);
    }
  }
  return null;
}

// Every step that is running or ready is moved on: the voice and the images are made at the same time.
async function advance(episode: Episode): Promise<void> {
  for (const step of getSteps(episode.id)) {
    if (step.status === "running") {
      if (step.name === "images" || step.name === "clips") await pollRender(episode, step.name);
      else if (!localTasks.has(taskKey(episode.id, step.name))) updateStep(episode.id, step.name, { status: "queued" });
    } else if (step.status === "queued") {
      await start(episode, step.name, step.meta);
    }
  }
}

async function start(episode: Episode, name: StepName, meta: StepMeta): Promise<void> {
  switch (name) {
    case "story": {
      // Each chapter is written from the ones before it, so it waits until they are written.
      const unwritten = listEpisodes({ seriesId: episode.seriesId }).find(
        (other) => other.partNumber < episode.partNumber && other.status !== "cancelled" && !other.story,
      );
      if (unwritten) return wait(episode, name, meta, `chapter ${unwritten.partNumber} to be written`);
      runLocal(episode, name, () => writeStory(episode, meta));
      return;
    }
    case "voice":
      startVoice(episode, meta);
      return;
    case "images":
    case "clips": {
      if (gpuBusy()) return wait(episode, name, meta, "another chapter's GPU job to finish");
      if (nextGpuJob() !== taskKey(episode.id, name)) return wait(episode, name, meta, "an earlier chapter's GPU job to go first");
      // A job Kaggle cannot finish this week waits for the reset instead of being cut off halfway.
      const resetsAt = await gpuShortfall(estimateStep({ name, status: "queued", meta, error: null, updatedAt: "" }, gpuScenes(episode, name).length).estimateSeconds ?? 0);
      if (resetsAt) {
        if (meta.waitingForGpu !== resetsAt) updateStep(episode.id, name, { meta: { waitingForGpu: resetsAt } });
        return;
      }
      await startRender(episode, name, meta);
      return;
    }
    case "video":
      runLocal(episode, name, async () => {
        await runAssemble(episode.dir, MODEL, { mood: musicMood(episode), musicTrack: meta.musicTrack, musicVolume: meta.musicVolume, sfxVolume: meta.sfxVolume });
      });
      return;
    case "publish":
      // A finished chapter waits here; once every chapter is finished the whole story goes out together.
      updateStep(episode.id, name, { status: "review", meta: { waitingFor: "the other chapters, then the story goes to YouTube" } });
  }
}

// Gemini's free voice requests run out for the day; recording tries again once they reset at midnight
// Pacific time (08:00 UTC, an hour late in summer, which is harmless).
let voiceBlockedUntil = 0;
const nextVoiceReset = () => {
  const reset = new Date();
  reset.setUTCHours(8, 0, 0, 0);
  if (reset.getTime() <= Date.now()) reset.setUTCDate(reset.getUTCDate() + 1);
  return reset.getTime();
};

// The first recording of a story waits for every chapter's approved script and records them all
// together, which costs about as many requests as one chapter. A redo records its own chapter only.
function startVoice(episode: Episode, meta: StepMeta): void {
  if (Date.now() < voiceBlockedUntil) return wait(episode, "voice", meta, "tomorrow's free voice requests");
  if (meta.note || meta.attempt > 0) {
    runVoiceTask([episode], () => runVoice(episode.dir, { force: true, styleNote: meta.note }).then(() => undefined));
    return;
  }
  const chapters = listEpisodes({ seriesId: episode.seriesId })
    .filter((other) => other.status !== "cancelled")
    .sort((a, b) => a.partNumber - b.partNumber);
  const planned = getSeries(episode.seriesId)?.bible.parts.length ?? chapters.length;
  const unapproved = chapters.filter((other) => getStep(other.id, "story").status !== "approved");
  if (chapters.length < planned || unapproved.length > 0) return wait(episode, "voice", meta, "every chapter's script to be approved");
  const batch = chapters.filter((other) => {
    const step = getStep(other.id, "voice");
    return step.status === "queued" && !step.meta.note && step.meta.attempt === 0;
  });
  runVoiceTask(batch, () => runStoryVoice(batch.map((other) => other.dir)));
}

function runVoiceTask(episodes: Episode[], work: () => Promise<void>): void {
  for (const episode of episodes) {
    localTasks.add(taskKey(episode.id, "voice"));
    updateStep(episode.id, "voice", { status: "running", error: null, meta: { startedAt: new Date().toISOString(), waitingFor: undefined } });
  }
  work()
    .then(async () => {
      // Each chapter is listened to against its script before review.
      for (const episode of episodes) {
        const story = getEpisode(episode.id)?.story;
        const flags = story
          ? await hearScenes(episode.dir, story).catch((error) => {
              console.error(`episode ${episode.id} voice check: ${error instanceof Error ? error.message : error}`);
              return [];
            })
          : [];
        updateStep(episode.id, "voice", { status: "review", meta: { flags } });
      }
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof QuotaExceededError) {
        voiceBlockedUntil = nextVoiceReset();
        for (const episode of episodes) updateStep(episode.id, "voice", { status: "queued", error: null, meta: { waitingFor: "tomorrow's free voice requests" } });
        return;
      }
      if (OFFLINE.test(message)) {
        for (const episode of episodes) updateStep(episode.id, "voice", { status: "queued", error: "Waiting for the internet connection" });
        return;
      }
      for (const episode of episodes) fail(episode.id, "voice", error);
    })
    .finally(() => {
      for (const episode of episodes) localTasks.delete(taskKey(episode.id, "voice"));
    });
}

export async function createNextEpisode(idea?: string): Promise<Episode> {
  const settings = getSettings();
  let series = listSeries().find((candidate) => candidate.status === "active") ?? null;
  let partNumber = 1;
  if (series) {
    const parts = listEpisodes({ seriesId: series.id }).filter((episode) => episode.status !== "cancelled");
    partNumber = Math.max(0, ...parts.map((episode) => episode.partNumber)) + 1;
    if (partNumber > series.bible.parts.length) {
      setSeriesStatus(series.id, "finished");
      series = null;
      partNumber = 1;
    }
  }
  if (!series) {
    // Each week's story is made with that week's GPU allowance, so a new one starts only when all its chapters fit.
    const needed = chapterGpuSeconds(settings.scenesPerPart) * settings.partsPerSeries;
    const resetsAt = await gpuShortfall(needed);
    if (resetsAt) {
      throw new Error(`A new story needs about ${Math.ceil(needed / 3600)} GPU hours, more than this week has left; it can start after the allowance resets (${resetsAt}).`);
    }
    series = createSeries(await writeSeriesBible({ idea, parts: settings.partsPerSeries, earlier: listSeries().map((other) => other.bible) }));
    // Every chapter is set up at once; each is written as soon as the one before it is.
    const first = createEpisode(series.id, 1);
    for (let part = 2; part <= series.bible.parts.length; part++) createEpisode(series.id, part);
    return first;
  }
  return createEpisode(series.id, partNumber);
}

// After a failed attempt (usually: not enough GPU left this week), a new story is tried again this much later.
const CREATE_RETRY_MS = 30 * 60_000;
let lastCreateFailure = 0;

// A new story starts once the last one has gone out to YouTube and nothing else is being made.
async function ensureStory(): Promise<void> {
  const settings = getSettings();
  if (!settings.autoCreate || creating || Date.now() - lastCreateFailure < CREATE_RETRY_MS) return;
  if (listSeries().some((series) => series.status === "active")) return;
  if (listEpisodes({ status: "in_progress" }).length > 0) return;
  creating = true;
  try {
    const episode = await createNextEpisode();
    console.log(`started a new story: series ${episode.seriesId}`);
  } catch (error) {
    lastCreateFailure = Date.now();
    console.error(`could not start a new story: ${error instanceof Error ? error.message : error}`);
  } finally {
    creating = false;
  }
}


const withAiNote = (text: string, hasImage: boolean) => {
  const plain = text.replace(AI_NOTE, "").trim();
  return hasImage ? `${plain}\n\n${AI_NOTE}` : plain;
};

// The published parts of the newest series the followers have seen, and their pictures.
async function pagePostContext() {
  const series = listSeries().find((candidate) => listEpisodes({ seriesId: candidate.id, status: "published" }).length > 0) ?? listSeries()[0];
  const parts = series ? listEpisodes({ seriesId: series.id }).filter((episode) => episode.status !== "cancelled") : [];
  const watchedParts = parts.filter((episode) => episode.status === "published" && episode.story).sort((a, b) => a.partNumber - b.partNumber);
  const stills: PostStill[] = [];
  // Pictures come from the last two published parts, which the followers remember best.
  for (const episode of watchedParts.slice(-2)) {
    for (const [index, scene] of (episode.story?.scenes ?? []).entries()) {
      const path = `${paths.renderDir(episode.dir, MODEL)}/images/scene-${String(index + 1).padStart(2, "0")}.png`;
      if (await Bun.file(path).exists()) stills.push({ path, part: episode.partNumber, narration: scene.narration });
    }
  }
  return {
    brandName: getSettings().brandName,
    seriesTitle: series?.bible.title,
    hashtags: series?.bible.hashtags ?? [],
    watched: watchedParts.map((episode) => ({
      number: episode.partNumber,
      narration: (episode.story?.scenes ?? []).map((scene) => scene.narration).join(" "),
    })),
    moreComing: Boolean(series && (series.status === "active" || parts.some((episode) => episode.status === "in_progress"))),
    stills,
  };
}

// The angle used least recently, so consecutive posts do different jobs.
function nextAngle(): PostAngle {
  const recent = listPosts().slice(0, POST_ANGLES.length - 1).map((post) => post.angle);
  return POST_ANGLES.find((angle) => !recent.includes(angle)) ?? POST_ANGLES[0];
}

const recentPostTexts = (except?: number) =>
  listPosts()
    .filter((post) => post.id !== except && post.status !== "discarded")
    .slice(0, 8)
    .map((post) => post.text);

// Drafts a new Page post for the owner to review. `idea` is the owner's own direction for it.
export async function draftPost(idea?: string): Promise<Post> {
  const angle = nextAngle();
  const written = await writePagePost({ ...(await pagePostContext()), angle, recent: recentPostTexts(), note: idea });
  return createPost({ angle, text: withAiNote(written.text, Boolean(written.imagePath)), imagePath: written.imagePath });
}

// Rewrites a draft from the owner's note, keeping its picture.
export async function rewritePost(id: number, note?: string): Promise<Post> {
  const post = getPost(id);
  if (!post || post.status !== "draft") throw new Error("Only a draft can be rewritten");
  const written = await writePagePost({
    ...(await pagePostContext()),
    angle: post.angle,
    recent: recentPostTexts(post.id),
    note: note || "Write a different take on the same idea.",
    current: post.text,
  });
  return updatePost(id, { text: withAiNote(written.text, Boolean(post.imagePath) && post.withImage), error: null });
}

export async function publishPost(id: number): Promise<Post> {
  const post = getPost(id);
  if (!post || post.status !== "draft") throw new Error("This post is not waiting to be published");
  if (!config.FACEBOOK_PAGE_ID || !config.FACEBOOK_PAGE_TOKEN) throw new Error("Facebook is not connected yet (see Settings)");
  const attach = post.withImage && post.imagePath && (await Bun.file(post.imagePath).exists()) ? post.imagePath : undefined;
  try {
    const result = await publishPagePost({
      pageId: config.FACEBOOK_PAGE_ID,
      pageToken: config.FACEBOOK_PAGE_TOKEN,
      message: post.text,
      imagePath: attach,
    });
    return updatePost(id, { status: "published", url: result.url, error: null });
  } catch (error) {
    updatePost(id, { error: (error instanceof Error ? error.message : String(error)).slice(0, 1000) });
    throw error;
  }
}

// Records the Page's numbers now. Kept so that later reports can be compared with this one.
export async function takeReport(): Promise<Report> {
  if (!config.FACEBOOK_PAGE_ID || !config.FACEBOOK_PAGE_TOKEN) throw new Error("Facebook is not connected yet (see Settings)");
  const data = await collectReport({ pageId: config.FACEBOOK_PAGE_ID, pageToken: config.FACEBOOK_PAGE_TOKEN });
  // A problem on YouTube's side must not cost the Facebook half of the report.
  if (youtubeConnected) {
    try {
      data.youtube = await collectYoutube(await youtubeAccessToken());
    } catch (error) {
      console.error(`report without YouTube: ${error instanceof Error ? error.message : error}`);
    }
  }
  return saveReport(data);
}

export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    // This project posts to YouTube only: no Facebook Page posts or Page reports.
    await ensureStory();
    publishScheduled();
    // Not awaited: joining and uploading a story takes minutes and must not hold up the chapters.
    void ensureRelease();
    for (const episode of listEpisodes({ status: "in_progress" }).reverse()) {
      await advance(episode).catch((error) => console.error(`episode ${episode.id}: ${error}`));
    }
  } finally {
    ticking = false;
  }
}

export function approveStep(episodeId: number, name: StepName): void {
  const step = getStep(episodeId, name);
  if (step.status !== "review") throw new Error(`The ${name} step is not waiting for review`);
  updateStep(episodeId, name, { status: "approved", meta: { note: undefined, scenes: undefined } });
  // Each step made from this one starts once everything else it is made from is approved too.
  for (const later of STEP_NAMES) {
    if (!STEP_NEEDS[later].includes(name) || getStep(episodeId, later).status !== "waiting") continue;
    if (STEP_NEEDS[later].every((need) => getStep(episodeId, need).status === "approved")) updateStep(episodeId, later, { status: "queued", error: null });
  }
}

export type RejectOptions = { note?: string; scenes?: number[]; musicTrack?: string; musicVolume?: number; sfxVolume?: number };

// Sends a step back to be redone, and resets every step built on it. Steps beside it (the voice when the
// images are redone) are kept.
export function rejectStep(episodeId: number, name: StepName, options: RejectOptions): void {
  const step = getStep(episodeId, name);
  if (step.status === "running" || step.status === "waiting") throw new Error(`The ${name} step cannot be redone right now`);
  // A reason given for rejecting a script is kept, so later scripts avoid the same thing.
  if (name === "story" && options.note) addCorrections("note", [options.note]);
  updateStep(episodeId, name, {
    status: "queued",
    error: null,
    meta: {
      note: options.note,
      scenes: options.scenes,
      attempt: step.meta.attempt + 1,
      musicTrack: options.musicTrack ?? step.meta.musicTrack,
      musicVolume: options.musicVolume ?? step.meta.musicVolume,
      sfxVolume: options.sfxVolume ?? step.meta.sfxVolume,
    },
  });
  // A Kaggle job already running for a later step is NOT stopped by this: Kaggle's API gives no way to
  // find the running session, so the owner has to stop it on Kaggle.
  for (const later of stepsBuiltOn(name)) {
    updateStep(episodeId, later, { status: "waiting", error: null, meta: { scenes: undefined, note: undefined, scheduledFor: undefined, waitingFor: undefined } });
  }
}

// Bedtime stories get calm music.
export function musicMood(episode: Episode): MusicMood {
  return getSeries(episode.seriesId)?.bible.storyType === "bedtime" ? "calm" : "cheerful";
}

// Sends viewers of a chapter to the whole story. Links in Shorts descriptions cannot be clicked, so the
// words matter more than the link.
function fullStoryLine(series: Series | null): string {
  return series?.fullStoryUrl ? `الحكاية كاملة على القناة 👈 ${series.fullStoryUrl}` : "الحكاية كاملة على القناة 👈";
}

// The description of a chapter's Short.
export async function buildDescription(episode: Episode): Promise<string> {
  const story = episode.story;
  if (!story) return "";
  const track = await musicTrack(episode);
  return [
    story.title,
    story.description,
    fullStoryLine(getSeries(episode.seriesId)),
    followLine(),
    [...story.hashtags, "#shorts"].join(" "),
    ...musicCredit(track ? [track] : []),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const youtubeConnected = Boolean(config.YOUTUBE_CLIENT_ID && config.YOUTUBE_CLIENT_SECRET && config.YOUTUBE_REFRESH_TOKEN);

// A short-lived token for the connected channel. A function declaration, so the report code above can use it.
async function youtubeAccessToken(): Promise<string> {
  if (!config.YOUTUBE_CLIENT_ID || !config.YOUTUBE_CLIENT_SECRET || !config.YOUTUBE_REFRESH_TOKEN) throw new Error("YouTube is not connected yet (see Settings)");
  return refreshAccessToken({
    clientId: config.YOUTUBE_CLIENT_ID,
    clientSecret: config.YOUTUBE_CLIENT_SECRET,
    refreshToken: config.YOUTUBE_REFRESH_TOKEN,
  });
}

// Uploads a finished video to the connected YouTube channel. A vertical video under three minutes becomes a Short.
// With `publishAt` it stays private until then, and YouTube makes it public by itself.
async function uploadToYoutube(video: { path: string; title: string; description: string; hashtags: string[]; publishAt?: string }) {
  const uploaded = await uploadVideo({
    accessToken: await youtubeAccessToken(),
    videoPath: video.path,
    title: video.title,
    description: video.description,
    tags: video.hashtags.map((tag) => tag.replace(/^#/, "").replace(/_/g, " ")).filter(Boolean),
    publishAt: video.publishAt,
  });
  return {
    videoId: uploaded.videoId,
    url: uploaded.url,
    // YouTube can hold uploads from an app it has not reviewed as private, whatever was asked for.
    detail:
      uploaded.privacy === "public" || video.publishAt
        ? undefined
        : `YouTube saved it as ${uploaded.privacy}. Open it in YouTube Studio to make it public.`,
  };
}

const youtubeUploads = new Set<number>();

// Sends a part that is already published elsewhere to YouTube, for parts that went out before the channel
// was connected or whose automatic upload failed.
export async function uploadEpisodeToYoutube(episodeId: number): Promise<void> {
  const episode = getEpisode(episodeId);
  if (!episode || episode.status !== "published") throw new Error("Only a published part can be sent to YouTube from here");
  const published = getStep(episodeId, "publish").meta.published ?? {};
  if (published.youtube?.status === "posted") throw new Error("This part is already on YouTube");
  if (youtubeUploads.has(episodeId)) throw new Error("This part is being uploaded right now");
  youtubeUploads.add(episodeId);
  try {
    const uploaded = await uploadToYoutube({
      path: await shortVideo(episode),
      title: episode.story?.title ?? "",
      description: await buildDescription(episode),
      hashtags: episode.story?.hashtags ?? [],
    });
    updateStep(episodeId, "publish", { meta: { published: { ...published, youtube: { status: "posted", ...uploaded } } } });
  } finally {
    youtubeUploads.delete(episodeId);
  }
}

export const fullStoryPaths = (seriesId: number) => {
  const dir = `${OUTPUT_DIR}/series/s${seriesId}`;
  return { video: `${dir}/full-story.mp4`, parts: `${dir}/full-story.json`, thumbnail: `${dir}/thumbnail.jpg`, release: `${dir}/release.json` };
};

// The vertical Short of a chapter, made from its wide video the first time it is needed.
async function shortVideo(episode: Episode): Promise<string> {
  const wide = paths.final(episode.dir, MODEL);
  const short = `${episode.dir}/short-${MODEL}.mp4`;
  const made = Bun.file(short);
  if (!(await made.exists()) || made.lastModified < Bun.file(wide).lastModified) await runShort(wide, short);
  return short;
}

const fullStoryBuilds = new Set<number>();
export const fullStoryBuilding = (seriesId: number) => fullStoryBuilds.has(seriesId);

// The chapters of a series whose video is finished (approved) or already out, in story order.
function finishedParts(seriesId: number): Episode[] {
  return listEpisodes({ seriesId })
    .filter((episode) => episode.status === "published" || (episode.status === "in_progress" && ["review", "approved"].includes(getStep(episode.id, "publish").status)))
    .sort((a, b) => a.partNumber - b.partNumber);
}

const imagePath = (episode: Episode, scene: number) => `${paths.renderDir(episode.dir, MODEL)}/images/scene-${String(scene).padStart(2, "0")}.png`;

// Joins every finished chapter of a series into one video, opened and closed once with a title card.
// Returns the chapter numbers it holds.
export async function buildFullStory(seriesId: number): Promise<number[]> {
  if (fullStoryBuilds.has(seriesId)) throw new Error("The full story is already being put together");
  const series = getSeries(seriesId);
  const parts = finishedParts(seriesId);
  if (!series || parts.length < 2) throw new Error("The full story needs at least two finished chapters");
  for (const episode of parts) {
    if (!(await Bun.file(paths.final(episode.dir, MODEL)).exists())) throw new Error(`Part ${episode.partNumber} has no finished video on the server`);
  }
  // Each chapter again without its title and opening line, so the film runs on from one chapter to the next.
  const videos: string[] = [];
  for (const episode of parts) {
    const clean = `${episode.dir}/video-${MODEL}-full.mp4`;
    const meta = getStep(episode.id, "video").meta;
    await runAssemble(episode.dir, MODEL, { mood: musicMood(episode), musicTrack: meta.musicTrack, musicVolume: meta.musicVolume, sfxVolume: meta.sfxVolume, titles: false, output: clean });
    videos.push(clean);
  }
  const target = fullStoryPaths(seriesId);
  fullStoryBuilds.add(seriesId);
  try {
    const first = parts[0] as Episode;
    const last = parts.at(-1) as Episode;
    const brand = getSettings().brandName;
    await runFullStory(videos, target.video, {
      intro: {
        image: imagePath(first, 1),
        lines: [...(brand ? [{ text: brand, size: 72 }] : []), { text: series.bible.title, size: 120, gold: true }],
      },
      outro: {
        image: imagePath(last, last.story?.scenes.length ?? 1),
        lines: [
          { text: "وتوتة توتة فرغت الحدوتة", size: 116, gold: true },
          { text: "حلوة ولا ملتوتة؟", size: 84 },
          { text: "الحكاية الجاية الأسبوع الجاي", size: 72 },
        ],
      },
    });
    const numbers = parts.map((episode) => episode.partNumber);
    await Bun.write(target.parts, JSON.stringify({ parts: numbers, builtAt: new Date().toISOString() }));
    return numbers;
  } finally {
    fullStoryBuilds.delete(seriesId);
  }
}

// Uploads the joined video to YouTube and remembers its link, which later descriptions send viewers to.
export async function uploadFullStory(seriesId: number): Promise<string> {
  const series = getSeries(seriesId);
  if (!series) throw new Error("No such series");
  const video = fullStoryPaths(seriesId).video;
  if (fullStoryBuilds.has(seriesId) || !(await Bun.file(video).exists())) throw new Error("Join the parts first");
  const text = await fullStoryText(series);
  const uploaded = await uploadToYoutube({ path: video, title: text.title, description: text.description, hashtags: series.bible.hashtags });
  setSeriesFullStoryUrl(seriesId, uploaded.url);
  if (uploaded.detail) throw new Error(`Uploaded, but ${uploaded.detail}`);
  return uploaded.url;
}

// What has gone out of a story so far, kept so a release cut off halfway carries on where it stopped.
type Release = { publishAt: string; playlistId?: string; videoId?: string; thumbnail?: "set" | string };

let releasing = false;
let lastReleaseFailure = 0;
const RELEASE_RETRY_MS = 60 * 60_000;

// Once every chapter of a story is finished, the whole story goes to YouTube: the joined film, scheduled a
// day ahead so the owner can still stop it, then one chapter a day as a Short after it.
async function ensureRelease(): Promise<void> {
  if (releasing || !youtubeConnected || Date.now() - lastReleaseFailure < RELEASE_RETRY_MS) return;
  for (const series of listSeries().filter((candidate) => candidate.status === "active")) {
    const chapters = listEpisodes({ seriesId: series.id }).filter((episode) => episode.status !== "cancelled");
    if (chapters.length < series.bible.parts.length) continue;
    if (finishedParts(series.id).length < chapters.length) continue;
    releasing = true;
    try {
      await releaseStory(series);
    } catch (error) {
      lastReleaseFailure = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      console.error(`release of series ${series.id}: ${message}`);
      void alert({ title: `${series.bible.title} did not go out`, message: message.slice(0, 300), click: "veogen://series", tags: ["warning"], priority: 4 });
    } finally {
      releasing = false;
    }
    return;
  }
}

async function releaseStory(series: Series): Promise<void> {
  const target = fullStoryPaths(series.id);
  const saved = Bun.file(target.release);
  const [hours, minutes] = getSettings().publishTime.split(":").map(Number) as [number, number];
  let release: Release = (await saved.exists())
    ? ((await saved.json()) as Release)
    : // The film goes public at the posting time at least a day from now: the owner's window to stop it.
      { publishAt: (() => {
          let at = set(addHours(new Date(), 24), { hours, minutes, seconds: 0, milliseconds: 0 });
          if (at < addHours(new Date(), 24)) at = addDays(at, 1);
          return at.toISOString();
        })() };
  const keep = async (next: Release) => {
    release = next;
    await Bun.write(target.release, JSON.stringify(release, null, 2));
  };
  const token = await youtubeAccessToken();
  const chapters = finishedParts(series.id);

  if (!release.playlistId) {
    const playlistId = await createPlaylist({ accessToken: token, title: series.bible.title, description: chapters[0]?.story?.description ?? "" });
    await keep({ ...release, playlistId });
  }
  if (!release.videoId) {
    if (!(await Bun.file(target.video).exists())) await buildFullStory(series.id);
    const text = await fullStoryText(series);
    const uploaded = await uploadToYoutube({ path: target.video, title: text.title, description: text.description, hashtags: series.bible.hashtags, publishAt: release.publishAt });
    setSeriesFullStoryUrl(series.id, uploaded.url);
    await keep({ ...release, videoId: uploaded.videoId });
    await addToPlaylist({ accessToken: token, playlistId: release.playlistId as string, videoId: uploaded.videoId, position: 0 });
  }
  if (!release.thumbnail) {
    // A channel that is not phone-verified cannot set thumbnails; the film still goes out, with YouTube's own pick.
    try {
      const images = chapters.flatMap((episode) =>
        (episode.story?.scenes ?? []).flatMap((scene, index) => (scene.shows?.includes("Hero") ? [imagePath(episode, index + 1)] : [])),
      );
      await runThumbnail(images.filter((_, index) => index % 4 === 0), series.bible.title, target.thumbnail);
      await setThumbnail({ accessToken: token, videoId: release.videoId as string, imagePath: target.thumbnail });
      await keep({ ...release, thumbnail: "set" });
    } catch (error) {
      await keep({ ...release, thumbnail: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
    }
  }

  // One chapter a day after the film, at the posting time.
  const shorts: string[] = [];
  for (const [index, episode] of chapters.entries()) {
    const done = getStep(episode.id, "publish").meta.published?.youtube;
    if (episode.status === "published" && done?.url) {
      shorts.push(done.url);
      continue;
    }
    const publishAt = addDays(new Date(release.publishAt), index + 1).toISOString();
    const uploaded = await uploadToYoutube({
      path: await shortVideo(episode),
      title: `${episode.story?.title ?? series.bible.title} #shorts`,
      description: await buildDescription(getEpisode(episode.id) as Episode),
      hashtags: episode.story?.hashtags ?? [],
      publishAt,
    });
    await addToPlaylist({ accessToken: token, playlistId: release.playlistId as string, videoId: uploaded.videoId }).catch((error) =>
      console.error(`playlist: ${error instanceof Error ? error.message : error}`),
    );
    updateStep(episode.id, "publish", {
      status: "approved",
      error: null,
      meta: { waitingFor: undefined, published: { youtube: { status: "posted", url: uploaded.url, detail: `Public on ${format(new Date(publishAt), "EEE d MMM HH:mm")}` } } },
    });
    setEpisodeStatus(episode.id, "published");
    shorts.push(uploaded.url);
  }
  setSeriesStatus(series.id, "finished");
  const goesPublic = format(new Date(release.publishAt), "EEE d MMM 'at' HH:mm");
  void alert({
    title: `${series.bible.title} is on YouTube`,
    message: `The full story goes public ${goesPublic}, then a chapter a day as a Short. To stop it, delete it in YouTube Studio before then. ${getSeries(series.id)?.fullStoryUrl ?? ""}${release.thumbnail === "set" ? "" : " (No custom thumbnail: verify the channel by phone to allow one.)"}`,
    click: getSeries(series.id)?.fullStoryUrl ?? "veogen://series",
    tags: ["tada"],
    priority: 4,
  });
}

// Title and description for the joined video.
export async function fullStoryText(series: Series): Promise<{ title: string; description: string }> {
  const parts = finishedParts(series.id);
  const tracks = [...new Set((await Promise.all(parts.map(musicTrack))).filter(Boolean))];
  return {
    title: `${series.bible.title} | الحكاية كاملة`,
    description: [`${series.bible.title} | الحكاية كاملة`, parts[0]?.story?.description ?? "", followLine(), series.bible.hashtags.join(" "), ...musicCredit(tracks)]
      .filter(Boolean)
      .join("\n\n"),
  };
}

// The next posting time that no other part is booked for.
export function nextPublishSlot(exceptEpisodeId?: number): Date {
  const [hours, minutes] = getSettings().publishTime.split(":").map(Number) as [number, number];
  const day = (date: Date) => format(date, "yyyy-MM-dd");
  const taken = new Set<string>();
  for (const episode of listEpisodes({ status: "in_progress" })) {
    const booked = getStep(episode.id, "publish").meta.scheduledFor;
    if (booked && episode.id !== exceptEpisodeId) taken.add(day(new Date(booked)));
  }
  let slot = set(new Date(), { hours, minutes, seconds: 0, milliseconds: 0 });
  while (slot <= new Date() || taken.has(day(slot))) slot = addDays(slot, 1);
  return slot;
}

// Books the part for the next free posting time; until then the owner can still cancel or post it at once.
export function scheduleEpisode(episodeId: number): void {
  if (getStep(episodeId, "publish").status !== "review") throw new Error("The video has not been approved yet");
  updateStep(episodeId, "publish", { error: null, meta: { scheduledFor: nextPublishSlot(episodeId).toISOString() } });
}

export function unscheduleEpisode(episodeId: number): void {
  if (getStep(episodeId, "publish").status !== "review") throw new Error("This part is not waiting to be posted");
  updateStep(episodeId, "publish", { meta: { scheduledFor: undefined } });
}

// Posts the parts whose booked time has come, and tells the owner how it went.
function publishScheduled(): void {
  for (const episode of listEpisodes({ status: "in_progress" })) {
    const step = getStep(episode.id, "publish");
    if (step.status !== "review" || !step.meta.scheduledFor || new Date(step.meta.scheduledFor) > new Date()) continue;
    // Cleared first: a post that fails waits for the owner instead of being tried again on every tick.
    updateStep(episode.id, "publish", { meta: { scheduledFor: undefined } });
    void publishEpisode(episode.id)
      .then(() => getStep(episode.id, "publish").error)
      .catch((error) => (error instanceof Error ? error.message : String(error)))
      .then((problem) => {
        if (problem) console.error(`episode ${episode.id} scheduled post failed: ${problem}`);
        void alert({
          title: problem ? `Part ${episode.partNumber} was not posted` : `Part ${episode.partNumber} is out`,
          message: problem ? problem.slice(0, 300) : "Posted at its scheduled time. Open Veogen to see where it went.",
          click: `veogen://episodes/${episode.id}`,
          tags: [problem ? "warning" : "tada"],
          priority: problem ? 4 : 3,
        });
      });
  }
}

export async function publishEpisode(episodeId: number): Promise<void> {
  const episode = getEpisode(episodeId);
  if (!episode) throw new Error("No such episode");
  if (getStep(episodeId, "publish").status !== "review") throw new Error("The video has not been approved yet");
  const description = await buildDescription(episode);
  const videoPath = paths.final(episode.dir, MODEL);
  const published: NonNullable<StepMeta["published"]> = {};

  // Listed as a task of this process, so a tick during the uploads does not take the step for one cut off by a restart.
  const key = taskKey(episodeId, "publish");
  localTasks.add(key);
  try {
    await sendOut(episode, description, videoPath, published);
  } finally {
    localTasks.delete(key);
  }
}

// Posts one chapter now, as a Short. Used when the owner posts a chapter by hand; a whole story normally
// goes out through ensureRelease.
async function sendOut(episode: Episode, description: string, _videoPath: string, published: NonNullable<StepMeta["published"]>): Promise<void> {
  const episodeId = episode.id;
  updateStep(episodeId, "publish", { status: "running", error: null, meta: { scheduledFor: undefined } });
  if (!youtubeConnected) {
    updateStep(episodeId, "publish", { status: "review", error: "YouTube is not connected yet (see Settings)." });
    return;
  }
  try {
    const uploaded = await uploadToYoutube({ path: await shortVideo(episode), title: episode.story?.title ?? "", description, hashtags: episode.story?.hashtags ?? [] });
    published.youtube = { status: "posted", url: uploaded.url, ...(uploaded.detail ? { detail: uploaded.detail } : {}) };
  } catch (error) {
    updateStep(episodeId, "publish", { status: "review", error: (error instanceof Error ? error.message : String(error)).slice(0, 1000) });
    return;
  }
  updateStep(episodeId, "publish", { status: "approved", meta: { published } });
  setEpisodeStatus(episodeId, "published");
}
