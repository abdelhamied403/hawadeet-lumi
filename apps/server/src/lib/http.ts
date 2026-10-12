import axios from "axios";
import { config, requireGeminiKey, requireKaggle } from "../config";

function kaggleAuthHeader(): string {
  const { username, key } = requireKaggle();
  // New-style tokens are bearer tokens; legacy keys use basic auth.
  if (key.startsWith("KGAT_")) return `Bearer ${key}`;
  return `Basic ${Buffer.from(`${username}:${key}`).toString("base64")}`;
}

export const kaggleHttp = axios.create({
  baseURL: "https://www.kaggle.com/api/v1",
  timeout: 60_000,
});

kaggleHttp.interceptors.request.use((request) => {
  request.headers.set("Authorization", kaggleAuthHeader());
  return request;
});

// For pre-signed download links, which must not receive our credentials.
export const downloadHttp = axios.create({ timeout: 10 * 60_000 });

export const geminiHttp = axios.create({
  baseURL: "https://generativelanguage.googleapis.com/v1beta",
  timeout: 3 * 60_000,
});

geminiHttp.interceptors.request.use((request) => {
  request.headers.set("x-goog-api-key", requireGeminiKey());
  return request;
});

// Meta Graph API, used to publish Reels to a Facebook Page. The page token is passed per request.
export const graphHttp = axios.create({
  baseURL: "https://graph.facebook.com/v23.0",
  timeout: 2 * 60_000,
});

// Facebook's upload host for video bytes; takes a full URL per request.
export const uploadHttp = axios.create({ timeout: 20 * 60_000, maxBodyLength: Infinity });

// ntfy, which delivers alerts to the owner's phone. The topic is part of each message.
export const ntfyHttp = axios.create({ baseURL: config.NTFY_SERVER, timeout: 20_000 });
