import { veogenHttp } from "@/lib/http";

export const STEP_NAMES = ["story", "voice", "images", "clips", "video", "publish"] as const;
export type StepName = (typeof STEP_NAMES)[number];
export type StepStatus = "waiting" | "queued" | "running" | "review" | "approved" | "failed";

export type StepSummary = {
  name: StepName;
  status: StepStatus;
  // Seconds of work the step has ahead of it; null when it has none.
  estimateSeconds: number | null;
  // When a step that is working now should finish.
  endsAt: string | null;
};

export type PublishResult = { status: "posted" | "manual" | "failed"; url?: string; detail?: string };

export type Step = StepSummary & {
  error: string | null;
  updatedAt: string;
  meta: {
    note?: string;
    scenes?: number[];
    attempt: number;
    jobUrl?: string;
    startedAt?: string;
    musicTrack?: string;
    musicVolume?: number;
    sfxVolume?: number;
    published?: Record<string, PublishResult>;
  };
};

export type EpisodeSummary = {
  id: number;
  seriesId: number;
  seriesTitle: string;
  partNumber: number;
  totalParts: number;
  title: string;
  status: "in_progress" | "published" | "cancelled";
  createdAt: string;
  publishedAt: string | null;
  currentStep: StepName | null;
  steps: StepSummary[];
};

// "Narrator" is the storyteller; any other speaker is a cast member's name.
export const NARRATOR = "Narrator";
// The main character speaking out loud inside a scene (same voice as the narrator).
export const HERO = "Hero";

export type StoryLine = { speaker: string; text: string };

export type CastMember = {
  name: string;
  nameArabic: string;
  gender: "male" | "female";
  age: "young" | "adult" | "old";
  role: string;
  look: string;
  voice: string;
};

export type StoryScene = {
  narration: string;
  lines: StoryLine[];
  imagePrompt: string;
  // Who is in the picture: HERO and/or cast names. Missing on older stories.
  shows?: string[];
  motionPrompt: string;
  // Name of the sound effect played in the scene, if any.
  sfx: string | null;
};

export type Story = {
  title: string;
  description: string;
  hashtags: string[];
  characterSheet: string;
  styleSheet: string;
  seed: number;
  cast: CastMember[];
  scenes: StoryScene[];
};

export type EpisodeScene = StoryScene & {
  number: number;
  audioUrl: string | null;
  audioSeconds: number | null;
  imageUrl: string | null;
  clipUrl: string | null;
};

export type EpisodeDetail = Omit<EpisodeSummary, "steps"> & {
  story: Story | null;
  plan: { number: number; summary: string; cliffhanger: string } | null;
  steps: Step[];
  scenes: EpisodeScene[];
  narrationUrl: string | null;
  videoUrl: string | null;
  description: string;
  musicTracks: string[];
  // Available sound effects: name -> what it sounds like.
  soundEffects: Record<string, string>;
};

export type SeriesSummary = {
  id: number;
  title: string;
  status: "active" | "finished";
  totalParts: number;
  publishedParts: number;
};

export type OverviewResponse = {
  episodes: EpisodeSummary[];
  series: SeriesSummary[];
  // Page posts waiting for a decision.
  draftPosts: number;
  quota: { usedSeconds: number; allowedSeconds: number; refreshesAt: string | null } | null;
};

export type SeriesDetail = {
  id: number;
  status: "active" | "finished";
  createdAt: string;
  title: string;
  premise: string;
  characterSheet: string;
  styleSheet: string;
  hashtags: string[];
  cast: CastMember[];
  parts: { number: number; summary: string; cliffhanger: string }[];
  episodes: EpisodeSummary[];
  fullStory: FullStory;
};

// Every published part joined into one video, for YouTube.
export type FullStory = {
  publishedParts: number[];
  // True while the server is putting the video together.
  building: boolean;
  videoUrl: string | null;
  // The parts the video on the server holds; fewer than `publishedParts` means it is out of date.
  includedParts: number[];
  builtAt: string | null;
  title: string;
  description: string;
  // Where it was uploaded, once the link is saved.
  youtubeUrl: string | null;
};

// An empty link clears the saved one.
export type SaveFullStoryLinkPayload = { url: string };

