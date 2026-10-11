import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "@/lib/http";
import { toast } from "@/lib/toast";
import { discardPost, publishPost, rewritePost, updatePost, type RewritePostPayload, type UpdatePostPayload } from "@/services/veogen";

// What the owner can do with a drafted Page post, each refreshing the list afterwards.
export function usePostActions(postId: number) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["posts"] });
    void queryClient.invalidateQueries({ queryKey: ["overview"] });
  };
  const onError = (error: unknown) => {
    // A failed publish stores its reason on the post, so the list is reloaded to show it.
    refresh();
    toast(errorMessage(error));
  };

  const save = useMutation({ mutationFn: (payload: UpdatePostPayload) => updatePost(postId, payload), onSuccess: refresh, onError });
  const rewrite = useMutation({ mutationFn: (payload: RewritePostPayload) => rewritePost(postId, payload), onSuccess: refresh, onError });
  const publish = useMutation({
    mutationFn: () => publishPost(postId),
    onSuccess: () => {
      refresh();
      toast("Published");
    },
    onError,
  });
  const discard = useMutation({
    mutationFn: () => discardPost(postId),
    onSuccess: () => {
      refresh();
      toast("Discarded");
    },
    onError,
  });
  return { save, rewrite, publish, discard };
}
