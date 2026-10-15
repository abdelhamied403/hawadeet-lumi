import { z } from "zod";
import { saveStory } from "../lib/project";
import { writeJson } from "../lib/story-model";
import { HERO, NARRATOR, storySchema, type CastMember, type Place, type Prop, type Story } from "../schemas/story";

const MAX_ATTEMPTS = 3;

// How the writer is told to fix the look of every image: one 3D cartoon style for the whole channel.
export const STYLE_SHEET_RULE =
  "ENGLISH, one sentence fixing the look of every image: bright 3D animated film still in a modern family-film style, soft rounded shapes, big expressive eyes, warm cheerful colour palette, soft bright lighting, gentle depth of field, wide 16:9 landscape composition";
// A motion clip lasts about five seconds, so each scene's narration has to be speakable in that time.
export const MAX_WORDS_PER_SCENE = 9;

// The first line has to land before a scrolling viewer leaves, so it is shorter than the others.
export const MAX_WORDS_OPENING = 6;

// An image description shorter than this leaves the picture to chance, and the image model fills it with something else.
export const MIN_WORDS_IMAGE = 45;

export const OPENING_RULES = `The opening decides everything. Most viewers are families scrolling past who have seen no other chapter, and they move on within three seconds unless something fun or curious is already happening on screen.
- Scene 1 opens INSIDE the first funny, surprising or curious moment: its image is a close shot of the one thing that makes a child ask "what is that?" (a tiny kitten stuck in a shoe, a balloon floating away, a giant footprint in the sand that turns out to be a camel's), and its line names that thing in ${MAX_WORDS_OPENING} words or fewer.
- Scene 1 is never setup: nobody wakes up, arrives or says good morning. Who the main character is and where they are come out in passing from scene 2 onwards.
- Scene 1 must make a child who knows nothing about the story curious: no names, and no "he" or "it" that only an earlier chapter explains.
- "hook": a written headline shown large on screen during scene 1, never spoken: ${MAX_WORDS_OPENING} Arabic words or fewer, Egyptian colloquial, simple words a child knows, a playful question a child wants answered (e.g. "مين أكل كحك تيتة؟"). It does not repeat scene 1's line and gives nothing away.`;

// What a story for small children must never contain; also used to check scripts and pictures.
export const KIDS_SAFETY = `This is for children aged 4 to 8, so it must be completely safe for them:
- Nothing frightening: no monsters, ghosts, darkness that threatens, villains who hurt anyone, chases, screaming or crying in terror. A problem is gentle (a lost toy, a stuck kite, a friend who is sad) and is always solved.
- No violence, injury, blood, weapons, punishment or anyone being hit, mocked or left out for how they look.
- Nothing a child could copy and get hurt: no playing with fire, knives, medicine, electricity, heights, open water or going off with strangers. Where the story needs something risky, a kind adult is there and the safe choice is the one shown.
- No romance, no bad words, no real people, places that could be found, brands or logos.
- Adults are kind and present; children are respectful, and the good choice is the one that ends well.`;

