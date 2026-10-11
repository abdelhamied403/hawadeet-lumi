import { saveStory } from "../lib/project";
import { writeJson } from "../lib/story-model";
import { HERO, NARRATOR, storySchema, type CastMember, type Story } from "../schemas/story";

const MAX_ATTEMPTS = 3;
// A motion clip lasts about five seconds, so each scene's narration has to be speakable in that time.
export const MAX_WORDS_PER_SCENE = 9;

export const SCENE_RULES = `Rules for every scene:
- "lines": what is spoken in the scene, in order, as [{"speaker": "...", "text": "..."}]. Usually ONE line by "Narrator". All the lines of a scene together are STRICTLY ${MAX_WORDS_PER_SCENE} words or fewer.
- "text": Egyptian colloquial Arabic (عامية مصرية), the way people really say it out loud. Use "…" for dramatic pauses. No English, no digits, no emojis. Natural everyday Egyptian words, never stiff formal Arabic.
- "imagePrompt" (ENGLISH): one frozen moment that shows exactly what is being said: shot type, who is there and what they are doing, the setting, the light. Call the main character "the young man" / "the young woman". Do NOT describe anyone's face, hair, age or clothes: each person's fixed look is added automatically from "shows". Describe only what IS in the picture, never what is absent. Never ask for text, captions or logos in the image.
- "shows": the people visible in that image, as a list: "${HERO}" for the main character, plus the exact name of any other character. Only people really in frame: a close-up of an object, a hand, feet or a door is []. Most images show ONE person.
- "motionPrompt" (ENGLISH): what moves during the 5 seconds: ONE simple, slow physical action, naming who or what does it ("the young man", "the padlock", never "he"). It must start from the image as described, involve only what is in that image, and be physically plausible. The camera is fixed or pushes in very slowly: no pans, tilts or orbits, and nothing new comes into view.
- Psychological, eerie horror: no gore, no harm to children, no real people, places or brands.`;

export function dialogueRules(cast: CastMember[]): string {
  if (cast.length === 0) return `Every line is spoken by "Narrator".`;
  const members = cast.map((member) => `- "${member.name}" (${member.nameArabic || member.name}): ${member.role} Looks like: ${member.look}`).join("\n");
  return `Speakers, using exactly these names:
- "Narrator": the main character telling the story to the viewer.
- "${HERO}": the main character speaking OUT LOUD inside the scene, to another character or to himself. Same person as the narrator.
${members}
Dialogue rules:
- Tell the story MOSTLY through spoken dialogue: at least two thirds of the scenes have someone speaking out loud ("${HERO}" or one of the characters). The part should play like a scene from a drama, with people talking to each other, not like someone reading a tale.
- Use "Narrator" only where nobody would speak: to set a place, to jump in time, or for a silent thought.
- A dialogue scene is one short line, or a two-line exchange between two speakers, and still ${MAX_WORDS_PER_SCENE} words or fewer in total.
- Conversations run across several scenes: one scene asks, the next answers. Lines must sound like real Egyptians talking, with hesitations and unfinished sentences.
- In a scene where a character speaks, the image shows that character: name them in the imagePrompt with their name written as words (e.g. "Amm Ahmed") and list them in "shows".`;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((token) => /[\u0621-\u064A]/.test(token)).length;
}

// With a cast, at least this share of scenes must have someone speaking out loud.
const MIN_DIALOGUE_SHARE = 0.5;

// Returns a description of what is wrong with the story, or null when it is usable.
export function storyProblem(story: Story, scenes: number): string | null {
  const tooLong = story.scenes.filter((scene) => wordCount(scene.narration) > MAX_WORDS_PER_SCENE + 1);
  if (story.scenes.length !== scenes) return `${story.scenes.length} scenes instead of ${scenes}`;
  if (tooLong.length > 0) return `${tooLong.length} scenes over the word limit`;
  const speakers = new Set([NARRATOR, HERO, ...story.cast.map((member) => member.name)]);
  const unknown = story.scenes.flatMap((scene) => scene.lines).find((line) => !speakers.has(line.speaker));
  if (unknown) return `unknown speaker "${unknown.speaker}"`;
  if (story.scenes.some((scene) => !scene.shows)) return `a scene is missing its "shows" list`;
  const strangers = story.scenes.flatMap((scene) => scene.shows ?? []).find((who) => who !== HERO && !story.cast.some((member) => member.name === who));
  if (strangers) return `unknown name "${strangers}" in "shows"`;
  if (story.cast.length > 0) {
    const spoken = story.scenes.filter((scene) => scene.lines.some((line) => line.speaker !== NARRATOR)).length;
    if (spoken < story.scenes.length * MIN_DIALOGUE_SHARE) return `only ${spoken} of ${story.scenes.length} scenes have dialogue`;
  }
  return null;
}

