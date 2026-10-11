"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  const [fixing, setFixing] = useState(marked.length > 0);
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
    <div className="sticky bottom-3 z-10 rounded-lg border bg-card/95 p-3 shadow-lg backdrop-blur">
      {open && (
        <div className="mb-3 grid gap-2">
          <label htmlFor={`note-${step}`} className="text-sm text-muted-foreground">
            {perScene && marked.length > 0
              ? `Redo ${marked.length === 1 ? "scene" : "scenes"} ${marked.join(", ")}. Anything to change? (optional)`
              : "What should change?"}
          </label>
          <Textarea id={`note-${step}`} value={note} onChange={(event) => setNote(event.target.value)} placeholder={noteHint} rows={2} dir="auto" />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {open ? (
          <>
            <Button variant="ghost" onClick={() => setFixing(false)} disabled={busy || marked.length > 0}>
              Cancel
            </Button>
            <Button variant="outline" onClick={send} disabled={busy || (!perScene && !note.trim() && !extra)}>
              {perScene && marked.length > 0 ? `Redo ${marked.length} marked` : perScene ? "Redo all scenes" : "Send back"}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => setFixing(true)} disabled={busy}>
            Ask for a fix
          </Button>
        )}
        <Button onClick={() => approve.mutate(step)} disabled={busy || marked.length > 0} size="lg">
          {STEP_COPY[step].approve}
        </Button>
      </div>
    </div>
  );
}
