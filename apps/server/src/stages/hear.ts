import { z } from "zod";
import { mediaDuration } from "../lib/ffmpeg";
import { paths } from "../lib/project";
import { writeJson } from "../lib/story-model";
import { NARRATOR, type Story } from "../schemas/story";
import type { SceneFlag } from "./check";

const replySchema = z.object({
  scenes: z.array(z.object({ scene: z.number().int(), heard: z.string().default(""), ok: z.boolean(), problem: z.string().default("") })),
});

// Listens to the chapter's whole recording next to its script and returns the scenes whose audio does not
// say what the script says, or says it badly. Like the picture check, it only reports.
export async function hearScenes(dir: string, story: Story): Promise<SceneFlag[]> {
  const spans: string[] = [];
  let cursor = 0;
  for (const [index, scene] of story.scenes.entries()) {
    const seconds = await mediaDuration(paths.voiceAudio(dir, index + 1));
    const lines = scene.lines.map((line) => `${line.speaker === NARRATOR ? "storyteller" : line.speaker}: ${line.text}`).join(" / ");
    spans.push(`Scene ${index + 1} (${cursor.toFixed(1)}s to ${(cursor + seconds).toFixed(1)}s): ${lines}`);
    cursor += seconds;
  }

  const prompt = `This audio is the recorded voice of one chapter of an Egyptian Arabic children's story, scene after scene. The script, with where each scene sits in the audio:
${spans.join("\n")}

For each scene, first write "heard": what is actually said in that stretch, transcribed in Arabic. Then decide whether it can be used as it is. It fails only for a clear fault a listener would notice:
- A word or line is missing, cut off, repeated, or different from the script in a way that changes it.
- Words from the next or previous scene are in this stretch (the cut is in the wrong place).
- Mumbled or garbled speech, a strange noise, or a long silence in the middle.
- The wrong voice: a line meant for a child sounds like the adult storyteller, or the other way round.
- Not Egyptian colloquial pronunciation (formal Arabic or a foreign accent).
Small differences in pace or tone are NOT faults: mark those ok.

Return ONLY JSON: { "scenes": [{ "scene": <number>, "heard": "...", "ok": true | false, "problem": "when not ok: one plain English sentence of 20 words or fewer" }] } with every scene from 1 to ${story.scenes.length}.`;

  const { data } = await writeJson(prompt, Buffer.from(await Bun.file(paths.narration(dir)).arrayBuffer()));
  return replySchema
    .parse(data)
    .scenes.filter((item) => !item.ok && item.problem.trim() && item.scene >= 1 && item.scene <= story.scenes.length)
    .map((item) => ({ scene: item.scene, problem: item.problem.trim() }));
}
