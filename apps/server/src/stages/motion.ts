import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ffmpeg } from "../lib/ffmpeg";
import { paths, sceneName } from "../lib/project";
import { writeJson } from "../lib/story-model";
import { NARRATOR, type Story } from "../schemas/story";

// A motion description shorter than this is too vague for the motion model, which then invents things.
const MIN_WORDS = 70;
const LOOK_WIDTH = 384;

const replySchema = z.object({ motionPrompt: z.string().min(1) });

export type DirectMotionOptions = {
  // The model whose scene images are looked at.
  model: string;
  // Scene numbers to direct; every scene when omitted.
  scenes?: number[];
  // What the producer wants changed in the motion.
  note?: string;
};

// The video model draws any words it is given as writing on the screen, so a motion description never carries
// the spoken line: Arabic letters and anything in quotation marks are taken out.
export function withoutWords(motionPrompt: string): string {
  return motionPrompt
    .replace(/["“”«»][^"“”«»]*["“”«»]/g, "")
    .replace(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+/g, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Rewrites the motion description of each scene into a full shot description, written while looking at
// the scene's actual image, so the motion model is told what is in the picture and what must stay as it is.
// One request per scene: with every picture in one request, the answers came back matched to the wrong
// pictures, whatever numbering was used, and shots got another scene's motion.
export async function directMotion(dir: string, story: Story, options: DirectMotionOptions): Promise<Story> {
  const numbers = story.scenes.map((_, index) => index + 1).filter((number) => !options.scenes || options.scenes.includes(number));
  const work = paths.workDir(dir, "motion");
  await mkdir(work, { recursive: true });
  const directed = new Map<number, string>();
  for (const number of numbers) {
    const written = await directScene(dir, story, number, options).catch((error: Error) => {
      console.error(`motion for scene ${number} kept as written: ${error.message.slice(0, 200)}`);
      return null;
    });
    if (written) directed.set(number, written);
  }
  return {
    ...story,
    scenes: story.scenes.map((scene, index) => {
      const written = directed.get(index + 1);
      return written && written.split(/\s+/).length >= MIN_WORDS ? { ...scene, motionPrompt: written } : scene;
    }),
  };
}

async function directScene(dir: string, story: Story, number: number, options: DirectMotionOptions): Promise<string> {
  const source = join(paths.renderDir(dir, options.model), "images", `${sceneName(number)}.png`);
  const jpeg = join(paths.workDir(dir, "motion"), `${sceneName(number)}.jpg`);
  await ffmpeg(["-i", source, "-vf", `scale=${LOOK_WIDTH}:-2`, "-q:v", "6", jpeg]);
  const scene = story.scenes[number - 1]!;
  const spoken = scene.lines.map((line) => `${line.speaker === NARRATOR ? "voice-over" : `${line.speaker} says aloud`}: ${line.text}`).join(" / ");
  const brief = `Spoken during it: ${spoken}. Intended action: ${scene.motionPrompt}`;
  const prompt = `You direct the motion for a wide 16:9 animated story for small children, in a bright 3D cartoon style. The picture above is the first frame of one 5-second shot. An image-to-video model animates it from your description. It follows a detailed description closely, and it cannot be told what to avoid: whatever it is not told, it makes up (characters appear, objects change, the camera turns to places that do not exist).

${brief}
${options.note ? `\nThe producer's note on the previous result, to follow fully: ${options.note}\n` : ""}
The viewer hears the spoken words while watching the shot, so what moves must be what those words describe. A girl who says she runs to the tree is seen running to it; a cat that jumps onto the wall is seen jumping. A shot where they only stand and blink while the words describe an action is wrong. Movements are lively and gentle, like a family animated film: nothing sudden, violent or frightening.

Write "motionPrompt": ONE English paragraph of 110 to 150 words, in this order:
1. What is in the picture, as you SEE it (trust the picture over anything else): who, by appearance ("a little girl in a yellow dress", "a small orange cat", never a name), their pose, where, the light.
2. The action, taken from the spoken words and the intended action, told as three beats in time: how it begins in the first second, what happens through the middle, and where it has come to rest by the end. Describe it physically: which part of the body or which object moves, in which direction, how far, how fast. One action, carried through from start to finish; a real movement of the body, not a twitch.
3. The face: where the eyes go and how the expression changes over the shot. Someone who says a line aloud speaks it for the whole shot, lips and jaw moving with the rhythm of speech, but only when their mouth can be seen in the picture; someone who is not speaking keeps their lips together. Never write the words that are said, in any language, and never put anything in quotation marks: the video model would draw them on the screen as writing.
4. One or two signs of life around the action: a blink, hair or fur moving in the breeze, leaves swaying, birds in the sky, sunlight sparkling on water.
5. The camera: fixed in place, or one very slow push-in. Never a pan, tilt, orbit or pull-back, even when the intended action asks for one: replace it with a slow push-in.
6. What stays exactly as it is, stated as facts: "the garden gate stays shut", "the kite stays caught in the tree", "the two children stay the only ones in the frame". Always cover the number of characters and every door in the picture.
Write only what happens, in positive statements. The words "no", "not", "without" and "never" must not appear: instead of "no other people appear", write "the girl stays alone in the garden". One continuous shot.

Return ONLY JSON: { "motionPrompt": "..." }`;

  const { data } = await writeJson(prompt, undefined, [Buffer.from(await Bun.file(jpeg).arrayBuffer())]);
  return withoutWords(replySchema.parse(data).motionPrompt);
}
