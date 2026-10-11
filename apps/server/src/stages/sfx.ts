import { writeJson } from "../lib/story-model";
import { storySchema, type Story } from "../schemas/story";

export const SFX_DIR = "assets/sfx";

// The effects in assets/sfx, described for the writer who picks them.
export const SFX: Record<string, string> = {
  knock: "three knocks on a wooden door",
  door_creak: "a door creaking open slowly",
  door_open: "a door latch opening",
  door_slam: "a door shutting hard",
  door_handle: "a locked door handle being tried",
  lock: "a lock clicking",
  drag: "something heavy scraping across the floor",
  footsteps: "slow footsteps",
  heartbeat: "a slow, heavy heartbeat",
  heartbeat_fast: "a racing heartbeat",
  breath: "frightened breathing",
  wood_crack: "a sharp crack of wood",
  keys: "keys jingling",
  stinger: "a deep sudden hit, for a moment of shock",
};

// Effects whose licence requires a credit in the video description.
export const SFX_CREDITS: Record<string, string> = {
  breath: "Sound effects: Little Robot Sound Factory (www.littlerobotsoundfactory.com), CC-BY 3.0",
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
  const prompt = `You are the sound designer of a short Egyptian horror video. Each scene lasts about 5 seconds and already has voice and music.

Available sound effects:
${Object.entries(SFX).map(([tag, description]) => `- "${tag}": ${description}`).join("\n")}

Scenes:
${JSON.stringify(scenes)}

For each scene choose ONE effect, or null.
- Use an effect only where that sound actually happens in the scene (someone knocks, a door moves, something is dragged, he is terrified…).
- Between a third and a half of the scenes get an effect; the rest are null. Silence is part of horror.
- "stinger" at most twice, on the biggest shocks. Do not use the same effect in two scenes in a row.

Return ONLY JSON: {"sfx": [...]} with exactly ${scenes.length} entries, each an effect name or null.`;
  try {
    const { data } = await writeJson(prompt);
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
