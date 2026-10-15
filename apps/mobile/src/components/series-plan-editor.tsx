import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { View } from "react-native";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Body, FieldError, Meta } from "@/components/ui/text";
import { errorMessage } from "@/lib/http";
import { toast } from "@/lib/toast";
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
      toast("Plan saved");
      onDone();
    },
    onError: (error) => toast(errorMessage(error)),
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit(
    (values) => save.mutate(values),
    () => toast("Some fields need fixing. They are marked in red."),
  );

  return (
    <View className="gap-6">
      <Body>
        The next scripts are written from this plan. Scripts that already exist are not changed, so reword a finished part here only to keep the plan in
        step with what you approved.
      </Body>

      <View className="gap-4">
        <Controller
          control={form.control}
          name="title"
          render={({ field }) => (
            <View className="gap-1.5">
              <Field label="Series title" arabic value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />
              <FieldError message={errors.title?.message} />
            </View>
          )}
        />
        <Controller
          control={form.control}
          name="premise"
          render={({ field }) => (
            <View className="gap-1.5">
              <Field label="The whole story, including how it ends" multiline className="min-h-36" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />
              <FieldError message={errors.premise?.message} />
            </View>
          )}
        />
        <Controller
          control={form.control}
          name="characterSheet"
          render={({ field }) => (
            <View className="gap-1.5">
              <Field label="Main character's look (English, used for every image)" multiline className="min-h-20" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />
              <FieldError message={errors.characterSheet?.message} />
            </View>
          )}
        />
        <Controller
          control={form.control}
          name="styleSheet"
          render={({ field }) => (
            <View className="gap-1.5">
              <Field label="Look of the images (English)" multiline className="min-h-20" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} />
              <FieldError message={errors.styleSheet?.message} />
              <Body className="text-xs">Changing the character or the look mid-series makes later parts look different from earlier ones.</Body>
            </View>
          )}
        />
      </View>

      <View className="gap-3">
        {parts.fields.map((item, index) => {
          const number = index + 1;
          const isLast = index === parts.fields.length - 1;
          const written = number <= started;
          return (
            <View key={item.id} className="gap-3 rounded-lg border border-border bg-card p-4">
              <View className="flex-row items-center justify-between">
                <Meta className="text-sm">
                  Part {String(number).padStart(2, "0")}
                  {written ? " · written" : ""}
                </Meta>
                {!written && parts.fields.length > 2 && (
                  <Button label="Remove" variant="ghost" size="sm" accessibilityLabel={`Remove part ${number}`} onPress={() => parts.remove(index)} />
                )}
              </View>
              <Controller
                control={form.control}
                name={`parts.${index}.summary`}
                render={({ field }) => (
                  <View className="gap-1.5">
                    <Field label="What happens" multiline className="min-h-24" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} accessibilityLabel={`Part ${number}: what happens`} />
                    <FieldError message={errors.parts?.[index]?.summary?.message} />
                  </View>
                )}
              />
              <Controller
                control={form.control}
                name={`parts.${index}.cliffhanger`}
                render={({ field }) => (
                  <View className="gap-1.5">
                    <Field
                      label={isLast ? "Happy ending it closes on" : "What it ends on"}
                      multiline
                      className="min-h-24"
                      value={field.value}
                      onChangeText={field.onChange}
                      onBlur={field.onBlur}
                      accessibilityLabel={`Part ${number}: ${isLast ? "happy ending" : "what it ends on"}`}
                    />
                    <FieldError message={errors.parts?.[index]?.cliffhanger?.message} />
                  </View>
                )}
              />
            </View>
          );
        })}
        <FieldError message={errors.parts?.root?.message ?? errors.parts?.message} />
        <Button label="Add a part" variant="outline" className="self-start" disabled={parts.fields.length >= 12} onPress={() => parts.append({ summary: "", cliffhanger: "" })} />
      </View>

      <View className="flex-row justify-end gap-2">
        <Button label="Discard changes" variant="ghost" onPress={onDone} disabled={save.isPending} />
        <Button label="Save plan" onPress={submit} busy={save.isPending} />
      </View>
    </View>
  );
}
