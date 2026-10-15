import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, isPast } from "date-fns";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Decision } from "@/components/decision";
import { Filmstrip } from "@/components/filmstrip";
import { PublishBench } from "@/components/publish-bench";
import { SceneWall } from "@/components/scene-wall";
import { Failure, Loading, Notice } from "@/components/screen";
import { StoryBench } from "@/components/story-bench";
import { Button } from "@/components/ui/button";
import { Arabic, Body, Meta } from "@/components/ui/text";
import { VideoBench, type MixChoice } from "@/components/video-bench";
import { VoiceBench } from "@/components/voice-bench";
import { useEpisodeActions } from "@/hooks/use-episode-actions";
import { errorMessage } from "@/lib/http";
import { slotLabel, STEP_COPY } from "@/lib/steps";
import { getEpisode, type EpisodeDetail, type Step, type StepName } from "@/services/veogen";

const NOTE_HINTS: Record<Exclude<StepName, "publish">, string> = {
  story: "For example: make it funnier, or use simpler words",
  voice: "For example: slower, and happier at the end",
  images: "For example: brighter colours, and she should be smiling",
  clips: "For example: less camera movement",
  video: "Change the music above, or describe what is wrong",
};

export default function EpisodeScreen() {
  const episodeId = Number(useLocalSearchParams<{ id: string }>().id);
  const { data: episode, error, refetch } = useQuery({
    queryKey: ["episode", episodeId],
    queryFn: () => getEpisode(episodeId),
    refetchInterval: 6000,
  });
  const [picked, setPicked] = useState<StepName | null>(null);

  if (!episode) return error ? <Failure message={errorMessage(error)} onRetry={() => void refetch()} /> : <Loading label="Loading the part" />;

  // Follow the step that is in play unless the owner tapped another frame.
  const selected = picked ?? episode.currentStep ?? "publish";
  const step = episode.steps.find((candidate) => candidate.name === selected) as Step;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <View className="flex-row items-center gap-1 px-2 pb-3 pt-1">
        <Pressable accessibilityRole="button" accessibilityLabel="Back to all parts" onPress={() => router.back()} className="size-11 items-center justify-center rounded-full active:bg-secondary">
          <Feather name="arrow-left" size={22} color="#e4ece8" />
        </Pressable>
        <View className="flex-1 pr-3">
          <Meta className="uppercase tracking-widest">
            Part {episode.partNumber} of {episode.totalParts}
            {episode.status !== "in_progress" && ` · ${episode.status}`}
          </Meta>
          <Arabic numberOfLines={1} accessibilityRole="header" className="font-script-bold text-3xl leading-[46px]">
            {episode.seriesTitle}
          </Arabic>
        </View>
      </View>
      <View>
        <Filmstrip steps={episode.steps} selected={selected} onSelect={setPicked} />
      </View>
      <StepBench key={`${selected}-${step.status}-${step.meta.attempt}`} episode={episode} step={step} />
    </SafeAreaView>
  );
}