export const SCENE_RULES = `Rules for every scene:
- "lines": what is spoken in the scene, in order, as [{"speaker": "...", "text": "..."}]. Usually ONE line. All the lines of a scene together are STRICTLY ${MAX_WORDS_PER_SCENE} words or fewer.
- "text": Egyptian colloquial Arabic (عامية مصرية), the way a mother or grandmother tells a story to a child out loud: short, simple words a five-year-old knows. Use "…" for a playful pause. No English, no digits, no emojis, never stiff formal Arabic.
- Every line must be something a camera can SHOW at that moment: someone doing something, or a thing that can be seen. A feeling is written as what it makes someone visibly do ("she was happy" is a girl jumping with both arms up, not "joy"). Never write a line whose picture would have to be vague ("the magic spread", "the day passed").
- "place": the exact name of the place the image is set in, from the list of places below, or null only when the frame is filled by one object and no surroundings can be seen.
- "imagePrompt" (ENGLISH, 60 to 100 words): one frozen moment that shows exactly what the line says, described so completely that two animators would draw the same picture. In this order:
  1. The shot: its size (close-up, medium, wide), the camera height and angle, and what is nearest the camera.
  2. Who is in it and their exact pose: where they stand in the frame, which way the body and the face are turned, where the eyes look, what each hand or paw is doing, the expression (always readable and friendly). Call the main character "the little boy" / "the little girl". End the imagePrompt with ONE sentence naming exactly the characters in "shows" and saying they are the only ones, matching "shows" exactly ("The little boy and the pelican are the only two in the picture." / "The little girl is the only one in the picture." / for [] "There is nobody in the picture."): the image model otherwise fills the edges of the frame, other boats, windows and streets with extra people, or draws a character twice.
  3. The one object or detail the line is about, where it is in the frame and its exact state ("the red kite caught in the branches of the mango tree", "the lid of the cookie tin open").
  4. What is behind and around them, taken from the place, with the same objects in the same state as the story left them.
  5. The light: bright and warm, its source and colour (morning sun, golden afternoon, soft lamp at bedtime).
  Do NOT describe anyone's face, hair, age or clothes: each character's fixed look is added automatically from "shows", and each character keeps only their own clothes (an animal never wears the child's life jacket or hat). Describe only what IS in the picture, never what is absent (the image model draws every noun it reads, even after "no": "there is no fish" draws a fish), and nothing the story has not revealed yet. Never ask for text, captions or logos in the image.
- "props": the recurring objects visible in that image, as a list of their exact names from the list of recurring objects below; [] when none of them is in frame.
- "shows": the characters visible in that image, as a list: "${HERO}" for the main character, plus the exact name of any other character. Only characters really in frame: a close-up of an object, a hand or a paw is []. Most images show ONE or TWO characters. Every person or animal in the imagePrompt must be in "shows", and only the main character and the cast can be: anyone else (a shopkeeper, a fisherman, a crowd) is talked about but kept out of the picture.
- "motionPrompt" (ENGLISH, 30 to 60 words): what happens during the 5 seconds, taken from the line: the ONE gentle physical action the line describes, from its start to its end ("the little girl lifts the kitten out of the shoe and hugs it to her chest"), naming who or what does it ("the little boy", "the kite", never "he"). When someone says the line aloud, they are seen saying it. It must start from the image as described, involve only what is in that image, and be physically plausible. The camera is fixed or pushes in very slowly: no pans, tilts or orbits, and nothing new comes into view.
${KIDS_SAFETY}`;

export function dialogueRules(cast: CastMember[]): string {
  if (cast.length === 0) return `Every line is spoken by "Narrator".`;
  const members = cast.map((member) => `- "${member.name}" (${member.nameArabic || member.name}): ${member.role} Looks like: ${member.look}`).join("\n");
  return `Speakers, using exactly these names:
- "Narrator": a warm grown-up storyteller telling the story to a child, in the third person ("كان فيه…", "وفجأة…").
- "${HERO}": the main character, a child, speaking OUT LOUD inside the scene, to another character or to themself, in their own child's voice.
${members}
Dialogue rules:
- The storyteller carries the story, and the characters bring it to life: about half of the scenes have someone speaking out loud ("${HERO}" or one of the characters), and the rest are told by "Narrator".
- A dialogue scene is one short line, or a two-line exchange between two speakers, and still ${MAX_WORDS_PER_SCENE} words or fewer in total.
- Conversations run across several scenes: one scene asks, the next answers. Characters talk the way Egyptian children and families really talk: simple, warm and often funny.
- In a scene where a character speaks, the image shows that character: name them in the imagePrompt with their name written as words (e.g. "Amm Ahmed") and list them in "shows".`;
}

const spokenAs = (thing: Place | Prop) => (thing.nameArabic ? ` (in the lines: ${thing.nameArabic})` : "");

