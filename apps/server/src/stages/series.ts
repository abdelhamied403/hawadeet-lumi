import { z } from "zod";
import { textModels, writeJson } from "../lib/story-model";
import { config } from "../config";
import { castMemberSchema, placeSchema, propSchema, sceneSchema, storySchema, type CastMember, type Place, type Prop, type Story } from "../schemas/story";
import { dialogueRules, KIDS_SAFETY, OPENING_RULES, placeRules, proofreadStory, SCENE_RULES, STYLE_SHEET_RULE, storyProblem, type LineFlag } from "./script";
import { assignSfx } from "./sfx";

// The rules are many, so a reply often breaks one; each rejection is told to the writer and it tries again.
const MAX_ATTEMPTS = 5;

// The kinds of story the channel tells; each week's story is one of them, rotated so they do not repeat.
export const STORY_TYPES = {
  values: "a values story: the child learns kindness, honesty, sharing, patience or courage by living it",
  adventure: "an adventure with animals: a small quest with a talking-animal friend, full of fun and friendship",
  bedtime: "a bedtime story: calm and dreamy, with a soft, sleepy, cosy ending",
  learning: "a learning story: the child discovers a fact about nature, numbers, letters, the body or a good habit through what happens",
} as const;
export type StoryType = keyof typeof STORY_TYPES;
const storyTypeNames = Object.keys(STORY_TYPES) as [StoryType, ...StoryType[]];

export const seriesBibleSchema = z.object({
  title: z.string().min(1),
  // The whole story in a few sentences, including how it ends. Never shown to viewers.
  premise: z.string().min(1),
  // Older (horror) series have none.
  storyType: z.enum(storyTypeNames).optional(),
  // What the child watching takes away, shown through the story and never preached. Empty for older series.
  lesson: z.string().default(""),
  // The main character is a child with a voice of their own; older series spoke in the narrator's voice.
  heroGender: z.enum(["male", "female"]).optional(),
  heroVoice: z.string().default(""),
  characterSheet: z.string().min(1),
  styleSheet: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  // Characters who speak besides the narrator; each keeps one voice for the whole series.
  cast: z.array(castMemberSchema).max(2).default([]),
  // The places the series happens in; each keeps one look for the whole series.
  places: z.array(placeSchema).max(5).default([]),
  // Objects handled or looked at in more than one scene; each keeps one look for the whole series.
  props: z.array(propSchema).max(8).default([]),
  parts: z
    .array(
      z.object({
        number: z.number().int(),
        // What happens in this part.
        summary: z.string().min(1),
        // What this chapter ends on: a light "what happens next?" or, for the last chapter, the happy ending.
        // Named for the horror series it started with; kept so stored series still load.
        cliffhanger: z.string().min(1),
      }),
    )
    .min(2)
    .max(12),
});

export type SeriesBible = z.infer<typeof seriesBibleSchema>;

// One voice per kind of character; the narrator's own voice is never reused for someone else.
const VOICES: Record<CastMember["gender"], Record<CastMember["age"], string[]>> = {
  male: { child: ["Puck", "Zephyr"], young: ["Achird", "Fenrir"], adult: ["Orus", "Iapetus"], old: ["Algieba", "Rasalgethi"] },
  female: { child: ["Leda", "Laomedeia"], young: ["Kore", "Autonoe"], adult: ["Aoede", "Despina"], old: ["Gacrux", "Vindemiatrix"] },
};

// The main character's child voice, chosen before the cast so nobody else gets it.
export function heroVoiceFor(gender: CastMember["gender"]): string {
  return VOICES[gender].child.find((candidate) => candidate !== config.GEMINI_VOICE) as string;
}

export function assignVoices(cast: CastMember[], heroVoice = ""): CastMember[] {
  const taken = new Set([config.GEMINI_VOICE, heroVoice, ...cast.map((member) => member.voice).filter(Boolean)].filter(Boolean));
  return cast.map((member) => {
    if (member.voice) return member;
    const voice = VOICES[member.gender][member.age].find((candidate) => !taken.has(candidate)) ?? VOICES[member.gender][member.age][0];
    taken.add(voice as string);
    return { ...member, voice: voice as string };
  });
}

