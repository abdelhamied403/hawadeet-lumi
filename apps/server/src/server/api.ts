import { resolve } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { config } from "../config";
import { paths, saveStory, sceneName } from "../lib/project";
import { storySchema } from "../schemas/story";
import { getGpuQuota } from "../services/kaggle";
import { listMusic } from "../stages/assemble";
import { SFX } from "../stages/sfx";
import { seriesBibleSchema } from "../stages/series";
import { authEnabled, login, loginSchema, logout, mediaToken, requireMediaAccess, requireSession, signedIn } from "./auth";
import { estimateStep } from "./estimates";
import { totalPlays } from "../stages/analytics";
import { AI_NOTE, POST_TEXT_MAX } from "../stages/posts";
import { alert, alertsConfigured, approveStep, buildDescription, buildFullStory, fullStoryBuilding, fullStoryPaths, fullStoryText, uploadFullStory, youtubeConnected, createNextEpisode, draftPost, MODEL, publishEpisode, publishPost, rejectStep, rewritePost, takeReport, tick, uploadEpisodeToYoutube } from "./engine";
import {
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
  reportBefore,
  saveEpisodeStory,
  saveSeriesBible,
  saveSettings,
  setEpisodeStatus,
  setSeriesFullStoryUrl,
  setSeriesStatus,
  settingsSchema,
  STEP_NAMES,
  updatePost,
  type Episode,
  type Post,
  type Series,
  type StepName,
} from "./store";

const stepNameSchema = z.enum(STEP_NAMES);
const rejectSchema = z.object({
  note: z.string().trim().max(1000).optional(),
  scenes: z.array(z.number().int().positive()).optional(),
  musicTrack: z.string().optional(),
  musicVolume: z.number().min(0).max(1).optional(),
  sfxVolume: z.number().min(0).max(1).optional(),
});
const createEpisodeSchema = z.object({ idea: z.string().trim().max(1000).optional() });
const createPostSchema = z.object({ idea: z.string().trim().max(500).optional() });
const updatePostSchema = z.object({ text: z.string().trim().min(1).max(POST_TEXT_MAX), withImage: z.boolean() });
const rewritePostSchema = z.object({ note: z.string().trim().max(500).optional() });

const mediaUrl = (path: string) => `/media/${path.replace(`${OUTPUT_DIR}/`, "")}`;

async function versioned(path: string): Promise<string | null> {
  const file = Bun.file(path);
  // The timestamp makes the browser reload a file that was regenerated under the same name.
  return (await file.exists()) ? `${mediaUrl(path)}?v=${file.lastModified}` : null;
}

// Each step with how long its work takes and, while it is working, when it should finish.
function timedSteps(episode: Episode) {
  const sceneCount = episode.story?.scenes.length ?? getSettings().scenesPerPart;
  return getSteps(episode.id).map((step) => ({ ...step, ...estimateStep(step, sceneCount) }));
}

function summarize(episode: Episode) {
  const series = getSeries(episode.seriesId);
  const steps = timedSteps(episode);
  const current = steps.find((step) => step.status !== "approved") ?? null;
  return {
    id: episode.id,
    seriesId: episode.seriesId,
    seriesTitle: series?.bible.title ?? "",
    partNumber: episode.partNumber,
    totalParts: series?.bible.parts.length ?? 0,
    title: episode.story?.title ?? `${series?.bible.title ?? ""} | الجزء ${episode.partNumber}`,
    status: episode.status,
    createdAt: episode.createdAt,
    publishedAt: episode.publishedAt,
    currentStep: current?.name ?? null,
    steps: steps.map(({ name, status, estimateSeconds, endsAt }) => ({ name, status, estimateSeconds, endsAt })),
  };
}

