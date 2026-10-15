import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { config } from "../config";
import { ffmpeg } from "../lib/ffmpeg";
import { writeJson } from "../lib/story-model";
import { buildCard } from "./captions";

const WIDTH = 1280;
const HEIGHT = 720;
const LOOK_WIDTH = 384;
// Pictures offered to the picker: enough to choose from, few enough that it looks at each one.
const MAX_CANDIDATES = 10;

const replySchema = z.object({ picture: z.number().int() });

// Asks which picture makes the best cover for a children's video: the main character's face, bright and
// clear, with room for the title. Falls back to the first picture when the answer cannot be used.
async function pickCover(images: string[], title: string): Promise<string> {
  const candidates = images.slice(0, MAX_CANDIDATES);
  const jpegs: Buffer[] = [];
  for (const [index, image] of candidates.entries()) {
    const jpeg = `${dirname(image)}/../cover-${index + 1}.jpg`;
    await ffmpeg(["-i", resolve(image), "-vf", `scale=${LOOK_WIDTH}:-2`, "-q:v", "6", resolve(jpeg)]);
    jpegs.push(Buffer.from(await Bun.file(jpeg).arrayBuffer()));
  }
  const prompt = `These ${candidates.length} pictures are scenes from an Egyptian children's cartoon called "${title}". Pick the one that makes the best YouTube thumbnail for children aged 4 to 8 and their parents: the main character's face large and clear with a happy, curious expression, bright colours, simple background, nothing frightening, and some calm space where a title can sit.

Return ONLY JSON: {"picture": <number from 1 to ${candidates.length}>}`;
  try {
    const { data } = await writeJson(prompt, undefined, jpegs);
    const { picture } = replySchema.parse(data);
    return candidates[picture - 1] ?? (candidates[0] as string);
  } catch (error) {
    console.error(`thumbnail pick: ${error instanceof Error ? error.message : error}`);
    return candidates[0] as string;
  }
}

// Makes the 1280×720 cover of the full story: the chosen picture with the title in large letters.
export async function runThumbnail(images: string[], title: string, output: string): Promise<string> {
  if (images.length === 0) throw new Error("There are no pictures to make a thumbnail from");
  const cover = await pickCover(images, title);
  await mkdir(dirname(output), { recursive: true });
  const assPath = `${output}.ass`;
  await Bun.write(assPath, buildCard([{ text: title, size: 104, gold: true }], 1, { width: WIDTH, height: HEIGHT }).replace(/\\pos\((\d+),(\d+)\)/g, `\\pos($1,${Math.round(HEIGHT * 0.8)})`));
  await ffmpeg(
    [
      "-loop", "1", "-i", resolve(cover),
      "-vf", `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},ass=${assPath.split("/").pop()}:fontsdir=${config.CAPTION_FONTS_DIR}`,
      // A moment in, once the title has popped to its full size.
      "-ss", "0.6",
      "-frames:v", "1", "-q:v", "2",
      resolve(output),
    ],
    dirname(output),
  );
  return output;
}
