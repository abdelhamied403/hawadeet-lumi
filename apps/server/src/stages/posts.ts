import { z } from "zod";
import { writeJson } from "../lib/story-model";
import type { PostAngle } from "../server/store";

const MAX_ATTEMPTS = 3;
export const POST_TEXT_MAX = 2000;
// Added under a post that carries one of the generated pictures.
export const AI_NOTE = "الصورة مصنوعة بالذكاء الاصطناعي.";

export type PostStill = {
  // Path of the picture under the output folder.
  path: string;
  part: number;
  // What the narrator says over that picture.
  narration: string;
};

export type WritePostPayload = {
  angle: PostAngle;
  // The Page's name; empty until the owner chooses one.
  brandName: string;
  // Title of the series running on the Page; absent before the first one.
  seriesTitle?: string;
  hashtags: string[];
  // Parts the followers have already watched, oldest first. Nothing unpublished is ever passed in,
  // so a post cannot give away what happens next.
  watched: { number: number; narration: string }[];
  // True when a next part exists or is being made.
  moreComing: boolean;
  stills: PostStill[];
  // Recent posts, so the new one does not repeat them.
  recent: string[];
  // The owner's own idea for the post, or what to change in `current`.
  note?: string;
  // The draft being rewritten; its picture is kept, so no stills are offered.
  current?: string;
};

export type WrittenPost = { text: string; imagePath: string | null };

const ANGLES: Record<PostAngle, string> = {
  question:
    "Give the parents ONE simple question to ask their child about the story so far (what would you do in the hero's place? what do you think happens next?), and invite them to share the child's answer in the comments.",
  teaser:
    "Build excitement for the next chapter. You do not know what happens next, so do not invent events: point at what was left open at the end of the last chapter and tell them it is coming.",
  moment:
    "Bring back the sweetest or funniest moment the followers have already seen, in one or two lines, then ask which moment their child loved most.",
  parents:
    "Do not mention the story. Share one short, warm, practical idea for parents of children aged 4 to 8 (a bedtime ritual, a way to teach sharing, a game for a car trip), then ask them to share their own.",
};

const resultSchema = z.object({ text: z.string().trim().min(20).max(900), still: z.number().int().nullable().default(null) });

// Writes one short Page post in Egyptian Arabic and, when it fits, picks the picture that goes with it.
export async function writePagePost(payload: WritePostPayload): Promise<WrittenPost> {
  const hasStory = payload.watched.length > 0;
  // Without a published chapter there is nothing to ask about or look back on.
  const angle: PostAngle = hasStory || payload.angle === "parents" ? payload.angle : "parents";
  const stills = angle === "parents" || payload.current ? [] : payload.stills;

  const prompt = `You run the Facebook Page${payload.brandName ? ` "${payload.brandName}"` : ""}, which publishes Egyptian animated stories for children aged 4 to 8 as short videos, one chapter a day. Its followers are their parents. Write ONE post for the Page to keep the followers active between videos.

${payload.seriesTitle ? `The story running now: ${payload.seriesTitle}` : "No story has started yet."}
${
  hasStory
    ? `What the followers have watched so far:\n${payload.watched.map((part) => `Chapter ${part.number}: ${part.narration}`).join("\n")}`
    : ""
}
${payload.moreComing ? "A next chapter is on its way." : ""}

The post's job: ${ANGLES[angle]}
${payload.note ? `\nThe Page owner asked for this: ${payload.note}` : ""}
${payload.current ? `\nRewrite this draft accordingly, keeping what already works:\n${payload.current.replace(AI_NOTE, "").trim()}` : ""}

Rules:
- Egyptian Arabic (Masri) exactly as people write it on Facebook in Cairo. No Modern Standard Arabic, no English.
- Warm and friendly, as one parent to another. Nothing scary, and nothing a parent would not want a child to read.
- Two to four short lines. The first line must make someone stop scrolling.
- End with something that invites a comment.
- Never reveal or guess anything beyond what the followers have watched.
- No "follow the page", no "like and share", no emojis except at most one.
- Finish with at most two of these hashtags on their own line: ${payload.hashtags.slice(0, 4).join(" ") || "#حواديت #قصص_اطفال"}
${
  payload.recent.length > 0
    ? `- It must not resemble any of these recent posts:\n${payload.recent.map((text) => `  • ${text.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")}`
    : ""
}
${
  stills.length > 0
    ? `\nPictures you may attach (each is the image shown while the narrator said the line):\n${stills
        .map((still, index) => `${index + 1}. Chapter ${still.part}: ${still.narration}`)
        .join("\n")}\nSet "still" to the number of the picture that fits the post best, or null when none fits.`
    : `\nSet "still" to null.`
}

Return ONLY JSON: { "text": "the post", "still": number | null }`;

  let problem = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data } = await writeJson(problem ? `${prompt}\n\nYour previous answer was rejected: ${problem}. Fix that.` : prompt);
    const parsed = resultSchema.safeParse(data);
    if (!parsed.success) {
      problem = parsed.error.message;
      continue;
    }
    const { text, still } = parsed.data;
    if (!/[؀-ۿ]/.test(text)) {
      problem = "the post is not in Arabic";
      continue;
    }
    const picked = still === null ? null : (stills[still - 1] ?? null);
    if (still !== null && !picked) {
      problem = `"still" must be null or a number from 1 to ${stills.length}`;
      continue;
    }
    return { text: text.replace(AI_NOTE, "").trim(), imagePath: picked?.path ?? null };
  }
  throw new Error(`The post could not be written: ${problem}`);
}
