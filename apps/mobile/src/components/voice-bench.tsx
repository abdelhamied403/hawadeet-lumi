import { Feather } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { Arabic, Body, Meta } from "@/components/ui/text";
import { mediaUrl } from "@/lib/http";
import type { EpisodeDetail } from "@/services/veogen";

// One player for the whole bench: pressing a recording stops whichever was playing.
export function VoiceBench({ episode }: { episode: EpisodeDetail }) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);

  const toggle = (path: string) => {
    if (current === path) {
      if (status.playing) return player.pause();
      // Finished recordings start over; paused ones carry on.
      if (status.duration > 0 && status.currentTime >= status.duration - 0.05) void player.seekTo(0);
      return player.play();
    }
    const uri = mediaUrl(path);
    if (!uri) return;
    player.replace({ uri });
    player.play();
    setCurrent(path);
  };
  const isPlaying = (path: string | null) => path !== null && current === path && status.playing;

  return (
    <View className="gap-5">
      {episode.narrationUrl && (
        <View className="gap-2">
          <Body>The whole narration</Body>
          <View className="flex-row items-center gap-3 rounded-md border border-border bg-card p-3">
            <PlayButton label="the whole narration" playing={isPlaying(episode.narrationUrl)} onPress={() => toggle(episode.narrationUrl as string)} />
            <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
              {current === episode.narrationUrl && status.duration > 0 && (
                <View className="h-full bg-primary" style={{ width: `${Math.min(100, (status.currentTime / status.duration) * 100)}%` }} />
              )}
            </View>
          </View>
        </View>
      )}
      <View className="gap-2">
        <Body>Scene by scene (check each cut starts and ends cleanly)</Body>
        {episode.scenes.map((scene) => {
          const long = scene.audioSeconds !== null && scene.audioSeconds > 6.5;
          return (
            <View key={scene.number} className="flex-row items-center gap-3 rounded-md border border-border bg-card p-3">
              {scene.audioUrl ? (
                <PlayButton label={`scene ${scene.number}`} playing={isPlaying(scene.audioUrl)} onPress={() => toggle(scene.audioUrl as string)} />
              ) : (
                <View className="size-11" />
              )}
              <View className="flex-1 gap-1">
                <Arabic className="text-xl leading-9">{scene.narration}</Arabic>
                <View className="flex-row justify-between">
                  <Meta>{String(scene.number).padStart(2, "0")}</Meta>
                  {scene.audioSeconds !== null && (
                    <Meta className={long ? "text-primary" : ""}>
                      {scene.audioSeconds.toFixed(1)} s{long ? " (the clip will be slowed to fit)" : ""}
                    </Meta>
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function PlayButton({ label, playing, onPress }: { label: string; playing: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${playing ? "Pause" : "Play"} ${label}`}
      onPress={onPress}
      className={`size-11 items-center justify-center rounded-full ${playing ? "bg-primary" : "bg-secondary"} active:opacity-80`}
    >
      <Feather name={playing ? "pause" : "play"} size={18} color={playing ? "#1a1304" : "#e4ece8"} />
    </Pressable>
  );
}