async function detail(episode: Episode) {
  const scenes = [];
  for (const [index, scene] of (episode.story?.scenes ?? []).entries()) {
    const number = index + 1;
    const voiceFile = Bun.file(paths.voiceTimings(episode.dir, number));
    const voice = (await voiceFile.exists()) ? ((await voiceFile.json()) as { duration: number }) : null;
    scenes.push({
      number,
      ...scene,
      audioUrl: await versioned(paths.voiceAudio(episode.dir, number)),
      audioSeconds: voice?.duration ?? null,
      imageUrl: await versioned(`${paths.renderDir(episode.dir, MODEL)}/images/${sceneName(number)}.png`),
      clipUrl: await versioned(paths.clip(episode.dir, MODEL, number)),
    });
  }
  const series = getSeries(episode.seriesId);
  return {
    ...summarize(episode),
    story: episode.story,
    plan: series?.bible.parts.find((part) => part.number === episode.partNumber) ?? null,
    steps: timedSteps(episode),
    scenes,
    narrationUrl: await versioned(paths.narration(episode.dir)),
    videoUrl: await versioned(paths.final(episode.dir, MODEL)),
    description: await buildDescription(episode),
    // Whether the server can upload this part to YouTube itself.
    youtubeConnected,
    musicTracks: await listMusic(),
    soundEffects: SFX,
  };
}

function requireEpisode(id: string): Episode {
  const episode = getEpisode(Number(id));
  if (!episode) throw new HttpError(404, "No such episode");
  return episode;
}

class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 404 | 409 | 429 | 502,
    message: string,
  ) {
    super(message);
  }
}

export const app = new Hono();

app.use("*", cors({ origin: [config.WEB_ORIGIN, "http://127.0.0.1:4518"], credentials: true }));

app.onError((error, context) => {
  if (error instanceof HttpError) return context.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return context.json({ error: "Invalid input", issues: error.issues }, 400);
  console.error(error);
  return context.json({ error: error instanceof Error ? error.message : "Unexpected error" }, 409);
});

app.post("/api/auth/login", async (context) => {
  if (!authEnabled) return context.json({ required: false, signedIn: true });
  const result = await login(context, loginSchema.parse(await context.req.json()).password);
  if (!result.ok) throw new HttpError(result.status, result.error);
  return context.json({ required: true, signedIn: true });
});

app.post("/api/auth/logout", (context) => {
  logout(context);
  return context.json({ required: authEnabled, signedIn: !authEnabled });
});

app.get("/api/auth/session", async (context) =>
  context.json({ required: authEnabled, signedIn: !authEnabled || (await signedIn(context)) }),
);

app.use("/api/*", requireSession);
app.use("/media/*", requireMediaAccess);

app.get("/api/auth/media-token", async (context) => context.json({ token: authEnabled ? await mediaToken() : null }));

// Kaggle is asked for the GPU allowance at most every few minutes, however often the widget polls.
const QUOTA_TTL_MS = 5 * 60_000;
let quotaCache: { at: number; value: Awaited<ReturnType<typeof getGpuQuota>> | null } = { at: 0, value: null };

async function cachedQuota() {
  if (Date.now() - quotaCache.at > QUOTA_TTL_MS) {
    quotaCache = { at: Date.now(), value: await getGpuQuota().catch(() => quotaCache.value) };
  }
  return quotaCache.value;
}

// Compact state for the desktop widget and its panel icon.
app.get("/api/status", async (context) => {
  const active = listEpisodes({ status: "in_progress" }).reverse();
  const episodes = active.map(summarize);
  const waiting = episodes.filter((episode) => episode.steps.some((step) => step.status === "review" || step.status === "failed"));
  return context.json({
    episodes,
    needsYou: waiting.length,
    draftPosts: listPosts({ status: "draft" }).length,
    dashboardUrl: config.WEB_ORIGIN,
    quota: await cachedQuota(),
  });
});

app.get("/api/overview", async (context) => {
  const quota = await cachedQuota();
  return context.json({
    episodes: listEpisodes().slice(0, 30).map(summarize),
    series: listSeries().map((series) => ({
      id: series.id,
      title: series.bible.title,
      status: series.status,
      totalParts: series.bible.parts.length,
      publishedParts: listEpisodes({ seriesId: series.id, status: "published" }).length,
    })),
    draftPosts: listPosts({ status: "draft" }).length,
    quota,
  });
});

const fullStoryLinkSchema = z.object({ url: z.union([z.literal(""), z.url()]) });

