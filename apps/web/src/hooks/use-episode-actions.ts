"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/http";
import {
  approveStep,
  publishEpisode,
  rejectStep,
  type EpisodeDetail,
  type RejectStepPayload,
  type StepName,
} from "@/services/veogen";

// The three decisions the owner can make on a part, each refreshing the open episode afterwards.
export function useEpisodeActions(episodeId: number) {
  const queryClient = useQueryClient();
  const onSuccess = (episode: EpisodeDetail) => {
    queryClient.setQueryData(["episode", episodeId], episode);
    void queryClient.invalidateQueries({ queryKey: ["overview"] });
  };
  const onError = (error: unknown) => toast.error(errorMessage(error));

  const approve = useMutation({
    mutationFn: (step: StepName) => approveStep(episodeId, step),
    onSuccess: (episode) => {
      onSuccess(episode);
      toast.success("Approved");
    },
    onError,
  });
  const sendBack = useMutation({
    mutationFn: ({ step, payload }: { step: StepName; payload: RejectStepPayload }) => rejectStep(episodeId, step, payload),
    onSuccess: (episode) => {
      onSuccess(episode);
      toast.success("Sent back to be redone");
    },
    onError,
  });
  const publish = useMutation({
    mutationFn: () => publishEpisode(episodeId),
    onSuccess: (episode) => {
      onSuccess(episode);
      toast.success("Published");
    },
    onError,
  });
  return { approve, sendBack, publish };
}
