import { isAxiosError } from "axios";
import { googleAuthHttp, uploadHttp, youtubeHttp } from "../lib/http";

export type YoutubeClient = { clientId: string; clientSecret: string };

function describeError(error: unknown): Error {
  if (isAxiosError(error)) {
    return new Error(`YouTube API ${error.response?.status ?? error.code}: ${(JSON.stringify(error.response?.data) ?? error.message).slice(0, 400)}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export type ExchangeCodePayload = YoutubeClient & {
  // The one-time code Google sends back after the owner allows access.
  code: string;
  redirectUri: string;
};

export type ExchangeCodeResponse = { accessToken: string; refreshToken: string };

// Trades the one-time code for tokens. The refresh token is only returned when consent was asked for again.
export async function exchangeCode(payload: ExchangeCodePayload): Promise<ExchangeCodeResponse> {
  try {
    const response = await googleAuthHttp.post<{ access_token: string; refresh_token?: string }>(
      "/token",
      new URLSearchParams({
        code: payload.code,
        client_id: payload.clientId,
        client_secret: payload.clientSecret,
        redirect_uri: payload.redirectUri,
        grant_type: "authorization_code",
      }),
    );
    if (!response.data.refresh_token) throw new Error("Google returned no refresh token. Remove the app's access in your Google account and connect again.");
    return { accessToken: response.data.access_token, refreshToken: response.data.refresh_token };
  } catch (error) {
    throw describeError(error);
  }
}

export type RefreshAccessPayload = YoutubeClient & { refreshToken: string };

// Gets an access token that is good for about an hour.
export async function refreshAccessToken(payload: RefreshAccessPayload): Promise<string> {
  try {
    const response = await googleAuthHttp.post<{ access_token: string }>(
      "/token",
      new URLSearchParams({
        client_id: payload.clientId,
        client_secret: payload.clientSecret,
        refresh_token: payload.refreshToken,
        grant_type: "refresh_token",
      }),
    );
    return response.data.access_token;
  } catch (error) {
    throw describeError(error);
  }
}

export type YoutubeChannel = { id: string; title: string; url: string };

// The channel the access token uploads to.
export async function getOwnChannel(accessToken: string): Promise<YoutubeChannel> {
  try {
    const response = await youtubeHttp.get<{ items?: { id: string; snippet: { title: string; customUrl?: string } }[] }>("/youtube/v3/channels", {
      params: { part: "snippet", mine: true },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const channel = response.data.items?.[0];
    if (!channel) throw new Error("This Google account has no YouTube channel. Create one on youtube.com first.");
    return { id: channel.id, title: channel.snippet.title, url: `https://www.youtube.com/${channel.snippet.customUrl ?? `channel/${channel.id}`}` };
  } catch (error) {
    throw describeError(error);
  }
}

export type UploadVideoPayload = {
  accessToken: string;
  // Path of the finished video on disk.
  videoPath: string;
  // YouTube allows 100 characters.
  title: string;
  description: string;
  tags?: string[];
};

export type UploadVideoResponse = {
  videoId: string;
  url: string;
  // What YouTube actually set. It can come back "private" for an API project YouTube has not reviewed,
  // whatever was asked for.
  privacy: "public" | "unlisted" | "private";
};

// Uploads a video as public, in Google's two steps: describe it, then send the bytes.
export async function uploadVideo(payload: UploadVideoPayload): Promise<UploadVideoResponse> {
  try {
    const file = Bun.file(payload.videoPath);
    const start = await youtubeHttp.post(
      "/upload/youtube/v3/videos",
      {
        snippet: {
          title: payload.title.slice(0, 100),
          description: payload.description.slice(0, 4900),
          tags: payload.tags,
          // Entertainment.
          categoryId: "24",
          defaultLanguage: "ar",
          defaultAudioLanguage: "ar",
        },
        // The videos are AI-made and say so, which YouTube asks uploaders to declare.
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false, containsSyntheticMedia: true },
      },
      {
        params: { uploadType: "resumable", part: "snippet,status" },
        headers: {
          Authorization: `Bearer ${payload.accessToken}`,
          "X-Upload-Content-Type": "video/mp4",
          "X-Upload-Content-Length": String(file.size),
        },
      },
    );
    const uploadUrl = start.headers.location as string | undefined;
    if (!uploadUrl) throw new Error("YouTube did not open an upload");

    const sent = await uploadHttp.put<{ id: string; status?: { privacyStatus?: UploadVideoResponse["privacy"] } }>(uploadUrl, Buffer.from(await file.arrayBuffer()), {
      headers: { Authorization: `Bearer ${payload.accessToken}`, "Content-Type": "video/mp4" },
    });
    return { videoId: sent.data.id, url: `https://www.youtube.com/watch?v=${sent.data.id}`, privacy: sent.data.status?.privacyStatus ?? "private" };
  } catch (error) {
    throw describeError(error);
  }
}