// The whole story joined into one video for YouTube: whether it can be made, and what goes with it.
async function presentFullStory(series: Series) {
  const published = listEpisodes({ seriesId: series.id, status: "published" }).map((episode) => episode.partNumber).sort((a, b) => a - b);
  const files = fullStoryPaths(series.id);
  const partsFile = Bun.file(files.parts);
  const built = (await partsFile.exists()) ? ((await partsFile.json()) as { parts: number[]; builtAt: string }) : null;
  return {
    publishedParts: published,
    building: fullStoryBuilding(series.id),
    videoUrl: built ? await versioned(files.video) : null,
    // Which parts the video on the server holds; fewer than `publishedParts` means it is out of date.
    includedParts: built?.parts ?? [],
    builtAt: built?.builtAt ?? null,
    ...(await fullStoryText(series)),
    youtubeUrl: series.fullStoryUrl,
    // Whether the server can upload it itself; otherwise it is uploaded by hand.
    canUpload: youtubeConnected,
  };
}

async function presentSeries(series: Series) {
  return {
    id: series.id,
    status: series.status,
    createdAt: series.createdAt,
    ...series.bible,
    episodes: listEpisodes({ seriesId: series.id }).reverse().map(summarize),
    fullStory: await presentFullStory(series),
  };
}

function requireSeries(id: string): Series {
  const series = getSeries(Number(id));
  if (!series) throw new HttpError(404, "No such series");
  return series;
}

app.get("/api/series/:id", async (context) => context.json(await presentSeries(requireSeries(context.req.param("id")))));

// Joins the published parts into one video. It takes a few minutes, so the answer comes back straight away
// with `building` set and the app keeps reading the series until the video is there.
app.post("/api/series/:id/full-story", async (context) => {
  const series = requireSeries(context.req.param("id"));
  if (fullStoryBuilding(series.id)) throw new HttpError(409, "The full story is already being put together");
  if (listEpisodes({ seriesId: series.id, status: "published" }).length < 2) throw new HttpError(409, "The full story needs at least two published parts");
  void buildFullStory(series.id).catch((error) => console.error(`full story of series ${series.id}: ${error instanceof Error ? error.message : error}`));
  return context.json(await presentSeries(series), 202);
});

// Uploads the joined video to the connected YouTube channel and saves its link.
app.post("/api/series/:id/full-story/upload", async (context) => {
  const series = requireSeries(context.req.param("id"));
  if (!youtubeConnected) throw new HttpError(409, "YouTube is not connected on the server");
  await uploadFullStory(series.id);
  return context.json(await presentSeries(requireSeries(context.req.param("id"))), 201);
});

// Saves where the full story was uploaded, so later descriptions can send viewers to it. An empty link clears it.
app.put("/api/series/:id/full-story", async (context) => {
  const series = requireSeries(context.req.param("id"));
  const body = fullStoryLinkSchema.parse(await context.req.json());
  setSeriesFullStoryUrl(series.id, body.url || null);
  return context.json(await presentSeries(requireSeries(context.req.param("id"))));
});

// Edits the series plan. Later parts are written from the new plan; parts already written are not changed.
app.put("/api/series/:id", async (context) => {
  const series = getSeries(Number(context.req.param("id")));
  if (!series) throw new HttpError(404, "No such series");
  const bible = seriesBibleSchema.parse(await context.req.json());
  const started = listEpisodes({ seriesId: series.id }).filter((episode) => episode.status !== "cancelled");
  const lastStarted = Math.max(0, ...started.map((episode) => episode.partNumber));
  if (bible.parts.length < lastStarted) {
    throw new HttpError(409, `Part ${lastStarted} already exists, so the series cannot be shorter than ${lastStarted} parts`);
  }
  // Parts are always numbered 1..n in order, whatever the client sent.
  saveSeriesBible(series.id, { ...bible, parts: bible.parts.map((part, index) => ({ ...part, number: index + 1 })) });
  if (series.status === "finished" && bible.parts.length > lastStarted) setSeriesStatus(series.id, "active");
  return context.json(await presentSeries(requireSeries(context.req.param("id"))));
});

app.post("/api/episodes", async (context) => {
  const body = createEpisodeSchema.parse(await context.req.json().catch(() => ({})));
  const episode = await createNextEpisode(body.idea);
  void tick();
  return context.json(summarize(episode), 201);
});

app.get("/api/episodes/:id", async (context) => context.json(await detail(requireEpisode(context.req.param("id")))));