export function placeRules(places: Place[], props: Prop[] = []): string {
  const parts: string[] = [];
  if (places.length > 0) {
    parts.push(`Places, using exactly these names in "place". Each keeps this one look in every image set there:
${places.map((place) => `- "${place.name}"${spokenAs(place)}: ${place.look}`).join("\n")}`);
  }
  if (props.length > 0) {
    parts.push(`Recurring objects, using exactly these names in "props". Each keeps this one look in every image it is in, so the imagePrompt says where it is and what state it is in, never what it looks like:
${props.map((prop) => `- "${prop.name}"${spokenAs(prop)}: ${prop.look}`).join("\n")}`);
  }
  if (parts.length > 0) {
    parts.push(`When a line names one of these places or objects, it uses the Arabic word given in brackets. The English names are labels for the pictures only: never write an English word in Arabic letters.`);
  }
  return parts.join("\n");
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((token) => /[\u0621-\u064A]/.test(token)).length;
}

// With a cast, at least this share of scenes must have someone speaking out loud; the storyteller tells the rest.
const MIN_DIALOGUE_SHARE = 0.3;

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
  return `You write scripts for short animated stories in wide 16:9 landscape for Egyptian children aged 4 to 8.

Write one original, self-contained children's story about: ${topic}

The story is told by a storyteller over ${scenes} scenes. Each scene is one still image that gets animated for 5 seconds.
The main character is a child, kept the same in every scene. The story has a gentle problem, and the last scene ends happily with its lesson shown through what the child does, never preached.

${OPENING_RULES}

${SCENE_RULES}
${dialogueRules([])}

Also write (in ENGLISH):
- "characterSheet": one sentence fixing the main character's look (age, hair, face, clothes with their colour), reused for every image.
- "styleSheet": ${STYLE_SHEET_RULE}
- "places": the one to three places the story happens in, each with a name (one Latin word) and a "look" of two or three sentences fixing its walls or landscape, floor, furniture, colours and light, reused for every image set there.

Return ONLY JSON with this shape:
{
  "title": "Arabic title, Egyptian colloquial, under 60 characters",
  "description": "one or two Arabic sentences for the video description",
  "hook": "the on-screen headline for scene 1",
  "hashtags": ["#حواديت", "#قصص_اطفال", "..."],
  "characterSheet": "...",
  "styleSheet": "...",
  "places": [{ "name": "Garden", "look": "..." }],
  "scenes": [{ "lines": [{ "speaker": "Narrator", "text": "..." }], "place": "Garden", "props": [], "imagePrompt": "...", "shows": ["Hero"], "motionPrompt": "..." }]
}
with exactly ${scenes} scenes.`;
}

// What the editor is told about the story, so it reads each line knowing what it is about.
export type ScriptContext = {
  premise: string;
  places: Place[];
  props: Prop[];
  // Fixes the producer made to earlier scripts, so the same mistakes are caught again.
  corrections: string[];
};

// A scene the editor thinks still needs the producer's eye; scene 0 is about the whole script.
export type LineFlag = { scene: number; problem: string };

const proofreadReplySchema = z.object({
  lines: z.array(z.string()),
  problems: z.array(z.object({ scene: z.number().int(), problem: z.string().min(1) })).default([]),
});

