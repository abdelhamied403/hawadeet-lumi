import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { Alert, Text, View } from "react-native";
import { z } from "zod";
import { Failure, Loading, Screen } from "@/components/screen";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/controls";
import { Field } from "@/components/ui/field";
import { Body, FieldError, Meta, Title } from "@/components/ui/text";
import { errorMessage } from "@/lib/http";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/toast";
import { getSettings, updateSettings } from "@/services/veogen";

// Same rules as the server's settings schema.
const settingsFormSchema = z.object({
  autoCreate: z.boolean(),
  dailyTime: z.string().regex(/^\d{2}:\d{2}$/, "Use a time like 09:00"),
  scenesPerPart: z.number({ error: "Enter a number" }).int("Enter a whole number").min(4, "At least 4 scenes").max(24, "At most 24 scenes"),
  partsPerSeries: z.number({ error: "Enter a number" }).int("Enter a whole number").min(2, "At least 2 parts").max(12, "At most 12 parts"),
  postsPerDay: z.number({ error: "Enter a number" }).int("Enter a whole number").min(0, "0 turns Page posts off").max(3, "At most 3 a day"),
});
type SettingsForm = z.infer<typeof settingsFormSchema>;

const CONNECTIONS = [
  { key: "gemini", name: "Google Gemini", role: "Writes the scripts and records the voice", setup: "GEMINI_API_KEY in the server's .env" },
  { key: "kaggle", name: "Kaggle", role: "Makes the images and motion clips on its free GPU", setup: "KAGGLE_USERNAME and KAGGLE_KEY in the server's .env" },
  { key: "facebook", name: "Facebook Page", role: "Posts the finished Reel automatically", setup: "FACEBOOK_PAGE_ID and FACEBOOK_PAGE_TOKEN in the server's .env, then restart the server" },
] as const;

export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const session = useSession();
  const { data, error, refetch, isRefetching } = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const form = useForm<SettingsForm>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: { autoCreate: true, dailyTime: "09:00", scenesPerPart: 16, partsPerSeries: 6, postsPerDay: 1 },
  });
  useEffect(() => {
    if (data) {
      form.reset({
        autoCreate: data.autoCreate,
        dailyTime: data.dailyTime,
        scenesPerPart: data.scenesPerPart,
        partsPerSeries: data.partsPerSeries,
        postsPerDay: data.postsPerDay,
      });
    }
  }, [data, form]);
  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast("Settings saved");
    },
    onError: (failure) => toast(errorMessage(failure)),
  });
  const signOut = useMutation({ mutationFn: session.signOut });
  const errors = form.formState.errors;
  const scenes = useWatch({ control: form.control, name: "scenesPerPart" }) || 0;

  if (!data) return error ? <Failure message={errorMessage(error)} onRetry={() => void refetch()} /> : <Loading />;

  const confirmSignOut = () =>
    Alert.alert("Sign out?", "The pipeline keeps running on the server. You will need the password to sign in again.", [
      { text: "Stay signed in", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => signOut.mutate() },
    ]);

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      <View className="gap-5">
        <Title>Settings</Title>

        <View className="flex-row items-start justify-between gap-4 rounded-lg border border-border bg-card p-4">
          <View className="flex-1 gap-1">
            <Text className="font-sans-medium text-base text-foreground">Write a new part every day</Text>
            <Body>Only the script is written automatically. Nothing else is made until you approve it.</Body>
          </View>
          <Controller control={form.control} name="autoCreate" render={({ field }) => <Toggle label="Write a new part every day" value={field.value} onChange={field.onChange} />} />
        </View>

        <Controller
          control={form.control}
          name="dailyTime"
          render={({ field }) => (
            <View className="gap-1.5">
              <Field label="Daily at (24-hour time, Cairo)" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} placeholder="09:00" keyboardType="numbers-and-punctuation" maxLength={5} />
              <FieldError message={errors.dailyTime?.message} />
            </View>
          )}
        />
        <NumberField control={form.control} name="scenesPerPart" label="Scenes per part" message={errors.scenesPerPart?.message} />
        <NumberField control={form.control} name="partsPerSeries" label="Parts per series" message={errors.partsPerSeries?.message} />
        <Meta className="leading-5">
          {scenes} scenes ≈ {Math.round(scenes * 5)} s of video and about {((scenes * 19) / 60).toFixed(1)} GPU hours per part (30 free hours a week). Parts
          per series applies to the next series.
        </Meta>
        <NumberField control={form.control} name="postsPerDay" label="Page posts drafted per day" message={errors.postsPerDay?.message} />
        <Meta className="leading-5">
          Short posts that keep followers talking between videos, drafted after the daily time. They wait in Posts until you publish them. 0 turns
          them off.
        </Meta>
        <Button label="Save settings" className="self-start" busy={save.isPending} disabled={!form.formState.isDirty} onPress={form.handleSubmit((values) => save.mutate(values))} />
      </View>

      <View className="gap-3">
        <Title className="text-2xl text-muted-foreground">Connections</Title>
        {CONNECTIONS.map((connection) => {
          const connected = data.connections[connection.key];
          return (
            <View key={connection.key} className="gap-1 rounded-lg border border-border bg-card px-4 py-3">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="font-sans-medium text-base text-foreground">{connection.name}</Text>
                <Text className={`font-sans text-sm ${connected ? "text-ok" : "text-primary"}`}>{connected ? "Connected" : "Not connected"}</Text>
              </View>
              <Body>{connection.role}</Body>
              {!connected && <Meta className="mt-1 leading-5">To connect: {connection.setup}</Meta>}
            </View>
          );
        })}
      </View>

      <View className="gap-3">
        <Title className="text-2xl text-muted-foreground">This phone</Title>
        <View className="gap-1 rounded-lg border border-border bg-card px-4 py-3">
          <Body>Signed in to</Body>
          <Text selectable className="font-mono text-sm text-foreground">
            {session.serverUrl}
          </Text>
        </View>
        <Button label="Sign out" variant="outline" className="self-start" busy={signOut.isPending} onPress={confirmSignOut} />
      </View>
    </Screen>
  );
}

// A whole-number field; an empty box is "not a number" until something is typed.
function NumberField({ control, name, label, message }: { control: Control<SettingsForm>; name: "scenesPerPart" | "partsPerSeries" | "postsPerDay"; label: string; message?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <View className="gap-1.5">
          <Field
            label={label}
            value={Number.isNaN(field.value) ? "" : String(field.value)}
            onChangeText={(text) => field.onChange(text.trim() === "" ? Number.NaN : Number(text))}
            onBlur={field.onBlur}
            keyboardType="number-pad"
            maxLength={2}
          />
          <FieldError message={message} />
        </View>
      )}
    />
  );
}
