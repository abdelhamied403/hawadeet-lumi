import type { Step, StepName } from "./store";

// Seconds of work per step, measured on this pipeline: a fixed start-up cost plus a cost per scene.
// Kaggle steps include downloading the models; the per-scene figures come from the jobs' own timings.
const COST: Record<StepName, { start: number; perScene: number }> = {
  story: { start: 180, perScene: 0 },
  voice: { start: 120, perScene: 10 },
  images: { start: 300, perScene: 220 },
  clips: { start: 600, perScene: 840 },
  video: { start: 60, perScene: 180 },
  publish: { start: 0, perScene: 0 },
};

// Kaggle GPU time one chapter of this many scenes uses: its images job and its clips job.
export function chapterGpuSeconds(scenes: number): number {
  return COST.images.start + COST.images.perScene * scenes + COST.clips.start + COST.clips.perScene * scenes;
}

export type StepEstimate = {
  // How long the step's work takes; null when it has none left (done, waiting for the owner, or failed).
  estimateSeconds: number | null;
  // When a step that is working now should finish.
  endsAt: string | null;
};

export function estimateStep(step: Step, sceneCount: number): StepEstimate {
  const busy = step.status === "running" || step.status === "queued";
  if (!busy && step.status !== "waiting") return { estimateSeconds: null, endsAt: null };
  if (step.name === "publish") return { estimateSeconds: null, endsAt: null };
  // A redo of some scenes only costs those scenes.
  const scenes = busy && step.meta.scenes?.length ? step.meta.scenes.length : sceneCount;
  const estimateSeconds = COST[step.name].start + COST[step.name].perScene * scenes;
  const started = step.status === "running" && step.meta.startedAt ? Date.parse(step.meta.startedAt) : null;
  return { estimateSeconds, endsAt: started ? new Date(started + estimateSeconds * 1000).toISOString() : null };
}
