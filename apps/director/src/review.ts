import { z } from "zod";
import { config, MEDIA_DIR } from "./config";
import type { ReviewPacket, StepName } from "./services/veogen";

export const decisionSchema = z.object({
  approve: z.boolean(),
  // Why, in one or two plain sentences. When sending back, this is what the server redoes the step from.
  note: z.string().default(""),
  // The scenes to redo; the whole step when empty.
  scenes: z.array(z.number().int().positive()).default([]),
  // Rewritten picture or motion descriptions for scenes being redone (images and clips only).
  promptFixes: z
    .array(z.object({ scene: z.number().int().positive(), imagePrompt: z.string().optional(), motionPrompt: z.string().optional() }))
    .default([]),
});
export type Decision = z.infer<typeof decisionSchema>;

const AUDIENCE = `You are the director of an Egyptian YouTube channel of animated stories for children aged 4 to 8, in Egyptian colloquial Arabic, in a bright 3D family-film cartoon style, wide 16:9. Nothing is published without your approval, and no human checks after you, so you are the last line of defence for a made-for-kids channel. Approve only what you would be happy for a small child to watch; send back what is wrong, saying exactly what to fix.`;

const KIDS_RULES = `Never acceptable: anything frightening or upsetting (menacing faces, monsters, darkness, injury, anger, crying in fear), violence, weapons, a child doing something unsafe a viewer could copy (fire, heights, medicine, water or boats without an adult or a life jacket, going with strangers), mocking how someone looks, romance, brands or logos, real people, or written text in a picture.`;

const STEP_GUIDE: Record<Exclude<StepName, "publish">, string> = {
  story: `You are reviewing the SCRIPT of one chapter. Read every line. Check:
- The Egyptian colloquial Arabic is natural, correct and simple enough for a 5-year-old (wrong or invented words, formal Arabic, a word that means something else).
- The chapter follows its plan, continues the earlier chapters, and makes sense on its own: no character who is not in the story, no event out of order.
- The lesson is shown, not preached, and the chapter is warm and fun.
- Each scene's picture description (imagePrompt) shows only the characters listed for it ("shows"); a character mentioned in the description but not listed gets invented by the image model.
- The cast is fixed for the whole story and the writer cannot add to it. Someone outside the cast (a fisherman, a shopkeeper) may be spoken about, or heard from off screen through the storyteller, but must not be shown: ask for those scenes to show the cast, the place or the object instead.
- The server's proofreader findings ("flags"): decide which are real.
Send back with a note the writer can follow (it rewrites the chapter from your note); list the scenes concerned. If only a few picture or motion descriptions are wrong, you may instead approve and give promptFixes for those scenes: they are saved before the pictures are made.`,
  voice: `You are reviewing the RECORDED VOICE of one chapter. You cannot listen; the server transcribed each scene and compared it with the script ("flags"), and gives each scene's length in seconds. Check:
- Every flag: a missing, garbled or wrong line, the cut in the wrong place, the wrong voice, or formal instead of Egyptian pronunciation, is a real fault.
- Lengths: a scene much longer than its words need (more than about 1.2 seconds per word) or shorter than about 0.25 seconds per word means a bad cut.
Send back only for clear faults; the whole chapter is recorded again, which costs part of the day's small allowance, so do not send back for small things.`,
  images: `You are reviewing the STILL PICTURES of one chapter, one per scene. Open the sheet of all pictures first to judge consistency, then open EVERY scene's picture. For each, check against its description:
- The right characters, and ONLY them: count the people and animals. A duplicate of a character, an extra child or adult, or a missing character is a fault.
- Each character looks the same as in the other scenes and as described (clothes, hair, colours, the life jacket on the child near water; an animal does not wear a person's clothes).
- The place and objects are as described; the moment matches the spoken lines.
- Bright, friendly 3D cartoon style, nothing frightening, no text or logos, no malformed faces, hands, paws or beaks.
For each scene you send back, give a promptFix: the scene's imagePrompt rewritten so the image model cannot get it wrong again (say exactly who is in the picture and that nobody else is, what each wears, who is out of frame). Keep the rest of the description.`,
  clips: `You are reviewing the MOTION CLIPS of one chapter. For each scene you get one image with four frames of its 5-second clip side by side, left to right in time order. Open every one. Check:
- Nothing appears that was not in the first frame (a new person or animal, a duplicated character), and nobody turns into someone else.
- Faces, hands, paws and beaks stay well formed through the clip, and whoever speaks moves their mouth (there is no lip sync).
- No flicker, streaks, melting or scribbles; the motion matches the scene's motion description and is gentle.
For each scene you send back, give a promptFix with a corrected motionPrompt when the description caused it.
Scenes with nobody in them have no clip: the video moves slowly over their still picture instead, so do not ask for one.`,
  video: `You are reviewing the FINISHED VIDEO of one chapter: a sheet of frames taken every few seconds, plus its loudness. Check:
- The captions are readable, inside the frame, not covering faces, and in Arabic.
- The title and opening line show at the start; the scenes run in order with no black or frozen stretches.
- Loudness is between about -18 and -14 LUFS.
Send back only for clear faults (the video is rebuilt from the same pictures and voice).`,
};

