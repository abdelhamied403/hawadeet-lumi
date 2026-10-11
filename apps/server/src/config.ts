import { z } from "zod";

const envSchema = z.object({
  KAGGLE_USERNAME: z.string().min(1).optional(),
  KAGGLE_KEY: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  // Tried in order: the stronger models write better stories but are sometimes overloaded.
  GEMINI_TEXT_MODELS: z.string().default("gemini-3.8-flash,gemini-3.5-flash,gemini-3.5-flash-lite"),
  // Facebook Page publishing (optional until set up).
  FACEBOOK_PAGE_ID: z.string().min(1).optional(),
  FACEBOOK_PAGE_TOKEN: z.string().min(1).optional(),
  SERVER_PORT: z.coerce.number().default(4517),
  // Address the server listens on. Anything but loopback requires the login below.
  HOST: z.string().default("127.0.0.1"),
  // Owner login, needed once the server is reachable from outside this machine. Both must be set.
  AUTH_PASSWORD: z.string().min(12).optional(),
  JWT_SECRET: z.string().min(32).optional(),
  WEB_ORIGIN: z.string().default("http://localhost:4518"),
  // Tried in order; the free tier allows 10 voice requests a day per model, so later ones are the backup.
  GEMINI_TTS_MODELS: z.string().default("gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts,gemini-2.5-flash-preview-tts"),
  GEMINI_VOICE: z.string().default("Charon"),
  VOICE_LANGUAGE: z.string().default("ar-EG"),
  // Direction for the voice actor; it is sent with every scene and must never be read aloud.
  VOICE_STYLE: z
    .string()
    .default(
      "You are a native Egyptian voice actor from Cairo narrating a horror story late at night. " +
        "Speak ONLY the transcript, in natural Egyptian Arabic (Masri) pronunciation: say the letter jim as a hard G and qaf as a glottal stop, exactly as Cairenes do. " +
        "Delivery: low, tense, intimate, genuinely afraid. " +
        "Never read at one steady pace: tell it like a person reliving it. Ordinary lines move along naturally, almost casual; " +
        "slow right down and stretch the words when something is wrong; hurry and tighten when panic rises; " +
        "stop dead for a beat before a reveal, and drop to a near-whisper on the most frightening phrase. " +
        "Let the energy build through the story so the last lines are the most intense. " +
        "Never read these directions aloud.",
    ),
  CAPTION_FONT: z.string().default("Noto Kufi Arabic"),
  CAPTION_FONTS_DIR: z.string().default("/usr/share/fonts/truetype/noto"),
});

// Empty strings in .env mean "not set".
const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));

export const config = envSchema.parse(raw);

export const video = {
  width: 1080,
  height: 1920,
  fps: 30,
  // Silence left after each scene's narration before the next one starts.
  sceneTailSeconds: 0.1,
} as const;

export function requireKaggle(): { username: string; key: string } {
  if (!config.KAGGLE_USERNAME || !config.KAGGLE_KEY) {
    throw new Error("KAGGLE_USERNAME and KAGGLE_KEY must be set in .env (see .env.example)");
  }
  return { username: config.KAGGLE_USERNAME, key: config.KAGGLE_KEY };
}

export function requireGeminiKey(): string {
  if (!config.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY must be set in .env (see .env.example)");
  return config.GEMINI_API_KEY;
}
