import { z } from "zod";
import { writeJson } from "../lib/story-model";
import { config } from "../config";
import { castMemberSchema, placeSchema, sceneSchema, storySchema, type CastMember, type Place, type Story } from "../schemas/story";
import { dialogueRules, OPENING_RULES, placeRules, proofreadStory, SCENE_RULES, storyProblem } from "./script";
import { assignSfx } from "./sfx";

const MAX_ATTEMPTS = 3;

export const seriesBibleSchema = z.object({
  title: z.string().min(1),
  // The whole story in a few sentences, including how it ends. Never shown to viewers.
  premise: z.string().min(1),
  characterSheet: z.string().min(1),
  styleSheet: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  // Characters who speak besides the narrator; each keeps one voice for the whole series.
  cast: z.array(castMemberSchema).max(2).default([]),
  // The places the series happens in; each keeps one look for the whole series.
  places: z.array(placeSchema).max(5).default([]),
  parts: z
    .array(
      z.object({
        number: z.number().int(),
        // What happens in this part.
        summary: z.string().min(1),
        // The unanswered question this part ends on.
        cliffhanger: z.string().min(1),
      }),
    )
    .min(2)
    .max(12),
});

export type SeriesBible = z.infer<typeof seriesBibleSchema>;

// One voice per kind of character; the narrator's own voice is never reused for someone else.
const VOICES: Record<CastMember["gender"], Record<CastMember["age"], string[]>> = {
  male: { young: ["Puck", "Achird"], adult: ["Orus", "Iapetus"], old: ["Algieba", "Rasalgethi"] },
  female: { young: ["Leda", "Kore"], adult: ["Aoede", "Despina"], old: ["Gacrux", "Vindemiatrix"] },
};

export function assignVoices(cast: CastMember[]): CastMember[] {
  const taken = new Set([config.GEMINI_VOICE, ...cast.map((member) => member.voice).filter(Boolean)]);
  return cast.map((member) => {
    if (member.voice) return member;
    const voice = VOICES[member.gender][member.age].find((candidate) => !taken.has(candidate)) ?? VOICES[member.gender][member.age][0];
    taken.add(voice as string);
    return { ...member, voice: voice as string };
  });
}

const CAST_SHAPE = `"cast": [{ "name": "one Latin word used as the speaker label, e.g. UmmHassan", "nameArabic": "the name in Arabic", "gender": "male" | "female", "age": "young" | "adult" | "old", "role": "ENGLISH, who they are and how they speak", "look": "ENGLISH, one precise sentence fixing their appearance so they are the same person in every image: age, build, hair (colour and cut), beard or not, skin, and the exact clothes with their colour" }]`;

const PLACES_SHAPE = `"places": [{ "name": "one Latin word used to point a scene at the place, e.g. Corridor", "look": "ENGLISH, three or four precise sentences fixing what never changes about the place, so it is the same in every image: its size and shape, the walls (colour, condition), the floor, every door (material, colour, where it is, its lock, peephole and handle), the furniture, and the light (source and colour). Nothing that changes during the story: whether a door is open or shut, who is there and what lies on the floor are left to each scene" }]`;

// Fixes the look of the places of a series that was planned without any, in step with what was already published.
export async function writePlaces(bible: SeriesBible, published: PreviousPart[], stills: Buffer[] = []): Promise<Place[]> {
  const prompt = `This is the plan of a serialized Egyptian horror story told as short videos. Its images are made one by one from text, so every place needs ONE fixed description or it looks different in every image.

Title: ${bible.title}
Story: ${bible.premise}
Parts: ${bible.parts.map((part) => `${part.number}. ${part.summary}`).join(" ")}
${published.length ? `Already published narration (the places must fit it):\n${published.map((part) => `Part ${part.number}: ${part.narration}`).join("\n")}` : ""}

${stills.length ? "The pictures above are stills from the published parts. Viewers have already seen these places: describe them as they look in the pictures (wall colour, floor, doors, light), choosing the most common look where the pictures differ.\n" : ""}
List the two to five places this story happens in. A door that matters to the story (one that is locked, one something stands behind) is described inside the place it is seen from, in full: its material, colour, lock, peephole and handle.

Return ONLY JSON: { ${PLACES_SHAPE} }`;
  return writeValidated(prompt, (data) => {
    const parsed = z.object({ places: z.array(placeSchema).min(1).max(5) }).safeParse(data);
    return parsed.success ? parsed.data.places : parsed.error.message;
  }, stills.length ? stills : undefined);
}

