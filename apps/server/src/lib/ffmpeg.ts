import ffmpegPath from "ffmpeg-static";

if (!ffmpegPath) throw new Error("ffmpeg-static did not provide a binary for this platform");

// Runs ffmpeg and returns its stderr (where ffmpeg writes progress and stream info).
export async function ffmpeg(args: string[], cwd?: string): Promise<string> {
  const child = Bun.spawn([ffmpegPath as string, "-hide_banner", "-y", ...args], {
    cwd,
    stdout: "ignore",
    stderr: "pipe",
  });
  const stderr = await new Response(child.stderr).text();
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(`ffmpeg failed (${code}): ffmpeg ${args.join(" ")}\n${stderr.slice(-1500)}`);
  }
  return stderr;
}

// Decodes the whole file, so the result is exact even when the container's duration header is not.
export async function mediaDuration(path: string): Promise<number> {
  const stderr = await ffmpeg(["-i", path, "-f", "null", "-"]);
  const matches = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = matches.at(-1);
  if (!last) throw new Error(`Could not read the duration of ${path}`);
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}
