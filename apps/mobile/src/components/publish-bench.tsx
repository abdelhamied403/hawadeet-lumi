import { Feather } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Linking, Pressable, Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Body } from "@/components/ui/text";
import { errorMessage, mediaUrl } from "@/lib/http";
import { toast } from "@/lib/toast";
import type { EpisodeDetail, PublishResult } from "@/services/veogen";

const PLATFORMS: { key: string; name: string }[] = [
  { key: "facebook", name: "Facebook Reels" },
  { key: "youtube", name: "YouTube Shorts" },
  { key: "tiktok", name: "TikTok" },
];

const RESULT_COPY: Record<PublishResult["status"], string> = {
  posted: "Posted",
  manual: "Post it yourself",
  failed: "Failed",
};

// Downloads the finished video to the phone, then opens Android's share sheet with it.
async function shareVideo(episode: EpisodeDetail): Promise<void> {
  const uri = mediaUrl(episode.videoUrl);
  if (!uri) throw new Error("The video has not been assembled yet");
  const target = new File(Paths.cache, `veogen-part-${episode.partNumber}.mp4`);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(uri, target);
  await Sharing.shareAsync(file.uri, { mimeType: "video/mp4", dialogTitle: "Send the video to" });
}

export function PublishBench({ episode }: { episode: EpisodeDetail }) {
  const step = episode.steps.find((candidate) => candidate.name === "publish");
  const results = step?.meta.published;
  const share = useMutation({ mutationFn: () => shareVideo(episode), onError: (error) => toast(errorMessage(error)) });

  const copy = async () => {
    await Clipboard.setStringAsync(episode.description);
    toast("Description copied");
  };

  return (
    <View className="gap-5">
      <View className="gap-2">
        <View className="flex-row items-center justify-between gap-3">
          <Body className="flex-1">Description that goes with the video</Body>
          <Button label="Copy" variant="ghost" size="sm" onPress={() => void copy()} />
        </View>
        <Text selectable className="rounded-md border border-border bg-card p-4 font-sans text-sm leading-6 text-foreground">
          {episode.description}
        </Text>
      </View>

      <View className="gap-2">
        <Body>Where it goes</Body>
        {PLATFORMS.map((platform) => {
          const result = results?.[platform.key];
          const url = result?.url;
          return (
            <View key={platform.key} className="gap-1 rounded-md border border-border bg-card px-4 py-3">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="font-sans-medium text-base text-foreground">{platform.name}</Text>
                {result && (
                  <Text className={`font-sans text-sm ${result.status === "posted" ? "text-ok" : result.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                    {RESULT_COPY[result.status]}
                  </Text>
                )}
              </View>
              {!result && <Body>{platform.key === "tiktok" ? "You upload it yourself" : "Posts automatically once connected"}</Body>}
              {result?.detail && <Body className="text-xs">{result.detail}</Body>}
              {url && (
                <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(url)} className="min-h-11 flex-row items-center gap-1.5 self-start">
                  <Text className="font-sans-medium text-sm text-primary">{result.status === "posted" ? "View the post" : "Open the upload page"}</Text>
                  <Feather name="external-link" size={14} color="#e9a23b" />
                </Pressable>
              )}
            </View>
          );
        })}
        <Body className="text-xs">TikTok is posted by hand, and so is YouTube until its channel is connected. Send the video straight to their apps from here.</Body>
        {episode.videoUrl && (
          <Button
            label={share.isPending ? "Downloading the video" : "Send the video to an app"}
            variant="outline"
            busy={share.isPending}
            onPress={() => share.mutate()}
            className="self-start"
          />
        )}
      </View>
    </View>
  );
}
