import type { StoryInput } from "../schemas/story";

// Hand-written story for the sample video, so the sample needs no story-writing service.
export const sampleStory: StoryInput = {
  title: "الباب اللي عمره ما كان موجود",
  description: "يوسف رجع بيت جدّه المهجور، ولقى باب عمره ما شافه قبل كده.",
  hashtags: ["#رعب", "#قصص_رعب", "#قصص_مرعبة"],
  characterSheet:
    "Youssef, an Egyptian man in his early thirties, short black hair, light stubble, tired dark eyes, wearing a worn dark grey jacket over a black shirt",
  styleSheet:
    "cinematic horror film still, photorealistic, 35mm, shallow depth of field, cold desaturated teal and grey palette, low-key lighting, deep shadows, light fog, film grain, vertical composition",
  seed: 1234,
  scenes: [
    {
      narration: "في ليلة ضلمة… يوسف رجع بيت جدّه المهجور، بعد عشرين سنة.",
      imagePrompt:
        "wide shot from behind of the man standing before a decaying two-storey old Egyptian house at night, broken wooden shutters, overgrown yard, a single dim moon behind clouds, thick ground fog",
      motionPrompt:
        "The man walks slowly toward the front door of the old house. Fog drifts across the ground, the tree branches sway slightly, the camera pushes in slowly behind him.",
    },
    {
      narration: "كل حاجة كانت زي ما سابها… إلا باب واحد، عمره ما كان موجود قبل كده.",
      imagePrompt:
        "the man holding a flashlight in a narrow dusty corridor with peeling wallpaper and old framed photographs, at the far end an old dark wooden door with faint light leaking from under it",
      motionPrompt:
        "The flashlight beam trembles and sweeps across the wall, dust floats through the light, the man takes a slow careful step forward toward the door.",
    },
    {
      narration: "ومن ورا الباب… سمع صوت بيهمس باسمه. صوت جدّه… اللي مات.",
      imagePrompt:
        "extreme close-up of the man's face in profile, his ear close to the dark wooden door, eyes wide with fear, cold sweat on his forehead, lit only by a weak flashlight from below",
      motionPrompt:
        "He slowly leans closer to the door, his eyes widen, his breathing quickens and a faint breath of mist leaves his mouth. The light flickers.",
    },
    {
      narration: "مدّ إيده عشان يفتح الباب… بس الباب اتفتح من جوّه الأول.",
      imagePrompt:
        "close-up of the man's trembling hand reaching for a rusty brass door handle, the door slightly ajar with pitch-black darkness in the gap, long pale thin fingers gripping the door edge from inside",
      motionPrompt:
        "The door creaks open slowly on its own, the pale fingers curl around the edge of the door, the man's hand freezes in the air and pulls back.",
    },
  ],
};
