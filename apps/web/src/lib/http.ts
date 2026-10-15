import axios from "axios";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4527";

export const veogenHttp = axios.create({ baseURL: API_URL, timeout: 120_000 });

// Turns a media path from the API into a full address the browser can load.
export function mediaUrl(path: string | null): string | undefined {
  return path ? `${API_URL}${path}` : undefined;
}

export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
    if (!error.response) return "The Veogen server is not running. Start it and reload.";
  }
  return error instanceof Error ? error.message : "Something went wrong";
}
