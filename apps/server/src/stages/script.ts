import { saveStory } from "../lib/project";
import { writeJson } from "../lib/story-model";
import { HERO, NARRATOR, storySchema, type CastMember, type Place, type Prop, type Story } from "../schemas/story";

const MAX_ATTEMPTS = 3;
// A motion clip lasts about five seconds, so each scene's narration has to be speakable in that time.
export const MAX_WORDS_PER_SCENE = 9;

// The first line has to land before a scrolling viewer leaves, so it is shorter than the others.
export const MAX_WORDS_OPENING = 6;

// An image description shorter than this leaves the picture to chance, and the image model fills it with something else.
export const MIN_WORDS_IMAGE = 45;

export const OPENING_RULES = `The opening decides everything. Most viewers are strangers scrolling past who have seen no other part, and they leave within three seconds unless something is already wrong on screen.
- Scene 1 is a cold open INSIDE the first frightening moment: its image is a close shot of the one thing that should not be there or should not be happening (prints on the floor, a door standing open, a shape at the end of the corridor), and its line names that thing in ${MAX_WORDS_OPENING} words or fewer.
- Scene 1 is never setup: nobody arrives, moves in, greets anyone, asks an everyday question or just stands there. Who the main character is and where he is come out in passing from scene 3 onwards.
- Scene 1 must unsettle someone who knows nothing about the story: no names, and no "he" or "it" that only an earlier part explains.
- Scenes 2 and 3 make it worse. Nothing calms down and nobody does anything ordinary before scene 4.
- "hook": a written headline shown large on screen during scene 1, never spoken: ${MAX_WORDS_OPENING} Arabic words or fewer, Egyptian colloquial, a question or claim a stranger needs answered (e.g. "مين دخل شقتي وأنا صاحي؟"). It does not repeat scene 1's line and gives nothing away.`;

export const SCENE_RULES = `Rules for every scene:
- "lines": what is spoken in the scene, in order, as [{"speaker": "...", "text": "..."}]. Usually ONE line by "Narrator". All the lines of a scene together are STRICTLY ${MAX_WORDS_PER_SCENE} words or fewer.
- "text": Egyptian colloquial Arabic (عامية مصرية), the way people really say it out loud. Use "…" for dramatic pauses. No English, no digits, no emojis. Natural everyday Egyptian words, never stiff formal Arabic.
- Every line must be something a camera can SHOW at that moment: a person doing something, or a thing that can be seen. A line about a feeling, a sound or a thought is written as what it makes someone visibly do ("I froze" is a man stopped mid-step with his hand in the air, not "fear"). Never write a line whose picture would have to be vague ("the darkness gathered", "shapes formed").
- "place": the exact name of the place the image is set in, from the list of places below, or null only when the frame is filled by one object and no surroundings can be seen.
- "imagePrompt" (ENGLISH, 60 to 100 words): one frozen moment that shows exactly what the line says, described so completely that two painters would paint the same picture. In this order:
  1. The shot: its size (extreme close-up, close-up, medium, wide), the camera height and angle, and what is nearest the camera.
  2. Who is in it and their exact pose: where they stand in the frame, which way the body and the face are turned, where the eyes look, what each hand is doing, the expression. Call the main character "the young man" / "the young woman".
  3. The one object or detail the line is about, where it is in the frame and its exact state ("the door opposite is shut, its rusty padlock hanging closed", "the brass peephole at eye level, dark").
  4. What is behind and around them, taken from the place, with the same doors, walls and objects in the same state as the story left them. Say of every door in the frame whether it is shut or open: a door that is locked in the story is shut in every picture.
  5. The light: its source, its colour, where the shadows fall.
  Do NOT describe anyone's face, hair, age or clothes: each person's fixed look is added automatically from "shows". Describe only what IS in the picture, never what is absent, and nothing the story has not revealed yet. What a character sees through a peephole, a keyhole or a gap is described as concretely as any other picture: the actual room, the actual thing in it. Never ask for text, captions or logos in the image.
- "props": the recurring objects visible in that image, as a list of their exact names from the list of recurring objects below; [] when none of them is in frame.
- "shows": the people visible in that image, as a list: "${HERO}" for the main character, plus the exact name of any other character. Only people really in frame: a close-up of an object, a hand, feet or a door is []. Most images show ONE person.
- "motionPrompt" (ENGLISH, 30 to 60 words): what happens during the 5 seconds, taken from the line: the ONE physical action the line describes, from its start to its end ("the young man takes two slow steps toward the door and stops with his hand an inch from the wood"), naming who or what does it ("the young man", "the padlock", never "he"). When someone says the line aloud, they are seen saying it. It must start from the image as described, involve only what is in that image, and be physically plausible. The camera is fixed or pushes in very slowly: no pans, tilts or orbits, and nothing new comes into view.
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

export function placeRules(places: Place[], props: Prop[] = []): string {
  const parts: string[] = [];
  if (places.length > 0) {
    parts.push(`Places, using exactly these names in "place". Each keeps this one look in every image set there:
