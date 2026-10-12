import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ffmpeg, mediaDuration } from "../lib/ffmpeg";
import { paths, sceneName } from "../lib/project";
import { writeJson } from "../lib/story-model";
import { NARRATOR, type Story } from "../schemas/story";

const LOOK_WIDTH = 384;
// Frames looked at per clip, spread over its length and laid side by side in time order.
const CLIP_FRAMES = 4;
const FRAME_WIDTH = 224;

// Scenes looked at per request: with more pictures at once the checker skims them and misses changes.
const BATCH = { images: 6, clips: 4 } as const;

const RETRY_PAUSE_MS = 30_000;

const replySchema = z.object({
  scenes: z.array(z.object({ scene: z.number().int(), seen: z.string().default(""), ok: z.boolean(), problem: z.string().default("") })),
});

// A scene whose picture or clip does not show what the scene says, in one sentence for the reviewer.
export type SceneFlag = { scene: number; problem: string };

export type CheckOptions = {
  // The model whose scene images and clips are looked at.
  model: string;
  kind: "images" | "clips";
  // Scene numbers to check; every scene when omitted.
  scenes?: number[];
};

function spoken(story: Story, number: number): string {
  const scene = story.scenes[number - 1]!;
  return scene.lines.map((line) => `${line.speaker === NARRATOR ? "voice-over" : `${line.speaker} says aloud`}: ${line.text}`).join(" / ");
}

// Looks at each scene's image (or frames of its clip) next to what the scene says and describes, and
// returns the scenes that do not match. It only reports: the reviewer decides what is redone.
export async function checkScenes(dir: string, story: Story, options: CheckOptions): Promise<SceneFlag[]> {
  const all = story.scenes.map((_, index) => index + 1).filter((number) => !options.scenes || options.scenes.includes(number));
  const flags: SceneFlag[] = [];
  for (let start = 0; start < all.length; start += BATCH[options.kind]) {
    const numbers = all.slice(start, start + BATCH[options.kind]);
    // A busy checker is asked once more; scenes it still cannot look at go to review unchecked.
    const found = await checkBatch(dir, story, options, numbers).catch(async () => {
      await Bun.sleep(RETRY_PAUSE_MS);
      return checkBatch(dir, story, options, numbers).catch((error: Error) => {
        console.error(`check of ${options.kind} ${numbers.join(", ")} skipped: ${error.message.slice(0, 200)}`);
        return [];
      });
    });
    flags.push(...found);
  }
  return flags;
}

async function checkBatch(dir: string, story: Story, options: CheckOptions, numbers: number[]): Promise<SceneFlag[]> {
  const work = paths.workDir(dir, `check-${options.kind}`);
  await mkdir(work, { recursive: true });

  const pictures: Buffer[] = [];
  for (const number of numbers) {
    const jpeg = join(work, `${sceneName(number)}.jpg`);
    if (options.kind === "images") {
      const source = join(paths.renderDir(dir, options.model), "images", `${sceneName(number)}.png`);
      await ffmpeg(["-i", source, "-vf", `scale=${LOOK_WIDTH}:-2`, "-q:v", "6", jpeg]);
    } else {
      const source = paths.clip(dir, options.model, number);
      const seconds = await mediaDuration(source);
      await ffmpeg(["-i", source, "-vf", `fps=${CLIP_FRAMES}/${seconds.toFixed(3)},scale=${FRAME_WIDTH}:-2,tile=${CLIP_FRAMES}x1`, "-frames:v", "1", "-q:v", "6", jpeg]);
    }
    pictures.push(Buffer.from(await Bun.file(jpeg).arrayBuffer()));
  }

  const briefs = numbers.map((number, position) => {
    const scene = story.scenes[number - 1]!;
    const place = story.places.find((candidate) => candidate.name === scene.place);
    const described = options.kind === "images" ? `Meant to show: ${scene.imagePrompt}` : `Meant to happen: ${scene.motionPrompt}`;
    return `Picture ${position + 1} = scene ${number}. Spoken during it: ${spoken(story, number)}. ${described}${place ? ` The place: ${place.look}` : ""}`;
  });

  const subject =
    options.kind === "images"
      ? "Each picture above is the still image of one scene."
      : `Each picture above is one scene's 5-second clip, as ${CLIP_FRAMES} frames side by side in time order (left is the start, right is the end).`;
  const faults =
    options.kind === "images"
      ? `- It shows a different thing or place from the one described (a window where the door should be, a courtyard where a dark room should be).
- A door, lock or object is in a different state from the description (open where it is shut).
- The person the scene is about is missing, or there are people who should not be there.
- The viewer could not tell from the picture what the spoken words are about.
- It shows something the story has not revealed yet.
- Written text, a logo, or a clearly malformed face, hand or object.`
      : `- Something appears that was not in the first frame: a person, a figure, an object, a room behind a door that opens.
- A door, lock or object changes state when the description says it stays as it is.
- The described action does not happen: the frames are almost the same while the words describe someone moving.
- The person or the place turns into a different one during the clip.
- Scribbles, streaks, flashes or melted shapes that are not part of the scene.`;

  const prompt = `You check the pictures of a vertical Egyptian horror video before its producer reviews them. ${subject}

${briefs.join("\n")}

For each scene, first write "seen": ${options.kind === "images" ? "what the picture actually shows (who, doing what, where, and the state of every door)" : "what is different between the first frame and the last frame (who or what moved, every door that opened or closed, anyone or anything that appeared)"}, in one sentence, from the picture alone. Then decide whether it can be used as it is. It fails only for a clear fault a viewer would notice:
${faults}
Differences of taste, small details and anything you are unsure about are NOT faults: mark those ok.

Return ONLY JSON: { "scenes": [{ "scene": <scene number>, "seen": "...", "ok": true | false, "problem": "when not ok: one plain English sentence of 20 words or fewer saying what is wrong, as seen" }] } with exactly these scenes: ${numbers.join(", ")}.`;

  const { data } = await writeJson(prompt, undefined, pictures);
  return replySchema
    .parse(data)
    .scenes.filter((item) => !item.ok && item.problem.trim() && numbers.includes(item.scene))
    .map((item) => ({ scene: item.scene, problem: item.problem.trim() }));
}
