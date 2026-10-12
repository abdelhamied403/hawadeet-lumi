import { config } from "../config";
import { generateJson, ModelUnavailableError, QuotaExceededError } from "../services/gemini";

// How many times one model is asked before its broken JSON counts as a failure.
const JSON_ATTEMPTS = 3;

export type WriteOptions = {
  // For routine work (checking, proofreading): the lightest model is asked first, which keeps the
  // few daily requests of the strongest ones for writing.
  light?: boolean;
};

export function textModels(): string[] {
  return config.GEMINI_TEXT_MODELS.split(",").map((model) => model.trim()).filter(Boolean);
}

// Asks the configured text models in order and returns the first reply, parsed as JSON.
export async function writeJson(prompt: string, audio?: Buffer, images?: Buffer[], options: WriteOptions = {}): Promise<{ data: unknown; model: string }> {
  const models = options.light ? textModels().reverse() : textModels();
  let lastError: unknown = new Error("No text model is configured");
  for (const model of models) {
    for (let attempt = 1; attempt <= JSON_ATTEMPTS; attempt += 1) {
      try {
        return { data: await generateJson({ model, prompt, audio, images }), model };
      } catch (error) {
        lastError = error;
        // A reply that is not valid JSON is a slip of that one reply: ask the same model again.
        if (error instanceof SyntaxError) continue;
        if (!(error instanceof ModelUnavailableError) && !(error instanceof QuotaExceededError)) throw error;
        break;
      }
    }
  }
  throw lastError;
}
