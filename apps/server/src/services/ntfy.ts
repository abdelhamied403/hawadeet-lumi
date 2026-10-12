import { isAxiosError } from "axios";
import { ntfyHttp } from "../lib/http";

export type SendAlertPayload = {
  topic: string;
  title: string;
  message: string;
  // Opened when the alert is tapped, e.g. a veogen:// link into the app.
  click?: string;
  // ntfy emoji short codes shown before the title.
  tags?: string[];
  // 1 (quiet) to 5 (urgent); 3 when left out.
  priority?: 1 | 2 | 3 | 4 | 5;
};

export type SendAlertResponse = { id: string; time: number };

// Publishes one alert to an ntfy topic.
export async function sendAlert(payload: SendAlertPayload): Promise<SendAlertResponse> {
  try {
    const response = await ntfyHttp.post<SendAlertResponse>("/", payload);
    return response.data;
  } catch (error) {
    if (isAxiosError(error)) {
      throw new Error(`ntfy ${error.response?.status ?? error.code}: ${(JSON.stringify(error.response?.data) ?? error.message).slice(0, 300)}`);
    }
    throw error;
  }
}
