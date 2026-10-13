import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@/lib/http";
import { toast } from "@/lib/toast";
import {
  approveStep,
  publishEpisode,
  rejectStep,
  scheduleEpisode,
  unscheduleEpisode,
  type EpisodeDetail,
  type RejectStepPayload,
  type StepName,
} from "@/services/veogen";

// The decisions the owner can make on a part, each refreshing the open episode afterwards.
export function useEpisodeActions(episodeId: number) {
  const queryClient = useQueryClient();
  const onSuccess = (episode: EpisodeDetail) => {
    queryClient.setQueryData(["episode", episodeId], episode);
    void queryClient.invalidateQueries({ queryKey: ["overview"] });
  };
  const onError = (error: unknown) => toast(errorMessage(error));

  const approve = useMutation({
    mutationFn: (step: StepName) => approveStep(episodeId, step),
    onSuccess: (episode) => {
      onSuccess(episode);
      toast("Approved");
    },
    onError,
  });
  const sendBack = useMutation({
    mutationFn: ({ step, payload }: { step: StepName; payload: RejectStepPayload }) => rejectStep(episodeId, step, payload),
    onSuccess: (episode) => {
      onSuccess(episode);
      toast("Sent back to be redone");
    },
    onError,
  });
  const publish = useMutation({
    mutationFn: () => publishEpisode(episodeId),
    onSuccess: (episode) => {
      onSuccess(episode);
      toast("Published");
    },
    onError,
  });
  const schedule = useMutation({
    mutationFn: () => scheduleEpisode(episodeId),
    onSuccess: (episode) => {
      onSuccess(episode);
      toast("Scheduled");
    },
    onError,
  });
  const unschedule = useMutation({
    mutationFn: () => unscheduleEpisode(episodeId),
    onSuccess: (episode) => {
      onSuccess(episode);
      toast("Schedule cancelled");
    },
    onError,
  });
  return { approve, sendBack, publish, schedule, unschedule };
}
