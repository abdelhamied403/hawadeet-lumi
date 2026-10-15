"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/http";
import { updateSeries, type SeriesDetail } from "@/services/veogen";

// Same rules as the server's series plan schema.
const planSchema = z.object({
  title: z.string().min(1, "The title is empty"),
  premise: z.string().min(1, "Describe the whole story, including the ending"),
  characterSheet: z.string().min(1, "Describe the main character's look"),
  styleSheet: z.string().min(1, "Describe the look of the images"),
  parts: z
    .array(
      z.object({
        summary: z.string().min(1, "Say what happens in this part"),
        cliffhanger: z.string().min(1, "Say what this part ends on"),
      }),
    )
    .min(2, "A series needs at least 2 parts")
    .max(12, "A series can have at most 12 parts"),
});
type PlanForm = z.infer<typeof planSchema>;

export function SeriesPlanEditor({ series, onDone }: { series: SeriesDetail; onDone: () => void }) {
  const queryClient = useQueryClient();
  // Parts that already have a script; they can be reworded here but the script itself does not change.
  const started = Math.max(0, ...series.episodes.filter((episode) => episode.status !== "cancelled").map((episode) => episode.partNumber));
  const form = useForm<PlanForm>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      title: series.title,
      premise: series.premise,
      characterSheet: series.characterSheet,
      styleSheet: series.styleSheet,
      parts: series.parts.map((part) => ({ summary: part.summary, cliffhanger: part.cliffhanger })),
    },
  });
  const parts = useFieldArray({ control: form.control, name: "parts" });
  const save = useMutation({
    mutationFn: (values: PlanForm) =>
      updateSeries(series.id, {
        ...values,
        hashtags: series.hashtags,
        cast: series.cast,
        parts: values.parts.map((part, index) => ({ number: index + 1, ...part })),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["series", series.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["overview"] });
      toast.success("Plan saved");
      onDone();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="grid min-w-0 gap-6">
      <p className="max-w-3xl text-sm text-muted-foreground">
        The next scripts are written from this plan. Scripts that already exist are not changed, so reword a finished part here only to
        keep the plan in step with what you approved.
      </p>

      <div className="grid max-w-3xl gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="plan-title">Series title</Label>
          <Input id="plan-title" dir="rtl" className="font-script text-xl" {...form.register("title")} />
          {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="plan-premise">The whole story, including how it ends</Label>
          <Textarea id="plan-premise" dir="auto" rows={6} {...form.register("premise")} />
          {errors.premise && <p className="text-xs text-destructive">{errors.premise.message}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="plan-character">Main character's look (English, used for every image)</Label>
          <Textarea id="plan-character" rows={2} {...form.register("characterSheet")} />
          {errors.characterSheet && <p className="text-xs text-destructive">{errors.characterSheet.message}</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="plan-style">Look of the images (English)</Label>
          <Textarea id="plan-style" rows={2} {...form.register("styleSheet")} />
          {errors.styleSheet && <p className="text-xs text-destructive">{errors.styleSheet.message}</p>}
          <p className="text-xs text-muted-foreground">Changing the character or the look mid-series makes later parts look different from earlier ones.</p>
        </div>
      </div>

      <ol className="grid gap-3">
        {parts.fields.map((field, index) => {
          const number = index + 1;
          const isLast = index === parts.fields.length - 1;
          return (
            <li key={field.id} className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[3rem_1fr_1fr_auto]">
              <span className="font-mono text-sm text-muted-foreground">
                {String(number).padStart(2, "0")}
                {number <= started && <span className="block text-xs">written</span>}
              </span>
              <div className="grid content-start gap-1.5">
                <Label htmlFor={`part-${index}-summary`}>What happens</Label>
                <Textarea id={`part-${index}-summary`} dir="auto" rows={4} {...form.register(`parts.${index}.summary`)} />
                {errors.parts?.[index]?.summary && <p className="text-xs text-destructive">{errors.parts[index].summary.message}</p>}
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor={`part-${index}-cliffhanger`}>{isLast ? "Happy ending it closes on" : "What it ends on"}</Label>
                <Textarea id={`part-${index}-cliffhanger`} dir="auto" rows={4} {...form.register(`parts.${index}.cliffhanger`)} />
                {errors.parts?.[index]?.cliffhanger && <p className="text-xs text-destructive">{errors.parts[index].cliffhanger.message}</p>}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove part ${number}`}
                title={number <= started ? "This part is already written" : "Remove this part"}
                disabled={number <= started || parts.fields.length <= 2}
                onClick={() => parts.remove(index)}
              >
                <Trash2Icon />
              </Button>
            </li>
          );
        })}
      </ol>
      {errors.parts?.root && <p className="text-xs text-destructive">{errors.parts.root.message}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" disabled={parts.fields.length >= 12} onClick={() => parts.append({ summary: "", cliffhanger: "" })}>
          <PlusIcon data-icon="inline-start" />
          Add a part
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Discard changes
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Save plan
          </Button>
        </div>
      </div>
    </form>
  );
}
