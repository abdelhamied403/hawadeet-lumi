import { isAxiosError } from "axios";
import { googleAuthHttp, uploadHttp, youtubeAnalyticsHttp, youtubeHttp } from "../lib/http";

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
  // When set (ISO time), the video stays private until then and YouTube makes it public by itself.
  publishAt?: string;
};

export type UploadVideoResponse = {
  videoId: string;
  url: string;
  // What YouTube actually set. It can come back "private" for an API project YouTube has not reviewed,
  // whatever was asked for.
  privacy: "public" | "unlisted" | "private";
};

// Uploads a video, public at once or at `publishAt`, in Google's two steps: describe it, then send the bytes.
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
          // Film & Animation.
          categoryId: "1",
          defaultLanguage: "ar",
          defaultAudioLanguage: "ar",
        },
        // The videos are for children, which YouTube requires uploaders to declare (it turns off comments and
        // personalised ads). They are clearly animated cartoons, which YouTube's altered-or-synthetic label
        // does not cover: it is for content a viewer could take for real people, places or events.
        status: {
          privacyStatus: payload.publishAt ? "private" : "public",
          ...(payload.publishAt ? { publishAt: payload.publishAt } : {}),
          selfDeclaredMadeForKids: true,
          containsSyntheticMedia: false,
        },
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

export type ScheduleVideoPayload = { accessToken: string; videoId: string; publishAt: string | null };

// Moves a private video's public time; null keeps it private with no time, so it never goes public by itself.
export async function scheduleVideo(payload: ScheduleVideoPayload): Promise<void> {
  try {
    await youtubeHttp.put(
      "/youtube/v3/videos",
      {
        id: payload.videoId,
        status: {
          privacyStatus: "private",
          ...(payload.publishAt ? { publishAt: payload.publishAt } : {}),
          selfDeclaredMadeForKids: true,
          containsSyntheticMedia: false,
        },
      },
      { params: { part: "status" }, headers: { Authorization: `Bearer ${payload.accessToken}` } },
    );
  } catch (error) {
    throw describeError(error);
  }
}

export type UpdateVideoTextPayload = { accessToken: string; videoId: string; title: string; description: string; tags?: string[] };

// Rewrites a video's title and description (YouTube needs the category sent again with them).
export async function updateVideoText(payload: UpdateVideoTextPayload): Promise<void> {
  try {
    await youtubeHttp.put(
      "/youtube/v3/videos",
      {
        id: payload.videoId,
        snippet: {
          title: payload.title.slice(0, 100),
          description: payload.description.slice(0, 4900),
          tags: payload.tags,
          categoryId: "1",
          defaultLanguage: "ar",
          defaultAudioLanguage: "ar",
        },
      },
      { params: { part: "snippet" }, headers: { Authorization: `Bearer ${payload.accessToken}` } },
    );
  } catch (error) {
    throw describeError(error);
  }
}

export type CreatePlaylistPayload = { accessToken: string; title: string; description: string };

// A public playlist on the channel; returns its id.
export async function createPlaylist(payload: CreatePlaylistPayload): Promise<string> {
  try {
    const response = await youtubeHttp.post<{ id: string }>(
      "/youtube/v3/playlists",
      {
        snippet: { title: payload.title.slice(0, 150), description: payload.description.slice(0, 4900), defaultLanguage: "ar" },
        status: { privacyStatus: "public" },
      },
      { params: { part: "snippet,status" }, headers: { Authorization: `Bearer ${payload.accessToken}` } },
    );
    return response.data.id;
  } catch (error) {
    throw describeError(error);
  }
}

export type AddToPlaylistPayload = { accessToken: string; playlistId: string; videoId: string; position?: number };

export async function addToPlaylist(payload: AddToPlaylistPayload): Promise<void> {
  try {
    await youtubeHttp.post(
      "/youtube/v3/playlistItems",
      {
        snippet: {
          playlistId: payload.playlistId,
          resourceId: { kind: "youtube#video", videoId: payload.videoId },
          ...(payload.position === undefined ? {} : { position: payload.position }),
        },
      },
      { params: { part: "snippet" }, headers: { Authorization: `Bearer ${payload.accessToken}` } },
    );
  } catch (error) {
    throw describeError(error);
  }
}

export type SetThumbnailPayload = { accessToken: string; videoId: string; imagePath: string };

