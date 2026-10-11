"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Controller, useFieldArray, useForm, type Control, type UseFormRegister } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/http";
import { cn } from "@/lib/utils";
import { HERO, NARRATOR, updateStory, type CastMember, type EpisodeDetail } from "@/services/veogen";

// Same rules as the server's story schema, so both accept and reject the same script.
const storyFormSchema = z.object({
  title: z.string().min(1, "The title is empty"),
  description: z.string(),
  scenes: z
    .array(
      z.object({
        lines: z
          .array(z.object({ speaker: z.string().min(1), text: z.string().min(1, "This line is empty") }))
          .min(1, "A scene needs at least one line"),
        imagePrompt: z.string().min(1, "Describe what the image shows"),
        shows: z.array(z.string()).optional(),
        motionPrompt: z.string().min(1, "Describe what moves"),
        sfx: z.string().nullable(),
      }),
    )
    .min(1),
});
type StoryForm = z.infer<typeof storyFormSchema>;

const WORD_LIMIT = 9;
const countWords = (text: string) => text.split(/\s+/).filter((token) => /[ء-ي]/.test(token)).length;

function speakerName(speaker: string, cast: CastMember[]): string {
  if (speaker === NARRATOR) return "Narrator";
  if (speaker === HERO) return "He says";
  const member = cast.find((candidate) => candidate.name === speaker);
  return member?.nameArabic || speaker;
}

function personName(who: string, cast: CastMember[]): string {
  if (who === HERO) return "Main character";
  return cast.find((candidate) => candidate.name === who)?.nameArabic || who;
}

