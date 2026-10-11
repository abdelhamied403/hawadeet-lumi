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