// Direct edits to the script, allowed while the story is waiting for review.
app.put("/api/episodes/:id/story", async (context) => {
  const episode = requireEpisode(context.req.param("id"));
  if (getStep(episode.id, "story").status !== "review") throw new HttpError(409, "The story can only be edited while it is in review");
  // The editors do not send the headline, so an edit keeps the one already written.
  const story = storySchema.parse({ hook: episode.story?.hook, ...(await context.req.json()) });
  saveEpisodeStory(episode.id, story);
  await saveStory(episode.dir, story);
  return context.json(await detail(requireEpisode(context.req.param("id"))));
});

// Changes one scene's image or motion description before that scene is redone.
app.put("/api/episodes/:id/scenes/:number", async (context) => {
  const episode = requireEpisode(context.req.param("id"));
  if (!episode.story) throw new HttpError(409, "The episode has no story yet");
  const body = z
    .object({ imagePrompt: z.string().trim().min(1).optional(), motionPrompt: z.string().trim().min(1).optional() })
    .parse(await context.req.json());
  const index = Number(context.req.param("number")) - 1;
  const scene = episode.story.scenes[index];
  if (!scene) throw new HttpError(404, "No such scene");
  const story = storySchema.parse({
    ...episode.story,
    scenes: episode.story.scenes.map((current, position) => (position === index ? { ...current, ...body } : current)),
  });
  saveEpisodeStory(episode.id, story);
  await saveStory(episode.dir, story);
  return context.json(await detail(requireEpisode(context.req.param("id"))));
});

app.post("/api/episodes/:id/steps/:step/approve", async (context) => {
  const episode = requireEpisode(context.req.param("id"));
  const step = stepNameSchema.parse(context.req.param("step")) as StepName;
  if (step === "publish") throw new HttpError(400, "Use the publish action for the last step");
  approveStep(episode.id, step);
  void tick();
  return context.json(await detail(requireEpisode(context.req.param("id"))));
});

app.post("/api/episodes/:id/steps/:step/reject", async (context) => {
  const episode = requireEpisode(context.req.param("id"));
  const step = stepNameSchema.parse(context.req.param("step")) as StepName;
  rejectStep(episode.id, step, rejectSchema.parse(await context.req.json().catch(() => ({}))));
  void tick();
  return context.json(await detail(requireEpisode(context.req.param("id"))));
});

app.post("/api/episodes/:id/publish", async (context) => {
  const episode = requireEpisode(context.req.param("id"));
  await publishEpisode(episode.id);
  return context.json(await detail(requireEpisode(context.req.param("id"))));
});

// Sends an already published part to the connected YouTube channel.
app.post("/api/episodes/:id/youtube", async (context) => {
  const episode = requireEpisode(context.req.param("id"));
  if (!youtubeConnected) throw new HttpError(409, "YouTube is not connected on the server");
  await uploadEpisodeToYoutube(episode.id);
  return context.json(await detail(requireEpisode(context.req.param("id"))), 201);
});

app.post("/api/episodes/:id/cancel", async (context) => {
  const episode = requireEpisode(context.req.param("id"));
  setEpisodeStatus(episode.id, "cancelled");
  return context.json(summarize(requireEpisode(context.req.param("id"))));
});

async function presentPost(post: Post) {
  return { ...post, imagePath: undefined, imageUrl: post.imagePath ? await versioned(post.imagePath) : null };
}

function requireDraft(id: string): Post {
  const post = getPost(Number(id));
  if (!post) throw new HttpError(404, "No such post");
  if (post.status !== "draft") throw new HttpError(409, "This post is no longer a draft");
  return post;
}

// Page posts that keep followers active between videos: drafts to review, and what was published.
app.get("/api/posts", async (context) =>
  context.json({
    drafts: await Promise.all(listPosts({ status: "draft" }).map(presentPost)),
    published: await Promise.all(listPosts({ status: "published" }).slice(0, 20).map(presentPost)),
    facebookConnected: Boolean(config.FACEBOOK_PAGE_ID && config.FACEBOOK_PAGE_TOKEN),
  }),
);

app.post("/api/posts", async (context) => {
  const body = createPostSchema.parse(await context.req.json().catch(() => ({})));
  return context.json(await presentPost(await draftPost(body.idea || undefined)), 201);
});

