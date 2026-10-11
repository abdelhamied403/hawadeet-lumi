import { config } from "../config";
import { generateJson, ModelUnavailableError, QuotaExceededError } from "../services/gemini";

// Asks the configured text models in order and returns the first reply, parsed as JSON.
export async function writeJson(prompt: string, audio?: Buffer, images?: Buffer[]): Promise<{ data: unknown; model: string }> {
  const models = config.GEMINI_TEXT_MODELS.split(",").map((model) => model.trim()).filter(Boolean);
  let lastError: unknown = new Error("No text model is configured");
  for (const model of models) {
    try {
      return { data: await generateJson({ model, prompt, audio, images }), model };
    } catch (error) {
      if (!(error instanceof ModelUnavailableError) && !(error instanceof QuotaExceededError)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
