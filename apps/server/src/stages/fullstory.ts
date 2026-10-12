import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { video } from "../config";
import { ffmpeg } from "../lib/ffmpeg";

// Joins finished parts, in the order given, into one video. Every part is re-encoded to the same
// frame size and rate, so parts made with different settings still join cleanly.
export async function runFullStory(partVideos: string[], output: string): Promise<string> {
  if (partVideos.length < 2) throw new Error("The full story needs at least two finished parts");
  await mkdir(dirname(output), { recursive: true });
  const list = join(dirname(output), "parts.txt");
  await Bun.write(list, partVideos.map((file) => `file '${resolve(file)}'`).join("\n"));
  await ffmpeg([
    "-f", "concat", "-safe", "0", "-i", list,
    "-vf", `scale=${video.width}:${video.height},fps=${video.fps},setsar=1`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart",
    resolve(output),
  ]);
  return output;
}
