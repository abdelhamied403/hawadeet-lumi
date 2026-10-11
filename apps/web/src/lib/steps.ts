import { format, intervalToDuration, isPast } from "date-fns";
import type { StepName, StepStatus, StepSummary } from "@/services/veogen";

export const STEP_COPY: Record<StepName, { label: string; working: string; approve: string; waitsOn: string }> = {
  story: { label: "Script", working: "Writing the script", approve: "Approve script", waitsOn: "" },
  voice: { label: "Voice", working: "Recording the narration", approve: "Approve voice", waitsOn: "the script" },
  images: { label: "Images", working: "Generating the scene images on Kaggle (about 4 minutes each)", approve: "Approve images", waitsOn: "the voice" },
  clips: { label: "Motion", working: "Animating the scenes on Kaggle (about 15 minutes each)", approve: "Approve motion", waitsOn: "the images" },
  video: { label: "Final cut", working: "Assembling the video (about 3 minutes per scene)", approve: "Approve final cut", waitsOn: "the motion clips" },
  publish: { label: "Publish", working: "Publishing", approve: "Publish", waitsOn: "the final cut" },
};

// "about 25 min", "about 3 h 50 min"
export function aboutDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60 / 5) * 5 || Math.round(seconds / 60));
  const { hours = 0, minutes: rest = 0 } = intervalToDuration({ start: 0, end: minutes * 60_000 });
  return `about ${[hours ? `${hours} h` : "", rest ? `${rest} min` : ""].filter(Boolean).join(" ")}`;
}

// What a step's frame says about time: how long it will take, or when it should be done.
export function stepTiming(step: StepSummary): string | null {
  if (step.endsAt) return isPast(step.endsAt) ? "should finish any minute" : `done about ${format(step.endsAt, "h:mm a")}`;
  return step.estimateSeconds ? aboutDuration(step.estimateSeconds) : null;
}

export const STATUS_COPY: Record<StepStatus, string> = {
  waiting: "Not started",
  queued: "Starting",
  running: "Working",
  review: "Needs you",
  approved: "Approved",
  failed: "Failed",
};
