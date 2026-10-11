import { useVideoPlayer, VideoView } from "expo-video";
import { View } from "react-native";
import { LevelStepper } from "@/components/ui/controls";
import { Picker } from "@/components/ui/picker";
import { Arabic, Body, Meta } from "@/components/ui/text";
import { mediaUrl } from "@/lib/http";
import type { EpisodeDetail } from "@/services/veogen";

export type MixChoice = { musicTrack?: string; musicVolume?: number; sfxVolume?: number };

export function VideoBench({
  episode,
  mix,
  onMixChange,
  adjustable,
}: {
  episode: EpisodeDetail;
  mix: MixChoice;
  onMixChange: (mix: MixChoice) => void;
  adjustable: boolean;
}) {
  const videoStep = episode.steps.find((step) => step.name === "video");
  const volume = mix.musicVolume ?? videoStep?.meta.musicVolume ?? 0.32;
  const sfxVolume = mix.sfxVolume ?? videoStep?.meta.sfxVolume ?? 0.45;
  const uri = mediaUrl(episode.videoUrl);

  return (
    <View className="gap-5">
      <View className="w-64 self-center overflow-hidden rounded-3xl border-4 border-secondary bg-strip">
        <View className="aspect-[9/16]">
          {uri ? (
            <FinalCut key={uri} uri={uri} />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Meta>Not assembled yet</Meta>
            </View>
          )}
        </View>
      </View>
      <View className="gap-1">
        <Arabic className="text-2xl leading-10">{episode.title}</Arabic>
        <Body>Watch it with sound, the way it will appear in a feed. Check the captions follow the voice and the music sits under it.</Body>
      </View>
      {adjustable && (
        <View className="gap-4 rounded-md border border-border bg-card p-4">
          <Body>Change the mix, then use “Ask for a fix” to rebuild the video with it. Which effect plays in which scene is set in the script.</Body>
          <View className="gap-2">
            <Body className="font-sans-medium text-foreground">Music track</Body>
            <Picker
              label="Music track"
              placeholder="Chosen automatically"
              value={mix.musicTrack ?? videoStep?.meta.musicTrack ?? null}
              options={episode.musicTracks.map((track) => ({ value: track, label: track.replace(/\.[^.]+$/, "") }))}
              onChange={(musicTrack) => onMixChange({ ...mix, musicTrack })}
            />
          </View>
          <LevelStepper label="Music level" value={volume} step={0.04} onChange={(musicVolume) => onMixChange({ ...mix, musicVolume })} />
          <LevelStepper label="Sound effects level" value={sfxVolume} step={0.05} onChange={(next) => onMixChange({ ...mix, sfxVolume: next })} />
        </View>
      )}
    </View>
  );
}

function FinalCut({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} style={{ width: "100%", height: "100%" }} contentFit="contain" nativeControls />;
}
