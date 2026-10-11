import { create, isAxiosError } from "axios";

// The server's address is typed in at sign-in, so the instance starts without one.
export const veogenHttp = create({ timeout: 120_000, withCredentials: true });

let mediaToken: string | null = null;

export function setServerUrl(url: string | null): void {
  veogenHttp.defaults.baseURL = url ?? undefined;
}

export function setMediaToken(token: string | null): void {
  mediaToken = token;
}

// "veogen.example.org " -> "https://veogen.example.org"
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Turns a media path from the API into an address a player can load. Players do not send the
// session cookie, so the address carries the media token.
export function mediaUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  const token = mediaToken ? `${path.includes("?") ? "&" : "?"}t=${mediaToken}` : "";
  return `${veogenHttp.defaults.baseURL ?? ""}${path}${token}`;
}

export function isSignedOutError(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 401;
}

export function errorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
    if (!error.response) return "The server did not answer. Check the address and your connection.";
  }
  return error instanceof Error ? error.message : "Something went wrong";
}
