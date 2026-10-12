import { Feather } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Controller, useForm } from "react-hook-form";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Body, FieldError, Meta } from "@/components/ui/text";
import { errorMessage, mediaUrl } from "@/lib/http";
import { toast } from "@/lib/toast";
import { buildFullStory, saveFullStoryLink, uploadFullStory, type SeriesDetail } from "@/services/veogen";

const YOUTUBE_UPLOAD = "https://www.youtube.com/upload";

// Same rule as the server: a full link, or nothing to clear it.
const linkSchema = z.object({ url: z.union([z.literal(""), z.url("Paste the full link, starting with https://")]) });
type LinkForm = z.infer<typeof linkSchema>;

const partList = (parts: number[]) => (parts.length === 0 ? "none" : parts.join(", "));

// Downloads the joined video to the phone, then opens Android's share sheet with it.
async function shareFullStory(series: SeriesDetail): Promise<void> {
  const uri = mediaUrl(series.fullStory.videoUrl);
  if (!uri) throw new Error("The full story has not been put together yet");
  const target = new File(Paths.cache, `veogen-series-${series.id}-full.mp4`);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(uri, target);
  await Sharing.shareAsync(file.uri, { mimeType: "video/mp4", dialogTitle: "Send the full story to" });
}

// The whole series as one video: put it together, send it to YouTube by hand, then save where it went.
export function FullStoryCard({ series }: { series: SeriesDetail }) {
  const queryClient = useQueryClient();
  const full = series.fullStory;
  const refresh = (fresh: SeriesDetail) => queryClient.setQueryData(["series", series.id], fresh);
  const onError = (failure: unknown) => toast(errorMessage(failure));

  const build = useMutation({ mutationFn: () => buildFullStory(series.id), onSuccess: refresh, onError });
  const share = useMutation({ mutationFn: () => shareFullStory(series), onError });
  const upload = useMutation({
    mutationFn: () => uploadFullStory(series.id),
    onSuccess: (fresh) => {
      refresh(fresh);
      toast("Uploaded to YouTube");
    },
    onError: (failure) => {
      // An upload that YouTube kept private still saves its link, so the series is read again.
      void queryClient.invalidateQueries({ queryKey: ["series", series.id] });
      onError(failure);
    },
  });
  const confirmUpload = () =>
    Alert.alert("Upload to YouTube?", "The full story goes on your channel as a public video.", [
      { text: "Not yet", style: "cancel" },
      { text: "Upload", onPress: () => upload.mutate() },
    ]);
  const form = useForm<LinkForm>({ resolver: zodResolver(linkSchema), defaultValues: { url: full.youtubeUrl ?? "" } });
  const saveLink = useMutation({
    mutationFn: (values: LinkForm) => saveFullStoryLink(series.id, { url: values.url.trim() }),
    onSuccess: (fresh) => {
      refresh(fresh);
      form.reset({ url: fresh.fullStory.youtubeUrl ?? "" });
      toast(fresh.fullStory.youtubeUrl ? "Link saved" : "Link cleared");
    },
    onError,
  });

  const copy = async () => {
    await Clipboard.setStringAsync(full.description);
    toast("Description copied");
  };

  const published = full.publishedParts.length;
  const total = series.parts.length;
  const working = full.building || build.isPending;
  const outOfDate = Boolean(full.videoUrl) && full.includedParts.length < published;

  return (
    <View className="gap-4 rounded-lg border border-border bg-card p-4">
      <View className="gap-1">
        <Text className="font-sans-medium text-lg text-foreground">The full story, for YouTube</Text>
        <Body>Every published part joined into one video. Each part on its own is short enough to upload as a YouTube Short.</Body>
      </View>

      {published < 2 ? (
        <Meta className="leading-5">Available once two parts are published ({published} of {total} so far).</Meta>
      ) : (
        <>
          <Meta className="leading-5">
            {published} of {total} parts published
            {full.videoUrl ? ` · the video holds parts ${partList(full.includedParts)}` : ""}
          </Meta>
          {working ? (
            <Body>Putting the video together. This takes a few minutes; this screen updates by itself.</Body>
          ) : (
            <Button
              label={full.videoUrl ? (outOfDate ? "Join again with the new parts" : "Join the parts again") : "Join the published parts"}
              variant={full.videoUrl && !outOfDate ? "outline" : "primary"}
              className="self-start"
              onPress={() => build.mutate()}
            />
          )}
        </>
      )}

      {full.videoUrl && !working && (
        <>
          <View className="gap-2">
            <View className="flex-row items-center justify-between gap-3">
              <Body className="flex-1">Description that goes with it</Body>
              <Button label="Copy" variant="ghost" size="sm" onPress={() => void copy()} />
            </View>
            <Text selectable className="rounded-md border border-border bg-strip p-3 font-sans text-sm leading-6 text-foreground">
              {full.description}
            </Text>
          </View>

          <View className="gap-2">
            <Body>{full.canUpload ? "Upload it to your channel from here, or send the video to the YouTube app yourself." : "YouTube is not connected on the server, so this one is uploaded by hand."}</Body>
            <View className="flex-row flex-wrap items-center gap-2">
              {full.canUpload && !full.youtubeUrl && <Button label={upload.isPending ? "Uploading" : "Upload to YouTube"} busy={upload.isPending} onPress={confirmUpload} />}
              <Button
                label={share.isPending ? "Downloading the video" : "Send the video to an app"}
                variant={full.canUpload ? "outline" : "primary"}
                busy={share.isPending}
                onPress={() => share.mutate()}
              />
              <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(YOUTUBE_UPLOAD)} className="min-h-11 flex-row items-center gap-1.5 px-2">
                <Text className="font-sans-medium text-sm text-primary">Open the upload page</Text>
                <Feather name="external-link" size={14} color="#e9a23b" />
              </Pressable>
            </View>
          </View>

          <View className="gap-2">
            <Controller
              control={form.control}
              name="url"
              render={({ field }) => (
                <Field
                  label="YouTube link, once it is uploaded"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  placeholder="https://youtu.be/…"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              )}
            />
            <FieldError message={form.formState.errors.url?.message} />
            <Meta className="leading-5">With the link saved, the description of every later part sends viewers to the full story.</Meta>
            <Button label="Save link" variant="outline" className="self-start" busy={saveLink.isPending} disabled={!form.formState.isDirty} onPress={form.handleSubmit((values) => saveLink.mutate(values))} />
          </View>
        </>
      )}
    </View>
  );
}
