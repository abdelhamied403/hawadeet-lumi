import { rm } from "node:fs/promises";
import { format } from "date-fns";
import { config } from "../config";
import { paths, saveStory } from "../lib/project";
import { publishPagePost, publishReel } from "../services/facebook";
import { sendAlert, type SendAlertPayload } from "../services/ntfy";
import { collectReport, summarizeReport } from "../stages/analytics";
import { runFullStory } from "../stages/fullstory";
import { runAssemble } from "../stages/assemble";
import { SFX_CREDITS } from "../stages/sfx";
import { directMotion } from "../stages/motion";
import { AI_NOTE, writePagePost, type PostStill } from "../stages/posts";
import { fetchRender, pushRender, type MotionModel } from "../stages/render";
import { writeSeriesBible, writeSeriesPart } from "../stages/series";
import { runVoice } from "../stages/voice";
import {
  createEpisode,
  createPost,
  createSeries,
  getEpisode,
  getPost,
  getSeries,
  getSettings,
  getStep,
  getSteps,
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
  setSeriesStatus,
  STEP_NAMES,
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
const KAGGLE_POLL_MS = 60_000;
const MAX_EPISODES_IN_PROGRESS = 2;
const MUSIC_CREDIT = `Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/`;
// Asks viewers to follow the Page; worded to fit any part of a series, the last one included.
const FOLLOW_LINE = "تابعوا عتمة عشان كل جزء جديد يوصلكم أول ما ينزل 🕯️";

// Steps running inside this process; anything marked running but missing here was cut off by a restart.
const localTasks = new Set<string>();
const lastPoll = new Map<string, number>();
let creating = false;
let ticking = false;

const taskKey = (episodeId: number, step: StepName) => `${episodeId}:${step}`;
const sceneNumbers = (episode: Episode) => (episode.story?.scenes ?? []).map((_, index) => index + 1);

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

// Tells the owner a step now needs them: it is ready to review, or it failed.
function alertStep(episodeId: number, step: StepName, outcome: "review" | "failed", detail?: string): void {
  const part = getEpisode(episodeId)?.partNumber ?? episodeId;
  const title =
    outcome === "failed" ? `Part ${part}: ${STEP_LABELS[step]} failed` : step === "publish" ? `Part ${part} is ready to publish` : `Part ${part}: ${STEP_LABELS[step]} ready for review`;
  void alert({
    title,
    message: outcome === "failed" ? (detail ?? "Open the part to see what went wrong.").slice(0, 300) : "Open Veogen to review it.",
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

function runLocal(episode: Episode, step: StepName, work: () => Promise<void>): void {
  const key = taskKey(episode.id, step);
  localTasks.add(key);
  updateStep(episode.id, step, { status: "running", error: null, meta: { startedAt: new Date().toISOString() } });
  work()
    .then(() => {
      updateStep(episode.id, step, { status: "review" });
      alertStep(episode.id, step, "review");
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

async function writeStory(episode: Episode, meta: StepMeta): Promise<void> {
  const series = getSeries(episode.seriesId);
  if (!series) throw new Error("The episode's series no longer exists");
  const previous = listEpisodes({ seriesId: series.id })
    .filter((other) => other.partNumber < episode.partNumber && other.status !== "cancelled" && other.story)
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((other) => ({
      number: other.partNumber,
      narration: (other.story?.scenes ?? []).map((scene) => scene.narration).join(" "),
    }));
  const story = await writeSeriesPart({
    bible: series.bible,
    partNumber: episode.partNumber,
    scenes: getSettings().scenesPerPart,
    previous,
    seed: series.seed,
    current: meta.note ? (episode.story ?? undefined) : undefined,
    note: meta.note,
  });
  saveEpisodeStory(episode.id, story);
  await saveStory(episode.dir, story);
}

async function startRender(episode: Episode, step: "images" | "clips", meta: StepMeta): Promise<void> {
  const scenes = meta.scenes?.length ? meta.scenes : sceneNumbers(episode);
  // Marked first, so the next tick does not start the same job while this one prepares.
  updateStep(episode.id, step, { status: "running", error: null, meta: { startedAt: new Date().toISOString() } });
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
    });
    // The clock for the estimate starts when the job is really on Kaggle, not while it was being prepared.
    updateStep(episode.id, step, { meta: { jobUrl, startedAt: new Date().toISOString() } });
  } catch (error) {
    fail(episode.id, step, error);
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
    for (const scene of sceneNumbers(episode)) {
      const file =
        step === "images"
          ? `${paths.renderDir(episode.dir, MODEL)}/images/scene-${String(scene).padStart(2, "0")}.png`
          : paths.clip(episode.dir, MODEL, scene);
      if (!(await Bun.file(file).exists())) missing.push(scene);
    }
    if (missing.length === 0) {
      updateStep(episode.id, step, { status: "review", error: null });
      alertStep(episode.id, step, "review");
    } else {
      fail(episode.id, step, `The Kaggle job ended (${result.status}) without scenes ${missing.join(", ")}.\n${result.logTail}`);
    }
  } catch (error) {
    // A dropped connection is not a failed job; the next poll tries again.
    console.error(`episode ${episode.id} ${step} poll: ${error instanceof Error ? error.message : error}`);
  }
}

async function advance(episode: Episode): Promise<void> {
  const step = getSteps(episode.id).find((candidate) => candidate.status !== "approved");
  if (!step) return;
  const { name, status, meta } = step;

  if (status === "running") {
    if (name === "images" || name === "clips") await pollRender(episode, name);
    else if (!localTasks.has(taskKey(episode.id, name))) updateStep(episode.id, name, { status: "queued" });
    return;
  }
  if (status !== "queued") return;

  switch (name) {
    case "story":
      runLocal(episode, name, () => writeStory(episode, meta));
      return;
    case "voice":
      runLocal(episode, name, async () => {
        await runVoice(episode.dir, { force: true, styleNote: meta.note });
      });
      return;
    case "images":
    case "clips":
      await startRender(episode, name, meta);
      return;
    case "video":
      runLocal(episode, name, async () => {
        await runAssemble(episode.dir, MODEL, { musicTrack: meta.musicTrack, musicVolume: meta.musicVolume, sfxVolume: meta.sfxVolume });
      });
      return;
    case "publish":
      // Nothing to prepare: it waits for the owner to press Publish.
      updateStep(episode.id, name, { status: "review" });
      alertStep(episode.id, name, "review");
  }
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
  if (!series) series = createSeries(await writeSeriesBible({ idea, parts: settings.partsPerSeries }));
  return createEpisode(series.id, partNumber);
}

async function ensureDailyEpisode(): Promise<void> {
  const settings = getSettings();
  if (!settings.autoCreate || creating) return;
  const today = format(new Date(), "yyyy-MM-dd");
  if (format(new Date(), "HH:mm") < settings.dailyTime) return;
  const episodes = listEpisodes();
  if (episodes.some((episode) => format(new Date(episode.createdAt), "yyyy-MM-dd") === today)) return;
  if (episodes.filter((episode) => episode.status === "in_progress").length >= MAX_EPISODES_IN_PROGRESS) return;
  creating = true;
  try {
    const episode = await createNextEpisode();
    console.log(`created today's part: episode ${episode.id}`);
  } catch (error) {
    console.error(`could not create today's part: ${error instanceof Error ? error.message : error}`);
  } finally {
    creating = false;
  }
}

const MAX_DRAFT_POSTS = 4;
const POST_RETRY_MS = 30 * 60_000;
let drafting = false;
let lastPostFailure = 0;

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

// Keeps the day's Page posts drafted. Nothing is posted until the owner publishes it.
async function ensurePagePosts(): Promise<void> {
  const settings = getSettings();
  if (settings.postsPerDay === 0 || drafting || Date.now() - lastPostFailure < POST_RETRY_MS) return;
  if (format(new Date(), "HH:mm") < settings.dailyTime) return;
  const today = format(new Date(), "yyyy-MM-dd");
  const posts = listPosts();
  if (posts.filter((post) => format(new Date(post.createdAt), "yyyy-MM-dd") === today).length >= settings.postsPerDay) return;
  if (posts.filter((post) => post.status === "draft").length >= MAX_DRAFT_POSTS) return;
  drafting = true;
  try {
    const post = await draftPost();
    console.log(`drafted Page post ${post.id} (${post.angle})`);
    void alert({ title: "A Page post is ready to review", message: post.text.slice(0, 200), click: "veogen://posts", tags: ["memo"], priority: 2 });
  } catch (error) {
    lastPostFailure = Date.now();
    console.error(`could not draft a Page post: ${error instanceof Error ? error.message : error}`);
  } finally {
    drafting = false;
  }
}

// Local hours at which the Page's numbers are recorded; the last one of the day also sends the summary alert.
const REPORT_HOURS = [2, 8, 14, 20];
const SUMMARY_HOUR = 20;
const REPORT_RETRY_MS = 30 * 60_000;
let reporting = false;
let lastReportFailure = 0;

// Records the Page's numbers now. Kept so that later reports can be compared with this one.
export async function takeReport(): Promise<Report> {
  if (!config.FACEBOOK_PAGE_ID || !config.FACEBOOK_PAGE_TOKEN) throw new Error("Facebook is not connected yet (see Settings)");
  return saveReport(await collectReport({ pageId: config.FACEBOOK_PAGE_ID, pageToken: config.FACEBOOK_PAGE_TOKEN }));
}

async function ensureReport(): Promise<void> {
  if (!config.FACEBOOK_PAGE_ID || !config.FACEBOOK_PAGE_TOKEN || reporting || Date.now() - lastReportFailure < REPORT_RETRY_MS) return;
  // The most recent report hour that has already passed, today or yesterday.
  const now = new Date();
  const due = REPORT_HOURS.map((hour) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour))
    .flatMap((slot) => [slot, new Date(slot.getTime() - 24 * 3_600_000)])
    .filter((slot) => slot <= now)
    .sort((a, b) => b.getTime() - a.getTime())[0] as Date;
  const latest = listReports(1)[0];
  if (latest && new Date(latest.takenAt) >= due) return;
  reporting = true;
  try {
    const report = await takeReport();
    console.log(`report ${report.id}: ${report.page.followers} followers, ${report.reels.length} reels`);
    if (due.getHours() === SUMMARY_HOUR) {
      const dayBefore = reportBefore(new Date(now.getTime() - 23 * 3_600_000));
      void alert({ title: "Today on the Page", message: summarizeReport(report, dayBefore), click: "veogen://analysis", tags: ["bar_chart"], priority: 2 });
    }
  } catch (error) {
    lastReportFailure = Date.now();
    console.error(`could not take a report: ${error instanceof Error ? error.message : error}`);
  } finally {
    reporting = false;
  }
}

export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    // Not awaited: reading numbers from Facebook must not hold up the parts in production.
    void ensureReport();
    await ensureDailyEpisode();
    // Not awaited: writing a post must not hold up the parts in production.
    void ensurePagePosts();
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
  const next = STEP_NAMES[STEP_NAMES.indexOf(name) + 1];
  if (next) updateStep(episodeId, next, { status: "queued", error: null });
}

export type RejectOptions = { note?: string; scenes?: number[]; musicTrack?: string; musicVolume?: number; sfxVolume?: number };

// Sends a step back to be redone, and resets every later step, since they were built on it.
export function rejectStep(episodeId: number, name: StepName, options: RejectOptions): void {
  const step = getStep(episodeId, name);
  if (step.status === "running" || step.status === "waiting") throw new Error(`The ${name} step cannot be redone right now`);
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
  for (const later of STEP_NAMES.slice(STEP_NAMES.indexOf(name) + 1)) {
    updateStep(episodeId, later, { status: "waiting", error: null, meta: { scenes: undefined, note: undefined } });
  }
}

async function musicTrack(episode: Episode): Promise<string> {
  const musicFile = Bun.file(`${episode.dir}/music.txt`);
  return (await musicFile.exists()) ? (await musicFile.text()).replace(/\.[^.]+$/, "") : "";
}

// Sends viewers to YouTube for the whole story: to the joined video once it is up, to the channel until then.
function fullStoryLine(series: Series | null): string {
  if (series?.fullStoryUrl) return `الحكاية كاملة على يوتيوب: ${series.fullStoryUrl}`;
  const channel = getSettings().youtubeUrl;
  return channel ? `الحكاية كاملة هتنزل على يوتيوب: ${channel}` : "";
}

export async function buildDescription(episode: Episode): Promise<string> {
  const story = episode.story;
  if (!story) return "";
  const track = await musicTrack(episode);
  return [
    story.title,
    story.description,
    FOLLOW_LINE,
    fullStoryLine(getSeries(episode.seriesId)),
    story.hashtags.join(" "),
    "هذا المحتوى مصنوع بالذكاء الاصطناعي.",
    track ? `Music: "${track}" ${MUSIC_CREDIT}` : "",
    ...new Set(story.scenes.map((scene) => SFX_CREDITS[scene.sfx ?? ""]).filter((credit): credit is string => Boolean(credit))),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const fullStoryPaths = (seriesId: number) => {
  const dir = `${OUTPUT_DIR}/series/s${seriesId}`;
  return { video: `${dir}/full-story.mp4`, parts: `${dir}/full-story.json` };
};

const fullStoryBuilds = new Set<number>();
export const fullStoryBuilding = (seriesId: number) => fullStoryBuilds.has(seriesId);

// The published parts of a series that have a finished video, in story order.
function publishedParts(seriesId: number): Episode[] {
  return listEpisodes({ seriesId, status: "published" }).sort((a, b) => a.partNumber - b.partNumber);
}

// Joins every published part of a series into one video for YouTube. Returns the part numbers it holds.
export async function buildFullStory(seriesId: number): Promise<number[]> {
  if (fullStoryBuilds.has(seriesId)) throw new Error("The full story is already being put together");
  const parts = publishedParts(seriesId);
  if (parts.length < 2) throw new Error("The full story needs at least two published parts");
  const videos = parts.map((episode) => paths.final(episode.dir, MODEL));
  for (const [index, file] of videos.entries()) {
    if (!(await Bun.file(file).exists())) throw new Error(`Part ${parts[index]?.partNumber} has no finished video on the server`);
  }
  const target = fullStoryPaths(seriesId);
  fullStoryBuilds.add(seriesId);
  try {
    await runFullStory(videos, target.video);
    const numbers = parts.map((episode) => episode.partNumber);
    await Bun.write(target.parts, JSON.stringify({ parts: numbers, builtAt: new Date().toISOString() }));
    return numbers;
  } finally {
    fullStoryBuilds.delete(seriesId);
  }
}

// Title and description for the joined video.
export async function fullStoryText(series: Series): Promise<{ title: string; description: string }> {
  const parts = publishedParts(series.id);
  const tracks = new Set((await Promise.all(parts.map(musicTrack))).filter(Boolean));
  const effects = new Set(
    parts.flatMap((episode) => (episode.story?.scenes ?? []).map((scene) => SFX_CREDITS[scene.sfx ?? ""])).filter((credit): credit is string => Boolean(credit)),
  );
  return {
    title: `${series.bible.title} | الحكاية كاملة`,
    description: [
      `${series.bible.title} | الحكاية كاملة`,
      parts[0]?.story?.description ?? "",
      FOLLOW_LINE,
      series.bible.hashtags.join(" "),
      "هذا المحتوى مصنوع بالذكاء الاصطناعي.",
      ...[...tracks].map((track) => `Music: "${track}" ${MUSIC_CREDIT}`),
      ...effects,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export async function publishEpisode(episodeId: number): Promise<void> {
  const episode = getEpisode(episodeId);
  if (!episode) throw new Error("No such episode");
  if (getStep(episodeId, "publish").status !== "review") throw new Error("The video has not been approved yet");
  const description = await buildDescription(episode);
  const videoPath = paths.final(episode.dir, MODEL);
  const published: NonNullable<StepMeta["published"]> = {};

  updateStep(episodeId, "publish", { status: "running", error: null });
  if (config.FACEBOOK_PAGE_ID && config.FACEBOOK_PAGE_TOKEN) {
    try {
      const reel = await publishReel({
        pageId: config.FACEBOOK_PAGE_ID,
        pageToken: config.FACEBOOK_PAGE_TOKEN,
        videoPath,
        description,
      });
      published.facebook = { status: "posted", url: reel.url };
    } catch (error) {
      published.facebook = { status: "failed", detail: error instanceof Error ? error.message : String(error) };
    }
  } else {
    published.facebook = { status: "manual", detail: "Facebook is not connected yet (see Settings)." };
  }
  // These two keep uploads from unreviewed apps private, so they are posted by hand for now.
  published.youtube = { status: "manual", url: "https://www.youtube.com/upload" };
  published.tiktok = { status: "manual", url: "https://www.tiktok.com/tiktokstudio/upload" };

  if (published.facebook.status === "failed") {
    updateStep(episodeId, "publish", { status: "review", error: published.facebook.detail ?? null, meta: { published } });
    return;
  }
  updateStep(episodeId, "publish", { status: "approved", meta: { published } });
  setEpisodeStatus(episodeId, "published");
  const series = getSeries(episode.seriesId);
  if (series && episode.partNumber >= series.bible.parts.length) {
    setSeriesStatus(series.id, "finished");
    // The last part is out, so the whole story can be joined for YouTube without being asked.
    void buildFullStory(series.id)
      .then(() => alert({ title: "The full story is ready", message: `${series.bible.title}: every part joined into one video for YouTube.`, click: "veogen://series", tags: ["film_projector"] }))
      .catch((error) => console.error(`full story of series ${series.id}: ${error instanceof Error ? error.message : error}`));
  }
}
