import { config } from "../config";
import { generateJson, ModelUnavailableError, QuotaExceededError } from "../services/gemini";

// How many times one model is asked before its broken JSON counts as a failure.
const JSON_ATTEMPTS = 3;

// Asks the configured text models in order and returns the first reply, parsed as JSON.
export async function writeJson(prompt: string, audio?: Buffer, images?: Buffer[]): Promise<{ data: unknown; model: string }> {
  const models = config.GEMINI_TEXT_MODELS.split(",").map((model) => model.trim()).filter(Boolean);
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