// Proposes speaking characters for a series that was planned without any.
export async function writeCast(bible: SeriesBible): Promise<CastMember[]> {
  const prompt = `This is the plan of a serialized Egyptian horror story told as short videos. The main character narrates it.

Title: ${bible.title}
Story: ${bible.premise}
Parts: ${bible.parts.map((part) => `${part.number}. ${part.summary}`).join(" ")}

Choose the one or two other characters whose VOICE would make this story more alive and frightening when heard (a neighbour, a doorman, a voice from behind the door…). They must fit the story as planned and be able to appear in several parts.

Return ONLY JSON: { ${CAST_SHAPE} } with one or two members.`;
  return writeValidated(prompt, (data) => {
    const parsed = z.object({ cast: z.array(castMemberSchema).min(1).max(2) }).safeParse(data);
    return parsed.success ? assignVoices(parsed.data.cast) : parsed.error.message;
  });
}

export type PreviousPart = {
  number: number;
  // The narration of that part, joined into one text.
  narration: string;
};

async function writeValidated<T>(prompt: string, validate: (data: unknown) => T | string, images?: Buffer[]): Promise<T> {
  let problem = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // A failed attempt's problem is told to the writer, so the next try fixes it.
    const { data } = await writeJson(problem ? `${prompt}\n\nYour previous answer was rejected: ${problem}. Fix that.` : prompt, undefined, images);
    const result = validate(data);
    if (typeof result !== "string") return result;
    problem = result;
  }
  throw new Error(`The story writer did not return a usable result after ${MAX_ATTEMPTS} attempts: ${problem}`);
}