const CAST_SHAPE = `"cast": [{ "name": "one Latin word used as the speaker label, e.g. Teta or Bisbis", "nameArabic": "the name in Arabic", "gender": "male" | "female", "age": "child" | "young" | "adult" | "old", "role": "ENGLISH, who they are (a person or a talking animal) and how they speak", "look": "ENGLISH, one precise sentence fixing their appearance so they are the same character in every image: for a person their age, build, hair (colour and cut), skin and the exact clothes with their colour; for an animal its kind, size, fur or feather colours and markings, and anything it wears" }]`;

const PLACES_SHAPE = `"places": [{ "name": "one Latin word used to point a scene at the place, e.g. Garden", "nameArabic": "the everyday Egyptian word a character would say for it, e.g. الجنينة", "look": "ENGLISH, three or four precise sentences fixing what never changes about the place, so it is the same in every image: its size and shape, the walls or landscape (colours), the floor or ground, the furniture, trees or other fixed things, and the light (source and colour). Nothing that changes during the story: who is there and what lies around are left to each scene" }]`;

const PROPS_SHAPE = `"props": [{ "name": "one Latin word used to point a scene at the object, e.g. Kite", "nameArabic": "the everyday Egyptian word a character would say for it, e.g. الطيارة الورق", "look": "ENGLISH, one or two precise sentences fixing the object so it is the same in every image: what it is, its size, material, colours and any mark that makes it recognisable" }]`;

// Fixes the look of the places and recurring objects of a series that was planned without any, in step with what was already published.
export async function writePlaces(bible: SeriesBible, published: PreviousPart[], stills: Buffer[] = []): Promise<{ places: Place[]; props: Prop[] }> {
  const prompt = `This is the plan of an Egyptian children's story told in chapters as short animated videos. Its images are made one by one from text, so every place needs ONE fixed description or it looks different in every image.

Title: ${bible.title}
Story: ${bible.premise}
Parts: ${bible.parts.map((part) => `${part.number}. ${part.summary}`).join(" ")}
${published.length ? `Already published narration (the places must fit it):\n${published.map((part) => `Part ${part.number}: ${part.narration}`).join("\n")}` : ""}

${stills.length ? "The pictures above are stills from the published parts. Viewers have already seen these places: describe them as they look in the pictures (wall colour, floor, doors, light), choosing the most common look where the pictures differ.\n" : ""}
List the two to five places this story happens in.
Then list the objects, up to eight, that a character handles or looks at in more than one scene of the story (a kite, a ball, a lantern, a basket, a book): the things a viewer would notice changing. Parts of a place, such as its doors and furniture, belong to the place and are not listed again.

Return ONLY JSON: { ${PLACES_SHAPE}, ${PROPS_SHAPE} }`;
  return writeValidated(prompt, (data) => {
    const parsed = z.object({ places: z.array(placeSchema).min(1).max(5), props: z.array(propSchema).max(8).default([]) }).safeParse(data);
    if (!parsed.success) return parsed.error.message;
    const unnamed = [...parsed.data.places, ...parsed.data.props].find((thing) => !hasArabic(thing.nameArabic));
    return unnamed ? `"${unnamed.name}" has no "nameArabic" in Egyptian Arabic letters` : parsed.data;
  }, stills.length ? stills : undefined);
}

const hasArabic = (text: string) => /[\u0621-\u064A]/.test(text) && !/[A-Za-z]/.test(text);

