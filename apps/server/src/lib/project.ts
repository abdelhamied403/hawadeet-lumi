import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { storySchema, type Story, type StoryInput } from "../schemas/story";

export const paths = {
  story: (dir: string) => join(dir, "story.json"),
  narration: (dir: string) => join(dir, "voice", "narration.mp3"),
  voiceTake: (dir: string, take: string) => join(dir, "voice", "takes", `${take}.mp3`),
  voiceLine: (dir: string, scene: number, line: number) => join(dir, "voice", "lines", `${sceneName(scene)}-${line}.mp3`),
  voiceAudio: (dir: string, scene: number) => join(dir, "voice", `${sceneName(scene)}.mp3`),
  voiceTimings: (dir: string, scene: number) => join(dir, "voice", `${sceneName(scene)}.json`),
  job: (dir: string, model: string) => join(dir, "jobs", `${model}.json`),
  renderDir: (dir: string, model: string) => join(dir, "render", model),
  clip: (dir: string, model: string, scene: number) => join(dir, "render", model, "clips", `${sceneName(scene)}.mp4`),
  workDir: (dir: string, model: string) => join(dir, "work", model),
  captions: (dir: string) => join(dir, "captions.ass"),
  final: (dir: string, model: string) => join(dir, `video-${model}.mp4`),
};

// Scenes are numbered from 1 in file names.
export function sceneName(scene: number): string {
  return `scene-${String(scene).padStart(2, "0")}`;
}

export async function loadStory(dir: string): Promise<Story> {
  const file = Bun.file(paths.story(dir));
  if (!(await file.exists())) throw new Error(`No story.json in ${dir}`);
  return storySchema.parse(await file.json());
}

export async function saveStory(dir: string, story: StoryInput): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Bun.write(paths.story(dir), JSON.stringify(storySchema.parse(story), null, 2));
}
