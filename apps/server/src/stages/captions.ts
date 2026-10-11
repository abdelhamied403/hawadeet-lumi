import { config, video } from "../config";
import { HERO, NARRATOR } from "../schemas/story";
import type { SceneVoice } from "./voice";

const WORDS_PER_CAPTION = 3;

// Arabic vowel marks help the voice but clutter on-screen text.
const DIACRITICS = /[ً-ْٰ]/g;

type Caption = { start: number; end: number; text: string };

function timestamp(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor((centiseconds % 360_000) / 6000);
  const rest = ((centiseconds % 6000) / 100).toFixed(2).padStart(5, "0");
  return `${hours}:${String(minutes).padStart(2, "0")}:${rest}`;
}

function cleanWord(text: string): string {
  return text.replace(DIACRITICS, "").replace(/[{}\\]/g, "").trim();
}

// Character lines are tinted so the viewer can tell who is speaking; the narrator stays white.
const CHARACTER_COLOUR = "{\\c&H3BA2E9&}";

// sceneStarts[i] is where scene i begins in the final video; sceneEnds[i] is where it ends.
export function buildCaptions(voices: SceneVoice[], sceneStarts: number[], sceneEnds: number[]): Caption[] {
  const captions: Caption[] = [];
  voices.forEach((voice, sceneIndex) => {
    const offset = sceneStarts[sceneIndex] ?? 0;
    const sceneEnd = sceneEnds[sceneIndex] ?? offset + voice.duration;
    const words = voice.words.map((word) => ({ ...word, text: cleanWord(word.text) })).filter((word) => word.text);

    // Up to three words per caption, never mixing two speakers in one.
    const groups: (typeof words)[] = [];
    for (const word of words) {
      const current = groups.at(-1);
      if (current && current.length < WORDS_PER_CAPTION && current[0]?.speaker === word.speaker) current.push(word);
      else groups.push([word]);
    }

    groups.forEach((group, index) => {
      const first = group[0];
      const last = group.at(-1);
      if (!first || !last) return;
      const next = groups[index + 1]?.[0];
      // Hold each caption until the next one starts, so the text never flickers off mid-sentence.
      const end = next ? offset + next.start : Math.min(sceneEnd, offset + last.end + 0.25);
      const tint = first.speaker && first.speaker !== NARRATOR && first.speaker !== HERO ? CHARACTER_COLOUR : "";
      captions.push({ start: offset + first.start, end, text: tint + group.map((word) => word.text).join(" ") });
    });
  });
  return captions;
}

export function buildAss(captions: Caption[]): string {
  const style = [
    "Caption",
    config.CAPTION_FONT,
    96, // font size
    "&H00FFFFFF", // text colour
    "&H00FFFFFF",
    "&H00000000", // outline colour
    "&H96000000", // shadow colour
    1, // bold
    0,
    0,
    0,
    100,
    100,
    0,
    0,
    1,
    6, // outline width
    2, // shadow depth
    2, // bottom centre
    80,
    80,
    520, // lifted above the platforms' own buttons and captions
    1,
  ].join(",");

  const events = captions.map(
    (caption) => `Dialogue: 0,${timestamp(caption.start)},${timestamp(caption.end)},Caption,,0,0,0,,${caption.text}`,
  );

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${video.width}`,
    `PlayResY: ${video.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: ${style}`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