// Gives the places and objects of a series planned before they had Arabic names the word the lines should use.
export async function writeArabicNames(bible: SeriesBible): Promise<SeriesBible> {
  const things = [...bible.places, ...bible.props];
  const prompt = `This is the plan of an Egyptian children's story told in Egyptian colloquial Arabic.

Story: ${bible.premise}

Its places and objects have English labels. For each one, give the everyday Egyptian word a character would say when talking about it (for a balcony: "البلكونة"; for a garden: "الجنينة"). Real Egyptian words only, never the English label written in Arabic letters.

${things.map((thing) => `- ${thing.name}: ${thing.look}`).join("\n")}

Return ONLY JSON: { "names": { ${things.map((thing) => `"${thing.name}": "..."`).join(", ")} } }`;
  const names = await writeValidated(prompt, (data) => {
    const parsed = z.object({ names: z.record(z.string(), z.string()) }).safeParse(data);
    if (!parsed.success) return parsed.error.message;
    const missing = things.find((thing) => !hasArabic(parsed.data.names[thing.name] ?? ""));
    return missing ? `no Arabic word for "${missing.name}"` : parsed.data.names;
  });
  const named = <T extends Place | Prop>(thing: T): T => ({ ...thing, nameArabic: thing.nameArabic || names[thing.name]!.trim() });
  return { ...bible, places: bible.places.map(named), props: bible.props.map(named) };
}

// Proposes speaking characters for a series that was planned without any.
export async function writeCast(bible: SeriesBible): Promise<CastMember[]> {
  const prompt = `This is the plan of an Egyptian children's story told in chapters as short animated videos. A storyteller narrates it and the main character is a child.

Title: ${bible.title}
Story: ${bible.premise}
Parts: ${bible.parts.map((part) => `${part.number}. ${part.summary}`).join(" ")}

Choose the one or two other characters whose VOICE would make this story more alive and fun to listen to (a grandmother, a talking cat, a friendly teacher, a little brother…). They must fit the story as planned, be kind, and be able to appear in several chapters.

Return ONLY JSON: { ${CAST_SHAPE} } with one or two members.`;
  return writeValidated(prompt, (data) => {
    const parsed = z.object({ cast: z.array(castMemberSchema).min(1).max(2) }).safeParse(data);
    return parsed.success ? assignVoices(parsed.data.cast, bible.heroVoice) : parsed.error.message;
  });
}

export type PreviousPart = {
  number: number;
  // The narration of that part, joined into one text.
  narration: string;
};

async function writeValidated<T>(prompt: string, validate: (data: unknown) => T | string, images?: Buffer[]): Promise<T> {
  let problem = "";
  let writer = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // A failed attempt's problem is told to the writer, so the next try fixes it.
    const { data, model } = await writeJson(problem ? `${prompt}\n\nYour previous answer was rejected: ${problem}. Fix that.` : prompt, undefined, images);
    writer = model;
    const result = validate(data);
    if (typeof result !== "string") return result;
    problem = result;
    console.warn(`writer attempt ${attempt} rejected: ${problem.slice(0, 200)}`);
  }
  // The lightest model only writes when the stronger ones are over their free daily limit, and it rarely meets every rule.
  const models = textModels();
  const fallback = models.length > 1 && writer === models.at(-1);
  throw new Error(
    fallback
      ? `The stronger writing models have used up today's free requests, and the fallback (${writer}) could not meet the rules: ${problem}. Their limit resets at 10:00 Cairo time; retry after that.`
      : `The story writer did not return a usable result after ${MAX_ATTEMPTS} attempts: ${problem}`,
  );
}

// Starting points for a story planned without the producer's idea, one picked at random,
// because a writer left to choose keeps returning to the same few settings.
const SETTINGS = [
  "a farm in a Delta village: the buffalo, the ducks in the canal, the date palms, grandpa's donkey cart",
  "a felucca trip on the Nile with the family, the fishermen and the birds on the river",
  "grandma's balcony in an old Cairo building: her plants, the pigeons on the roof, the neighbours' kids",
  "the school: the classroom, the playground, the school trip to the zoo or the museum",
  "a desert oasis: a friendly camel, the palm trees, the spring, a night full of stars",
  "Ramadan or the Eid in the neighbourhood: the lanterns, the kahk, the swings, the market",
  "the sea at Alexandria or on the Red Sea in summer: the sand, the waves, the shells, the fish",
  "a garden at night with fireflies, an owl and the moon, just before bedtime",
  "a small shop in the neighbourhood: the baker, the greengrocer, the toy seller, the old bookshop",
  "an Upper Egyptian village near the temples: the river, the sugar cane, the colourful houses",
];

