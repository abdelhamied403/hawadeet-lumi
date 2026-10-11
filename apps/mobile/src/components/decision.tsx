import { useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useEpisodeActions } from "@/hooks/use-episode-actions";
import { STEP_COPY } from "@/lib/steps";
import type { RejectStepPayload, StepName } from "@/services/veogen";

// Approve the step, or send it back with a note. `marked` lists scenes picked for a redo (images and motion).
export function Decision({
  episodeId,
  step,
  marked = [],
  extra,
  noteHint,
}: {
  episodeId: number;
  step: Exclude<StepName, "publish">;
  marked?: number[];
  extra?: Pick<RejectStepPayload, "musicTrack" | "musicVolume" | "sfxVolume">;
  noteHint: string;
}) {
  const { approve, sendBack } = useEpisodeActions(episodeId);
  const [fixing, setFixing] = useState(false);
  const [note, setNote] = useState("");
  const busy = approve.isPending || sendBack.isPending;
  const perScene = step === "images" || step === "clips";
  const open = fixing || marked.length > 0;

  const send = () =>
    sendBack.mutate({
      step,
      payload: { note: note.trim() || undefined, scenes: marked.length > 0 ? marked : undefined, ...extra },
    });

  return (
    <View className="gap-3">
      {open && (
        <Field
          label={
            perScene && marked.length > 0
              ? `Redo ${marked.length === 1 ? "scene" : "scenes"} ${marked.join(", ")}. Anything to change? (optional)`
              : "What should change?"
          }
          value={note}
          onChangeText={setNote}
          placeholder={noteHint}
          multiline
          className="min-h-16"
        />
      )}
      <View className="flex-row flex-wrap items-center justify-end gap-2">
        {open ? (
          <>
            {marked.length === 0 && <Button label="Cancel" variant="ghost" onPress={() => setFixing(false)} disabled={busy} />}
            <Button
              label={perScene && marked.length > 0 ? `Redo ${marked.length} marked` : perScene ? "Redo all scenes" : "Send back"}
              variant="outline"
              onPress={send}
              busy={sendBack.isPending}
              disabled={busy || (!perScene && !note.trim() && !extra)}
            />
          </>
        ) : (
          <Button label="Ask for a fix" variant="outline" onPress={() => setFixing(true)} disabled={busy} />
        )}
        <Button label={STEP_COPY[step].approve} size="lg" onPress={() => approve.mutate(step)} busy={approve.isPending} disabled={busy || marked.length > 0} />
      </View>
    </View>
  );
}
