import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Arabic, Body, Meta } from "@/components/ui/text";
import { errorMessage, mediaUrl } from "@/lib/http";
import { toast } from "@/lib/toast";
import { updateScene, type EpisodeDetail, type EpisodeScene } from "@/services/veogen";

const FILL = { width: "100%", height: "100%" } as const;

// A wall of 9:16 frames. Marking a frame queues that scene for a redo; its description can be changed first.
export function SceneWall({
  episode,
  kind,
  marked,
  onToggle,
  selectable,
}: {
  episode: EpisodeDetail;
  kind: "images" | "clips";
  marked: number[];
  onToggle: (scene: number) => void;
  selectable: boolean;
}) {
  const [viewing, setViewing] = useState<EpisodeScene | null>(null);
  const problemKey = kind === "images" ? "imageProblem" : "clipProblem";
  const flagged = episode.scenes.filter((scene) => scene[problemKey]).length;
  return (
    <View className="gap-4">
      {selectable && <Body>Tap a frame to see it full screen. Mark any scene that looks wrong: only marked scenes are redone, which saves GPU time.</Body>}
      {flagged > 0 && (
        <View className="flex-row items-start gap-2 rounded-md border border-primary/40 bg-primary/10 p-3">
          <Feather name="alert-triangle" size={16} color="#e9a23b" style={{ marginTop: 2 }} />
          <Body className="flex-1">
            {`The automatic check flagged ${flagged} ${flagged === 1 ? "scene" : "scenes"} that may not show what ${flagged === 1 ? "its line says" : "their lines say"}. Nothing is redone until you mark it.`}
          </Body>
        </View>
      )}
      <View className="flex-row flex-wrap justify-between gap-y-3">
        {episode.scenes.map((scene) => (
          <SceneFrame
            key={scene.number}
            episodeId={episode.id}
            scene={scene}
            kind={kind}
            marked={marked.includes(scene.number)}
            onToggle={() => onToggle(scene.number)}
            onView={() => setViewing(scene)}
            selectable={selectable}
          />
        ))}
      </View>
      {viewing && <Viewer scene={viewing} kind={kind} onClose={() => setViewing(null)} />}
    </View>
  );
}

function SceneFrame({
  episodeId,
  scene,
  kind,
  marked,
  onToggle,
  onView,
  selectable,
}: {
  episodeId: number;
  scene: EpisodeScene;
  kind: "images" | "clips";
  marked: boolean;
  onToggle: () => void;
  onView: () => void;
  selectable: boolean;
}) {
  const queryClient = useQueryClient();
  const promptKey = kind === "images" ? "imagePrompt" : "motionPrompt";
  const [prompt, setPrompt] = useState(scene[promptKey]);
  const save = useMutation({
    mutationFn: () => updateScene(episodeId, scene.number, { [promptKey]: prompt.trim() }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["episode", episodeId], updated);
      toast(`Scene ${scene.number} description saved`);
    },
    onError: (error) => toast(errorMessage(error)),
  });
  const made = kind === "images" ? scene.imageUrl : scene.clipUrl;
  // A clip shows its still image until it is opened.
  const still = mediaUrl(scene.imageUrl);
  const problem = kind === "images" ? scene.imageProblem : scene.clipProblem;

  return (
    <View className={`w-[48.5%] gap-2 rounded-md border bg-card p-2 ${marked ? "border-primary" : problem ? "border-primary/40" : "border-border"}`}>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`Scene ${scene.number}${made ? `, open ${kind === "images" ? "image" : "clip"}` : ", not made yet"}`}
        disabled={!made}
        onPress={onView}
        className="aspect-[9/16] overflow-hidden rounded-sm bg-strip"
      >
        {made && still ? <Image source={{ uri: still }} style={FILL} contentFit="cover" transition={150} /> : null}
        {!made && (
          <View className="absolute inset-0 items-center justify-center">
            <Meta>Not made yet</Meta>
          </View>
        )}
        {made && kind === "clips" && (
          <View className="absolute inset-0 items-center justify-center">
            <View className="size-11 items-center justify-center rounded-full bg-strip/80">
              <Feather name="play" size={18} color="#e4ece8" />
            </View>
          </View>
        )}
        <Text className="absolute left-1.5 top-1.5 rounded-sm bg-strip/80 px-1.5 py-0.5 font-mono text-xs text-foreground">{String(scene.number).padStart(2, "0")}</Text>
      </Pressable>
      <Arabic numberOfLines={2} className="text-base leading-7 text-muted-foreground">
        {scene.narration}
      </Arabic>
      {problem && (
        <View className="flex-row items-start gap-1.5">
          <Feather name="alert-triangle" size={12} color="#e9a23b" style={{ marginTop: 3 }} />
          <Text className="flex-1 font-sans text-xs leading-4 text-primary">{problem}</Text>
        </View>
      )}
      {selectable && (
        <Button
          label={marked ? "Marked for redo" : "Redo this scene"}
          variant={marked ? "primary" : "outline"}
          size="sm"
          accessibilityState={{ selected: marked }}
          onPress={onToggle}
        />
      )}
      {selectable && marked && (
        <View className="gap-1.5">
          <Field label={kind === "images" ? "What the image shows" : "What moves"} value={prompt} onChangeText={setPrompt} multiline className="min-h-24 text-xs" />
          <Button
            label="Save description"
            variant="ghost"
            size="sm"
            onPress={() => save.mutate()}
            busy={save.isPending}
            disabled={!prompt.trim() || prompt.trim() === scene[promptKey]}
          />
        </View>
      )}
    </View>
  );
}

// One scene at full size. The clip player only exists while this is open.
function Viewer({ scene, kind, onClose }: { scene: EpisodeScene; kind: "images" | "clips"; onClose: () => void }) {
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView className="flex-1 bg-strip">
        <View className="flex-row items-center justify-between px-4 py-2">
          <Meta>Scene {String(scene.number).padStart(2, "0")}</Meta>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} className="size-11 items-center justify-center rounded-full active:bg-secondary">
            <Feather name="x" size={22} color="#e4ece8" />
          </Pressable>
        </View>
        <View className="flex-1">
          {kind === "images" ? (
            <Image source={{ uri: mediaUrl(scene.imageUrl) }} style={FILL} contentFit="contain" accessibilityLabel={`Scene ${scene.number}: ${scene.imagePrompt}`} />
          ) : (
            <Clip uri={mediaUrl(scene.clipUrl) as string} />
          )}
        </View>
        <View className="gap-1 px-4 py-3">
          <Arabic className="text-lg leading-8">{scene.narration}</Arabic>
          <Body className="text-xs">{kind === "images" ? scene.imagePrompt : scene.motionPrompt}</Body>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Clip({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (created) => {
    created.loop = true;
    created.muted = true;
    created.play();
  });
  return <VideoView player={player} style={FILL} contentFit="contain" nativeControls />;
}