export async function writeSeriesBible(options: { idea?: string; parts: number; earlier?: SeriesBible[] }): Promise<SeriesBible> {
  const earlier = options.earlier ?? [];
  const setting = SETTINGS[Math.floor(Math.random() * SETTINGS.length)];
  // The kind of story told longest ago (earlier is newest first), so the weeks take turns.
  const lastTold = (type: StoryType) => {
    const index = earlier.findIndex((bible) => bible.storyType === type);
    return index < 0 ? Infinity : index;
  };
  const storyType = storyTypeNames.reduce((best, type) => (lastTold(type) > lastTold(best) ? type : best));
  const prompt = `You are the head writer of an Egyptian children's channel for ages 4 to 8. Each week it tells ONE complete story as a wide 16:9 animated film in chapters, which are joined into one long video, and each chapter is also shown as a Short.

Plan a new story of exactly ${options.parts} chapters.${options.idea ? `\nThe producer's idea for it: ${options.idea}` : `\nInvent an original idea rooted in Egyptian everyday life, set in ${setting}.`}
It is ${STORY_TYPES[storyType]}.
${earlier.length ? `
The channel has already told these stories:
${earlier.map((bible) => `- ${bible.title}: ${bible.premise}`).join("\n")}
The new story must feel different to a child who watched those: a different setting, a different main character, different side characters and a different lesson.
` : ""}
What makes it work:
- ONE continuous story with one main character, a child of 6 to 8, and a simple problem that grows a little in every chapter and is happily solved in the last.
- Each chapter is a small story of its own that a child enjoys without the others, and ends on a light, curious "what happens next?". The last chapter ends warmly, with the lesson shown through what the child does, never preached.
- Besides the storyteller and the main character, one or two other characters speak in their own voice in some scenes: a family member, a friend or a talking animal. "cast" lists only these OTHER characters, never the main character, who is fixed by "characterSheet" and "heroName".
- Simple and clear for a small child: few characters, one thing happening at a time, lots of fun and warmth.
${KIDS_SAFETY}

Return ONLY JSON:
{
  "title": "story title in Egyptian colloquial Arabic, simple words, under 50 characters",
  "premise": "the whole story in 4-6 sentences in English, including the ending",
  "lesson": "ENGLISH, one short sentence: what a child watching takes away",
  "heroName": "the main character's first name in Arabic",
  "heroGender": "male" | "female",
  "characterSheet": "ENGLISH, one precise sentence fixing the main character's look (age, build, hair colour and cut, skin, clothes with their colour), reused for every image they are in",
  "styleSheet": "${STYLE_SHEET_RULE}",
  "hashtags": ["#حواديت", "#قصص_اطفال", "..."],
  ${CAST_SHAPE},
  ${PLACES_SHAPE},
  ${PROPS_SHAPE},
  "parts": [{ "number": 1, "summary": "English, what happens in this chapter", "cliffhanger": "English, what this chapter ends on (for the last one, the happy ending)" }]
}
with exactly ${options.parts} chapters, one or two cast members, two to five places and up to eight recurring objects (the things a character handles or looks at in more than one scene).`;

  return writeValidated(prompt, (data) => {
    const parsed = seriesBibleSchema.safeParse(data);
    if (!parsed.success) return parsed.error.message;
    if (parsed.data.parts.length !== options.parts) return `${parsed.data.parts.length} chapters instead of ${options.parts}`;
    if (!parsed.data.heroGender) return `"heroGender" is missing`;
    if (!parsed.data.lesson) return `"lesson" is missing`;
    const heroName = typeof (data as { heroName?: unknown }).heroName === "string" ? ((data as { heroName: string }).heroName).trim() : "";
    const twin = parsed.data.cast.find((member) => /main character/i.test(member.role) || (heroName && member.nameArabic.trim() === heroName));
    if (twin) return `"${twin.name}" in "cast" is the main character; "cast" must list only the other characters`;
    const unnamed = [...parsed.data.places, ...parsed.data.props].find((thing) => !hasArabic(thing.nameArabic));
    if (unnamed) return `"${unnamed.name}" has no "nameArabic" in Egyptian Arabic letters`;
    const heroVoice = heroVoiceFor(parsed.data.heroGender);
    return { ...parsed.data, storyType, heroVoice, cast: assignVoices(parsed.data.cast, heroVoice) };
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
  // Fixes the producer made to earlier scripts; the writer is told not to repeat those mistakes.
  corrections?: string[];
};

// The written part, plus the scenes the proofreader thinks the producer should look at.
export async function writeSeriesPart(options: WritePartOptions): Promise<{ story: Story; flags: LineFlag[] }> {
  const { bible, partNumber } = options;
  const plan = bible.parts.find((part) => part.number === partNumber);
  if (!plan) throw new Error(`The series has no part ${partNumber}`);
  const isLast = partNumber === bible.parts.length;
  const previous = options.previous.length
    ? options.previous.map((part) => `Part ${part.number} narration:\n${part.narration}`).join("\n\n")
    : "(this is the first part)";

  const prompt = `You write one chapter of an Egyptian children's story for ages 4 to 8, told as a wide 16:9 animated film.

Story: ${bible.title}
Whole story (secret, for your planning): ${bible.premise}
${bible.lesson ? `What the child watching takes away (show it, never preach it): ${bible.lesson}\n` : ""}Main character look: ${bible.characterSheet}

Already published:
${previous}

Now write chapter ${partNumber} of ${bible.parts.length}.
What happens in this chapter: ${plan.summary}
${isLast ? `This is the FINAL chapter: solve the problem and end happily: ${plan.cliffhanger}` : `It ends on: ${plan.cliffhanger}`}

Structure: exactly ${options.scenes} scenes, each one still image animated for 5 seconds with one or two spoken lines.
- ${partNumber === 1 ? "Open on the first fun or curious thing that happens, not on how the main character got there." : "Pick the story up where the last chapter stopped, but open on something fun or curious happening NOW, shown so that it works without having seen that chapter. Do not retell it."}
- Do not contradict the previous narration and do not repeat its lines.
- ${isLast ? "The last scene closes the story warmly." : "The last scene leaves the child smiling and curious about what happens next, never worried."}

${OPENING_RULES}

${SCENE_RULES}
${dialogueRules(bible.cast)}
${placeRules(bible.places, bible.props)}
${options.corrections?.length ? `\nThe producer had to correct these in earlier scripts. Do not make the same mistakes:\n${options.corrections.map((correction) => `- ${correction}`).join("\n")}\n` : ""}${options.current && options.note ? `\nThe producer rejected the previous version with this note. Follow it fully, even where that means writing every scene anew: ${options.note}\nThe rejected version, for reference only (do not copy its lines unless they already fit the note and the rules above):\n${JSON.stringify(options.current.scenes.map((scene) => scene.lines))}\n` : ""}
Return ONLY JSON:
{
  "description": "one or two Arabic sentences (Egyptian colloquial) for this chapter's video description, written for the parents, no spoilers",
  "hook": "the on-screen headline for scene 1",
  "scenes": [{ "lines": [{ "speaker": "Narrator", "text": "..." }], "place": "...", "props": [], "imagePrompt": "...", "shows": ["Hero"], "motionPrompt": "..." }]
}
with exactly ${options.scenes} scenes.`;

  const story = await writeValidated(prompt, (data) => {
    const parsed = partReplySchema.safeParse(data);
    if (!parsed.success) return parsed.error.message;
    const story = storySchema.parse({
      title: `${bible.title} | الحلقة ${partNumber}`,
      description: parsed.data.description,
      hook: parsed.data.hook,
      hashtags: bible.hashtags,
      characterSheet: bible.characterSheet,
      styleSheet: bible.styleSheet,
      // The same seed in every part keeps the look of the series consistent.
      seed: options.seed,
      cast: bible.cast,
      heroVoice: bible.heroVoice,
      places: bible.places,
      props: bible.props,
      scenes: parsed.data.scenes,
    });
    return storyProblem(story, options.scenes) ?? story;
  });
  const proofread = await proofreadStory(story, { premise: bible.premise, places: bible.places, props: bible.props, corrections: options.corrections ?? [] });
  return { story: await assignSfx(proofread.story), flags: proofread.flags };
}
