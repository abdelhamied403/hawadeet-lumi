import { format } from "date-fns";
import { getPageSummary, getReelInsights, listPagePosts, listPageReels, type PageAccess } from "../services/facebook";
import { getChannelStats, getVideoWatchStats, listChannelVideos } from "../services/youtube";

export type ReelReport = {
  id: string;
  title: string;
  publishedAt: string;
  lengthSeconds: number;
  url: string;
  plays: number;
  replays: number;
  averageWatchSeconds: number;
  totalWatchSeconds: number;
  reactions: number;
  comments: number;
  follows: number;
  // Share of viewers still watching at evenly spaced points from start to end, 0 to 1.
  retention: number[];
};

export type PostReport = {
  id: string;
  publishedAt: string;
  excerpt: string;
  kind: "text" | "photo";
  url: string;
  views: number;
  clicks: number;
  reactions: number;
  comments: number;
  shares: number;
};

export type YoutubeVideoReport = {
  id: string;
  title: string;
  publishedAt: string;
  lengthSeconds: number;
  url: string;
  views: number;
  likes: number;
  comments: number;
  // Null until YouTube's watch-time numbers reach this video (a day or two), or when they cannot be read.
  averageWatchSeconds: number | null;
  averageWatchedShare: number | null;
  subscribersGained: number | null;
};

export type YoutubeReport = {
  channel: { title: string; subscribers: number; views: number };
  // Newest first.
  videos: YoutubeVideoReport[];
  // Why watch time is missing, when it could not be read at all.
  watchTimeProblem: string | null;
};

// The Page's and the channel's numbers at one moment. Reports are kept, so two of them show what changed in between.
export type ReportData = {
  page: { name: string; followers: number; likes: number };
  reels: ReelReport[];
  posts: PostReport[];
  // Missing in reports taken before the channel was connected, or when YouTube could not be read.
  youtube?: YoutubeReport;
};

// Reads the connected channel's current numbers from YouTube.
export async function collectYoutube(accessToken: string): Promise<YoutubeReport> {
  const channel = await getChannelStats(accessToken);
  const videos = await listChannelVideos({ accessToken, uploadsPlaylistId: channel.uploadsPlaylistId });
  let watchTimeProblem: string | null = null;
  const oldest = videos.map((video) => video.publishedAt).sort()[0];
  const watch = await getVideoWatchStats({
    accessToken,
    videoIds: videos.map((video) => video.id),
    startDate: format(oldest ? new Date(oldest) : new Date(), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
  }).catch((error) => {
    watchTimeProblem = error instanceof Error ? error.message.slice(0, 200) : String(error);
    return {} as Awaited<ReturnType<typeof getVideoWatchStats>>;
  });
  return {
    channel: { title: channel.title, subscribers: channel.subscribers, views: channel.views },
    videos: videos
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .map((video) => ({
        ...video,
        averageWatchSeconds: watch[video.id]?.averageWatchSeconds ?? null,
        averageWatchedShare: watch[video.id]?.averageWatchedShare ?? null,
        subscribersGained: watch[video.id]?.subscribersGained ?? null,
      })),
    watchTimeProblem,
  };
}

export const youtubeViews = (report: ReportData) => (report.youtube?.videos ?? []).reduce((sum, video) => sum + video.views, 0);

const EXCERPT_LENGTH = 90;

// Reads the Page's current numbers from Facebook. Reels and posts are newest first.
export async function collectReport(access: PageAccess): Promise<ReportData> {
  const [page, reels, posts] = await Promise.all([getPageSummary(access), listPageReels(access), listPagePosts(access)]);
  const reelReports: ReelReport[] = [];
  for (const reel of reels) {
    const insights = await getReelInsights({ videoId: reel.id, pageToken: access.pageToken });
    reelReports.push({
      id: reel.id,
      title: reel.description.split("\n")[0]?.trim() || "Reel",
      publishedAt: reel.createdAt,
      lengthSeconds: reel.lengthSeconds,
      url: reel.url,
      comments: reel.comments,
      ...insights,
    });
  }
  return {
    page,
    reels: reelReports,
    // A Reel also appears on the timeline as a video post; its numbers are already in `reels`.
    posts: posts
      .filter((post) => post.kind !== "video")
      .map((post) => ({
        id: post.id,
        publishedAt: post.createdAt,
        excerpt: post.message.replace(/\s+/g, " ").trim().slice(0, EXCERPT_LENGTH),
        kind: post.kind as "text" | "photo",
        url: post.url,
        views: post.views,
        clicks: post.clicks,
        reactions: post.reactions,
        comments: post.comments,
        shares: post.shares,
      })),
  };
}

export const totalPlays = (report: ReportData) => report.reels.reduce((sum, reel) => sum + reel.plays, 0);

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

// One short paragraph for the evening alert: where the Page stands and what moved since `before`.
export function summarizeReport(report: ReportData, before: ReportData | null): string {
  const lines = [
    `${report.page.followers} followers${before ? ` (${signed(report.page.followers - before.page.followers)})` : ""}, ${totalPlays(report)} reel plays${before ? ` (${signed(totalPlays(report) - totalPlays(before))})` : ""}.`,
  ];
  if (report.youtube) {
    const earlier = before?.youtube;
    lines.push(
      `YouTube: ${report.youtube.channel.subscribers} subscribers${earlier ? ` (${signed(report.youtube.channel.subscribers - earlier.channel.subscribers)})` : ""}, ${youtubeViews(report)} views${before && earlier ? ` (${signed(youtubeViews(report) - youtubeViews(before))})` : ""}.`,
    );
  }
  const newest = report.reels[0];
  if (newest) lines.push(`Newest reel: ${newest.plays} plays, ${newest.averageWatchSeconds.toFixed(1)}s average watch, ${newest.reactions} reactions.`);
  return lines.join("\n");
}
