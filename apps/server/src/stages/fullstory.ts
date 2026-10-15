import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { config, video } from "../config";
import { ffmpeg } from "../lib/ffmpeg";
import { buildCard } from "./captions";
import { SFX_DIR } from "./sfx";

const ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"];
const AUDIO = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];
const INTRO_SECONDS = 3.5;
const OUTRO_SECONDS = 5;

export type Card = { image: string; lines: { text: string; size?: number; gold?: boolean }[] };

export type FullStoryOptions = {
  // Opens the film once: the story's title over its first picture.
  intro?: Card;
  // Closes it once: the traditional ending and what comes next, over its last picture.
  outro?: Card;
};

// A still picture that slowly moves closer, with the card's words popping in over it and a chime.
async function renderCard(card: Card, seconds: number, output: string): Promise<void> {
  const work = dirname(output);
  const assName = `${output.split("/").pop()}.ass`;
  await Bun.write(join(work, assName), buildCard(card.lines, seconds));
  const frames = Math.round(seconds * video.fps);
  const chime = resolve(SFX_DIR, "sparkle.mp3");
  const hasChime = await Bun.file(chime).exists();
  await ffmpeg(
    [
      "-loop", "1", "-i", resolve(card.image),
      ...(hasChime ? ["-i", chime] : ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]),
      "-filter_complex",
      [
        `[0:v]scale=${video.width * 2}:${video.height * 2}:force_original_aspect_ratio=increase,crop=${video.width * 2}:${video.height * 2},` +
          `zoompan=z='min(1+0.0009*on,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${video.width}x${video.height}:fps=${video.fps},` +
          `eq=brightness=-0.06,ass=${assName}:fontsdir=${config.CAPTION_FONTS_DIR},setsar=1[v]`,
        `[1:a]aresample=48000,volume=0.5,apad[a]`,
      ].join(";"),
      "-map", "[v]", "-map", "[a]",
      "-t", seconds.toFixed(3),
      ...ENCODE, ...AUDIO,
      resolve(output),
    ],
    work,
  );
}

// Joins finished chapters, in the order given, into one video, with the opening and ending cards once
// each. Every piece is re-encoded to the same frame size and rate, so they join cleanly.
export async function runFullStory(partVideos: string[], output: string, options: FullStoryOptions = {}): Promise<string> {
  if (partVideos.length < 2) throw new Error("The full story needs at least two finished parts");
  const work = dirname(output);
  await mkdir(work, { recursive: true });
  const pieces = [...partVideos.map((file) => resolve(file))];
  if (options.intro) {
    const intro = join(work, "intro.mp4");
    await renderCard(options.intro, INTRO_SECONDS, intro);
    pieces.unshift(resolve(intro));
  }
  if (options.outro) {
    const outro = join(work, "outro.mp4");
    await renderCard(options.outro, OUTRO_SECONDS, outro);
    pieces.push(resolve(outro));
  }
  const inputs = pieces.flatMap((file) => ["-i", file]);
  const normalize = pieces
    .map((_, index) => `[${index}:v]scale=${video.width}:${video.height},fps=${video.fps},setsar=1[v${index}];[${index}:a]aresample=48000,aformat=channel_layouts=stereo[a${index}]`)
    .join(";");
  const joined = pieces.map((_, index) => `[v${index}][a${index}]`).join("");
  await ffmpeg([
    ...inputs,
    "-filter_complex", `${normalize};${joined}concat=n=${pieces.length}:v=1:a=1[v][a]`,
    "-map", "[v]", "-map", "[a]",
    ...ENCODE, ...AUDIO,
    "-movflags", "+faststart",
    resolve(output),
  ]);
  return output;
}

// The vertical version of a wide chapter, for YouTube Shorts: the whole picture across the middle,
// over a blurred, darkened copy of itself that fills the tall frame.
export async function runShort(wideVideo: string, output: string): Promise<string> {
  await mkdir(dirname(output), { recursive: true });
  const width = 1080;
  const height = 1920;
  await ffmpeg([
    "-i", resolve(wideVideo),
    "-filter_complex",
    `[0:v]split[a][b];[a]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=24:3,eq=brightness=-0.12[bg];` +
      `[b]scale=${width}:-2:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`,
    "-map", "[v]", "-map", "0:a",
    ...ENCODE,
    "-c:a", "copy",
    "-movflags", "+faststart",
    resolve(output),
  ]);
  return output;
}