function buildPrompt(packet: ReviewPacket): string {
  const step = packet.step as Exclude<StepName, "publish">;
  return `${AUDIENCE}

${KIDS_RULES}

The pictures and clips are made on a small weekly GPU allowance that only just covers one story, so every redo of a picture (about 4 minutes of GPU) or a clip (about 14 minutes) is paid for by the rest of the story. Send a scene back only for a fault a child or a parent would actually notice in a moving video: a wrong, missing, duplicated or invented character, a character who looks different from the rest of the story, a broken face or hand, something unsafe or frightening, or a picture that does not show what is being said. Do NOT send back for small background details: tiny distant figures on another boat, a blur at the edge of the frame, a slightly different shade, an object a little out of place.

Story: "${packet.story.title}" (${packet.story.type || "story"}; lesson: ${packet.story.lesson || "-"}). This is chapter ${packet.chapter} of ${packet.chapters}.
Chapter plan: ${packet.story.chapterPlan || "-"}
${packet.names.length ? `Recurring objects and places, with the Arabic words the story uses for them: ${packet.names.join("; ")}\n` : ""}${packet.earlierChapters.map((earlier) => `Chapter ${earlier.chapter} (already made): ${earlier.lines.join(" / ")}`).join("\n")}
${packet.attempt > 0 ? `This step has been sent back ${packet.attempt} time(s) already; the last reason was: ${packet.lastNote ?? "-"}. Be precise about what is still wrong, and approve if the faults are fixed.\n` : ""}
${STEP_GUIDE[step]}

Files for the whole chapter (open them with the Read tool): ${packet.files.length ? packet.files.join(", ") : "none"}

The server's own findings: ${packet.flags.length ? packet.flags.map((flag) => `scene ${flag.scene}: ${flag.problem}`).join("; ") : "none"}
${packet.loudness === null ? "" : `Loudness: ${packet.loudness} LUFS\n`}
Scenes:
${packet.scenes
  .map(
    (scene) => `Scene ${scene.scene}
  Lines: ${scene.lines.join(" / ")}
  Shows: ${scene.shows.join("; ") || "nobody (a place or object only)"}
  Place: ${scene.place || "-"}
  imagePrompt: ${scene.imagePrompt}
  motionPrompt: ${scene.motionPrompt}${scene.audioSeconds === null ? "" : `\n  Voice length: ${scene.audioSeconds.toFixed(1)}s`}${scene.files.length ? `\n  Files: ${scene.files.join(", ")}` : ""}`,
  )
  .join("\n")}

When you have looked at everything, end your reply with ONLY this JSON object and nothing after it:
{"approve": true | false, "note": "why, in plain English; when sending back, exactly what to fix, at most 3000 characters", "scenes": [scene numbers to redo, empty for the whole step], "promptFixes": [{"scene": n, "imagePrompt": "...", "motionPrompt": "..."}]}`;
}

const cliReplySchema = z.object({ result: z.string(), is_error: z.boolean().optional() });

// The last JSON object in the reviewer's reply.
function lastJson(text: string): unknown {
  for (let end = text.lastIndexOf("}"); end > 0; end = text.lastIndexOf("}", end - 1)) {
    for (let start = text.lastIndexOf("{", end); start >= 0; start = text.lastIndexOf("{", start - 1)) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // Not a whole object yet: widen to the previous opening brace.
      }
    }
  }
  throw new Error("The reviewer's reply has no decision in it");
}

// Asks Claude, through the Claude Code CLI, to review one step. It may only read files.
export async function review(packet: ReviewPacket): Promise<Decision> {
  const process = Bun.spawn(
    [
      config.CLAUDE_BIN,
      "-p",
      "--output-format", "json",
      "--model", config.CLAUDE_MODEL,
      "--allowedTools", "Read",
      "--add-dir", MEDIA_DIR,
      "--max-turns", "60",
    ],
    { cwd: MEDIA_DIR, stdin: new Blob([buildPrompt(packet)]), stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (code !== 0) throw new Error(`claude exited with ${code}: ${(stderr || stdout).slice(0, 500)}`);
  const reply = cliReplySchema.parse(JSON.parse(stdout));
  if (reply.is_error) throw new Error(`claude: ${reply.result.slice(0, 500)}`);
  return decisionSchema.parse(lastJson(reply.result));
}