// A second pass by an "Egyptian editor": the writer sometimes misspells colloquial words, slips into
// formal Arabic or writes an English word in Arabic letters. It also flags lines that do not make sense
// or are not safe for small children, for the producer to decide on. A line whose edit breaks the word limit keeps its original text.
export async function proofreadNarration(lines: { scene: number; text: string }[], context?: ScriptContext): Promise<{ lines: string[]; flags: LineFlag[] }> {
  const names = context ? [...context.places, ...context.props].filter((thing) => thing.nameArabic) : [];
  const prompt = `أنت محرر لغوي مصري من القاهرة بتراجع نص حدوتة للأطفال من سن ٤ لـ ٨ سنين مكتوبة بالعامية المصرية.
${context ? `\nالقصة (بالإنجليزي، عشان تفهم كل سطر بيتكلم عن إيه): ${context.premise}\n` : ""}${names.length ? `الأماكن والحاجات في القصة واسمها الصح في الكلام: ${names.map((thing) => `${thing.name} = ${thing.nameArabic}`).join("، ")}\n` : ""}
راجع كل سطر وصحّح بس اللي غلط:
- كلمات مكتوبة غلط أو مش موجودة في العامية المصرية (مثال: "بتهألى" الصح "بيتهيألي"، "زعلانه" الصح "زعلانة").
- كلمة إنجليزي مكتوبة بحروف عربي بدل الكلمة المصري (مثال: "البوظة" والمقصود booth، الصح "الكشك").
- كلمات فصحى أو من لهجة تانية ليها بديل مصري طبيعي.
- كلمة صعبة على طفل عنده خمس سنين ليها بديل أبسط.
- تركيب جملة محدش بيقوله في مصر.
${context?.corrections.length ? `\nدي تصحيحات عملها المنتج في نصوص قبل كده. لو لقيت نفس الغلط صلّحه بنفس الطريقة:\n${context.corrections.map((correction) => `- ${correction}`).join("\n")}\n` : ""}
قواعد:
- أقل تغيير ممكن. السطر السليم يرجع زي ما هو بالظبط.
- متغيّرش المعنى ولا ترتيب الأحداث، ومتزودش كلام. كل سطر ${MAX_WORDS_PER_SCENE} كلمات أو أقل.
- سيب علامة "…" في مكانها.

وبعد التصحيح، اكتب في "problems" أي مشهد لسه محتاج المنتج يبص عليه: سطر مش مفهوم، أو بيذكر حاجة القصة مش بتشرحها أبداً، أو مش منطقي مع اللي قبله، أو مش مناسب لطفل صغير حسب القواعد دي:
${KIDS_SAFETY}
اكتب المشكلة في جملة إنجليزي قصيرة، وابدأ مشكلة الأمان بكلمة "Kids safety:". لو مفيش، سيبها فاضية.

السطور (JSON، كل سطر ورقم المشهد بتاعه):
${JSON.stringify(lines)}

رجّع JSON بس بالشكل ده: {"lines": ["...", "..."], "problems": [{"scene": 5, "problem": "..."}]} و"lines" بنفس عدد السطور (${lines.length}) وبنفس الترتيب.`;
  const original = lines.map((line) => line.text);
  try {
    const { data } = await writeJson(prompt);
    const reply = proofreadReplySchema.parse(data);
    if (reply.lines.length !== lines.length) throw new Error(`it returned ${reply.lines.length} lines instead of ${lines.length}`);
    const edited = reply.lines.map((line, index) => (line.trim() && wordCount(line) <= MAX_WORDS_PER_SCENE + 1 ? line.trim() : original[index]!));
    const scenes = new Set(lines.map((line) => line.scene));
    return { lines: edited, flags: reply.problems.filter((flag) => scenes.has(flag.scene)) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`proofreading: ${reason}`);
    // Said out loud, so a script that was never proofread does not pass for one that was.
    return { lines: original, flags: [{ scene: 0, problem: `The proofreader could not run (${reason.slice(0, 150)}), so this script was not checked for wrong words.` }] };
  }
}

export async function proofreadStory(story: Story, context?: ScriptContext): Promise<{ story: Story; flags: LineFlag[] }> {
  const original = story.scenes.flatMap((scene, index) => scene.lines.map((line) => ({ scene: index + 1, text: line.text })));
  const { lines: edited, flags } = await proofreadNarration(original, context);
  let cursor = 0;
  const proofread = storySchema.parse({
    ...story,
    scenes: story.scenes.map((scene) => ({
      ...scene,
      lines: scene.lines.map((line) => ({ ...line, text: edited[cursor++] ?? line.text })),
    })),
  });
  return { story: proofread, flags };
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
    const { story } = await proofreadStory(parsed.data);
    await saveStory(dir, story);
    console.log(`story (${model}): ${story.title} (${story.scenes.length} scenes) -> ${dir}/story.json`);
    return story;
  }
  throw new Error(`The story writer did not return a usable story after ${MAX_ATTEMPTS} attempts: ${problem}`);
}
