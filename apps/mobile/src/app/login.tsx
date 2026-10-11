import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { KeyboardAvoidingView, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Body, FieldError } from "@/components/ui/text";
import { errorMessage, normalizeServerUrl } from "@/lib/http";
import { useSession } from "@/lib/session";

// The password rules are the server's; the address is only checked for shape.
const loginFormSchema = z.object({
  serverUrl: z
    .string()
    .trim()
    .min(1, "Enter the server address")
    .refine((value) => /^(https?:\/\/)?[a-z0-9.-]+(:\d+)?$/i.test(value.replace(/\/+$/, "")), "Use an address like veogen-yours.duckdns.org"),
  password: z.string().min(1, "Enter the password").max(200, "The password is too long"),
});
type LoginForm = z.infer<typeof loginFormSchema>;

export default function LoginScreen() {
  const session = useSession();
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { serverUrl: session.serverUrl ?? "", password: "" },
  });
  const signIn = useMutation({
    mutationFn: (values: LoginForm) => session.signIn(normalizeServerUrl(values.serverUrl), values.password),
  });
  const errors = form.formState.errors;
  const failure = signIn.error ? errorMessage(signIn.error) : !signIn.isPending && !form.formState.isDirty ? session.problem : null;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView contentContainerClassName="grow justify-center gap-8 px-6 py-10" keyboardShouldPersistTaps="handled">
          <View className="gap-2">
            <Text accessibilityRole="header" className="font-display text-5xl tracking-[6px] text-primary">
              VEOGEN
            </Text>
            <Body>Review each step of a part and publish it, from your phone.</Body>
          </View>

          <View className="gap-4">
            <Controller
              control={form.control}
              name="serverUrl"
              render={({ field }) => (
                <View className="gap-1.5">
                  <Field
                    label="Server address"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    placeholder="veogen-yours.duckdns.org"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    returnKeyType="next"
                  />
                  <FieldError message={errors.serverUrl?.message} />
                </View>
              )}
            />
            <Controller
              control={form.control}
              name="password"
              render={({ field }) => (
                <View className="gap-1.5">
                  <Field
                    label="Password"
                    value={field.value}
                    onChangeText={field.onChange}
                    onBlur={field.onBlur}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="go"
                    onSubmitEditing={form.handleSubmit((values) => signIn.mutate(values))}
                  />
                  <FieldError message={errors.password?.message} />
                </View>
              )}
            />
            {failure && (
              <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-destructive">
                {failure}
              </Text>
            )}
            <Button label={signIn.isPending ? "Signing in" : "Sign in"} size="lg" busy={signIn.isPending} onPress={form.handleSubmit((values) => signIn.mutate(values))} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
