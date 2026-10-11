"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { FilmstripMini } from "@/components/filmstrip";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/http";
import { STATUS_COPY, STEP_COPY } from "@/lib/steps";
import { cn } from "@/lib/utils";
import { createEpisode, getOverview, type EpisodeSummary } from "@/services/veogen";

// Same limit as the server.
const newPartSchema = z.object({ idea: z.string().trim().max(1000, "Keep the idea under 1000 characters") });
type NewPartForm = z.infer<typeof newPartSchema>;

export default function DeskPage() {
  const { data, error } = useQuery({ queryKey: ["overview"], queryFn: getOverview, refetchInterval: 8000 });

  if (error) return <p className="text-destructive">{errorMessage(error)}</p>;
  if (!data) return <p className="text-muted-foreground">Loading…</p>;

  const inProgress = data.episodes.filter((episode) => episode.status === "in_progress");
  const needsYou = inProgress.filter((episode) => episode.steps.some((step) => step.status === "review" || step.status === "failed"));
  const working = inProgress.filter((episode) => !needsYou.includes(episode));
  const published = data.episodes.filter((episode) => episode.status === "published");
  const activeSeries = data.series.find((series) => series.status === "active");

  return (
    <div className="grid gap-10">
      <section className="grid gap-3">
        <h1 className="font-display text-4xl font-extrabold uppercase tracking-wide">
          {needsYou.length > 0 ? `${needsYou.length} waiting for you` : "Nothing needs you right now"}
        </h1>
        {needsYou.length === 0 && working.length === 0 && (
          <p className="max-w-xl text-muted-foreground">
            No part is in production. A new one is written every day at the time set in Settings, or start one below.
          </p>
        )}
        <EpisodeList episodes={[...needsYou, ...working]} />
      </section>

      <NewPart hasActiveSeries={Boolean(activeSeries)} nextLabel={activeSeries ? `the next part of “${activeSeries.title}”` : "the first part of a new series"} />

      {published.length > 0 && (
        <section className="grid gap-3">
          <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-muted-foreground">Published</h2>
          <EpisodeList episodes={published} />
        </section>
      )}
    </div>
  );
}

function EpisodeList({ episodes }: { episodes: EpisodeSummary[] }) {
  if (episodes.length === 0) return null;
  return (
    <ul className="grid gap-2">
      {episodes.map((episode) => {
        const current = episode.steps.find((step) => step.name === episode.currentStep);
        const needsYou = current?.status === "review" || current?.status === "failed";
        return (
          <li key={episode.id}>
            <Link
              href={`/episodes/${episode.id}`}
              className={cn(
                "grid gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[1fr_auto_11rem] sm:items-center",
                needsYou && "border-primary",
              )}
            >
              <span className="min-w-0">
                <span dir="rtl" className="block truncate font-script text-2xl">
                  {episode.seriesTitle}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  Part {episode.partNumber} of {episode.totalParts} · started {formatDistanceToNow(new Date(episode.createdAt), { addSuffix: true })}
                </span>
              </span>
              <FilmstripMini steps={episode.steps} />
              <span className={cn("text-sm text-muted-foreground sm:text-right", needsYou && "font-medium text-primary")}>
                {episode.status === "published"
                  ? "Published"
                  : current
                    ? `${STEP_COPY[current.name].label}: ${STATUS_COPY[current.status].toLowerCase()}`
                    : ""}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function NewPart({ hasActiveSeries, nextLabel }: { hasActiveSeries: boolean; nextLabel: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<NewPartForm>({ resolver: zodResolver(newPartSchema), defaultValues: { idea: "" } });
  const create = useMutation({
    mutationFn: (values: NewPartForm) => createEpisode({ idea: values.idea || undefined }),
    onSuccess: (episode) => {
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      router.push(`/episodes/${episode.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <section className="grid max-w-2xl gap-3 rounded-lg border border-dashed p-5">
      <h2 className="text-lg font-medium">Start a part now</h2>
      <p className="text-sm text-muted-foreground">This writes {nextLabel}. You review the script before anything else is made.</p>
      <form onSubmit={form.handleSubmit((values) => create.mutate(values))} className="grid gap-3">
        {!hasActiveSeries && (
          <div className="grid gap-1.5">
            <Label htmlFor="idea">Your idea for the series (optional)</Label>
            <Textarea
              id="idea"
              dir="auto"
              rows={3}
              placeholder="For example: a night-shift pharmacist notices the same customer buying the same medicine every night, for someone who died years ago"
              {...form.register("idea")}
            />
            {form.formState.errors.idea && <p className="text-xs text-destructive">{form.formState.errors.idea.message}</p>}
          </div>
        )}
        <div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Planning the story…" : hasActiveSeries ? "Write the next part" : "Start a new series"}
          </Button>
        </div>
      </form>
    </section>
  );
}
