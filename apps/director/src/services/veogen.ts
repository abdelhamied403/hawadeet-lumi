import axios from "axios";
import { config } from "../config";

// The kids' Veogen server. This file is the only user of it.
const veogenHttp = axios.create({ baseURL: config.VEOGEN_URL, timeout: 10 * 60_000 });

export type StepName = "story" | "voice" | "images" | "clips" | "video" | "publish";
export type StepStatus = "waiting" | "queued" | "running" | "review" | "approved" | "failed";

export type EpisodeStep = { name: StepName; status: StepStatus };

export type EpisodeSummary = {
  id: number;
  seriesId: number;
  seriesTitle: string;
  partNumber: number;
  totalParts: number;
  title: string;
  status: "in_progress" | "published" | "cancelled";
  steps: EpisodeStep[];
};

export type StatusResponse = { episodes: EpisodeSummary[] };

// The chapters being made now, with the state of each step.
export async function getStatus(): Promise<StatusResponse> {
  const response = await veogenHttp.get<StatusResponse>("/api/status");
  return response.data;
}

export type ReviewPacket = {
  episodeId: number;
  chapter: number;
  chapters: number;
  step: StepName;
  attempt: number;
  lastNote: string | null;
  story: { title: string; type: string; lesson: string; chapterPlan: string };
  earlierChapters: { chapter: number; lines: string[] }[];
  names: string[];
  flags: { scene: number; problem: string }[];
  scenes: {
    scene: number;
    lines: string[];
    shows: string[];
    place: string;
    imagePrompt: string;
    motionPrompt: string;
    sfx: string | null;
    files: string[];
    audioSeconds: number | null;
  }[];
  files: string[];
  loudness: number | null;
};

export async function getPacket(episodeId: number, step: StepName): Promise<ReviewPacket> {
  const response = await veogenHttp.get<ReviewPacket>(`/api/episodes/${episodeId}/steps/${step}/packet`);
  return response.data;
}

// One generated file (a picture, a sheet of frames, a recording), by its path under /media/.
export async function getMediaFile(path: string): Promise<ArrayBuffer> {
  const response = await veogenHttp.get<ArrayBuffer>(`/media/${path.split("/").map(encodeURIComponent).join("/")}`, { responseType: "arraybuffer" });
  return response.data;
}

export async function approveStep(episodeId: number, step: StepName): Promise<void> {
  await veogenHttp.post(`/api/episodes/${episodeId}/steps/${step}/approve`);
}

export type RejectStepPayload = { note: string; scenes?: number[] };

export async function rejectStep(episodeId: number, step: StepName, payload: RejectStepPayload): Promise<void> {
  await veogenHttp.post(`/api/episodes/${episodeId}/steps/${step}/reject`, payload);
}

export type UpdateScenePayload = { imagePrompt?: string; motionPrompt?: string };

// Rewrites a scene's picture or motion description before that scene is redone.
export async function updateScene(episodeId: number, scene: number, payload: UpdateScenePayload): Promise<void> {
  await veogenHttp.put(`/api/episodes/${episodeId}/scenes/${scene}`, payload);
}

export type SendAlertPayload = { title: string; message: string; click?: string };

export async function sendAlert(payload: SendAlertPayload): Promise<void> {
  await veogenHttp.post("/api/alerts", payload);
}