// The script as a typed page: the one light surface on the desk.
export function StoryBench({ episode, editable }: { episode: EpisodeDetail; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const story = episode.story;
  if (!story) return null;

  return (
    <div className="grid gap-4">
      {episode.plan && (
        <p className="max-w-3xl text-sm text-muted-foreground">
          <span className="text-foreground">Plan for this part:</span> {episode.plan.summary}{" "}
          <span className="text-foreground">Ends on:</span> {episode.plan.cliffhanger}
        </p>
      )}
      <article className="mx-auto w-full max-w-3xl rounded-sm bg-paper px-5 py-7 text-paper-ink shadow-xl sm:px-10">
        {editing ? (
          <StoryEditor episode={episode} onDone={() => setEditing(false)} />
        ) : (
          <>
            <header dir="rtl" className="border-b border-paper-ink/20 pb-4">
              <h2 className="font-script text-3xl font-bold leading-snug">{story.title}</h2>
              {story.description && <p className="mt-2 font-script text-lg text-paper-ink/70">{story.description}</p>}
            </header>
            <ol className="mt-2">
              {story.scenes.map((scene, index) => {
                const words = countWords(scene.narration);
                return (
                  <li key={index} className="grid grid-cols-[2rem_1fr] gap-x-3 border-b border-paper-ink/10 py-4 last:border-0">
                    <span className="pt-2 font-mono text-xs text-paper-ink/50">{String(index + 1).padStart(2, "0")}</span>
                    <div className="min-w-0">
                      {scene.lines.map((line, lineIndex) => {
                        const spoken = line.speaker !== NARRATOR;
                        return (
                          <p key={lineIndex} dir="rtl" className={cn("font-script text-2xl leading-relaxed", spoken && "font-bold")}>
                            {spoken && (
                              <span className="ml-2 rounded-sm bg-paper-ink/10 px-1.5 py-0.5 align-middle font-sans text-xs font-medium">
                                {speakerName(line.speaker, story.cast)}
                              </span>
                            )}
                            {line.text}
                          </p>
                        );
                      })}
                      <dl className="mt-2 grid gap-1 text-[13px] leading-snug text-paper-ink/65">
                        <div>
                          <dt className="inline font-medium text-paper-ink/85">Image: </dt>
                          <dd className="inline">{scene.imagePrompt}</dd>
                        </div>
                        {scene.shows && (
                          <div>
                            <dt className="inline font-medium text-paper-ink/85">In the picture: </dt>
                            <dd className="inline">
                              {scene.shows.length > 0 ? scene.shows.map((who) => personName(who, story.cast)).join(", ") : "Nobody"}
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt className="inline font-medium text-paper-ink/85">Motion: </dt>
                          <dd className="inline">{scene.motionPrompt}</dd>
                        </div>
                        {scene.sfx && (
                          <div>
                            <dt className="inline font-medium text-paper-ink/85">Sound: </dt>
                            <dd className="inline">{episode.soundEffects[scene.sfx] ?? scene.sfx}</dd>
                          </div>
                        )}
                      </dl>
                      {words > WORD_LIMIT && (
                        <p className="mt-1 text-xs font-medium text-red-800">
                          {words} words: scenes over {WORD_LIMIT} run longer than the 5-second clip.
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </article>
      {editable && !editing && (
        <div className="mx-auto flex w-full max-w-3xl justify-end">
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit script
          </Button>
        </div>
      )}
    </div>
  );
}

const FIELD = "border-paper-ink/25 bg-white/60 text-paper-ink placeholder:text-paper-ink/40";
// The select needs a value for "none"; the story stores that as null.
const NO_SOUND = "none";

function StoryEditor({ episode, onDone }: { episode: EpisodeDetail; onDone: () => void }) {
  const queryClient = useQueryClient();
  const story = episode.story!;
  const form = useForm<StoryForm>({
    resolver: zodResolver(storyFormSchema),
    defaultValues: {
      title: story.title,
      description: story.description,
      scenes: story.scenes.map((scene) => ({ lines: scene.lines, imagePrompt: scene.imagePrompt, shows: scene.shows, motionPrompt: scene.motionPrompt, sfx: scene.sfx })),
    },
  });
  const { fields } = useFieldArray({ control: form.control, name: "scenes" });
  const save = useMutation({
    mutationFn: (values: StoryForm) => updateStory(episode.id, { ...story, ...values }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["episode", episode.id], updated);
      toast.success("Script saved");
      onDone();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="grid gap-5">
      <div className="grid gap-2">
        <label htmlFor="story-title" className="text-xs font-medium uppercase tracking-wider text-paper-ink/60">
          Title
        </label>
        <Input id="story-title" dir="rtl" className={cn(FIELD, "font-script text-xl")} {...form.register("title")} />
        {errors.title && <p className="text-xs text-red-800">{errors.title.message}</p>}
        <label htmlFor="story-description" className="text-xs font-medium uppercase tracking-wider text-paper-ink/60">
          Description
        </label>
        <Textarea id="story-description" dir="rtl" rows={2} className={cn(FIELD, "font-script text-lg")} {...form.register("description")} />
      </div>
      {fields.map((item, index) => (
        <fieldset key={item.id} className="grid gap-2 border-t border-paper-ink/15 pt-4">
          <legend className="float-left font-mono text-xs text-paper-ink/50">Scene {index + 1}</legend>
          <div className="clear-both">
            <SceneLines control={form.control} register={form.register} scene={index} cast={story.cast} />
          </div>
          {errors.scenes?.[index]?.lines && (
            <p className="text-xs text-red-800">
              {errors.scenes[index].lines.message ?? errors.scenes[index].lines.find?.((line) => line?.text)?.text?.message}
            </p>
          )}
          <Textarea
            id={`scene-${index}-image`}
            aria-label={`Scene ${index + 1} image description`}
            rows={2}
            className={cn(FIELD, "text-[13px]")}
            {...form.register(`scenes.${index}.imagePrompt`)}
          />
          {errors.scenes?.[index]?.imagePrompt && <p className="text-xs text-red-800">{errors.scenes[index].imagePrompt.message}</p>}
          <Controller
            control={form.control}
            name={`scenes.${index}.shows`}
            render={({ field }) => (
              <div role="group" aria-label={`Scene ${index + 1} people in the picture`} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                <span className="text-paper-ink/60">In the picture:</span>
                {[HERO, ...story.cast.map((member) => member.name)].map((who) => {
                  const shown = field.value ?? [];
                  return (
                    <label key={who} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="size-3.5 accent-paper-ink"
                        checked={shown.includes(who)}
                        onChange={(event) => field.onChange(event.target.checked ? [...shown, who] : shown.filter((name) => name !== who))}
                      />
                      {personName(who, story.cast)}
                    </label>
                  );
                })}
              </div>
            )}
          />
          <Textarea
            id={`scene-${index}-motion`}
            aria-label={`Scene ${index + 1} motion description`}
            rows={2}
            className={cn(FIELD, "text-[13px]")}
            {...form.register(`scenes.${index}.motionPrompt`)}
          />
          {errors.scenes?.[index]?.motionPrompt && <p className="text-xs text-red-800">{errors.scenes[index].motionPrompt.message}</p>}
          <Controller
            control={form.control}
            name={`scenes.${index}.sfx`}
            render={({ field }) => (
              <Select value={field.value ?? NO_SOUND} onValueChange={(value) => field.onChange(!value || value === NO_SOUND ? null : value)}>
                <SelectTrigger id={`scene-${index}-sfx`} aria-label={`Scene ${index + 1} sound effect`} className={cn(FIELD, "w-full text-[13px] sm:w-72")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SOUND}>No sound effect</SelectItem>
                  {Object.entries(episode.soundEffects).map(([name, description]) => (
                    <SelectItem key={name} value={name}>
                      {description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </fieldset>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className="text-paper-ink hover:bg-paper-ink/10 hover:text-paper-ink" onClick={onDone}>
          Discard changes
        </Button>
        <Button type="submit" disabled={save.isPending}>
          Save script
        </Button>
      </div>
    </form>
  );
}

// The spoken lines of one scene: who says each, and what.
function SceneLines({
  control,
  register,
  scene,
  cast,
}: {
  control: Control<StoryForm>;
  register: UseFormRegister<StoryForm>;
  scene: number;
  cast: CastMember[];
}) {
  const lines = useFieldArray({ control, name: `scenes.${scene}.lines` });
  const speakers = [{ value: NARRATOR, label: "Narrator" }, { value: HERO, label: "He says (out loud)" }, ...cast.map((member) => ({ value: member.name, label: member.nameArabic || member.name }))];

  return (
    <div className="grid gap-2">
      {lines.fields.map((line, index) => (
        <div key={line.id} className="grid gap-2 sm:grid-cols-[9rem_1fr_auto]">
          {cast.length > 0 ? (
            <Controller
              control={control}
              name={`scenes.${scene}.lines.${index}.speaker`}
              render={({ field }) => (
                <Select value={field.value} onValueChange={(value) => field.onChange(value ?? NARRATOR)}>
                  <SelectTrigger id={`scene-${scene}-line-${index}-speaker`} aria-label={`Scene ${scene + 1} line ${index + 1} speaker`} className={cn(FIELD, "w-full")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {speakers.map((speaker) => (
                      <SelectItem key={speaker.value} value={speaker.value}>
                        {speaker.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          ) : (
            <span className="self-center text-xs text-paper-ink/60">Narrator</span>
          )}
          <Textarea
            id={`scene-${scene}-line-${index}-text`}
            aria-label={`Scene ${scene + 1} line ${index + 1}`}
            dir="rtl"
            rows={2}
            className={cn(FIELD, "font-script text-xl")}
            {...register(`scenes.${scene}.lines.${index}.text`)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-paper-ink hover:bg-paper-ink/10 hover:text-paper-ink"
            aria-label={`Remove line ${index + 1} of scene ${scene + 1}`}
            disabled={lines.fields.length <= 1}
            onClick={() => lines.remove(index)}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      {cast.length > 0 && lines.fields.length < 2 && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-paper-ink hover:bg-paper-ink/10 hover:text-paper-ink"
            onClick={() => lines.append({ speaker: cast[0]?.name ?? NARRATOR, text: "" })}
          >
            <PlusIcon data-icon="inline-start" />
            Add a spoken line
          </Button>
        </div>
      )}
    </div>
  );
}
