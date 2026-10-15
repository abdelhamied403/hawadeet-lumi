import { z } from "zod";

// Speaker label for lines told by the storyteller; every other speaker is a cast member's name.
export const NARRATOR = "Narrator";

// Speaker label for the main character (a child) talking out loud inside a scene, in the story's
// `heroVoice`. Older stories have no hero voice and use the narrator's, performed as speech.
export const HERO = "Hero";

export const lineSchema = z.object({
  speaker: z.string().min(1),
  // Arabic text, spoken and shown as captions.
  text: z.string().min(1),
});

export const castMemberSchema = z.object({
  // Short Latin name, used as the speaker label in scripts (e.g. "UmmHassan").
  name: z.string().regex(/^[A-Za-z]+$/, "Use letters only, no spaces"),
  nameArabic: z.string().default(""),
  gender: z.enum(["male", "female"]),
  age: z.enum(["child", "young", "adult", "old"]),
  // English: who they are and how they sound, used to direct the voice.
  role: z.string().min(1),
  // English: what they look like, used in image descriptions.
  look: z.string().min(1),
  // Voice name; filled in automatically when empty.
  voice: z.string().default(""),
});

export const placeSchema = z.object({
  // Short Latin name, used to point a scene at the place (e.g. "Corridor").
  name: z.string().regex(/^[A-Za-z]+$/, "Use letters only, no spaces"),
  // The everyday Egyptian word for the place, used whenever a line names it. Without it the writer
  // turns the English name into Arabic letters ("Booth" became "البوظة"). Empty for older series until filled in.
  nameArabic: z.string().default(""),
  // English: what the place looks like and the state its doors and objects are in, added to every image set there.
  look: z.string().min(1),
});

export const propSchema = z.object({
  // Short Latin name, used to point a scene at the object (e.g. "Padlock").
  name: z.string().regex(/^[A-Za-z]+$/, "Use letters only, no spaces"),
  // The everyday Egyptian word for the object, used whenever a line names it. Empty for older series until filled in.
  nameArabic: z.string().default(""),
  // English: what the object looks like, added to every image it is in.
  look: z.string().min(1),
});

export const sceneSchema = z
  .object({
    // Everything spoken in the scene, joined. Kept in step with `lines` automatically.
    narration: z.string().default(""),
    // Who says what, in order. A scene with no lines given is one narrator line.
    lines: z.array(lineSchema).min(1).optional(),
    // English prompt for the still image.
    imagePrompt: z.string().min(1),
    // Who is visible in the image: HERO for the main character and/or cast names; empty when nobody is.
    // Their fixed looks are added to the image prompt from this list. Older stories have none, and get
    // the main character's look in every image.
    shows: z.array(z.string()).optional(),
    // Name of the place the image is set in; its fixed look is added to the image prompt. Older stories have none.
    place: z.string().nullable().default(null),
    // Names of the story's recurring objects visible in the image; their fixed looks are added to the image prompt.
    props: z.array(z.string()).default([]),
    // English prompt describing how the image should move.
    motionPrompt: z.string().min(1),
    // Name of a sound effect from assets/sfx played in this scene, if any.
    sfx: z.string().nullable().default(null),
  })
  .refine((scene) => scene.narration.trim().length > 0 || (scene.lines?.length ?? 0) > 0, "A scene needs spoken text")
  .transform((scene) => {
    const lines = scene.lines ?? [{ speaker: NARRATOR, text: scene.narration }];
    return { ...scene, lines, narration: lines.map((line) => line.text).join(" ") };
  });

export const storySchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  // Arabic headline shown large on screen during the first scene; never spoken. Empty for older stories.
  hook: z.string().default(""),
  hashtags: z.array(z.string()).default([]),
  // Appended to every image prompt to keep the character and look consistent.
  characterSheet: z.string().default(""),
  styleSheet: z.string().default(""),
  seed: z.number().int().default(1234),
  // The main character's own voice; empty for older stories, where they speak in the narrator's.
  heroVoice: z.string().default(""),
  // Characters who speak besides the narrator.
  cast: z.array(castMemberSchema).default([]),
  // The places the story happens in, each with one fixed look.
  places: z.array(placeSchema).default([]),
  // Objects the characters handle or look at in more than one scene, each with one fixed look.
  props: z.array(propSchema).default([]),
  scenes: z.array(sceneSchema).min(1),
});

// "AmmAhmed" -> "Amm Ahmed", the way a cast member is named inside image prompts.
export function spokenName(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

// Staging rules added to every picture, for the image model's habits that cost redos: extra people at the
// edges and in the background, a character drawn twice, clothes moving from one character to another, and
// lettering. Written as plain statements, since the image model has no negative prompt.
function stagingRules(scene: Scene): string[] {
  const names = (scene.shows ?? []).map((who) => (who === HERO ? "the main character" : spokenName(who)));
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
  const who = names.length === 0 ? "No people and no animals anywhere in the picture, only the place and its objects" : `Only ${list} ${names.length > 1 ? "are" : "is"} in the picture, ${names.length > 1 ? "each drawn once" : "drawn once"}`;
  return [
    `${who}; the edges and background of the frame show only scenery, with any other boats, windows and streets empty`,
    ...(names.length ? ["Each character wears only their own clothes, and animals are bare"] : []),
    "No lettering anywhere",
  ];
}

// The full prompt for a scene's image: the moment, the fixed look of the place and of each person in it, the
// staging rules, then the style.
export function buildImagePrompt(story: Story, scene: Scene): string {
  const looks = scene.shows
    ? scene.shows.map((who) => {
        if (who === HERO) return story.characterSheet && `The main character: ${story.characterSheet}`;
        const member = story.cast.find((candidate) => candidate.name === who);
        return member ? `${spokenName(member.name)}: ${member.look}` : "";
      })
    : [story.characterSheet];
  const place = story.places.find((candidate) => candidate.name === scene.place);
  const props = scene.props.map((name) => {
    const prop = story.props.find((candidate) => candidate.name === name);
    return prop ? `The ${spokenName(prop.name).toLowerCase()}: ${prop.look}` : "";
  });
  return [scene.imagePrompt, place ? `The place: ${place.look}` : "", ...props, ...looks, ...(scene.shows ? stagingRules(scene) : []), story.styleSheet]
    .filter(Boolean)
    .map((part) => part.trim().replace(/\.$/, ""))
    .join(". ");
}

export type Line = z.infer<typeof lineSchema>;
export type Place = z.infer<typeof placeSchema>;
export type Prop = z.infer<typeof propSchema>;
export type CastMember = z.infer<typeof castMemberSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Story = z.infer<typeof storySchema>;
// What may be handed in before defaults are filled (older stories have no lines or cast).
export type StoryInput = z.input<typeof storySchema>;
