import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { router } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import { FilmstripMini } from "@/components/filmstrip";
import { Failure, Loading, Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Arabic, Body, FieldError, Meta, Title } from "@/components/ui/text";
import { errorMessage } from "@/lib/http";
import { isScheduled, slotLabel, STATUS_COPY, STEP_COPY } from "@/lib/steps";
import { toast } from "@/lib/toast";
import { createEpisode, getOverview, type EpisodeSummary, type OverviewResponse } from "@/services/veogen";

// Same limit as the server.
const newPartSchema = z.object({ idea: z.string().trim().max(1000, "Keep the idea under 1000 characters") });
type NewPartForm = z.infer<typeof newPartSchema>;

export default function DeskScreen() {
  const { data, error, refetch, isRefetching } = useQuery({ queryKey: ["overview"], queryFn: getOverview, refetchInterval: 8000 });

  if (!data) return error ? <Failure message={errorMessage(error)} onRetry={() => void refetch()} /> : <Loading />;

  const inProgress = data.episodes.filter((episode) => episode.status === "in_progress");
  const needsYou = inProgress.filter((episode) => episode.steps.some((step) => step.status === "review" || step.status === "failed"));
  const working = inProgress.filter((episode) => !needsYou.includes(episode));
  const published = data.episodes.filter((episode) => episode.status === "published");
  const activeSeries = data.series.find((series) => series.status === "active");

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      <View className="gap-3">
        <Text className="font-display text-xl tracking-[4px] text-primary">VEOGEN</Text>
        <GpuAllowance quota={data.quota} />
      </View>

      <View className="gap-3">
        <Title>{needsYou.length > 0 ? `${needsYou.length} waiting for you` : "Nothing needs you right now"}</Title>
        {needsYou.length === 0 && working.length === 0 && (
          <Body>No part is in production. A new one is written every day at the time set in Settings, or start one below.</Body>
        )}
        <EpisodeList episodes={[...needsYou, ...working]} />
      </View>

      <NewPart hasActiveSeries={Boolean(activeSeries)} nextLabel={activeSeries ? `the next part of “${activeSeries.title}”` : "the first part of a new series"} />

      {published.length > 0 && (
        <View className="gap-3">
          <Title className="text-2xl text-muted-foreground">Published</Title>
          <EpisodeList episodes={published} />
        </View>
      )}
    </Screen>
  );
}

function GpuAllowance({ quota }: { quota: OverviewResponse["quota"] }) {
  if (!quota || quota.allowedSeconds <= 0) return null;
  const used = quota.usedSeconds / 3600;
  const allowed = quota.allowedSeconds / 3600;
  return (
    <View accessible accessibilityLabel={`Kaggle GPU this week: ${used.toFixed(1)} of ${allowed.toFixed(0)} hours used`} className="gap-1">
      <View className="flex-row justify-between">
        <Meta>GPU this week</Meta>
        <Meta>
          {used.toFixed(1)} / {allowed.toFixed(0)} h
        </Meta>
      </View>
      <View className="h-1 overflow-hidden rounded-full bg-secondary">
        <View className="h-full bg-primary" style={{ width: `${Math.min(100, (used / allowed) * 100)}%` }} />
      </View>
    </View>
  );
}

function EpisodeList({ episodes }: { episodes: EpisodeSummary[] }) {
  if (episodes.length === 0) return null;
  return (
    <View className="gap-2">
      {episodes.map((episode) => {
        const current = episode.steps.find((step) => step.name === episode.currentStep);
        const scheduled = current && isScheduled(current) ? current.scheduledFor : null;
        const needsYou = (current?.status === "review" && !scheduled) || current?.status === "failed";
        const state =
          episode.status === "published"
            ? "Published"
            : scheduled
              ? `Posts ${slotLabel(scheduled)}`
              : current
                ? `${STEP_COPY[current.name].label}: ${STATUS_COPY[current.status].toLowerCase()}`
                : "";
        return (
          <Pressable
            key={episode.id}
            accessibilityRole="button"
            accessibilityLabel={`${episode.seriesTitle}, part ${episode.partNumber} of ${episode.totalParts}. ${state}`}
            onPress={() => router.push({ pathname: "/episodes/[id]", params: { id: String(episode.id) } })}
            className={`gap-2 rounded-lg border bg-card px-4 py-3 active:bg-secondary ${needsYou ? "border-primary" : "border-border"}`}
          >
            <Arabic numberOfLines={1} className="text-2xl">
              {episode.seriesTitle}
            </Arabic>
            <Meta>
              Part {episode.partNumber} of {episode.totalParts} · started {formatDistanceToNow(new Date(episode.createdAt), { addSuffix: true })}
            </Meta>
            <View className="flex-row items-center justify-between gap-3">
              <FilmstripMini steps={episode.steps} />
              <Text className={`font-sans text-sm ${needsYou ? "font-sans-medium text-primary" : "text-muted-foreground"}`}>{state}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function NewPart({ hasActiveSeries, nextLabel }: { hasActiveSeries: boolean; nextLabel: string }) {
  const queryClient = useQueryClient();
  const form = useForm<NewPartForm>({ resolver: zodResolver(newPartSchema), defaultValues: { idea: "" } });
  const create = useMutation({
    mutationFn: (values: NewPartForm) => createEpisode({ idea: values.idea || undefined }),
    onSuccess: (episode) => {
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      form.reset();
      router.push({ pathname: "/episodes/[id]", params: { id: String(episode.id) } });
    },
    onError: (error) => toast(errorMessage(error)),
  });

  return (
    <View className="gap-3 rounded-lg border border-dashed border-border p-4">
      <Text className="font-sans-medium text-lg text-foreground">Start a part now</Text>
      <Body>This writes {nextLabel}. You review the script before anything else is made.</Body>
      {!hasActiveSeries && (
        <Controller
          control={form.control}
          name="idea"
          render={({ field }) => (
            <View className="gap-1.5">
              <Field
                label="Your idea for the series (optional)"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                multiline
                numberOfLines={3}
                className="min-h-24"
                placeholder="For example: a night-shift pharmacist notices the same customer buying the same medicine every night, for someone who died years ago"
              />
              <FieldError message={form.formState.errors.idea?.message} />
            </View>
          )}
        />
      )}
      <Button
        label={create.isPending ? "Planning the story" : hasActiveSeries ? "Write the next part" : "Start a new series"}
        busy={create.isPending}
        onPress={form.handleSubmit((values) => create.mutate(values))}
        className="self-start"
      />
    </View>
  );
}