export async function writeSeriesBible(options: { idea?: string; parts: number }): Promise<SeriesBible> {
  const prompt = `You are the head writer of a serialized Egyptian horror story told as short vertical videos, one part per day.

Plan a new series of exactly ${options.parts} parts.${options.idea ? `\nThe producer's idea for it: ${options.idea}` : "\nInvent an original idea rooted in Egyptian everyday life (an old flat, a village, a night shift, a family secret…)."}

What makes it work:
- ONE continuous story with one main character, a mystery that deepens in every part, and a real ending in the last part.
- Every part except the last ends on a cliffhanger that makes the viewer need the next part.
- Besides the main character (who narrates), one or two other characters speak in their own voice in some scenes: choose who (a neighbour, a doorman, a relative, a voice from behind a door…).
- Psychological, eerie horror: no gore, no harm to children, no real people, places or brands.

Return ONLY JSON:
{
  "title": "series title in Egyptian colloquial Arabic, under 50 characters",
  "premise": "the whole story in 4-6 sentences in English, including the ending",
  "characterSheet": "ENGLISH, one precise sentence fixing the main character's look (age, build, hair colour and cut, beard or not, clothes with their colour), reused for every image they are in",
  "styleSheet": "ENGLISH, one sentence fixing the look of every image: cinematic horror film still, photorealistic, lens, colour palette, lighting, film grain, vertical composition",
  "hashtags": ["#رعب", "..."],
  ${CAST_SHAPE},
  ${PLACES_SHAPE},
  "parts": [{ "number": 1, "summary": "English, what happens in this part", "cliffhanger": "English, the question it ends on" }]
}
with exactly ${options.parts} parts, one or two cast members and two to five places.`;

  return writeValidated(prompt, (data) => {
    const parsed = seriesBibleSchema.safeParse(data);
    if (!parsed.success) return parsed.error.message;
    if (parsed.data.parts.length !== options.parts) return `${parsed.data.parts.length} parts instead of ${options.parts}`;
    return { ...parsed.data, cast: assignVoices(parsed.data.cast) };
  });
}

const partReplySchema = z.object({
  description: z.string().default(""),
  hook: z.string().default(""),
  scenes: z.array(sceneSchema).min(1),
});

export type WritePartOptions = {
  bible: SeriesBible;
  partNumber: number;
  scenes: number;
  previous: PreviousPart[];
  seed: number;
  // When rewriting: the current version and what the producer wants changed.
  current?: Story;
  note?: string;
};

export async function writeSeriesPart(options: WritePartOptions): Promise<Story> {
  const { bible, partNumber } = options;
  const plan = bible.parts.find((part) => part.number === partNumber);
  if (!plan) throw new Error(`The series has no part ${partNumber}`);
  const isLast = partNumber === bible.parts.length;
  const previous = options.previous.length
    ? options.previous.map((part) => `Part ${part.number} narration:\n${part.narration}`).join("\n\n")
    : "(this is the first part)";

  const prompt = `You write one part of a serialized Egyptian horror story told as short vertical videos.

Series: ${bible.title}
Whole story (secret, for your planning): ${bible.premise}
Main character look: ${bible.characterSheet}

Already published:
${previous}

Now write part ${partNumber} of ${bible.parts.length}.
What happens in this part: ${plan.summary}
${isLast ? "This is the FINAL part: resolve the mystery and end on a chilling last line." : `It must end on this cliffhanger: ${plan.cliffhanger}`}

Structure: exactly ${options.scenes} scenes, each one still image animated for 5 seconds with one or two spoken lines.
- ${partNumber === 1 ? "Open on the first frightening thing that happens, not on how the main character got there." : "Pick the story up where the last part stopped, but open on what is frightening NOW, shown so that it works without having seen that part. Do not retell it."}
- Do not contradict the previous narration and do not repeat its lines.
- ${isLast ? "The last scene closes the story." : "The last scene is the cliffhanger: stop at the most tense moment."}

${OPENING_RULES}

${SCENE_RULES}
${dialogueRules(bible.cast)}
${placeRules(bible.places)}
${options.current && options.note ? `\nThe producer rejected the previous version with this note. Follow it fully, even where that means writing every scene anew: ${options.note}\nThe rejected version, for reference only (do not copy its lines unless they already fit the note and the rules above):\n${JSON.stringify(options.current.scenes.map((scene) => scene.lines))}\n` : ""}
Return ONLY JSON:
{
  "description": "one or two Arabic sentences (Egyptian colloquial) for this part's video description, no spoilers",
  "hook": "the on-screen headline for scene 1",
  "scenes": [{ "lines": [{ "speaker": "Narrator", "text": "..." }], "place": "...", "imagePrompt": "...", "shows": ["Hero"], "motionPrompt": "..." }]
}
with exactly ${options.scenes} scenes.`;

  const story = await writeValidated(prompt, (data) => {
    const parsed = partReplySchema.safeParse(data);
    if (!parsed.success) return parsed.error.message;
    const story = storySchema.parse({
      title: `${bible.title} | الجزء ${partNumber}`,
      description: parsed.data.description,
      hook: parsed.data.hook,
      hashtags: bible.hashtags,
      characterSheet: bible.characterSheet,
      styleSheet: bible.styleSheet,
      // The same seed in every part keeps the look of the series consistent.
      seed: options.seed,
      cast: bible.cast,
      places: bible.places,
      scenes: parsed.data.scenes,
    });
    return storyProblem(story, options.scenes) ?? story;
  });
  return assignSfx(await proofreadStory(story));
}
