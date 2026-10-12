import { mkdir, readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { config, video } from "../config";
import { ffmpeg, mediaDuration } from "../lib/ffmpeg";
import { loadStory, paths, sceneName } from "../lib/project";
import { buildAss, buildCaptions } from "./captions";
import { SFX_DIR } from "./sfx";
import { loadSceneVoice, type SceneVoice } from "./voice";

const MUSIC_DIR = "assets/music";
// Both tracks are first levelled to the same loudness, then the music is turned down to this fraction.
const MUSIC_VOLUME = 0.32;
const LEVEL = "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000";
const MUSIC_FADE_SECONDS = 1.5;
// Sound effects are stored near full scale; this brings them under the voice.
const SFX_VOLUME = 0.45;
// An effect starts just after its scene does, so it does not land exactly on the cut.
const SFX_DELAY_SECONDS = 0.15;
// A clip shorter than its narration is slowed down by at most this much; the rest is a held last frame.
const MAX_SLOWDOWN = 1.5;

// Whole frames only, so the video and audio tracks stay the same length across many scenes.
function sceneLength(voice: SceneVoice): number {
  return Math.ceil((voice.duration + video.sceneTailSeconds) * video.fps) / video.fps;
}

export async function listMusic(): Promise<string[]> {
  const files = await readdir(MUSIC_DIR).catch(() => []);
  return files.filter((file) => /\.(mp3|m4a|wav|ogg|flac)$/i.test(file)).sort();
}

// Without a chosen track, each project folder gets a stable pick, so the tracks rotate between videos.
async function findMusic(dir: string, preferred?: string): Promise<string | null> {
  const tracks = await listMusic();
  if (tracks.length === 0) return null;
  if (preferred && tracks.includes(preferred)) return resolve(MUSIC_DIR, preferred);
  const key = [...resolve(dir)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return resolve(MUSIC_DIR, tracks[key % tracks.length] as string);
}

export type AssembleOptions = {
  // File name inside assets/music.
  musicTrack?: string;
  // Music level relative to the voice, 0 to 1.
  musicVolume?: number;
  // Sound effect level, 0 to 1.
  sfxVolume?: number;
};

async function buildVideoSegment(clip: string, target: number, output: string): Promise<void> {
  const clipLength = await mediaDuration(clip);
  const slowdown = Math.min(Math.max(target / clipLength, 1), MAX_SLOWDOWN);
  const filters = [
    `setpts=${slowdown.toFixed(4)}*PTS`,
    // Builds the in-between frames, so 16 fps clips (and slowed ones) play smoothly instead of stepping.
    `minterpolate=fps=${video.fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`,
    `scale=${video.width}:${video.height}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${video.width}:${video.height}`,
    "setsar=1",
    `fps=${video.fps}`,
    "tpad=stop_mode=clone:stop_duration=3",
  ];
  await ffmpeg([
    "-i", clip,
    "-vf", filters.join(","),
    "-t", target.toFixed(4),
    "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
    output,
  ]);
}

async function buildAudioSegment(audio: string, target: number, output: string): Promise<void> {
  await ffmpeg(["-i", audio, "-af", "apad", "-t", target.toFixed(4), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", output]);
}

async function concat(files: string[], listPath: string, output: string): Promise<void> {
  await Bun.write(listPath, files.map((file) => `file '${file}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", output]);
}

export async function runAssemble(dir: string, model: string, options: AssembleOptions = {}): Promise<string> {
  const story = await loadStory(dir);
  const work = resolve(paths.workDir(dir, model));
  await mkdir(work, { recursive: true });

  const voices: SceneVoice[] = [];
  const videoSegments: string[] = [];
  const audioSegments: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let cursor = 0;

  for (const index of story.scenes.keys()) {
    const number = index + 1;
    const clip = resolve(paths.clip(dir, model, number));
    if (!(await Bun.file(clip).exists())) throw new Error(`Missing clip for scene ${number}: ${clip}`);
    const voice = await loadSceneVoice(dir, number);
    const target = sceneLength(voice);

    const videoSegment = join(work, `${sceneName(number)}.mp4`);
    const audioSegment = join(work, `${sceneName(number)}.wav`);
    // Motion smoothing takes minutes per clip, so a segment is rebuilt only when its clip or length changed.
    const stamp = `${Bun.file(clip).lastModified}:${target.toFixed(4)}`;
    const stampFile = Bun.file(`${videoSegment}.stamp`);
    if (!(await Bun.file(videoSegment).exists()) || !(await stampFile.exists()) || (await stampFile.text()) !== stamp) {
      await buildVideoSegment(clip, target, videoSegment);
      await Bun.write(stampFile, stamp);
    }
    await buildAudioSegment(resolve(paths.voiceAudio(dir, number)), target, audioSegment);

    voices.push(voice);
    videoSegments.push(videoSegment);
    audioSegments.push(audioSegment);
    starts.push(cursor);
    cursor += target;
    ends.push(cursor);
  }

  const joinedVideo = join(work, "video.mp4");
  const narration = join(work, "narration.wav");
  await concat(videoSegments, join(work, "video.txt"), joinedVideo);
  await concat(audioSegments, join(work, "audio.txt"), narration);

  await Bun.write(paths.captions(dir), buildAss(buildCaptions(voices, starts, ends), { text: story.hook, end: ends[0] ?? 0 }));

  const music = await findMusic(dir, options.musicTrack);
  const inputs = ["-i", joinedVideo, "-i", narration];
  // ffmpeg runs inside the project folder so the captions path needs no filter escaping.
  const filters = [`[0:v]ass=captions.ass:fontsdir=${config.CAPTION_FONTS_DIR}[v]`, `[1:a]${LEVEL}[voice]`];
  const mix = ["[voice]"];
  let nextInput = 2;
  if (music) {
    inputs.push("-stream_loop", "-1", "-i", music);
    const fadeStart = Math.max(0, cursor - MUSIC_FADE_SECONDS).toFixed(2);
    filters.push(
      `[${nextInput}:a]${LEVEL},volume=${options.musicVolume ?? MUSIC_VOLUME},afade=t=out:st=${fadeStart}:d=${MUSIC_FADE_SECONDS}[music]`,
    );
    mix.push("[music]");
    nextInput++;
  }
  for (const [index, scene] of story.scenes.entries()) {
    const effect = scene.sfx ? resolve(SFX_DIR, `${scene.sfx}.mp3`) : null;
    if (!effect || !(await Bun.file(effect).exists())) continue;
    const delay = Math.round(((starts[index] ?? 0) + SFX_DELAY_SECONDS) * 1000);
    inputs.push("-i", effect);
    filters.push(`[${nextInput}:a]aresample=48000,volume=${options.sfxVolume ?? SFX_VOLUME},adelay=${delay}:all=1[sfx${index}]`);
    mix.push(`[sfx${index}]`);
    nextInput++;
  }
  filters.push(`${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0[a]`);

  const output = resolve(paths.final(dir, model));
  await ffmpeg(
    [
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", "[v]",
      "-map", "[a]",
      "-t", cursor.toFixed(4),
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      output,
    ],
    resolve(dir),
  );

  // Recorded so the publish step can credit the track in the description.
  await Bun.write(join(resolve(dir), "music.txt"), music ? basename(music) : "");
  console.log(`video: ${output} (${cursor.toFixed(1)}s, music: ${music ? basename(music) : "none in assets/music"})`);
  return output;
}
