import { isAxiosError } from "axios";
import { graphHttp, uploadHttp } from "../lib/http";

export type PublishReelPayload = {
  pageId: string;
  pageToken: string;
  // Path of the finished video on disk.
  videoPath: string;
  description: string;
};

export type PublishReelResponse = {
  videoId: string;
  url: string;
};

type StartResponse = { video_id: string; upload_url: string };

function describeError(error: unknown): Error {
  if (isAxiosError(error)) {
    return new Error(`Facebook API ${error.response?.status ?? error.code}: ${(JSON.stringify(error.response?.data) ?? error.message).slice(0, 400)}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

// Publishes a Reel to a Facebook Page in Meta's three steps: open an upload, send the bytes, publish.
export async function publishReel(payload: PublishReelPayload): Promise<PublishReelResponse> {
  try {
    const start = await graphHttp.post<StartResponse>(`/${payload.pageId}/video_reels`, null, {
      params: { upload_phase: "start", access_token: payload.pageToken },
    });

    const file = Bun.file(payload.videoPath);
    await uploadHttp.post(start.data.upload_url, Buffer.from(await file.arrayBuffer()), {
      headers: {
        Authorization: `OAuth ${payload.pageToken}`,
        offset: "0",
        file_size: String(file.size),
        "Content-Type": "application/octet-stream",
      },
    });

    await graphHttp.post(`/${payload.pageId}/video_reels`, null, {
      params: {
        upload_phase: "finish",
        video_id: start.data.video_id,
        video_state: "PUBLISHED",
        description: payload.description,
        access_token: payload.pageToken,
      },
    });
    return { videoId: start.data.video_id, url: `https://www.facebook.com/reel/${start.data.video_id}` };
  } catch (error) {
    throw describeError(error);
  }
}

export type PublishPostPayload = {
  pageId: string;
  pageToken: string;
  message: string;
  // Path of a picture on disk to post with the text.
  imagePath?: string;
  // False uploads the post without showing it to anyone (used to check the connection).
  published?: boolean;
};

export type PublishPostResponse = {
  postId: string;
  url: string;
};

// Publishes a text post, or a photo with the text as its caption, to a Facebook Page.
export async function publishPagePost(payload: PublishPostPayload): Promise<PublishPostResponse> {
  const published = String(payload.published ?? true);
  try {
    let postId: string;
    if (payload.imagePath) {
      const file = Bun.file(payload.imagePath);
      const form = new FormData();
      form.append("caption", payload.message);
      form.append("published", published);
      form.append("access_token", payload.pageToken);
      form.append("source", new Blob([await file.arrayBuffer()], { type: file.type }), "post.png");
      const photo = await graphHttp.post<{ id: string; post_id?: string }>(`/${payload.pageId}/photos`, form);
      postId = photo.data.post_id ?? photo.data.id;
    } else {
      const post = await graphHttp.post<{ id: string }>(`/${payload.pageId}/feed`, null, {
        params: { message: payload.message, published, access_token: payload.pageToken },
      });
      postId = post.data.id;
    }
    const link = await graphHttp
      .get<{ permalink_url?: string; link?: string }>(`/${postId}`, {
        params: { fields: payload.imagePath && !postId.includes("_") ? "link" : "permalink_url", access_token: payload.pageToken },
      })
      .catch(() => null);
    return { postId, url: link?.data.permalink_url ?? link?.data.link ?? `https://www.facebook.com/${postId}` };
  } catch (error) {
    throw describeError(error);
  }
}

// Removes a post or photo from the Page.
export async function deletePageObject(payload: { id: string; pageToken: string }): Promise<void> {
  try {
    await graphHttp.delete(`/${payload.id}`, { params: { access_token: payload.pageToken } });
  } catch (error) {
    throw describeError(error);
  }
}

export type PageAccess = { pageId: string; pageToken: string };

export type PageSummary = { name: string; followers: number; likes: number };

// The Page's name and audience size.
export async function getPageSummary(payload: PageAccess): Promise<PageSummary> {
  try {
    const response = await graphHttp.get<{ name: string; followers_count?: number; fan_count?: number }>(`/${payload.pageId}`, {
      params: { fields: "name,followers_count,fan_count", access_token: payload.pageToken },
    });
    return { name: response.data.name, followers: response.data.followers_count ?? 0, likes: response.data.fan_count ?? 0 };
  } catch (error) {
    throw describeError(error);
  }
}

type Count = { summary?: { total_count?: number } };

export type PageReel = {
  id: string;
  createdAt: string;
  description: string;
  lengthSeconds: number;
  url: string;
  comments: number;
};

// The Page's Reels, newest first.
export async function listPageReels(payload: PageAccess): Promise<PageReel[]> {
  try {
    const response = await graphHttp.get<{
      data: { id: string; created_time: string; description?: string; length?: number; permalink_url?: string; comments?: Count }[];
    }>(`/${payload.pageId}/video_reels`, {
      params: {
        limit: 50,
        fields: "id,created_time,description,length,permalink_url,comments.summary(total_count).limit(0)",
        access_token: payload.pageToken,
      },
    });
    return response.data.data.map((reel) => ({
      id: reel.id,
      createdAt: reel.created_time,
      description: reel.description ?? "",
      lengthSeconds: reel.length ?? 0,
      url: `https://www.facebook.com${reel.permalink_url ?? `/reel/${reel.id}/`}`,
      comments: reel.comments?.summary?.total_count ?? 0,
    }));
  } catch (error) {
    throw describeError(error);
  }
}

export type ReelInsights = {
  plays: number;
  replays: number;
  averageWatchSeconds: number;
  totalWatchSeconds: number;
  reactions: number;
  // People who followed the Page from this Reel.
  follows: number;
  // Share of viewers still watching at 41 evenly spaced points from the start to the end, 0 to 1.
  retention: number[];
};

type InsightValue = number | Record<string, number>;

// Watch numbers for one Reel. Needs the read_insights permission.
export async function getReelInsights(payload: { videoId: string; pageToken: string }): Promise<ReelInsights> {
  try {
    const response = await graphHttp.get<{ data: { name: string; values: { value: InsightValue }[] }[] }>(`/${payload.videoId}/video_insights`, {
      params: { access_token: payload.pageToken },
    });
    const metrics = new Map(response.data.data.map((metric) => [metric.name, metric.values[0]?.value]));
    const number = (name: string) => (typeof metrics.get(name) === "number" ? (metrics.get(name) as number) : 0);
    const record = (name: string) => (typeof metrics.get(name) === "object" ? (metrics.get(name) as Record<string, number>) : {});
    const graph = record("post_video_retention_graph");
    return {
      plays: number("fb_reels_total_plays"),
      replays: number("fb_reels_replay_count"),
      averageWatchSeconds: number("post_video_avg_time_watched") / 1000,
      totalWatchSeconds: number("post_video_view_time") / 1000,
      reactions: Object.values(record("post_video_likes_by_reaction_type")).reduce((sum, count) => sum + count, 0),
      follows: number("post_video_followers"),
      retention: Object.keys(graph)
        .sort((a, b) => Number(a) - Number(b))
        .map((point) => graph[point] ?? 0),
    };
  } catch (error) {
    throw describeError(error);
  }
}

export type PagePost = {
  id: string;
  createdAt: string;
  message: string;
  kind: "text" | "photo" | "video";
  url: string;
  // Times the post appeared on someone's screen.
  views: number;
  clicks: number;
  reactions: number;
  comments: number;
  shares: number;
};

// Everything on the Page's timeline with its response. Needs read_insights and pages_read_user_content.
export async function listPagePosts(payload: PageAccess): Promise<PagePost[]> {
  try {
    const response = await graphHttp.get<{
      data: {
        id: string;
        created_time: string;
        message?: string;
        status_type?: string;
        permalink_url?: string;
        shares?: { count?: number };
        reactions?: Count;
        comments?: Count;
        insights?: { data: { name: string; values: { value: InsightValue }[] }[] };
      }[];
    }>(`/${payload.pageId}/posts`, {
      params: {
        limit: 50,
        fields:
          "id,created_time,message,status_type,permalink_url,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),insights.metric(post_media_view,post_clicks)",
        access_token: payload.pageToken,
      },
    });
    return response.data.data.map((post) => {
      const insight = (name: string) => {
        const value = post.insights?.data.find((metric) => metric.name === name)?.values[0]?.value;
        return typeof value === "number" ? value : 0;
      };
      return {
        id: post.id,
        createdAt: post.created_time,
        message: post.message ?? "",
        kind: post.status_type === "added_video" ? "video" : post.status_type === "added_photos" ? "photo" : "text",
        url: post.permalink_url ?? `https://www.facebook.com/${post.id}`,
        views: insight("post_media_view"),
        clicks: insight("post_clicks"),
        reactions: post.reactions?.summary?.total_count ?? 0,
        comments: post.comments?.summary?.total_count ?? 0,
        shares: post.shares?.count ?? 0,
      };
    });
  } catch (error) {
    throw describeError(error);
  }
}

export type ExchangeTokenPayload = {
  appId: string;
  appSecret: string;
  // Short-lived user token from Graph API Explorer.
  userToken: string;
};

export type ManagedPage = {
  id: string;
  name: string;
  // Page token; it does not expire when listed with a long-lived user token.
  access_token: string;
};

// Trades a short-lived user token for a long-lived one.
export async function exchangeUserToken(payload: ExchangeTokenPayload): Promise<string> {
  try {
    const response = await graphHttp.get<{ access_token: string }>("/oauth/access_token", {
      params: {
        grant_type: "fb_exchange_token",
        client_id: payload.appId,
        client_secret: payload.appSecret,
        fb_exchange_token: payload.userToken,
      },
    });
    return response.data.access_token;
  } catch (error) {
    throw describeError(error);
  }
}

// Lists the Pages the token's owner manages, each with its Page token.
export async function listManagedPages(userToken: string): Promise<ManagedPage[]> {
  try {
    const response = await graphHttp.get<{ data: ManagedPage[] }>("/me/accounts", {
      params: { fields: "id,name,access_token", access_token: userToken },
    });
    return response.data.data;
  } catch (error) {
    throw describeError(error);
  }
}
