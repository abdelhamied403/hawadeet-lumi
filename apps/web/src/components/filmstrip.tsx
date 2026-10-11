"use client";

import { CheckIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { STATUS_COPY, STEP_COPY, stepTiming } from "@/lib/steps";
import { cn } from "@/lib/utils";
import type { StepName, StepSummary } from "@/services/veogen";

// The six steps as frames on a strip of film. The frame that needs a decision is lit.
export function Filmstrip({
  steps,
  selected,
  onSelect,
}: {
  steps: StepSummary[];
  selected: StepName;
  onSelect: (step: StepName) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md bg-strip">
      <div className="min-w-[640px]">
        <div className="sprockets" aria-hidden />
        <ol className="grid grid-cols-6 gap-1.5 px-1.5">
          {steps.map((step, index) => {
            const needsYou = step.status === "review" || step.status === "failed";
            const busy = step.status === "running" || step.status === "queued";
            return (
              <li key={step.name}>
                <button
                  type="button"
                  onClick={() => onSelect(step.name)}
                  aria-current={selected === step.name ? "step" : undefined}
                  className={cn(
                    "flex h-28 w-full flex-col justify-between rounded-sm border border-transparent bg-card p-2.5 text-left outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring",
                    step.status === "waiting" && "opacity-55",
                    selected === step.name && "border-foreground/50",
                    needsYou && "lit border-primary",
                  )}
                >
                  <span className="flex items-center justify-between font-mono text-xs text-muted-foreground">
                    {index + 1}
                    {step.status === "approved" && <CheckIcon className="size-4 text-ok" aria-hidden />}
                    {busy && <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" aria-hidden />}
                    {step.status === "failed" && <TriangleAlertIcon className="size-4 text-destructive" aria-hidden />}
                  </span>
                  <span>
                    <span className="block font-display text-xl font-bold uppercase leading-none tracking-wide">
                      {STEP_COPY[step.name].label}
                    </span>
                    <span
                      className={cn(
                        "mt-1 block text-xs text-muted-foreground",
                        needsYou && "text-primary",
                        step.status === "failed" && "text-destructive",
                      )}
                    >
                      {STATUS_COPY[step.status]}
                    </span>
                    {stepTiming(step) && <span className="block text-xs text-muted-foreground">{stepTiming(step)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="sprockets" aria-hidden />
      </div>
    </div>
  );
}

// A one-line version of the strip for lists.
export function FilmstripMini({ steps }: { steps: StepSummary[] }) {
  return (
    <span className="flex gap-0.5" aria-hidden>
      {steps.map((step) => (
        <span
          key={step.name}
          className={cn(
            "h-3 w-5 rounded-[2px] bg-secondary",
            step.status === "approved" && "bg-ok",
            (step.status === "running" || step.status === "queued") && "bg-muted-foreground",
            step.status === "review" && "bg-primary",
            step.status === "failed" && "bg-destructive",
          )}
        />
      ))}
    </span>
  );
}