${places.map((place) => `- "${place.name}": ${place.look}`).join("\n")}`);
  }
  if (props.length > 0) {
    parts.push(`Recurring objects, using exactly these names in "props". Each keeps this one look in every image it is in, so the imagePrompt says where it is and what state it is in, never what it looks like:
${props.map((prop) => `- "${prop.name}": ${prop.look}`).join("\n")}`);
  }
  return parts.join("\n");
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
  const opening = wordCount(story.scenes[0]?.narration ?? "");
  if (opening > MAX_WORDS_OPENING) return `scene 1 says ${opening} words; the opening line must be ${MAX_WORDS_OPENING} or fewer`;
  if (wordCount(story.hook) > MAX_WORDS_OPENING + 1) return `the "hook" headline is over ${MAX_WORDS_OPENING} words`;
  const speakers = new Set([NARRATOR, HERO, ...story.cast.map((member) => member.name)]);
  const unknown = story.scenes.flatMap((scene) => scene.lines).find((line) => !speakers.has(line.speaker));
  if (unknown) return `unknown speaker "${unknown.speaker}"`;
  if (story.scenes.some((scene) => !scene.shows)) return `a scene is missing its "shows" list`;
  const strangers = story.scenes.flatMap((scene) => scene.shows ?? []).find((who) => who !== HERO && !story.cast.some((member) => member.name === who));
  if (strangers) return `unknown name "${strangers}" in "shows"`;
  const thin = story.scenes.findIndex((scene) => scene.imagePrompt.split(/\s+/).length < MIN_WORDS_IMAGE);
  if (thin >= 0) return `the "imagePrompt" of scene ${thin + 1} is under ${MIN_WORDS_IMAGE} words; every one needs the shot, the pose, the object and its state, the surroundings and the light`;
  const nowhere = story.scenes.find((scene) => scene.place && !story.places.some((place) => place.name === scene.place));
  if (nowhere) return `unknown place "${nowhere.place}"`;
  const stray = story.scenes.flatMap((scene) => scene.props).find((name) => !story.props.some((prop) => prop.name === name));
  if (stray) return `unknown object "${stray}" in "props"`;
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
The last scene is a twist or a chilling final line. One main character, kept the same in every scene.

${OPENING_RULES}

${SCENE_RULES}
${dialogueRules([])}

Also write (in ENGLISH):
- "characterSheet": one sentence fixing the main character's look (age, hair, face, clothes), reused for every image.
- "styleSheet": one sentence fixing the look of every image: cinematic horror film still, photorealistic, lens, colour palette, lighting, film grain, vertical composition.
- "places": the one to three places the story happens in, each with a name (one Latin word) and a "look" of two or three sentences fixing its walls, floor, doors (material, colour, which are shut), furniture and light, reused for every image set there.

Return ONLY JSON with this shape:
{
  "title": "Arabic title, Egyptian colloquial, under 60 characters",
  "description": "one or two Arabic sentences for the video description",
  "hook": "the on-screen headline for scene 1",
  "hashtags": ["#رعب", "..."],
  "characterSheet": "...",
  "styleSheet": "...",
  "places": [{ "name": "Corridor", "look": "..." }],
  "scenes": [{ "lines": [{ "speaker": "Narrator", "text": "..." }], "place": "Corridor", "props": [], "imagePrompt": "...", "shows": ["Hero"], "motionPrompt": "..." }]
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
    const { data } = await writeJson(prompt, undefined, undefined, { light: true });
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