export type UpdateSeriesPayload = {
  title: string;
  premise: string;
  characterSheet: string;
  styleSheet: string;
  hashtags: string[];
  cast: CastMember[];
  parts: { number: number; summary: string; cliffhanger: string }[];
};

export type CreateEpisodePayload = { idea?: string };

export type RejectStepPayload = {
  note?: string;
  scenes?: number[];
  musicTrack?: string;
  musicVolume?: number;
  sfxVolume?: number;
};

export type UpdateScenePayload = { imagePrompt?: string; motionPrompt?: string };

export type Settings = {
  autoCreate: boolean;
  dailyTime: string;
  scenesPerPart: number;
  partsPerSeries: number;
  // Page posts drafted each day; 0 turns them off.
  postsPerDay: number;
  // The YouTube channel viewers are sent to for the whole story; empty leaves that line out.
  youtubeUrl: string;
  // Send alerts to the owner's phone.
  notifications: boolean;
};

export type SettingsResponse = Settings & {
  connections: { kaggle: boolean; gemini: boolean; facebook: boolean; alerts: boolean };
  // What the ntfy app subscribes to; null until the server has a topic.
  alertsTopic: { server: string; topic: string } | null;
};

export type SessionResponse = {
  // False when the server runs without a login (the laptop-only setup).
  required: boolean;
  signedIn: boolean;
};

export type LoginPayload = { password: string };

export type MediaTokenResponse = { token: string | null };

export async function getSession(): Promise<SessionResponse> {
  return (await veogenHttp.get<SessionResponse>("/api/auth/session")).data;
}

export async function login(payload: LoginPayload): Promise<SessionResponse> {
  return (await veogenHttp.post<SessionResponse>("/api/auth/login", payload)).data;
}

export async function logout(): Promise<SessionResponse> {
  return (await veogenHttp.post<SessionResponse>("/api/auth/logout")).data;
}

export async function getMediaToken(): Promise<MediaTokenResponse> {
  return (await veogenHttp.get<MediaTokenResponse>("/api/auth/media-token")).data;
}

export async function getOverview(): Promise<OverviewResponse> {
  return (await veogenHttp.get<OverviewResponse>("/api/overview")).data;
}

export async function getSeries(id: number): Promise<SeriesDetail> {
  return (await veogenHttp.get<SeriesDetail>(`/api/series/${id}`)).data;
}

export async function updateSeries(id: number, payload: UpdateSeriesPayload): Promise<SeriesDetail> {
  return (await veogenHttp.put<SeriesDetail>(`/api/series/${id}`, payload)).data;
}

// Starts joining the published parts into one video; the series reports `building` until it is there.
export async function buildFullStory(id: number): Promise<SeriesDetail> {
  return (await veogenHttp.post<SeriesDetail>(`/api/series/${id}/full-story`)).data;
}

export async function saveFullStoryLink(id: number, payload: SaveFullStoryLinkPayload): Promise<SeriesDetail> {
  return (await veogenHttp.put<SeriesDetail>(`/api/series/${id}/full-story`, payload)).data;
}

export async function getEpisode(id: number): Promise<EpisodeDetail> {
  return (await veogenHttp.get<EpisodeDetail>(`/api/episodes/${id}`)).data;
}

export async function createEpisode(payload: CreateEpisodePayload): Promise<EpisodeSummary> {
  return (await veogenHttp.post<EpisodeSummary>("/api/episodes", payload)).data;
}

// The server rebuilds each scene's joined narration from its lines, so it is not sent.
export type UpdateStoryPayload = Omit<Story, "scenes"> & { scenes: Omit<StoryScene, "narration">[] };

export async function updateStory(id: number, story: UpdateStoryPayload): Promise<EpisodeDetail> {
  return (await veogenHttp.put<EpisodeDetail>(`/api/episodes/${id}/story`, story)).data;
}

export async function updateScene(id: number, scene: number, payload: UpdateScenePayload): Promise<EpisodeDetail> {
  return (await veogenHttp.put<EpisodeDetail>(`/api/episodes/${id}/scenes/${scene}`, payload)).data;
}

