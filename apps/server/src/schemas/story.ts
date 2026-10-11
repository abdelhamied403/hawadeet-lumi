import { z } from "zod";

// Speaker label for lines told by the storyteller; every other speaker is a cast member's name.
export const NARRATOR = "Narrator";

// Speaker label for the main character talking out loud inside a scene. Same voice as the narrator,
// performed as speech to someone, not as storytelling.
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
  age: z.enum(["young", "adult", "old"]),
  // English: who they are and how they sound, used to direct the voice.
  role: z.string().min(1),
  // English: what they look like, used in image descriptions.
  look: z.string().min(1),
  // Voice name; filled in automatically when empty.
  voice: z.string().default(""),
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
  hashtags: z.array(z.string()).default([]),
  // Appended to every image prompt to keep the character and look consistent.
  characterSheet: z.string().default(""),
  styleSheet: z.string().default(""),
  seed: z.number().int().default(1234),
  // Characters who speak besides the narrator.
  cast: z.array(castMemberSchema).default([]),
  scenes: z.array(sceneSchema).min(1),
});

// "AmmAhmed" -> "Amm Ahmed", the way a cast member is named inside image prompts.
export function spokenName(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

// The full prompt for a scene's image: the moment, then the fixed look of each person in it, then the style.
export function buildImagePrompt(story: Story, scene: Scene): string {
  const looks = scene.shows
    ? scene.shows.map((who) => {
        if (who === HERO) return story.characterSheet && `The young main character: ${story.characterSheet}`;
        const member = story.cast.find((candidate) => candidate.name === who);
        return member ? `${spokenName(member.name)}: ${member.look}` : "";
      })
    : [story.characterSheet];
  return [scene.imagePrompt, ...looks, story.styleSheet]
    .filter(Boolean)
    .map((part) => part.trim().replace(/\.$/, ""))
    .join(". ");
}

export type Line = z.infer<typeof lineSchema>;
export type CastMember = z.infer<typeof castMemberSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Story = z.infer<typeof storySchema>;
// What may be handed in before defaults are filled (older stories have no lines or cast).
export type StoryInput = z.input<typeof storySchema>;
