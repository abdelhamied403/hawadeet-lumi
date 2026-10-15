import { mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { ffmpeg, mediaDuration } from "../lib/ffmpeg";
import { paths, sceneName } from "../lib/project";
import { HERO, NARRATOR } from "../schemas/story";
import { getSeries, getStep, listEpisodes, OUTPUT_DIR, type Episode, type StepName } from "./store";

// Frames looked at per clip, spread over its length (start, middle, end and one picked by chance).
const CLIP_FRAMES = 4;
const FRAME_WIDTH = 416;
// The finished video is looked at as one frame every this many seconds.
const VIDEO_FRAME_EVERY = 4;

// Everything a reviewer needs to judge one step of one chapter: what it is meant to be, what the
// server's own checks found, and the files to look at, as paths under /media/ (the reviewer may run on
// another machine and download them).
export type ReviewPacket = {
  episodeId: number;
  chapter: number;
  chapters: number;
  step: StepName;
  // How many times this step has already been sent back.
  attempt: number;
  // The reason given the last time it was sent back.
  lastNote: string | null;
  story: { title: string; type: string; lesson: string; chapterPlan: string };
  // For a script: the earlier chapters' lines, so the wording stays the same from chapter to chapter.
  earlierChapters: { chapter: number; lines: string[] }[];
  // The story's recurring objects and places with the Arabic words used for them.
  names: string[];
  // The server's own automatic findings, scene by scene (0 = the whole chapter).
  flags: { scene: number; problem: string }[];
  scenes: {
    scene: number;
    lines: string[];
    // Who should be visible, with their fixed looks.
    shows: string[];
    place: string;
    imagePrompt: string;
    motionPrompt: string;
    sfx: string | null;
    // The files to look at for this scene in this step.
    files: string[];
    audioSeconds: number | null;
  }[];
  // Files about the whole chapter: a sheet of every picture, frames of the finished video.
  files: string[];
  // Loudness of the finished video, in LUFS (about -16 is right for YouTube).
  loudness: number | null;
};

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

// The scenes' images side by side, four to a row, in scene order.
async function contactSheet(images: string[], output: string): Promise<string | null> {
  const present: string[] = [];
  for (const image of images) if (await exists(image)) present.push(image);
  if (present.length === 0) return null;
  const columns = 4;
  await ffmpeg([
    ...present.flatMap((image) => ["-i", image]),
    "-filter_complex",
    `${present.map((_, index) => `[${index}:v]scale=480:264,setsar=1[s${index}]`).join(";")};${present.map((_, index) => `[s${index}]`).join("")}xstack=inputs=${present.length}:layout=${present
      .map((_, index) => `${(index % columns) * 486}_${Math.floor(index / columns) * 270}`)
      .join("|")}:fill=black[out]`,
    "-map", "[out]", "-frames:v", "1", "-q:v", "3",
    output,
  ]).catch(async () => {
    // xstack needs at least two inputs; a single picture is its own sheet.
    await ffmpeg(["-i", present[0] as string, "-vf", "scale=960:-2", "-frames:v", "1", "-q:v", "3", output]);
  });
  return output;
}

// Four frames of a clip side by side, left to right in time order.
async function clipFrames(clip: string, output: string): Promise<string | null> {
  if (!(await exists(clip))) return null;
  const seconds = await mediaDuration(clip);
  await ffmpeg(["-i", clip, "-vf", `fps=${CLIP_FRAMES}/${seconds.toFixed(3)},scale=${FRAME_WIDTH}:-2,tile=${CLIP_FRAMES}x1:padding=4`, "-frames:v", "1", "-q:v", "4", output]);
  return output;
}

async function loudness(video: string): Promise<number | null> {
  const log = await ffmpeg(["-i", video, "-af", "ebur128", "-f", "null", "-"]).catch(() => "");
  const match = /I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/.exec(log) ?? [...log.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].at(-1);
  return match ? Number(match[1]) : null;
}

export async function buildPacket(episode: Episode, step: StepName, model: string): Promise<ReviewPacket> {
  const story = episode.story;
  if (!story) throw new Error("The chapter has no script yet");
  const series = getSeries(episode.seriesId);
  const meta = getStep(episode.id, step).meta;
  const dir = resolve(episode.dir);
  const work = join(dir, "work", "review", step);
  await mkdir(work, { recursive: true });
  const imageOf = (number: number) => join(dir, "render", model, "images", `${sceneName(number)}.png`);

  const scenes: ReviewPacket["scenes"] = [];
  for (const [index, scene] of story.scenes.entries()) {
    const number = index + 1;
    const files: string[] = [];
    if (step === "images" && (await exists(imageOf(number)))) files.push(imageOf(number));
    if (step === "clips") {
      const frames = await clipFrames(resolve(paths.clip(dir, model, number)), join(work, `${sceneName(number)}-frames.jpg`));
      if (frames) files.push(frames);
    }
    const shows = (scene.shows ?? []).map((who) => {
      if (who === HERO) return `the main character (${story.characterSheet})`;
      const member = story.cast.find((candidate) => candidate.name === who);
      return member ? `${who}: ${member.look}` : who;
    });
    const voice = await Bun.file(paths.voiceTimings(dir, number))
      .json()
      .catch(() => null);
    scenes.push({
      scene: number,
      lines: scene.lines.map((line) => `${line.speaker === NARRATOR ? "Storyteller" : line.speaker === HERO ? "Main character" : line.speaker}: ${line.text}`),
      shows,
      place: story.places.find((place) => place.name === scene.place)?.look ?? scene.place ?? "",
      imagePrompt: scene.imagePrompt,
      motionPrompt: scene.motionPrompt,
      sfx: scene.sfx ?? null,
      files,
      audioSeconds: voice?.duration ?? null,
    });
  }

  const files: string[] = [];
  if (step === "images") {
    const sheet = await contactSheet(story.scenes.map((_, index) => imageOf(index + 1)), join(work, "sheet.jpg"));
    if (sheet) files.push(sheet);
  }
  let level: number | null = null;
  if (step === "video") {
    const final = resolve(paths.final(dir, model));
    if (await exists(final)) {
      const seconds = await mediaDuration(final);
      const count = Math.max(4, Math.ceil(seconds / VIDEO_FRAME_EVERY));
      const columns = 4;
      const sheet = join(work, "frames.jpg");
      await ffmpeg(["-i", final, "-vf", `fps=1/${VIDEO_FRAME_EVERY},scale=480:-2,tile=${columns}x${Math.ceil(count / columns)}:padding=4`, "-frames:v", "1", "-q:v", "4", sheet]);
      files.push(sheet);
      level = await loudness(final);
    }
  }

  const media = (path: string) => relative(resolve(OUTPUT_DIR), resolve(path));
  for (const scene of scenes) scene.files = scene.files.map(media);
  files.splice(0, files.length, ...files.map(media));
  const plan = series?.bible.parts.find((part) => part.number === episode.partNumber);
  const earlierChapters =
    step === "story"
      ? listEpisodes({ seriesId: episode.seriesId })
          .filter((other) => other.partNumber < episode.partNumber && other.status !== "cancelled" && other.story)
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((other) => ({ chapter: other.partNumber, lines: (other.story?.scenes ?? []).flatMap((scene) => scene.lines.map((line) => line.text)) }))
      : [];
  const names = [...story.props, ...story.places].map((thing) => `${thing.name}: ${thing.nameArabic ?? ""}`);
  return {
    episodeId: episode.id,
    chapter: episode.partNumber,
    chapters: series?.bible.parts.length ?? episode.partNumber,
    step,
    attempt: meta.attempt,
    lastNote: meta.note ?? null,
    story: {
      title: series?.bible.title ?? story.title,
      type: series?.bible.storyType ?? "",
      lesson: series?.bible.lesson ?? "",
      chapterPlan: plan ? JSON.stringify(plan) : "",
    },
    earlierChapters,
    names,
    flags: meta.flags ?? [],
    scenes,
    files,
    loudness: level,
  };
}
