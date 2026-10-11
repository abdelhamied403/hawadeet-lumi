import { zodResolver } from "@hookform/resolvers/zod";
import { formatDistanceToNow } from "date-fns";
import { Image } from "expo-image";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Alert, Text, View } from "react-native";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Field } from "@/components/ui/field";
import { FieldError } from "@/components/ui/text";
import { usePostActions } from "@/hooks/use-post-actions";
import { mediaUrl } from "@/lib/http";
import type { PagePost, PostAngle } from "@/services/veogen";

export const ANGLE_COPY: Record<PostAngle, string> = {
  question: "A question about the story",
  teaser: "Teaser for the next part",
  moment: "A moment they already saw",
  confession: "Asks for their own stories",
};

// Same limits as the server.
const editSchema = z.object({
  text: z.string().trim().min(1, "The post cannot be empty").max(2000, "Keep the post under 2000 characters"),
  withImage: z.boolean(),
});
type EditForm = z.infer<typeof editSchema>;

const rewriteSchema = z.object({ note: z.string().trim().max(500, "Keep the note under 500 characters") });
type RewriteForm = z.infer<typeof rewriteSchema>;

const RTL = { writingDirection: "rtl" } as const;

// A drafted Page post on a slip of script paper: read it, change it, then publish or discard it.
export function PostSlip({ post, canPublish }: { post: PagePost; canPublish: boolean }) {
  const { save, rewrite, publish, discard } = usePostActions(post.id);
  const [mode, setMode] = useState<"read" | "edit" | "rewrite">("read");
  const edit = useForm<EditForm>({ resolver: zodResolver(editSchema), defaultValues: { text: post.text, withImage: post.withImage } });
  const rewriting = useForm<RewriteForm>({ resolver: zodResolver(rewriteSchema), defaultValues: { note: "" } });
  const busy = save.isPending || rewrite.isPending || publish.isPending || discard.isPending;
  const still = mediaUrl(post.imageUrl);
  const editingWithImage = useWatch({ control: edit.control, name: "withImage" });
  const showStill = Boolean(still) && (mode === "edit" ? editingWithImage : post.withImage);

  const startEdit = () => {
    edit.reset({ text: post.text, withImage: post.withImage });
    setMode("edit");
  };
  const confirmPublish = () =>
    Alert.alert("Publish to the Page?", "Everyone who follows the Page can see it straight away.", [
      { text: "Not yet", style: "cancel" },
      { text: "Publish", onPress: () => publish.mutate() },
    ]);
  const confirmDiscard = () =>
    Alert.alert("Discard this post?", "It is removed from your drafts and never posted.", [
      { text: "Keep it", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => discard.mutate() },
    ]);

  return (
    <View className="gap-4 rounded-sm bg-paper p-4">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 font-mono text-xs text-paper-ink/60">{ANGLE_COPY[post.angle]}</Text>
        <Text className="font-mono text-xs text-paper-ink/60">{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</Text>
      </View>

      {showStill && (
        <View className="overflow-hidden rounded-sm bg-strip" style={{ aspectRatio: 4 / 5 }}>
          <Image source={{ uri: still }} style={{ flex: 1 }} contentFit="cover" transition={150} accessibilityLabel="The picture posted with the text" />
        </View>
      )}
      {mode !== "edit" && still && !post.withImage && <Text className="font-sans text-sm text-paper-ink/60">Posting without its picture.</Text>}

      {mode === "edit" ? (
        <View className="gap-2">
          <Controller
            control={edit.control}
            name="text"
            render={({ field }) => (
              <Field tone="paper" arabic multiline label="Post text" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} className="min-h-40 leading-9" />
            )}
          />
          <FieldError message={edit.formState.errors.text?.message} />
          {still && (
            <Controller
              control={edit.control}
              name="withImage"
              render={({ field }) => <Checkbox tone="paper" label="Post it with the picture" checked={field.value} onChange={field.onChange} />}
            />
          )}
        </View>
      ) : (
        <Text selectable className="text-right font-script text-2xl leading-[40px] text-paper-ink" style={RTL}>
          {post.text}
        </Text>
      )}

      {mode === "rewrite" && (
        <View className="gap-1.5">
          <Controller
            control={rewriting.control}
            name="note"
            render={({ field }) => (
              <Field
                tone="paper"
                multiline
                label="What should change? (optional)"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                placeholder="For example: shorter, and end on a dare"
                className="min-h-16"
              />
            )}
          />
          <FieldError message={rewriting.formState.errors.note?.message} />
        </View>
      )}

      {post.error && mode === "read" && <Text className="font-sans text-sm text-[#a3312a]">Publishing failed: {post.error}</Text>}

      <View className="flex-row flex-wrap items-center justify-end gap-2 border-t border-paper-ink/15 pt-3">
        {mode === "read" && (
          <>
            <Button label="Discard" variant="paper" size="sm" onPress={confirmDiscard} disabled={busy} busy={discard.isPending} />
            <Button label="Rewrite" variant="paper" size="sm" onPress={() => setMode("rewrite")} disabled={busy} />
            <Button label="Edit" variant="paper" size="sm" onPress={startEdit} disabled={busy} />
            <Button label="Publish" onPress={confirmPublish} disabled={busy || !canPublish} busy={publish.isPending} />
          </>
        )}
        {mode === "edit" && (
          <>
            <Button label="Cancel" variant="paper" size="sm" onPress={() => setMode("read")} disabled={busy} />
            <Button
              label="Save changes"
              busy={save.isPending}
              onPress={edit.handleSubmit((values) => save.mutate(values, { onSuccess: () => setMode("read") }))}
            />
          </>
        )}
        {mode === "rewrite" && (
          <>
            <Button label="Cancel" variant="paper" size="sm" onPress={() => setMode("read")} disabled={busy} />
            <Button
              label={rewrite.isPending ? "Rewriting" : "Rewrite it"}
              busy={rewrite.isPending}
              onPress={rewriting.handleSubmit((values) =>
                rewrite.mutate(
                  { note: values.note || undefined },
                  {
                    onSuccess: () => {
                      rewriting.reset();
                      setMode("read");
                    },
                  },
                ),
              )}
            />
          </>
        )}
      </View>
    </View>
  );
}