function buildPrompt(topic: string, scenes: number): string {
  return `You write scripts for short vertical horror videos (Reels / Shorts) for an Egyptian audience.

Write one original, self-contained horror story about: ${topic}

The story is told by a narrator over ${scenes} scenes. Each scene is one still image that gets animated for 5 seconds.
Scene 1 is a hook that makes the viewer stay. The last scene is a twist or a chilling final line. One main character, kept the same in every scene.

${SCENE_RULES}
${dialogueRules([])}

Also write (in ENGLISH):
- "characterSheet": one sentence fixing the main character's look (age, hair, face, clothes), reused for every image.
- "styleSheet": one sentence fixing the look of every image: cinematic horror film still, photorealistic, lens, colour palette, lighting, film grain, vertical composition.

Return ONLY JSON with this shape:
{
  "title": "Arabic title, Egyptian colloquial, under 60 characters",
  "description": "one or two Arabic sentences for the video description",
  "hashtags": ["#رعب", "..."],
  "characterSheet": "...",
  "styleSheet": "...",
  "scenes": [{ "lines": [{ "speaker": "Narrator", "text": "..." }], "imagePrompt": "...", "shows": ["Hero"], "motionPrompt": "..." }]
}
with exactly ${scenes} scenes.`;
}

// A second pass by an "Egyptian editor": the writer sometimes misspells colloquial words or slips into
// formal Arabic. Returns the original lines if the edit cannot be trusted.
export async function proofreadNarration(lines: string[]): Promise<string[]> {
  const prompt = `أنت محرر لغوي مصري من القاهرة بتراجع نص راوي لقصة رعب مكتوبة بالعامية المصرية.

راجع كل سطر وصحّح بس اللي غلط:
- كلمات مكتوبة غلط أو مش موجودة في العامية المصرية (مثال: "بترابيز" الصح "بترباس"، "صديان" الصح "مصدّي").
- كلمات فصحى أو من لهجة تانية ليها بديل مصري طبيعي.
- تركيب جملة محدش بيقوله في مصر.

قواعد:
- أقل تغيير ممكن. السطر السليم يرجع زي ما هو بالظبط.
- متغيّرش المعنى ولا ترتيب الأحداث، ومتزودش كلام. كل سطر ${MAX_WORDS_PER_SCENE} كلمات أو أقل.
- سيب علامة "…" في مكانها.

السطور (JSON):
${JSON.stringify(lines)}

رجّع JSON بس بالشكل ده: {"lines": ["...", "..."]} بنفس عدد السطور (${lines.length}) وبنفس الترتيب.`;
  try {
    const { data } = await writeJson(prompt);
    const edited = (data as { lines?: unknown }).lines;
    const usable =
      Array.isArray(edited) &&
      edited.length === lines.length &&
      edited.every((line) => typeof line === "string" && line.trim() && wordCount(line) <= MAX_WORDS_PER_SCENE + 1);
    return usable ? (edited as string[]).map((line) => line.trim()) : lines;
  } catch {
    return lines;
  }
}

export async function proofreadStory(story: Story): Promise<Story> {
  const original = story.scenes.flatMap((scene) => scene.lines.map((line) => line.text));
  const edited = await proofreadNarration(original);
  let cursor = 0;
  return storySchema.parse({
    ...story,
    scenes: story.scenes.map((scene) => ({
      ...scene,
      lines: scene.lines.map((line) => ({ ...line, text: edited[cursor++] ?? line.text })),
    })),
  });
}

// A single stand-alone story (the dashboard writes serialized parts instead; see series.ts).
export async function runScript(dir: string, options: { topic: string; scenes: number }): Promise<Story> {
  let problem = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data, model } = await writeJson(buildPrompt(options.topic, options.scenes));
    const parsed = storySchema.safeParse({ ...(data as object), seed: Math.floor(Math.random() * 1_000_000) });
    if (!parsed.success) {
      problem = parsed.error.message;
      continue;
    }
    problem = storyProblem(parsed.data, options.scenes) ?? "";
    if (problem) continue;
    const story = await proofreadStory(parsed.data);
    await saveStory(dir, story);
    console.log(`story (${model}): ${story.title} (${story.scenes.length} scenes) -> ${dir}/story.json`);
    return story;
  }
  throw new Error(`The story writer did not return a usable story after ${MAX_ATTEMPTS} attempts: ${problem}`);
}