export async function approveStep(id: number, step: StepName): Promise<EpisodeDetail> {
  return (await veogenHttp.post<EpisodeDetail>(`/api/episodes/${id}/steps/${step}/approve`)).data;
}

export async function rejectStep(id: number, step: StepName, payload: RejectStepPayload): Promise<EpisodeDetail> {
  return (await veogenHttp.post<EpisodeDetail>(`/api/episodes/${id}/steps/${step}/reject`, payload)).data;
}

export async function publishEpisode(id: number): Promise<EpisodeDetail> {
  return (await veogenHttp.post<EpisodeDetail>(`/api/episodes/${id}/publish`)).data;
}

export async function cancelEpisode(id: number): Promise<EpisodeSummary> {
  return (await veogenHttp.post<EpisodeSummary>(`/api/episodes/${id}/cancel`)).data;
}

export async function getSettings(): Promise<SettingsResponse> {
  return (await veogenHttp.get<SettingsResponse>("/api/settings")).data;
}

export async function updateSettings(payload: Settings): Promise<Settings> {
  return (await veogenHttp.put<Settings>("/api/settings", payload)).data;
}

// What a Page post is trying to do.
export type PostAngle = "question" | "teaser" | "moment" | "confession";

export type PagePost = {
  id: number;
  angle: PostAngle;
  text: string;
  // A still from a published part that goes with the post, if one was picked.
  imageUrl: string | null;
  withImage: boolean;
  status: "draft" | "published" | "discarded";
  // Where the post is on Facebook, once published.
  url: string | null;
  // Why the last attempt to publish failed.
  error: string | null;
  createdAt: string;
  publishedAt: string | null;
};

export type PostsResponse = {
  drafts: PagePost[];
  published: PagePost[];
  facebookConnected: boolean;
};

export type CreatePostPayload = { idea?: string };
export type UpdatePostPayload = { text: string; withImage: boolean };
export type RewritePostPayload = { note?: string };

export async function getPosts(): Promise<PostsResponse> {
  return (await veogenHttp.get<PostsResponse>("/api/posts")).data;
}

export async function createPost(payload: CreatePostPayload): Promise<PagePost> {
  return (await veogenHttp.post<PagePost>("/api/posts", payload)).data;
}

export async function updatePost(id: number, payload: UpdatePostPayload): Promise<PagePost> {
  return (await veogenHttp.put<PagePost>(`/api/posts/${id}`, payload)).data;
}

export async function rewritePost(id: number, payload: RewritePostPayload): Promise<PagePost> {
  return (await veogenHttp.post<PagePost>(`/api/posts/${id}/rewrite`, payload)).data;
}

export async function publishPost(id: number): Promise<PagePost> {
  return (await veogenHttp.post<PagePost>(`/api/posts/${id}/publish`)).data;
}

export async function discardPost(id: number): Promise<PagePost> {
  return (await veogenHttp.post<PagePost>(`/api/posts/${id}/discard`)).data;
}

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
  // People who followed the Page from this Reel.
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
  // Times the post appeared on someone's screen.
  views: number;
  clicks: number;
  reactions: number;
  comments: number;
  shares: number;
};

// The Page's numbers as they stood at one moment.
export type Report = {
  id: number;
  takenAt: string;
  page: { name: string; followers: number; likes: number };
  reels: ReelReport[];
  posts: PostReport[];
};

export type AnalysisResponse = {
  facebookConnected: boolean;
  latest: Report | null;
  // The report from about a day before the latest, to show what changed.
  dayBefore: Report | null;
  // One point per kept report, oldest first.
  history: { takenAt: string; followers: number; plays: number }[];
};

export type TestAlertResponse = { sent: boolean };

export async function getAnalysis(): Promise<AnalysisResponse> {
  return (await veogenHttp.get<AnalysisResponse>("/api/analysis")).data;
}

// Records the Page's numbers now, instead of waiting for the next scheduled report.
export async function refreshAnalysis(): Promise<AnalysisResponse> {
  return (await veogenHttp.post<AnalysisResponse>("/api/analysis/refresh")).data;
}

export async function sendTestAlert(): Promise<TestAlertResponse> {
  return (await veogenHttp.post<TestAlertResponse>("/api/alerts/test")).data;
}