app.put("/api/posts/:id", async (context) => {
  const post = requireDraft(context.req.param("id"));
  const body = updatePostSchema.parse(await context.req.json());
  let text = body.text;
  // The note about the generated picture follows the picture when it is switched on or off.
  if (post.imagePath && body.withImage !== post.withImage) {
    const plain = text.replace(AI_NOTE, "").trim();
    text = body.withImage ? `${plain}\n\n${AI_NOTE}` : plain;
  }
  return context.json(await presentPost(updatePost(post.id, { text, withImage: body.withImage })));
});

app.post("/api/posts/:id/rewrite", async (context) => {
  const post = requireDraft(context.req.param("id"));
  const body = rewritePostSchema.parse(await context.req.json().catch(() => ({})));
  return context.json(await presentPost(await rewritePost(post.id, body.note || undefined)));
});

app.post("/api/posts/:id/publish", async (context) => {
  const post = requireDraft(context.req.param("id"));
  return context.json(await presentPost(await publishPost(post.id)));
});

app.post("/api/posts/:id/discard", async (context) => {
  const post = requireDraft(context.req.param("id"));
  return context.json(await presentPost(updatePost(post.id, { status: "discarded" })));
});

const HISTORY_POINTS = 120;

// The newest report, the one from about a day earlier to compare it with, and the trend across all of them.
function analysis() {
  const reports = listReports(HISTORY_POINTS);
  const latest = reports[0] ?? null;
  return {
    facebookConnected: Boolean(config.FACEBOOK_PAGE_ID && config.FACEBOOK_PAGE_TOKEN),
    latest,
    dayBefore: latest ? reportBefore(new Date(new Date(latest.takenAt).getTime() - 23 * 3_600_000)) : null,
    history: reports
      .map((report) => ({ takenAt: report.takenAt, followers: report.page.followers, plays: totalPlays(report) }))
      .reverse(),
  };
}

app.get("/api/analysis", (context) => context.json(analysis()));

// Every kept report in full, newest first, for a closer look than the app's screen gives.
app.get("/api/analysis/reports", (context) => context.json(listReports(Number(context.req.query("limit")) || 30)));

app.post("/api/analysis/refresh", async (context) => {
  await takeReport();
  return context.json(analysis(), 201);
});

app.post("/api/alerts/test", async (context) => {
  if (!alertsConfigured) throw new HttpError(409, "Alerts are not set up on the server (NTFY_TOPIC is missing)");
  const sent = await alert({ title: "Veogen alerts are working", message: "This is the test you asked for.", click: "veogen://", tags: ["white_check_mark"] }, { force: true });
  if (!sent) throw new HttpError(502, "The alert could not be sent");
  return context.json({ sent });
});

app.get("/api/settings", (context) =>
  context.json({
    ...getSettings(),
    connections: {
      kaggle: Boolean(config.KAGGLE_USERNAME && config.KAGGLE_KEY),
      gemini: Boolean(config.GEMINI_API_KEY),
      facebook: Boolean(config.FACEBOOK_PAGE_ID && config.FACEBOOK_PAGE_TOKEN),
      youtube: youtubeConnected,
      alerts: alertsConfigured,
    },
    // What the owner's ntfy app subscribes to; null until NTFY_TOPIC is set.
    alertsTopic: config.NTFY_TOPIC ? { server: config.NTFY_SERVER, topic: config.NTFY_TOPIC } : null,
  }),
);

app.put("/api/settings", async (context) => {
  // Merged over the saved values, so a client that does not know a newer setting leaves it alone.
  saveSettings(settingsSchema.parse({ ...getSettings(), ...((await context.req.json()) as object) }));
  return context.json(getSettings());
});

// Serves generated audio, images and video, with byte ranges so the browser can seek in videos.
app.get("/media/*", async (context) => {
  const root = resolve(OUTPUT_DIR);
  const path = resolve(root, decodeURIComponent(context.req.path.replace("/media/", "")));
  if (!path.startsWith(`${root}/`) || path.endsWith(".sqlite")) throw new HttpError(404, "Not found");
  const file = Bun.file(path);
  if (!(await file.exists())) throw new HttpError(404, "Not found");

  const headers: Record<string, string> = {
    "Content-Type": file.type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(context.req.header("range") ?? "");
  if (!range) return new Response(file, { headers: { ...headers, "Content-Length": String(file.size) } });
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${file.size}`, "Content-Length": String(end - start + 1) },
  });
});
