"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, mediaUrl } from "@/lib/http";
import { cn } from "@/lib/utils";
import { updateScene, type EpisodeDetail, type EpisodeScene } from "@/services/veogen";

export function VoiceBench({ episode }: { episode: EpisodeDetail }) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      {episode.narrationUrl && (
        <div className="grid gap-2">
          <h3 className="text-sm text-muted-foreground">The whole narration</h3>
          <audio controls preload="metadata" src={mediaUrl(episode.narrationUrl)} className="w-full" />
        </div>
      )}
      <div className="grid gap-2">
        <h3 className="text-sm text-muted-foreground">Scene by scene (check each cut starts and ends cleanly)</h3>
        <ol className="grid gap-2">
          {episode.scenes.map((scene) => (
            <li key={scene.number} className="grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-[2rem_1fr_15rem] sm:items-center">
              <span className="font-mono text-xs text-muted-foreground">{String(scene.number).padStart(2, "0")}</span>
              <p dir="rtl" className="min-w-0 font-script text-xl leading-relaxed">
                {scene.narration}
              </p>
              <div className="grid gap-1">
                {scene.audioUrl && <audio controls preload="none" src={mediaUrl(scene.audioUrl)} className="h-9 w-full" />}
                {scene.audioSeconds !== null && (
                  <span className={cn("font-mono text-xs text-muted-foreground", scene.audioSeconds > 6.5 && "text-primary")}>
                    {scene.audioSeconds.toFixed(1)} s{scene.audioSeconds > 6.5 ? " (the clip will be slowed to fit)" : ""}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

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
  return (
    <div className="grid gap-4">
      {selectable && (
        <p className="text-sm text-muted-foreground">
          Mark any scene that looks wrong. Only marked scenes are redone, which saves GPU time.
        </p>
      )}
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {episode.scenes.map((scene) => (
          <SceneFrame
            key={scene.number}
            episodeId={episode.id}
            scene={scene}
            kind={kind}
            marked={marked.includes(scene.number)}
            onToggle={() => onToggle(scene.number)}
            selectable={selectable}
          />
        ))}
      </ol>
    </div>
  );
}

function SceneFrame({
  episodeId,
  scene,
  kind,
  marked,
  onToggle,
  selectable,
}: {
  episodeId: number;
  scene: EpisodeScene;
  kind: "images" | "clips";
  marked: boolean;
  onToggle: () => void;
  selectable: boolean;
}) {
  const queryClient = useQueryClient();
  const promptKey = kind === "images" ? "imagePrompt" : "motionPrompt";
  const [prompt, setPrompt] = useState(scene[promptKey]);
  const save = useMutation({
    mutationFn: () => updateScene(episodeId, scene.number, { [promptKey]: prompt.trim() }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["episode", episodeId], updated);
      toast.success(`Scene ${scene.number} description saved`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const source = kind === "images" ? scene.imageUrl : scene.clipUrl;

  return (
    <li className={cn("grid content-start gap-2 rounded-md border bg-card p-2", marked && "border-primary")}>
      <div className="relative aspect-[9/16] overflow-hidden rounded-sm bg-strip">
        {source && kind === "images" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(source)} alt={`Scene ${scene.number}: ${scene.imagePrompt}`} className="size-full object-cover" loading="lazy" />
        )}
        {source && kind === "clips" && (
          <video src={mediaUrl(source)} poster={mediaUrl(scene.imageUrl)} controls loop muted playsInline preload="none" className="size-full object-cover" />
        )}
        {!source && <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Not made yet</span>}
        <span className="absolute left-1.5 top-1.5 rounded-sm bg-strip/80 px-1.5 py-0.5 font-mono text-xs">{String(scene.number).padStart(2, "0")}</span>
      </div>
      <p dir="rtl" className="line-clamp-2 text-sm leading-snug text-muted-foreground">
        {scene.narration}
      </p>
      {selectable && (
        <Button variant={marked ? "default" : "outline"} size="sm" onClick={onToggle} aria-pressed={marked}>
          {marked ? <CheckIcon data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}
          {marked ? "Marked for redo" : "Redo this scene"}
        </Button>
      )}
      {selectable && marked && (
        <div className="grid gap-1.5">
          <Label htmlFor={`prompt-${kind}-${scene.number}`} className="text-xs text-muted-foreground">
            {kind === "images" ? "What the image shows" : "What moves"}
          </Label>
          <Textarea id={`prompt-${kind}-${scene.number}`} value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} className="text-xs" />
          <Button variant="ghost" size="sm" onClick={() => save.mutate()} disabled={save.isPending || !prompt.trim() || prompt.trim() === scene[promptKey]}>
            Save description
          </Button>
        </div>
      )}
    </li>
  );
}

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
  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,20rem)_1fr]">
      <div className="mx-auto w-full max-w-80 overflow-hidden rounded-[1.6rem] border-4 border-secondary bg-strip">
        {episode.videoUrl ? (
          <video src={mediaUrl(episode.videoUrl)} controls playsInline preload="metadata" className="aspect-[9/16] w-full" />
        ) : (
          <div className="grid aspect-[9/16] place-items-center text-sm text-muted-foreground">Not assembled yet</div>
        )}
      </div>
      <div className="grid content-start gap-5">
        <div>
          <h3 dir="rtl" className="font-script text-2xl">
            {episode.title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Watch it with sound, the way it will appear in a feed. Check the captions follow the voice and the music sits under it.
          </p>
        </div>
        {adjustable && (
          <div className="grid max-w-md gap-4 rounded-md border bg-card p-4">
            <p className="text-sm text-muted-foreground">Change the mix, then use “Ask for a fix” to rebuild the video with it. Which effect plays in which scene is set in the script.</p>
            <div className="grid gap-2">
              <Label htmlFor="music-track">Music track</Label>
              <Select value={mix.musicTrack ?? videoStep?.meta.musicTrack ?? null} onValueChange={(value) => onMixChange({ ...mix, musicTrack: value ?? undefined })}>
                <SelectTrigger id="music-track" className="w-full">
                  <SelectValue placeholder="Chosen automatically" />
                </SelectTrigger>
                <SelectContent>
                  {episode.musicTracks.map((track) => (
                    <SelectItem key={track} value={track}>
                      {track.replace(/\.[^.]+$/, "")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="music-volume">
                Music level <span className="font-mono text-xs text-muted-foreground">{Math.round(volume * 100)}%</span>
              </Label>
              <Slider
                id="music-volume"
                min={0}
                max={1}
                step={0.02}
                value={[volume]}
                onValueChange={(value) => onMixChange({ ...mix, musicVolume: Array.isArray(value) ? value[0] : value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sfx-volume">
                Sound effects level <span className="font-mono text-xs text-muted-foreground">{Math.round(sfxVolume * 100)}%</span>
              </Label>
              <Slider
                id="sfx-volume"
                min={0}
                max={1}
                step={0.05}
                value={[sfxVolume]}
                onValueChange={(value) => onMixChange({ ...mix, sfxVolume: Array.isArray(value) ? value[0] : value })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
