import { isAxiosError } from "axios";
import { geminiHttp } from "../lib/http";

export class QuotaExceededError extends Error {}

export type SynthesizeSpeechPayload = {
  model: string;
  // Prebuilt voice name, e.g. "Charon".
  voice: string;
  // BCP-47 code, e.g. "ar-EG".
  language: string;
  // Acting direction; the service is told to perform it, not read it.
  style: string;
  // The words to speak.
  transcript: string;
};

export type SynthesizeSpeechResponse = {
  // A complete WAV file.
  audio: Buffer;
  mimeType: string;
};

type GenerateContentResponse = {
  candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[];
};

// 429 is not retried: on the free tier it is the daily cap, which waiting a minute does not clear.
// The reply body when there is one, otherwise the network error (timeouts and dropped connections have no body).
function describeBody(error: { response?: { data?: unknown }; message: string }): string {
  return (JSON.stringify(error.response?.data) ?? error.message).slice(0, 400);
}

const RETRY_STATUSES = new Set([500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

type SpeechRequestBody = {
  contents: { parts: { text: string; speechMetadata?: { speaker: string; style?: string } }[] }[];
  generationConfig: { responseModalities: ["AUDIO"]; speechConfig: Record<string, unknown> };
};

async function requestSpeech(model: string, body: SpeechRequestBody): Promise<SynthesizeSpeechResponse> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { data } = await geminiHttp.post<GenerateContentResponse>(`/models/${model}:generateContent`, body);
      const inline = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
      if (!inline) throw new Error(`The voice service returned no audio: ${JSON.stringify(data).slice(0, 300)}`);
      return { audio: Buffer.from(inline.data, "base64"), mimeType: inline.mimeType };
    } catch (error) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status !== undefined && RETRY_STATUSES.has(status) && attempt < MAX_ATTEMPTS) {
        await Bun.sleep(attempt * 20_000);
        continue;
      }
      if (isAxiosError(error)) {
        const message = `Gemini API ${status ?? error.code}: ${describeBody(error)}`;
        throw status === 429 ? new QuotaExceededError(message) : new Error(message);
      }
      throw error;
    }
  }
}

// One voice reading the whole transcript.
export async function synthesizeSpeech(payload: SynthesizeSpeechPayload): Promise<SynthesizeSpeechResponse> {
  return requestSpeech(payload.model, {
    contents: [{ parts: [{ text: `${payload.style}\n\n#### TRANSCRIPT\n${payload.transcript}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        languageCode: payload.language,
        voiceConfig: { prebuiltVoiceConfig: { voiceName: payload.voice } },
      },
    },
  });
}

export type SynthesizeDialoguePayload = {
  model: string;
  language: string;
  // Exactly two speakers: the service accepts no other number.
  speakers: [{ name: string; voice: string }, { name: string; voice: string }];
  // The lines in the order they are spoken; `style` directs that speaker's delivery.
  lines: { speaker: string; text: string; style: string }[];
};

// Two voices performing an exchange in one recording.
export async function synthesizeDialogue(payload: SynthesizeDialoguePayload): Promise<SynthesizeSpeechResponse> {
  return requestSpeech(payload.model, {
    contents: [
      { parts: payload.lines.map((line) => ({ text: line.text, speechMetadata: { speaker: line.speaker, style: line.style } })) },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        languageCode: payload.language,
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: payload.speakers.map((speaker) => ({
            speaker: speaker.name,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker.voice } },
          })),
        },
      },
    },
  });
}

export class ModelUnavailableError extends Error {}

export type GenerateJsonPayload = {
  model: string;
  prompt: string;
  // An MP3 for the model to listen to alongside the prompt.
  audio?: Buffer;
  // JPEG pictures for the model to look at, in order.
  images?: Buffer[];
};

type GenerateTextResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
};

// Everything written is for small children, so Google's own filters are switched on as a safety net
// behind the prompts' rules.
const SAFETY_SETTINGS = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"].map(
  (category) => ({ category, threshold: "BLOCK_MEDIUM_AND_ABOVE" }),
);

// Returns the model's reply parsed as JSON; the caller validates its shape.
// Overload and quota errors are thrown as typed errors so the caller can move to another model.
export async function generateJson(payload: GenerateJsonPayload): Promise<unknown> {
  const body = {
    contents: [
      {
        parts: [
          ...(payload.audio ? [{ inlineData: { mimeType: "audio/mp3", data: payload.audio.toString("base64") } }] : []),
          ...(payload.images ?? []).map((image) => ({ inlineData: { mimeType: "image/jpeg", data: image.toString("base64") } })),
          { text: payload.prompt },
        ],
      },
    ],
    // Listening tasks should be repeatable; writing tasks should be varied.
    generationConfig: { responseMimeType: "application/json", temperature: payload.audio ? 0 : payload.images?.length ? 0.6 : 1 },
    safetySettings: SAFETY_SETTINGS,
  };
  try {
    const { data } = await geminiHttp.post<GenerateTextResponse>(`/models/${payload.model}:generateContent`, body);
    const candidate = data.candidates?.[0];
    // A blocked reply is a slip of that one reply, like broken JSON, so the caller asks again.
    if (candidate?.finishReason === "SAFETY") throw new SyntaxError("The reply was blocked by the safety filter");
    const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!text) throw new Error(`The story service returned no text: ${JSON.stringify(data).slice(0, 300)}`);
    return JSON.parse(text);
  } catch (error) {
    if (!isAxiosError(error)) throw error;
    const status = error.response?.status;
    const message = `Gemini API ${status ?? error.code}: ${describeBody(error)}`;
    if (status === 429) throw new QuotaExceededError(message);
    if (status === undefined || RETRY_STATUSES.has(status)) throw new ModelUnavailableError(message);
    throw new Error(message);
  }
}
