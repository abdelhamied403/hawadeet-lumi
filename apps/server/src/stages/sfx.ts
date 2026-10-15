import { writeJson } from "../lib/story-model";
import { storySchema, type Story } from "../schemas/story";

export const SFX_DIR = "assets/sfx";

// The effects in assets/sfx, described for the writer who picks them.
export const SFX: Record<string, string> = {
  birds: "birds chirping on a sunny morning",
  giggle: "a child giggling",
  pop: "a light, bubbly pop, for something appearing or a small surprise",
  whoosh: "a quick whoosh, for something flying past or a fast move",
  sparkle: "a magical twinkling chime, for a wonderful discovery",
  splash: "a splash of water",
  footsteps: "light quick footsteps",
  knock: "a friendly knock on a door",
  meow: "a cat meowing",
  bell: "a small bell ringing (a bicycle, a shop door, a school bell)",
};

// Chooses a sound effect for the scenes where a sound really happens. The script itself is not changed.
// Returns the story untouched if the answer cannot be trusted.
export async function assignSfx(story: Story): Promise<Story> {
  const scenes = story.scenes.map((scene, index) => ({
    scene: index + 1,
    spoken: scene.narration,
    image: scene.imagePrompt,
    motion: scene.motionPrompt,
  }));
  const prompt = `You are the sound designer of a short animated story for small children. Each scene lasts about 5 seconds and already has voice and music.

Available sound effects:
${Object.entries(SFX).map(([tag, description]) => `- "${tag}": ${description}`).join("\n")}

Scenes:
${JSON.stringify(scenes)}

For each scene choose ONE effect, or null.
- Use an effect only where that sound actually happens in the scene (a cat meows, someone runs, water splashes, something wonderful appears…).
- Scene 1 gets the effect that fits it best: the first second needs a fun sound that makes a child look.
- About a third of the scenes get an effect; the rest are null, so the voice stays clear.
- Never anything loud or startling. Do not use the same effect in two scenes in a row.

Return ONLY JSON: {"sfx": [...]} with exactly ${scenes.length} entries, each an effect name or null.`;
  try {
    const { data } = await writeJson(prompt, undefined, undefined, { light: true });
    const chosen = (data as { sfx?: unknown }).sfx;
    if (!Array.isArray(chosen) || chosen.length !== story.scenes.length) return story;
    return storySchema.parse({
      ...story,
      scenes: story.scenes.map((scene, index) => {
        const tag = chosen[index];
        return { ...scene, sfx: typeof tag === "string" && tag in SFX ? tag : null };
      }),
    });
  } catch {
    return story;
  }
}
