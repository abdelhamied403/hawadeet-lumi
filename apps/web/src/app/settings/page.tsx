"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/http";
import { cn } from "@/lib/utils";
import { getSettings, updateSettings } from "@/services/veogen";

// Same rules as the server's settings schema.
const settingsFormSchema = z.object({
  autoCreate: z.boolean(),
  dailyTime: z.string().regex(/^\d{2}:\d{2}$/, "Use a time like 09:00"),
  scenesPerPart: z.number({ error: "Enter a number" }).int().min(4, "At least 4 scenes").max(24, "At most 24 scenes"),
  partsPerSeries: z.number({ error: "Enter a number" }).int().min(2, "At least 2 parts").max(12, "At most 12 parts"),
});
type SettingsForm = z.infer<typeof settingsFormSchema>;

const CONNECTIONS = [
  { key: "gemini", name: "Google Gemini", role: "Writes the scripts and records the voice", setup: "GEMINI_API_KEY in .env" },
  { key: "kaggle", name: "Kaggle", role: "Makes the images and motion clips on its free GPU", setup: "KAGGLE_USERNAME and KAGGLE_KEY in .env" },
  { key: "facebook", name: "Facebook Page", role: "Posts the finished Reel automatically", setup: "FACEBOOK_PAGE_ID and FACEBOOK_PAGE_TOKEN in .env, then restart the server" },
] as const;

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: { autoCreate: true, dailyTime: "09:00", scenesPerPart: 16, partsPerSeries: 6 },
  });
  useEffect(() => {
    if (data) form.reset({ autoCreate: data.autoCreate, dailyTime: data.dailyTime, scenesPerPart: data.scenesPerPart, partsPerSeries: data.partsPerSeries });
  }, [data, form]);
  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved");
    },
    onError: (failure) => toast.error(errorMessage(failure)),
  });
  const errors = form.formState.errors;
  const scenes = form.watch("scenesPerPart") || 0;

  if (error) return <p className="text-destructive">{errorMessage(error)}</p>;
  if (!data) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="grid max-w-2xl gap-10">
      <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="grid gap-6">
        <h1 className="font-display text-4xl font-extrabold uppercase tracking-wide">Settings</h1>

        <div className="flex items-start justify-between gap-6 rounded-lg border bg-card p-4">
          <div>
            <Label htmlFor="autoCreate">Write a new part every day</Label>
            <p className="mt-1 text-sm text-muted-foreground">
              Only the script is written automatically. Nothing else is made until you approve it.
            </p>
          </div>
          <Controller
            control={form.control}
            name="autoCreate"
            render={({ field }) => <Switch id="autoCreate" checked={field.value} onCheckedChange={field.onChange} />}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <div className="grid content-start gap-1.5">
            <Label htmlFor="dailyTime">Daily at</Label>
            <Input id="dailyTime" type="time" {...form.register("dailyTime")} />
            {errors.dailyTime && <p className="text-xs text-destructive">{errors.dailyTime.message}</p>}
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="scenesPerPart">Scenes per part</Label>
            <Input id="scenesPerPart" type="number" min={4} max={24} {...form.register("scenesPerPart", { valueAsNumber: true })} />
            {errors.scenesPerPart && <p className="text-xs text-destructive">{errors.scenesPerPart.message}</p>}
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="partsPerSeries">Parts per series</Label>
            <Input id="partsPerSeries" type="number" min={2} max={12} {...form.register("partsPerSeries", { valueAsNumber: true })} />
            {errors.partsPerSeries && <p className="text-xs text-destructive">{errors.partsPerSeries.message}</p>}
          </div>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          {scenes} scenes ≈ {Math.round(scenes * 5)} s of video and about {((scenes * 19) / 60).toFixed(1)} GPU hours per part (30 free hours a week).
          Parts per series applies to the next series.
        </p>
        <div>
          <Button type="submit" disabled={save.isPending || !form.formState.isDirty}>
            Save settings
          </Button>
        </div>
      </form>

      <section className="grid gap-3">
        <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-muted-foreground">Connections</h2>
        <ul className="grid gap-2">
          {CONNECTIONS.map((connection) => {
            const connected = data.connections[connection.key];
            return (
              <li key={connection.key} className="grid gap-1 rounded-lg border bg-card px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <p className="font-medium">{connection.name}</p>
                  <p className="text-sm text-muted-foreground">{connection.role}</p>
                  {!connected && <p className="mt-1 font-mono text-xs text-muted-foreground">To connect: {connection.setup}</p>}
                </div>
                <span className={cn("text-sm", connected ? "text-ok" : "text-primary")}>{connected ? "Connected" : "Not connected"}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
