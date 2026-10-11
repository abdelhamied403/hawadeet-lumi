import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ffmpeg } from "../lib/ffmpeg";
import { paths, sceneName } from "../lib/project";
import { writeJson } from "../lib/story-model";
import { NARRATOR, type Story } from "../schemas/story";

// A motion description shorter than this is too vague for the motion model, which then invents things.
const MIN_WORDS = 35;
const LOOK_WIDTH = 384;

const replySchema = z.object({ scenes: z.array(z.object({ scene: z.number().int(), motionPrompt: z.string().min(1) })) });

export type DirectMotionOptions = {
  // The model whose scene images are looked at.
  model: string;
  // Scene numbers to direct; every scene when omitted.
  scenes?: number[];
  // What the producer wants changed in the motion.
  note?: string;
};

// Rewrites the motion description of each scene into a full shot description, written while looking at
// the scene's actual image, so the motion model is told what is in the picture and what must stay as it is.
export async function directMotion(dir: string, story: Story, options: DirectMotionOptions): Promise<Story> {
  const numbers = story.scenes.map((_, index) => index + 1).filter((number) => !options.scenes || options.scenes.includes(number));
  const work = paths.workDir(dir, "motion");
  await mkdir(work, { recursive: true });
  const images: Buffer[] = [];
  for (const number of numbers) {
    const source = join(paths.renderDir(dir, options.model), "images", `${sceneName(number)}.png`);
    const jpeg = join(work, `${sceneName(number)}.jpg`);
    await ffmpeg(["-i", source, "-vf", `scale=${LOOK_WIDTH}:-2`, "-q:v", "6", jpeg]);
    images.push(Buffer.from(await Bun.file(jpeg).arrayBuffer()));
  }

  const briefs = numbers.map((number, position) => {
    const scene = story.scenes[number - 1]!;
    const spoken = scene.lines.map((line) => `${line.speaker === NARRATOR ? "voice-over" : `${line.speaker} says aloud`}: ${line.text}`).join(" / ");
    return `Picture ${position + 1} = scene ${number}. Spoken during it: ${spoken}. Intended action: ${scene.motionPrompt}`;
  });

  const prompt = `You direct the motion for a vertical Egyptian horror video. Each picture above is the first frame of one 5-second shot. An image-to-video model animates it from your description, and it cannot be told what to avoid: whatever it is not told, it makes up (doors swing open, strangers walk in, the camera turns to rooms that do not exist).

${briefs.join("\n")}
${options.note ? `\nThe producer's note on the previous result, to follow fully: ${options.note}\n` : ""}
For each scene write "motionPrompt": ONE English paragraph of 60 to 90 words, in this order:
1. What is in the picture, as you SEE it (trust the picture over anything else): who, by appearance ("an old man in a beige galabeya", never a name), where, the light.
2. The ONE main action, taken from the intended action and fitting the spoken words, described physically: which part moves, in which direction, how slowly. Someone who says a line aloud moves their lips as they speak, but only when their mouth can actually be seen in the picture. Small and slow beats big and fast.
3. One or two signs of life around it: breathing, a blink, a flickering bulb, drifting dust.
4. The camera: fixed in place, or one very slow push-in. Never a pan, tilt, orbit or pull-back, even when the intended action asks for one: replace it with a slow push-in.
5. What stays exactly as it is, stated as a fact: "the door stays shut and padlocked", "the corridor behind him stays empty", "the figure stays a blurred shadow behind the glass", "he stays alone in the frame". Always cover doors, the number of people, and anything hidden or half-seen.
Write only what happens, in positive statements. The words "no", "not", "without" and "never" must not appear: instead of "no other people appear", write "he stays alone in the corridor". One continuous shot.

Return ONLY JSON: { "scenes": [{ "scene": <scene number>, "motionPrompt": "..." }] } with exactly these scenes: ${numbers.join(", ")}.`;

  const { data } = await writeJson(prompt, undefined, images);
  const directed = new Map(replySchema.parse(data).scenes.map((item) => [item.scene, item.motionPrompt.trim()]));
  return {
    ...story,
    scenes: story.scenes.map((scene, index) => {
      const written = directed.get(index + 1);
      const usable = numbers.includes(index + 1) && written && written.split(/\s+/).length >= MIN_WORDS;
      return usable ? { ...scene, motionPrompt: written } : scene;
    }),
  };
}