function StepBench({ episode, step }: { episode: EpisodeDetail; step: Step }) {
  const { sendBack, publish, schedule, unschedule } = useEpisodeActions(episode.id);
  const [marked, setMarked] = useState<number[]>([]);
  const [mix, setMix] = useState<MixChoice>({});
  const name = step.name;
  const copy = STEP_COPY[name];
  const inReview = step.status === "review";
  const toggle = (scene: number) =>
    setMarked((current) => (current.includes(scene) ? current.filter((value) => value !== scene) : [...current, scene].sort((a, b) => a - b)));

  const redoFromHere = () =>
    Alert.alert(`Redo ${copy.label.toLowerCase()}?`, "Every later step is redone too. If a Kaggle job is running, stop it on Kaggle yourself.", [
      { text: "Keep it", style: "cancel" },
      { text: "Redo from here", style: "destructive", onPress: () => sendBack.mutate({ step: name, payload: {} }) },
    ]);
  const confirmPublish = () =>
    Alert.alert("Publish this part now?", "Publishing cannot be undone from here.", [
      { text: "Not yet", style: "cancel" },
      { text: "Publish now", onPress: () => publish.mutate() },
    ]);
  const scheduledFor = name === "publish" && inReview ? step.meta.scheduledFor : undefined;
  const publishBusy = publish.isPending || schedule.isPending || unschedule.isPending;

  let body: React.ReactNode;
  let bar: React.ReactNode = null;

  if (step.status === "waiting") {
    body = <Notice title={`${copy.label} has not started`} body={`It starts once you approve ${copy.waitsOn}.`} />;
  } else if (step.status === "queued" || step.status === "running") {
    const jobUrl = step.meta.jobUrl;
    body = (
      <Notice
        title={copy.working}
        body={
          step.meta.startedAt
            ? `Started ${formatDistanceToNow(new Date(step.meta.startedAt), { addSuffix: true })}. This screen updates by itself.`
            : "Starting. This screen updates by itself."
        }
      >
        {step.meta.note && <Body className="mt-2">Your note: {step.meta.note}</Body>}
        {jobUrl && (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(jobUrl)} className="mt-2 min-h-11 flex-row items-center gap-1.5 self-start">
            <Text className="font-sans-medium text-sm text-primary">Watch the job on Kaggle</Text>
            <Feather name="external-link" size={14} color="#e9a23b" />
          </Pressable>
        )}
      </Notice>
    );
  } else if (step.status === "failed") {
    body = (
      <Notice title={`${copy.label} failed`} body="Nothing was lost. Read the reason below, then try again." tone="error">
        <Text selectable className="mt-3 rounded-md bg-strip p-3 font-mono text-xs leading-5 text-foreground">
          {step.error}
        </Text>
        <Button label="Try again" className="mt-3 self-start" onPress={() => sendBack.mutate({ step: name, payload: {} })} busy={sendBack.isPending} />
      </Notice>
    );
  } else {
    body = (
      <>
        {name === "story" && <StoryBench episode={episode} editable={inReview} />}
        {name === "voice" && <VoiceBench episode={episode} />}
        {(name === "images" || name === "clips") && <SceneWall episode={episode} kind={name} marked={marked} onToggle={toggle} selectable={inReview} />}
        {name === "video" && <VideoBench episode={episode} mix={mix} onMixChange={setMix} adjustable={inReview} />}
        {scheduledFor && (
          <View className="gap-1 rounded-lg border border-border bg-card p-5">
            <Meta className="uppercase tracking-widest">Scheduled</Meta>
            <Text className="font-display text-3xl uppercase leading-9 tracking-wide text-foreground">{slotLabel(scheduledFor)}</Text>
            <Body>
              {isPast(scheduledFor)
                ? "Posting now. This screen updates by itself."
                : `Posts by itself ${formatDistanceToNow(new Date(scheduledFor), { addSuffix: true })}. You get an alert when it is out.`}
            </Body>
          </View>
        )}
        {name === "publish" && <PublishBench episode={episode} />}
        {step.status === "approved" && name !== "publish" && episode.status === "in_progress" && (
          <View className="flex-row flex-wrap items-center justify-end gap-3">
            <Body>You approved this step.</Body>
            <Button label="Redo from here" variant="outline" size="sm" onPress={redoFromHere} busy={sendBack.isPending} />
          </View>
        )}
        {name === "publish" && step.error && inReview && <Text className="font-sans text-sm text-destructive">{step.error}</Text>}
      </>
    );
    if (inReview && name !== "publish") {
      bar = (
        <Decision
          episodeId={episode.id}
          step={name}
          marked={marked}
          extra={name === "video" && (mix.musicTrack || mix.musicVolume !== undefined || mix.sfxVolume !== undefined) ? mix : undefined}
          noteHint={NOTE_HINTS[name]}
        />
      );
    } else if (inReview) {
      bar = scheduledFor ? (
        <View className="flex-row flex-wrap items-center justify-end gap-2">
          <Button label="Cancel schedule" variant="outline" busy={unschedule.isPending} disabled={publishBusy} onPress={() => unschedule.mutate()} />
          <Button label={publish.isPending ? "Publishing" : "Publish now"} variant="outline" busy={publish.isPending} disabled={publishBusy} onPress={confirmPublish} />
        </View>
      ) : (
        <View className="gap-2">
          <Button label={`Schedule for ${slotLabel(episode.publishSlot)}`} size="lg" busy={schedule.isPending} disabled={publishBusy} onPress={() => schedule.mutate()} />
          <Button label={publish.isPending ? "Publishing" : "Publish now"} variant="ghost" busy={publish.isPending} disabled={publishBusy} onPress={confirmPublish} />
        </View>
      );
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1">
      <ScrollView contentContainerClassName="gap-5 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>
      {bar && (
        <SafeAreaView edges={["bottom"]} className="border-t border-border bg-card px-4 pt-3">
          <View className="pb-3">{bar}</View>
        </SafeAreaView>
      )}
    </KeyboardAvoidingView>
  );
}
