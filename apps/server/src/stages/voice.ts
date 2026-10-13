import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { config } from "../config";
import { ffmpeg, mediaDuration } from "../lib/ffmpeg";
import { loadStory, paths } from "../lib/project";
import { writeJson } from "../lib/story-model";
import { HERO, NARRATOR, type Story } from "../schemas/story";
import { QuotaExceededError, synthesizeDialogue, synthesizeSpeech } from "../services/gemini";

const wordTimingSchema = z.object({
  text: z.string(),
  // Seconds from the start of the scene's audio.
  start: z.number(),
  end: z.number(),
  // Who says it; absent in recordings made before dialogue existed.
  speaker: z.string().optional(),
});

export const sceneVoiceSchema = z.object({
  duration: z.number(),
  words: z.array(wordTimingSchema),
});

export type WordTiming = z.infer<typeof wordTimingSchema>;
export type SceneVoice = z.infer<typeof sceneVoiceSchema>;

type Interval = { start: number; end: number };
// One spoken line and where it sits in the story (scene and line numbers start at 1).
type ScriptLine = { scene: number; line: number; speaker: string; text: string };
// One recording: every line it contains is spoken by one of its (one or two) voices.
export type Take = { name: string; lines: ScriptLine[] };

const DIACRITICS = /[ً-ْٰ]/g;
const SILENCE_FILTER = "silencedetect=noise=-38dB:d=0.22";
// Evens out a recording whose loudness jumps between lines, without flattening whispers completely.
const LEVEL_FILTER = "dynaudnorm=f=400:g=15:m=5:p=0.9";
// How far a cut may move from its estimated time to land in a pause.
const SNAP_WINDOW_SECONDS = 1.5;
const MP3 = ["-c:a", "libmp3lame", "-b:a", "128k"];

async function detectSilences(audioPath: string, duration: number): Promise<Interval[]> {
  const stderr = await ffmpeg(["-i", audioPath, "-af", SILENCE_FILTER, "-f", "null", "-"]);
  const starts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((match) => Math.max(0, Number(match[1])));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((match) => Number(match[1]));
  return starts.map((start, index) => ({ start, end: ends[index] ?? duration }));
}