// Sets a video's cover picture (JPEG under 2 MB). Only a channel verified by phone may set its own.
export async function setThumbnail(payload: SetThumbnailPayload): Promise<void> {
  try {
    await uploadHttp.post("https://www.googleapis.com/upload/youtube/v3/thumbnails/set", Buffer.from(await Bun.file(payload.imagePath).arrayBuffer()), {
      params: { videoId: payload.videoId, uploadType: "media" },
      headers: { Authorization: `Bearer ${payload.accessToken}`, "Content-Type": "image/jpeg" },
    });
  } catch (error) {
    throw describeError(error);
  }
}

export type ChannelStats = {
  title: string;
  subscribers: number;
  views: number;
  // The playlist that holds every upload of the channel.
  uploadsPlaylistId: string;
};

// The connected channel's audience and total views.
export async function getChannelStats(accessToken: string): Promise<ChannelStats> {
  try {
    const response = await youtubeHttp.get<{
      items?: { snippet: { title: string }; statistics: { subscriberCount?: string; viewCount?: string }; contentDetails: { relatedPlaylists: { uploads: string } } }[];
    }>("/youtube/v3/channels", {
      params: { part: "snippet,statistics,contentDetails", mine: true },
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const channel = response.data.items?.[0];
    if (!channel) throw new Error("This Google account has no YouTube channel");
    return {
      title: channel.snippet.title,
      subscribers: Number(channel.statistics.subscriberCount ?? 0),
      views: Number(channel.statistics.viewCount ?? 0),
      uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
    };
  } catch (error) {
    throw describeError(error);
  }
}

export type ChannelVideo = {
  id: string;
  title: string;
  publishedAt: string;
  lengthSeconds: number;
  url: string;
  views: number;
  likes: number;
  comments: number;
};

// "PT1M2S" -> 62
function isoSeconds(duration: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration);
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : 0;
}

// The channel's newest uploads (up to 50) with their public counts.
export async function listChannelVideos(payload: { accessToken: string; uploadsPlaylistId: string }): Promise<ChannelVideo[]> {
  try {
    const headers = { Authorization: `Bearer ${payload.accessToken}` };
    const uploads = await youtubeHttp.get<{ items?: { contentDetails: { videoId: string } }[] }>("/youtube/v3/playlistItems", {
      params: { part: "contentDetails", playlistId: payload.uploadsPlaylistId, maxResults: 50 },
      headers,
    });
    const ids = (uploads.data.items ?? []).map((item) => item.contentDetails.videoId);
    if (ids.length === 0) return [];
    const videos = await youtubeHttp.get<{
      items?: {
        id: string;
        snippet: { title: string; publishedAt: string };
        contentDetails: { duration: string };
        statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
      }[];
    }>("/youtube/v3/videos", { params: { part: "snippet,contentDetails,statistics", id: ids.join(","), maxResults: 50 }, headers });
    return (videos.data.items ?? []).map((video) => ({
      id: video.id,
      title: video.snippet.title,
      publishedAt: video.snippet.publishedAt,
      lengthSeconds: isoSeconds(video.contentDetails.duration),
      url: `https://www.youtube.com/watch?v=${video.id}`,
      views: Number(video.statistics.viewCount ?? 0),
      likes: Number(video.statistics.likeCount ?? 0),
      comments: Number(video.statistics.commentCount ?? 0),
    }));
  } catch (error) {
    throw describeError(error);
  }
}

export type VideoWatchStats = {
  averageWatchSeconds: number;
  // Average share of the video that was watched, 0 to 1.
  averageWatchedShare: number;
  subscribersGained: number;
};

export type VideoWatchPayload = {
  accessToken: string;
  videoIds: string[];
  // Both yyyy-MM-dd.
  startDate: string;
  endDate: string;
};

// Watch time per video over a date range, keyed by video id. YouTube's own numbers run a day or two behind,
// so a new video is missing until they catch up. Needs the yt-analytics.readonly permission.
export async function getVideoWatchStats(payload: VideoWatchPayload): Promise<Record<string, VideoWatchStats>> {
  if (payload.videoIds.length === 0) return {};
  try {
    const response = await youtubeAnalyticsHttp.get<{ rows?: [string, number, number, number][] }>("/v2/reports", {
      params: {
        ids: "channel==MINE",
        startDate: payload.startDate,
        endDate: payload.endDate,
        dimensions: "video",
        metrics: "averageViewDuration,averageViewPercentage,subscribersGained",
        filters: `video==${payload.videoIds.join(",")}`,
      },
      headers: { Authorization: `Bearer ${payload.accessToken}` },
    });
    return Object.fromEntries(
      (response.data.rows ?? []).map(([id, seconds, percentage, gained]) => [id, { averageWatchSeconds: seconds, averageWatchedShare: percentage / 100, subscribersGained: gained }]),
    );
  } catch (error) {
    throw describeError(error);
  }
}
