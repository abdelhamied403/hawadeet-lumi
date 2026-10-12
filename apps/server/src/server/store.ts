import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { z } from "zod";
import { storySchema, type Story } from "../schemas/story";
import type { ReportData } from "../stages/analytics";
import { seriesBibleSchema, type SeriesBible } from "../stages/series";

export const OUTPUT_DIR = "output";
mkdirSync(OUTPUT_DIR, { recursive: true });

const db = new Database(`${OUTPUT_DIR}/veogen.sqlite`, { create: true });
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bible TEXT NOT NULL,
    seed INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id INTEGER NOT NULL REFERENCES series(id),
    part_number INTEGER NOT NULL,
    dir TEXT NOT NULL,
    story TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress',
    created_at TEXT NOT NULL,
    published_at TEXT
  );
  CREATE TABLE IF NOT EXISTS steps (
    episode_id INTEGER NOT NULL REFERENCES episodes(id),
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (episode_id, name)
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    angle TEXT NOT NULL,
    text TEXT NOT NULL,
    image_path TEXT,
    with_image INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft',
    url TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    published_at TEXT
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taken_at TEXT NOT NULL,
    data TEXT NOT NULL
  );
`);

// Columns added after the first release; a database made before them gets them here.
const seriesColumns = db.query<{ name: string }, []>("PRAGMA table_info(series)").all().map((column) => column.name);
if (!seriesColumns.includes("full_story_url")) db.exec("ALTER TABLE series ADD COLUMN full_story_url TEXT");

export const STEP_NAMES = ["story", "voice", "images", "clips", "video", "publish"] as const;
export type StepName = (typeof STEP_NAMES)[number];

// waiting: an earlier step is not approved yet. queued: ready to run. review: waiting for the owner.
export const STEP_STATUSES = ["waiting", "queued", "running", "review", "approved", "failed"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const stepMetaSchema = z.object({
  // The owner's note from the last rejection, used when the step runs again.
  note: z.string().optional(),
  // Scene numbers to redo; all scenes when absent.
  scenes: z.array(z.number().int()).optional(),
  // How many times the step has been rejected; varies the image seed.
  attempt: z.number().int().default(0),
  jobUrl: z.string().optional(),
  startedAt: z.string().optional(),
  musicTrack: z.string().optional(),
  musicVolume: z.number().optional(),
  sfxVolume: z.number().optional(),
  // Per-platform result of publishing.
  published: z.record(z.string(), z.object({ status: z.string(), url: z.string().optional(), detail: z.string().optional() })).optional(),
});
export type StepMeta = z.infer<typeof stepMetaSchema>;

export type Step = { name: StepName; status: StepStatus; meta: StepMeta; error: string | null; updatedAt: string };
export type Series = {
  id: number;
  bible: SeriesBible;
  seed: number;
  status: "active" | "finished";
  createdAt: string;
  // Where the whole story, joined into one video, was uploaded (YouTube); null until the owner saves the link.
  fullStoryUrl: string | null;
};
export type Episode = {
  id: number;
  seriesId: number;
  partNumber: number;
  dir: string;
  story: Story | null;
  status: "in_progress" | "published" | "cancelled";
  createdAt: string;
  publishedAt: string | null;
};

// What a Page post is trying to do; rotated so the Page does not repeat itself.
export const POST_ANGLES = ["question", "teaser", "moment", "confession"] as const;
export type PostAngle = (typeof POST_ANGLES)[number];

export type Post = {
  id: number;
  angle: PostAngle;
  text: string;
  // A still from a published part, as a path under the output folder; null for a text-only post.
  imagePath: string | null;
  // The owner can post the text without its picture.
  withImage: boolean;
  status: "draft" | "published" | "discarded";
  url: string | null;
  error: string | null;
  createdAt: string;
  publishedAt: string | null;
};

export const settingsSchema = z.object({
  // Create the day's part automatically.
  autoCreate: z.boolean().default(true),
  // Local time (HH:mm) after which the day's part is created.
  dailyTime: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  scenesPerPart: z.number().int().min(4).max(24).default(16),
  partsPerSeries: z.number().int().min(2).max(12).default(6),
  // Page posts drafted each day between videos; 0 turns them off.
  postsPerDay: z.number().int().min(0).max(3).default(1),
  // The YouTube channel viewers are sent to for the whole story; empty leaves that line out of descriptions.
  youtubeUrl: z.union([z.literal(""), z.url()]).default(""),
  // Send phone alerts (needs NTFY_TOPIC in .env).
  notifications: z.boolean().default(true),
});
export type Settings = z.infer<typeof settingsSchema>;

type SeriesRow = { id: number; bible: string; seed: number; status: string; created_at: string; full_story_url: string | null };
type EpisodeRow = {
  id: number;
  series_id: number;
  part_number: number;
  dir: string;
  story: string | null;
  status: string;
  created_at: string;
  published_at: string | null;
};
type StepRow = { name: string; status: string; meta: string; error: string | null; updated_at: string };

const now = () => new Date().toISOString();

function toSeries(row: SeriesRow): Series {
  return {
    id: row.id,
    bible: seriesBibleSchema.parse(JSON.parse(row.bible)),
    seed: row.seed,
    status: row.status as Series["status"],
    createdAt: row.created_at,
    fullStoryUrl: row.full_story_url,
  };
}

function toEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    seriesId: row.series_id,
    partNumber: row.part_number,
    dir: row.dir,
    story: row.story ? storySchema.parse(JSON.parse(row.story)) : null,
    status: row.status as Episode["status"],
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

export function getSettings(): Settings {
  const rows = db.query<{ key: string; value: string }, []>("SELECT key, value FROM settings").all();
  return settingsSchema.parse(Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)])));
}

export function saveSettings(settings: Settings): void {
  const statement = db.query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  for (const [key, value] of Object.entries(settings)) statement.run(key, JSON.stringify(value));
}

export function createSeries(bible: SeriesBible): Series {
  const seed = Math.floor(Math.random() * 1_000_000);
  const { lastInsertRowid } = db
    .query("INSERT INTO series (bible, seed, created_at) VALUES (?, ?, ?)")
    .run(JSON.stringify(bible), seed, now());
  return getSeries(Number(lastInsertRowid)) as Series;
}

export function getSeries(id: number): Series | null {
  const row = db.query<SeriesRow, [number]>("SELECT * FROM series WHERE id = ?").get(id);
  return row ? toSeries(row) : null;
}

export function listSeries(): Series[] {
  return db.query<SeriesRow, []>("SELECT * FROM series ORDER BY id DESC").all().map(toSeries);
}

export function saveSeriesBible(id: number, bible: SeriesBible): void {
  db.query("UPDATE series SET bible = ? WHERE id = ?").run(JSON.stringify(bible), id);
}

export function setSeriesFullStoryUrl(id: number, url: string | null): void {
  db.query("UPDATE series SET full_story_url = ? WHERE id = ?").run(url, id);
}

export function setSeriesStatus(id: number, status: Series["status"]): void {
  db.query("UPDATE series SET status = ? WHERE id = ?").run(status, id);
}

export function createEpisode(seriesId: number, partNumber: number): Episode {
  const dir = `${OUTPUT_DIR}/episodes/s${seriesId}p${String(partNumber).padStart(2, "0")}`;
  const { lastInsertRowid } = db
    .query("INSERT INTO episodes (series_id, part_number, dir, created_at) VALUES (?, ?, ?, ?)")
    .run(seriesId, partNumber, dir, now());
  const id = Number(lastInsertRowid);
  const insert = db.query("INSERT INTO steps (episode_id, name, status, updated_at) VALUES (?, ?, ?, ?)");
  for (const name of STEP_NAMES) insert.run(id, name, name === "story" ? "queued" : "waiting", now());
  return getEpisode(id) as Episode;
}

export function getEpisode(id: number): Episode | null {
  const row = db.query<EpisodeRow, [number]>("SELECT * FROM episodes WHERE id = ?").get(id);
  return row ? toEpisode(row) : null;
}

export function listEpisodes(filter: { seriesId?: number; status?: Episode["status"] } = {}): Episode[] {
  const rows = db.query<EpisodeRow, []>("SELECT * FROM episodes ORDER BY id DESC").all().map(toEpisode);
  return rows.filter(
    (episode) =>
      (filter.seriesId === undefined || episode.seriesId === filter.seriesId) &&
      (filter.status === undefined || episode.status === filter.status),
  );
}

export function saveEpisodeStory(id: number, story: Story): void {
  db.query("UPDATE episodes SET story = ? WHERE id = ?").run(JSON.stringify(story), id);
}

export function setEpisodeStatus(id: number, status: Episode["status"]): void {
  db.query("UPDATE episodes SET status = ?, published_at = ? WHERE id = ?").run(status, status === "published" ? now() : null, id);
}

export function getSteps(episodeId: number): Step[] {
  const rows = db.query<StepRow, [number]>("SELECT name, status, meta, error, updated_at FROM steps WHERE episode_id = ?").all(episodeId);
  return STEP_NAMES.map((name) => {
    const row = rows.find((candidate) => candidate.name === name) as StepRow;
    return {
      name,
      status: row.status as StepStatus,
      meta: stepMetaSchema.parse(JSON.parse(row.meta)),
      error: row.error,
      updatedAt: row.updated_at,
    };
  });
}

export function getStep(episodeId: number, name: StepName): Step {
  return getSteps(episodeId).find((step) => step.name === name) as Step;
}

export function updateStep(
  episodeId: number,
  name: StepName,
  change: { status?: StepStatus; meta?: Partial<StepMeta>; error?: string | null },
): Step {
  const current = getStep(episodeId, name);
  const meta = { ...current.meta, ...change.meta };
  db.query("UPDATE steps SET status = ?, meta = ?, error = ?, updated_at = ? WHERE episode_id = ? AND name = ?").run(
    change.status ?? current.status,
    JSON.stringify(meta),
    change.error === undefined ? current.error : change.error,
    now(),
    episodeId,
    name,
  );
  return getStep(episodeId, name);
}

type PostRow = {
  id: number;
  angle: string;
  text: string;
  image_path: string | null;
  with_image: number;
  status: string;
  url: string | null;
  error: string | null;
  created_at: string;
  published_at: string | null;
};

function toPost(row: PostRow): Post {
  return {
    id: row.id,
    angle: row.angle as PostAngle,
    text: row.text,
    imagePath: row.image_path,
    withImage: row.with_image === 1,
    status: row.status as Post["status"],
    url: row.url,
    error: row.error,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

export function createPost(post: Pick<Post, "angle" | "text" | "imagePath">): Post {
  const { lastInsertRowid } = db
    .query("INSERT INTO posts (angle, text, image_path, created_at) VALUES (?, ?, ?, ?)")
    .run(post.angle, post.text, post.imagePath, now());
  return getPost(Number(lastInsertRowid)) as Post;
}

export function getPost(id: number): Post | null {
  const row = db.query<PostRow, [number]>("SELECT * FROM posts WHERE id = ?").get(id);
  return row ? toPost(row) : null;
}

export function listPosts(filter: { status?: Post["status"] } = {}): Post[] {
  const rows = db.query<PostRow, []>("SELECT * FROM posts ORDER BY id DESC").all().map(toPost);
  return rows.filter((post) => filter.status === undefined || post.status === filter.status);
}

export function updatePost(
  id: number,
  change: Partial<Pick<Post, "text" | "imagePath" | "withImage" | "status" | "url" | "error">>,
): Post {
  const current = getPost(id) as Post;
  const next = { ...current, ...change };
  db.query("UPDATE posts SET text = ?, image_path = ?, with_image = ?, status = ?, url = ?, error = ?, published_at = ? WHERE id = ?").run(
    next.text,
    next.imagePath,
    next.withImage ? 1 : 0,
    next.status,
    next.url,
    next.error,
    next.status === "published" ? (current.publishedAt ?? now()) : null,
    id,
  );
  return getPost(id) as Post;
}

export type Report = ReportData & { id: number; takenAt: string };

type ReportRow = { id: number; taken_at: string; data: string };

const toReport = (row: ReportRow): Report => ({ ...(JSON.parse(row.data) as ReportData), id: row.id, takenAt: row.taken_at });

export function saveReport(data: ReportData): Report {
  const { lastInsertRowid } = db.query("INSERT INTO reports (taken_at, data) VALUES (?, ?)").run(now(), JSON.stringify(data));
  return toReport(db.query<ReportRow, [number]>("SELECT * FROM reports WHERE id = ?").get(Number(lastInsertRowid)) as ReportRow);
}

// Newest first.
export function listReports(limit = 200): Report[] {
  return db.query<ReportRow, [number]>("SELECT * FROM reports ORDER BY id DESC LIMIT ?").all(limit).map(toReport);
}

// The newest report taken at or before the given moment.
export function reportBefore(moment: Date): Report | null {
  const row = db.query<ReportRow, [string]>("SELECT * FROM reports WHERE taken_at <= ? ORDER BY id DESC LIMIT 1").get(moment.toISOString());
  return row ? toReport(row) : null;
}