function speechWithin(silences: Interval[], from: number, to: number): Interval[] {
  const speech: Interval[] = [];
  let cursor = from;
  for (const silence of silences) {
    if (silence.end <= from || silence.start >= to) continue;
    if (silence.start > cursor) speech.push({ start: cursor, end: silence.start });
    cursor = Math.max(cursor, silence.end);
  }
  if (cursor < to) speech.push({ start: cursor, end: to });
  return speech.length > 0 ? speech : [{ start: from, end: to }];
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.replace(/[….,،؛:!؟?"«»]/g, ""))
    .filter((token) => token.replace(DIACRITICS, "").length > 0);
}

function weight(token: string): number {
  return token.replace(DIACRITICS, "").length + 1;
}

// The voice service gives no word timings, so words are spread over the spoken parts of the audio
// (pauses skipped) in proportion to their length. Close enough for 3-word captions.
function estimateWords(tokens: string[], speech: Interval[]): WordTiming[] {
  const totalWeight = tokens.reduce((sum, token) => sum + weight(token), 0) || 1;
  const totalSpeech = speech.reduce((sum, interval) => sum + (interval.end - interval.start), 0);

  // Converts a position measured in spoken seconds back to a position in the real audio.
  const toAudioTime = (spoken: number): number => {
    let remaining = spoken;
    for (const interval of speech) {
      const length = interval.end - interval.start;
      if (remaining <= length) return interval.start + remaining;
      remaining -= length;
    }
    return speech.at(-1)?.end ?? spoken;
  };

  let cursor = 0;
  return tokens.map((token) => {
    const length = (weight(token) / totalWeight) * totalSpeech;
    const word = { text: token, start: toAudioTime(cursor), end: toAudioTime(cursor + length) };
    cursor += length;
    return word;
  });
}

// Fallback for finding where each line starts: estimate from word lengths, then move to the middle
// of the nearest pause, since lines end on sentence breaks.
function estimateLineStarts(lineTokens: string[][], silences: Interval[], duration: number): number[] {
  const estimated = estimateWords(lineTokens.flat(), speechWithin(silences, 0, duration));
  const starts = [0];
  let wordIndex = 0;
  for (let line = 1; line < lineTokens.length; line++) {
    wordIndex += lineTokens[line - 1]?.length ?? 0;
    const estimate = estimated[wordIndex]?.start ?? duration;
    const previous = starts.at(-1) ?? 0;
    const pauses = silences
      .map((silence) => ({ middle: (silence.start + silence.end) / 2, length: silence.end - silence.start }))
      .filter((pause) => pause.middle > previous + 0.5 && Math.abs(pause.middle - estimate) <= SNAP_WINDOW_SECONDS);
    // Longer pauses are more likely to be sentence ends, so distance is discounted by pause length.
    const best = pauses.sort(
      (a, b) => Math.abs(a.middle - estimate) - a.length - (Math.abs(b.middle - estimate) - b.length),
    )[0];
    starts.push(best ? best.middle : Math.max(estimate, previous + 0.5));
  }
  return starts;
}

// Asks a model to listen to the recording and say when each line starts, then moves each answer into
// the pause it falls next to. Far more accurate than estimating from word lengths when the pace varies.
// Returns null when the answer cannot be trusted, so the caller can fall back to the estimate.
async function hearLineStarts(audioPath: string, lines: string[], silences: Interval[], duration: number): Promise<number[] | null> {
  if (lines.length === 1) return [0];
  const prompt = `This audio is a recording of these ${lines.length} lines spoken in order, in Egyptian Arabic (one or two different voices):
${JSON.stringify(lines)}

Return ONLY JSON: {"starts": [seconds, ...]} with exactly ${lines.length} numbers: the time in seconds (one decimal) at which each line STARTS being spoken.`;
  try {
    const { data } = await writeJson(prompt, Buffer.from(await Bun.file(audioPath).arrayBuffer()));
    const heard = (data as { starts?: unknown }).starts;
    if (!Array.isArray(heard) || heard.length !== lines.length || !heard.every((value) => typeof value === "number")) return null;
    const times = heard as number[];
    const ordered = times.every((time, index) => index === 0 || time > (times[index - 1] as number) + 0.3);
    if (!ordered || (times[0] as number) > 2 || (times.at(-1) as number) >= duration) return null;

    return times.map((time, index) => {
      if (index === 0) return 0;
      // A line starts where a pause ends; cut in the middle of that pause.
      const pause = silences
        .filter((silence) => Math.abs(silence.end - time) <= 1)
        .sort((a, b) => Math.abs(a.end - time) - Math.abs(b.end - time))[0];
      return pause ? (pause.start + pause.end) / 2 : Math.max(0, time - 0.1);
    });
  } catch {
    return null;
  }
}

function scriptLines(story: Story): ScriptLine[] {
  return story.scenes.flatMap((scene, sceneIndex) =>
    scene.lines.map((line, lineIndex) => ({ scene: sceneIndex + 1, line: lineIndex + 1, speaker: line.speaker, text: line.text })),
  );
}

// The voice service takes at most two voices per recording. The main recording holds the narrator and
// the character with the most lines; any other character gets a recording of their own.
function planTakes(story: Story): Take[] {
  const lines = scriptLines(story);
  const counts = new Map<string, number>();
  for (const line of lines) if (!sameVoiceAsNarrator(line.speaker)) counts.set(line.speaker, (counts.get(line.speaker) ?? 0) + 1);
  const others = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([speaker]) => speaker);
  const lead = others[0];
  const takes: Take[] = [{ name: "main", lines: lines.filter((line) => sameVoiceAsNarrator(line.speaker) || line.speaker === lead) }];
  for (const speaker of others.slice(1)) takes.push({ name: speaker, lines: lines.filter((line) => line.speaker === speaker) });
  return takes.filter((take) => take.lines.length > 0);
}

// The narrator and the main character speaking in a scene are one person, so one voice.
function sameVoiceAsNarrator(speaker: string): boolean {
  return speaker === NARRATOR || speaker === HERO;
}

// The name a line is recorded under: lines sharing a voice must share a name in the request.
function recordingName(speaker: string): string {
  return sameVoiceAsNarrator(speaker) ? NARRATOR : speaker;
}

function voiceFor(story: Story, speaker: string): { voice: string; style: string } {
  if (speaker === NARRATOR) return { voice: config.GEMINI_VOICE, style: config.VOICE_STYLE };
  if (speaker === HERO) {
    return {
      voice: config.GEMINI_VOICE,
      style:
        "The main character of an Egyptian horror story speaking OUT LOUD to another person in the scene: a nervous young man, " +
        "natural conversational Egyptian Arabic (Cairo), not storytelling. Speak ONLY the transcript, never these directions.",
    };
  }
  const member = story.cast.find((candidate) => candidate.name === speaker);
  if (!member?.voice) throw new Error(`No voice is set for the character "${speaker}"`);
  return {
    voice: member.voice,
    style: `A character in an Egyptian horror story: ${member.role} Natural Egyptian Arabic (Cairo) pronunciation. Speak ONLY the transcript, never these directions.`,
  };
}

async function recordTake(story: Story, take: Take, audioPath: string, styleNote: string): Promise<string> {
  const speakers = [...new Set(take.lines.map((line) => recordingName(line.speaker)))];
  const note = styleNote ? ` Extra direction from the producer: ${styleNote}` : "";
  const models = config.GEMINI_TTS_MODELS.split(",").map((model) => model.trim()).filter(Boolean);

  for (const [index, model] of models.entries()) {
    try {
      const first = speakers[0] as string;
      const second = speakers[1];
      const { audio } = second
        ? await synthesizeDialogue({
            model,
            language: config.VOICE_LANGUAGE,
            speakers: [
              { name: first, voice: voiceFor(story, first).voice },
              { name: second, voice: voiceFor(story, second).voice },
            ],
            lines: take.lines.map((line) => ({
              speaker: recordingName(line.speaker),
              text: line.text,
              style: voiceFor(story, line.speaker).style + note,
            })),
          })
        : await synthesizeSpeech({
            model,
            voice: voiceFor(story, first).voice,
            language: config.VOICE_LANGUAGE,
            style: `${voiceFor(story, first).style} Leave a clear pause of about one second between lines.${note}`,
            transcript: take.lines.map((line) => line.text).join("\n\n"),
          });
      await mkdir(dirname(audioPath), { recursive: true });
      const wavPath = `${audioPath}.wav`;
      await Bun.write(wavPath, audio);
      await ffmpeg(["-i", wavPath, "-af", LEVEL_FILTER, ...MP3, audioPath]);
      await Bun.file(wavPath).delete();
      return model;
    } catch (error) {
      if (!(error instanceof QuotaExceededError) || index === models.length - 1) throw error;
      console.log(`${model} has no free requests left today; trying ${models[index + 1]}`);
    }
  }
  throw new Error("No voice model is configured");
}

type LinePiece = { duration: number; words: WordTiming[] };

// Cuts a recording into its lines and returns each line's length and word timings.
export async function cutTake(dir: string, take: Take, audioPath: string): Promise<Map<string, LinePiece>> {
  const duration = await mediaDuration(audioPath);
  const silences = await detectSilences(audioPath, duration);
  const texts = take.lines.map((line) => line.text);
  const heard = await hearLineStarts(audioPath, texts, silences, duration);
  if (!heard) console.log(`could not hear the line starts in the ${take.name} recording; estimating them from the pauses`);
  const starts = heard ?? estimateLineStarts(texts.map(tokenize), silences, duration);

  const pieces = new Map<string, LinePiece>();
  for (const [index, line] of take.lines.entries()) {
    const start = starts[index] ?? 0;
    const end = starts[index + 1] ?? duration;
    const piecePath = paths.voiceLine(dir, line.scene, line.line);
    await mkdir(dirname(piecePath), { recursive: true });
    await ffmpeg(["-i", audioPath, "-ss", start.toFixed(3), "-to", end.toFixed(3), ...MP3, piecePath]);
    const words = estimateWords(tokenize(line.text), speechWithin(silences, start, end)).map((word) => ({
      text: word.text,
      start: word.start - start,
      end: word.end - start,
      speaker: line.speaker,
    }));
    pieces.set(`${line.scene}:${line.line}`, { duration: await mediaDuration(piecePath), words });
  }
  return pieces;
}

async function concatAudio(inputs: string[], output: string): Promise<void> {
  if (inputs.length === 1) {
    await ffmpeg(["-i", inputs[0] as string, ...MP3, output]);
    return;
  }
  const labels = inputs.map((_, index) => `[${index}:a]`).join("");
  await ffmpeg([...inputs.flatMap((input) => ["-i", input]), "-filter_complex", `${labels}concat=n=${inputs.length}:v=0:a=1[a]`, "-map", "[a]", ...MP3, output]);
}

export async function loadSceneVoice(dir: string, scene: number): Promise<SceneVoice> {
  const file = Bun.file(paths.voiceTimings(dir, scene));
  if (!(await file.exists())) throw new Error(`No voice for scene ${scene}; run the voice stage first`);
  return sceneVoiceSchema.parse(await file.json());
}

async function loadExisting(dir: string, scenes: number): Promise<SceneVoice[] | null> {
  const voices: SceneVoice[] = [];
  for (let scene = 1; scene <= scenes; scene++) {
    const voice = await loadSceneVoice(dir, scene).catch(() => null);
    if (!voice) return null;
    voices.push(voice);
  }
  return voices;
}

// Records the story with as few requests as possible (the free tier allows only a handful a day),
// cuts the recordings into lines, and rebuilds one audio file per scene.
export async function runVoice(dir: string, options: { force?: boolean; styleNote?: string } = {}): Promise<SceneVoice[]> {
  const story = await loadStory(dir);
  if (!options.force) {
    const existing = await loadExisting(dir, story.scenes.length);
    if (existing) return existing;
  }

  const pieces = new Map<string, LinePiece>();
  for (const take of planTakes(story)) {
    const takePath = paths.voiceTake(dir, take.name);
    const model = await recordTake(story, take, takePath, options.styleNote ?? "");
    console.log(`${take.name} recording made with ${model} (${take.lines.length} lines)`);
    for (const [key, piece] of await cutTake(dir, take, takePath)) pieces.set(key, piece);
  }

  const voices: SceneVoice[] = [];
  for (const [index, scene] of story.scenes.entries()) {
    const number = index + 1;
    const words: WordTiming[] = [];
    let cursor = 0;
    for (const lineNumber of scene.lines.keys()) {
      const piece = pieces.get(`${number}:${lineNumber + 1}`);
      if (!piece) throw new Error(`Scene ${number} line ${lineNumber + 1} was not recorded`);
      words.push(...piece.words.map((word) => ({ ...word, start: word.start + cursor, end: word.end + cursor })));
      cursor += piece.duration;
    }
    const audioPath = paths.voiceAudio(dir, number);
    await concatAudio(scene.lines.map((_, lineIndex) => paths.voiceLine(dir, number, lineIndex + 1)), audioPath);
    const voice = { duration: await mediaDuration(audioPath), words };
    await Bun.write(paths.voiceTimings(dir, number), JSON.stringify(voice, null, 2));
    console.log(`voice ${number}/${story.scenes.length}: ${voice.duration.toFixed(2)}s, ${words.length} words`);
    voices.push(voice);
  }

  // The whole performance in story order, for listening to in one go.
  await concatAudio(story.scenes.map((_, index) => paths.voiceAudio(dir, index + 1)), paths.narration(dir));
  return voices;
}
