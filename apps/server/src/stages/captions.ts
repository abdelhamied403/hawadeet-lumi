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

// The headline sits near the top, under the story's title and clear of the platforms' own header, and fades out with the first scene.
const HOOK_STYLE = `Hook,${config.CAPTION_FONT},96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,7,2,8,200,200,170,1`;
const HOOK_FADE_MS = 300;

export type Hook = { text: string; end: number };

// The story's name and chapter number glow above the headline during the first scene: pale gold letters
// over a blurred amber halo, popping in with a small bounce.
// No letter spacing: libass stops joining Arabic letters when it is set, and the title comes out backwards.
const TITLE_STYLE = `Title,${config.CAPTION_FONT},68,&H00B8E9FF,&H00B8E9FF,&H00101010,&H00000000,1,0,0,0,100,100,0,0,1,3,0,8,200,200,60,1`;
const TITLE_GLOW = "\\1c&H3BA2E9&\\3c&H1E7AF0&\\bord18\\blur10";
const TITLE_POP = "\\fscx40\\fscy40\\t(0,220,\\fscx112\\fscy112)\\t(220,360,\\fscx100\\fscy100)";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export type Title = { text: string; end: number };

function titleEvents(title: Title): string[] {
  const text = cleanWord(title.text.replace(/\s*\|\s*/g, " · ").replace(/[0-9]/g, (digit) => ARABIC_DIGITS[Number(digit)]!));
  if (!text) return [];
  const span = `${timestamp(0)},${timestamp(title.end)}`;
  return [
    `Dialogue: 2,${span},Title,,0,0,0,,{\\fad(0,${HOOK_FADE_MS})${TITLE_GLOW}${TITLE_POP}}${text}`,
    `Dialogue: 3,${span},Title,,0,0,0,,{\\fad(0,${HOOK_FADE_MS})${TITLE_POP}}${text}`,
  ];
}

// Twinkling stars for a magical moment: small four-pointed stars drawn as shapes (so no font is needed),
// each fading in, growing a little and fading out at its own time and place, away from the captions.
const FX_STYLE = "Fx,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1";
const STAR = "m 0 -24 l 6 -6 l 24 0 l 6 6 l 0 24 l -6 6 l -24 0 l -6 -6";
const STAR_COLOURS = ["&H9BEFFF&", "&HFFFFFF&", "&HB8E9FF&"];
const STARS_PER_SECOND = 7;

export type Span = { start: number; end: number };

export function buildSparkles(spans: Span[]): string[] {
  const events: string[] = [];
  for (const span of spans) {
    const count = Math.max(4, Math.round((span.end - span.start) * STARS_PER_SECOND));
    for (let index = 0; index < count; index++) {
      // Fixed pseudo-random spread, so a rebuilt video sparkles the same way.
      const seed = (index * 7919 + Math.round(span.start * 1000)) % 10007;
      const x = 120 + ((seed * 37) % (video.width - 240));
      const y = 90 + ((seed * 53) % Math.round(video.height * 0.62));
      const start = span.start + ((seed % 1000) / 1000) * Math.max(0.1, span.end - span.start - 0.8);
      const life = 0.6 + (seed % 5) / 10;
      const scale = 110 + (seed % 7) * 18;
      const colour = STAR_COLOURS[seed % STAR_COLOURS.length];
      const ms = Math.round(life * 1000);
      events.push(
        `Dialogue: 4,${timestamp(start)},${timestamp(start + life)},Fx,,0,0,0,,{\\an5\\pos(${x},${y})\\1c${colour}\\blur2\\fscx${scale}\\fscy${scale}\\fad(${Math.round(ms * 0.4)},${Math.round(ms * 0.5)})\\t(0,${ms},\\fscx${scale + 40}\\fscy${scale + 40}\\frz45)\\p1}${STAR}{\\p0}`,
      );
    }
  }
  return events;
}

// A full-screen card (the story's opening and its ending): lines of large text in the middle of the
// picture, each popping in shortly after the one before, and fading out at the end.
const CARD_STYLE = `Card,${config.CAPTION_FONT},110,&H00FFFFFF,&H00FFFFFF,&H00101010,&H96000000,1,0,0,0,100,100,0,0,1,8,3,5,120,120,0,1`;

export function buildCard(lines: { text: string; size?: number; gold?: boolean }[], seconds: number, size: { width: number; height: number } = video): string {
  const lineGap = size.height * 0.16;
  const top = size.height / 2 - ((lines.length - 1) * lineGap) / 2;
  const events = lines.flatMap((line, index) => {
    const text = cleanWord(line.text);
    if (!text) return [];
    const start = 0.15 + index * 0.45;
    const position = `\\pos(${Math.round(size.width / 2)},${Math.round(top + index * lineGap)})`;
    const look = `${line.size ? `\\fs${line.size}` : ""}${line.gold ? TITLE_GLOW : ""}`;
    return [
      ...(line.gold ? [`Dialogue: 2,${timestamp(start)},${timestamp(seconds)},Card,,0,0,0,,{${position}\\fad(0,300)${look}${TITLE_POP}}${text}`] : []),
      `Dialogue: 3,${timestamp(start)},${timestamp(seconds)},Card,,0,0,0,,{${position}\\fad(0,300)${line.size ? `\\fs${line.size}` : ""}${TITLE_POP}}${text}`,
    ];
  });
  return assFile(size, [CARD_STYLE], events);
}

function assFile(size: { width: number; height: number }, styles: string[], events: string[]): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${size.width}`,
    `PlayResY: ${size.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles.map((style) => `Style: ${style}`),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

export function buildAss(captions: Caption[], hook?: Hook, title?: Title, effects: string[] = []): string {
  const style = [
    "Caption",
    config.CAPTION_FONT,
    80, // font size
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
    200,
    200,
    80, // near the bottom of the wide frame
    1,
  ].join(",");

  const events = captions.map(
    (caption) => `Dialogue: 0,${timestamp(caption.start)},${timestamp(caption.end)},Caption,,0,0,0,,${caption.text}`,
  );

  return assFile({ width: video.width, height: video.height }, [style, HOOK_STYLE, TITLE_STYLE, FX_STYLE], [
    ...(hook && cleanWord(hook.text) ? [`Dialogue: 1,${timestamp(0)},${timestamp(hook.end)},Hook,,0,0,0,,{\\fad(0,${HOOK_FADE_MS})}${cleanWord(hook.text)}`] : []),
    ...(title ? titleEvents(title) : []),
    ...events,
    ...effects,
  ]);
}
