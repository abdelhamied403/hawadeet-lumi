import { Feather } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useFieldArray, useForm, type Control } from "react-hook-form";
import { Pressable, Text, View } from "react-native";
import { z } from "zod";
import { personName } from "@/components/story-bench";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Field } from "@/components/ui/field";
import { Picker } from "@/components/ui/picker";
import { errorMessage } from "@/lib/http";
import { toast } from "@/lib/toast";
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

// The picker needs a value for "none"; the story stores that as null.
const NO_SOUND = "none";

function PaperError({ message }: { message?: string }) {
  return message ? <Text className="font-sans text-xs text-red-800">{message}</Text> : null;
}

export function StoryEditor({ episode, onDone }: { episode: EpisodeDetail; onDone: () => void }) {
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
      toast("Script saved");
      onDone();
    },
    onError: (error) => toast(errorMessage(error)),
  });
  const errors = form.formState.errors;
  const sounds = [{ value: NO_SOUND, label: "No sound effect" }, ...Object.entries(episode.soundEffects).map(([value, label]) => ({ value, label }))];
  const submit = form.handleSubmit(
    (values) => save.mutate(values),
    () => toast("Some fields need fixing. They are marked in red."),
  );

  return (
    <View className="gap-5">
      <View className="gap-3">
        <Controller
          control={form.control}
          name="title"
          render={({ field }) => <Field label="Title" tone="paper" arabic value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />}
        />
        <PaperError message={errors.title?.message} />
        <Controller
          control={form.control}
          name="description"
          render={({ field }) => (
            <Field label="Description" tone="paper" arabic multiline className="min-h-20 text-lg" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />
          )}
        />
      </View>

      {fields.map((item, index) => {
        const sceneErrors = errors.scenes?.[index];
        const number = index + 1;
        return (
          <View key={item.id} className="gap-3 border-t border-paper-ink/15 pt-4">
            <Text accessibilityRole="header" className="font-mono text-xs text-paper-ink/50">
              Scene {number}
            </Text>
            <SceneLines control={form.control} scene={index} cast={story.cast} />
            <PaperError message={sceneErrors?.lines?.message ?? sceneErrors?.lines?.find?.((line) => line?.text)?.text?.message} />

            <Controller
              control={form.control}
              name={`scenes.${index}.imagePrompt`}
              render={({ field }) => (
                <Field label="What the image shows" tone="paper" multiline className="min-h-16 text-[13px]" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} accessibilityLabel={`Scene ${number} image description`} />
              )}
            />
            <PaperError message={sceneErrors?.imagePrompt?.message} />

            <Controller
              control={form.control}
              name={`scenes.${index}.shows`}
              render={({ field }) => {
                const shown = field.value ?? [];
                return (
                  <View accessibilityLabel={`Scene ${number} people in the picture`} className="flex-row flex-wrap items-center gap-x-4">
                    <Text className="font-sans text-[13px] text-paper-ink/60">In the picture:</Text>
                    {[HERO, ...story.cast.map((member) => member.name)].map((who) => (
                      <Checkbox
                        key={who}
                        tone="paper"
                        label={personName(who, story.cast)}
                        checked={shown.includes(who)}
                        onChange={(checked) => field.onChange(checked ? [...shown, who] : shown.filter((name) => name !== who))}
                      />
                    ))}
                  </View>
                );
              }}
            />

            <Controller
              control={form.control}
              name={`scenes.${index}.motionPrompt`}
              render={({ field }) => (
                <Field label="What moves" tone="paper" multiline className="min-h-16 text-[13px]" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} accessibilityLabel={`Scene ${number} motion description`} />
              )}
            />
            <PaperError message={sceneErrors?.motionPrompt?.message} />

            <Controller
              control={form.control}
              name={`scenes.${index}.sfx`}
              render={({ field }) => (
                <Picker
                  label={`Scene ${number} sound effect`}
                  tone="paper"
                  value={field.value ?? NO_SOUND}
                  options={sounds}
                  onChange={(value) => field.onChange(value === NO_SOUND ? null : value)}
                />
              )}
            />
          </View>
        );
      })}

      <View className="flex-row justify-end gap-2">
        <Button label="Discard changes" variant="paper" onPress={onDone} disabled={save.isPending} />
        <Button label="Save script" onPress={submit} busy={save.isPending} />
      </View>
    </View>
  );
}

// The spoken lines of one scene: who says each, and what.
function SceneLines({ control, scene, cast }: { control: Control<StoryForm>; scene: number; cast: CastMember[] }) {
  const lines = useFieldArray({ control, name: `scenes.${scene}.lines` });
  const speakers = [
    { value: NARRATOR, label: "Narrator" },
    { value: HERO, label: "He says (out loud)" },
    ...cast.map((member) => ({ value: member.name, label: member.nameArabic || member.name })),
  ];

  return (
    <View className="gap-3">
      {lines.fields.map((line, index) => (
        <View key={line.id} className="gap-2">
          <View className="flex-row items-center gap-2">
            <View className="flex-1">
              {cast.length > 0 ? (
                <Controller
                  control={control}
                  name={`scenes.${scene}.lines.${index}.speaker`}
                  render={({ field }) => (
                    <Picker label={`Scene ${scene + 1} line ${index + 1} speaker`} tone="paper" value={field.value} options={speakers} onChange={field.onChange} />
                  )}
                />
              ) : (
                <Text className="font-sans text-xs text-paper-ink/60">Narrator</Text>
              )}
            </View>
            {lines.fields.length > 1 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove line ${index + 1} of scene ${scene + 1}`}
                onPress={() => lines.remove(index)}
                className="size-11 items-center justify-center rounded-md active:bg-paper-ink/10"
              >
                <Feather name="x" size={18} color="#22201b" />
              </Pressable>
            )}
          </View>
          <Controller
            control={control}
            name={`scenes.${scene}.lines.${index}.text`}
            render={({ field }) => (
              <Field tone="paper" arabic multiline className="min-h-16" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} accessibilityLabel={`Scene ${scene + 1} line ${index + 1}`} />
            )}
          />
        </View>
      ))}
      {cast.length > 0 && lines.fields.length < 2 && (
        <Button label="Add a spoken line" variant="paper" size="sm" className="self-start" onPress={() => lines.append({ speaker: cast[0]?.name ?? NARRATOR, text: "" })} />
      )}
    </View>
  );
}
