"use client";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Decision } from "@/components/decision";
import { Filmstrip } from "@/components/filmstrip";
import { SceneWall, VideoBench, VoiceBench, type MixChoice } from "@/components/media-benches";
import { PublishBench } from "@/components/publish-bench";
import { StoryBench } from "@/components/story-bench";
import { Button } from "@/components/ui/button";
import { useEpisodeActions } from "@/hooks/use-episode-actions";
import { errorMessage } from "@/lib/http";
import { STEP_COPY } from "@/lib/steps";
import { getEpisode, type EpisodeDetail, type Step, type StepName } from "@/services/veogen";

const NOTE_HINTS: Record<Exclude<StepName, "publish">, string> = {
  story: "For example: make it funnier, or use simpler words",
  voice: "For example: slower, and happier at the end",
  images: "For example: brighter colours, and she should be smiling",
  clips: "For example: less camera movement",
  video: "Change the music above, or describe what is wrong",
};

export function EpisodeView({ episodeId }: { episodeId: number }) {
  const { data: episode, error } = useQuery({
    queryKey: ["episode", episodeId],
    queryFn: () => getEpisode(episodeId),
    refetchInterval: 6000,
  });
  const [picked, setPicked] = useState<StepName | null>(null);

  if (error) return <p className="text-destructive">{errorMessage(error)}</p>;
  if (!episode) return <p className="text-muted-foreground">Loading the part…</p>;

  // Follow the step that is in play unless the owner clicked another frame.
  const selected = picked ?? episode.currentStep ?? "publish";
  const step = episode.steps.find((candidate) => candidate.name === selected) as Step;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Part {episode.partNumber} of {episode.totalParts}
            {episode.status !== "in_progress" && ` · ${episode.status}`}
          </p>
          <h1 dir="rtl" className="mt-1 font-script text-4xl font-bold">
            {episode.seriesTitle}
          </h1>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          All parts
        </Link>
      </header>

      <Filmstrip steps={episode.steps} selected={selected} onSelect={setPicked} />

      <StepBench key={`${selected}-${step.status}-${step.meta.attempt}`} episode={episode} step={step} />
    </div>
  );
}

function StepBench({ episode, step }: { episode: EpisodeDetail; step: Step }) {
  const { sendBack } = useEpisodeActions(episode.id);
  const [marked, setMarked] = useState<number[]>([]);
  const [mix, setMix] = useState<MixChoice>({});
  const name = step.name;
  const copy = STEP_COPY[name];
  const inReview = step.status === "review";
  const toggle = (scene: number) =>
    setMarked((current) => (current.includes(scene) ? current.filter((value) => value !== scene) : [...current, scene].sort((a, b) => a - b)));

  if (step.status === "waiting") {
    return <Notice title={`${copy.label} has not started`} body={`It starts once you approve ${copy.waitsOn}.`} />;
  }

  if (step.status === "queued" || step.status === "running") {
    return (
      <Notice
        title={`${copy.working}…`}
        body={
          step.meta.startedAt
            ? `Started ${formatDistanceToNow(new Date(step.meta.startedAt), { addSuffix: true })}. This page updates by itself.`
            : "Starting. This page updates by itself."
        }
      >
        {step.meta.note && <p className="mt-2 text-sm text-muted-foreground">Your note: {step.meta.note}</p>}
        {step.meta.jobUrl && (
          <a href={step.meta.jobUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline">
            Watch the job on Kaggle
            <ExternalLinkIcon className="size-3.5" aria-hidden />
          </a>
        )}
      </Notice>
    );
  }

  if (step.status === "failed") {
    return (
      <Notice title={`${copy.label} failed`} body="Nothing was lost. Read the reason below, then try again." tone="error">
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-strip p-3 font-mono text-xs">{step.error}</pre>
        <Button className="mt-3" onClick={() => sendBack.mutate({ step: name, payload: {} })} disabled={sendBack.isPending}>
          Try again
        </Button>
      </Notice>
    );
  }

  return (
    <div className="grid gap-5">
      {name === "story" && <StoryBench episode={episode} editable={inReview} />}
      {name === "voice" && <VoiceBench episode={episode} />}
      {(name === "images" || name === "clips") && (
        <SceneWall episode={episode} kind={name} marked={marked} onToggle={toggle} selectable={inReview} />
      )}
      {name === "video" && <VideoBench episode={episode} mix={mix} onMixChange={setMix} adjustable={inReview} />}
      {name === "publish" && <PublishBench episode={episode} />}

      {inReview && name !== "publish" && (
        <Decision
          episodeId={episode.id}
          step={name}
          marked={marked}
          extra={name === "video" && (mix.musicTrack || mix.musicVolume !== undefined || mix.sfxVolume !== undefined) ? mix : undefined}
          noteHint={NOTE_HINTS[name]}
        />
      )}
      {step.status === "approved" && name !== "publish" && episode.status === "in_progress" && (
        <div className="flex flex-wrap items-center justify-end gap-3 text-sm text-muted-foreground">
          You approved this step.
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendBack.mutate({ step: name, payload: {} })}
            disabled={sendBack.isPending}
            title="Every later step is redone too. If a Kaggle job is running, stop it on Kaggle yourself."
          >
            Redo from here
          </Button>
        </div>
      )}
    </div>
  );
}

function Notice({
  title,
  body,
  tone,
  children,
}: {
  title: string;
  body: string;
  tone?: "error";
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card p-6">
      <h2 className={tone === "error" ? "text-lg font-medium text-destructive" : "text-lg font-medium"}>{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {children}
    </section>
  );
}
