import type { ReactNode } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Body } from "@/components/ui/text";

// A scrolling tab screen; pulling down reloads it.
export function Screen({ children, refreshing, onRefresh }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-background">
      <ScrollView
        contentContainerClassName="gap-8 px-4 pb-10 pt-4"
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor="#e9a23b" colors={["#e9a23b"]} progressBackgroundColor="#16252b" /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-background">
      <Body>{label}</Body>
    </SafeAreaView>
  );
}

export function Failure({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-background px-8">
      <Text className="text-center font-sans text-base text-destructive">{message}</Text>
      <Button label="Try again" variant="outline" onPress={onRetry} />
    </SafeAreaView>
  );
}

// A boxed message: what state a step is in and what happens next.
export function Notice({ title, body, tone, children }: { title: string; body: string; tone?: "error"; children?: ReactNode }) {
  return (
    <View className="gap-1 rounded-lg border border-border bg-card p-5">
      <Text className={`font-sans-medium text-lg ${tone === "error" ? "text-destructive" : "text-foreground"}`}>{title}</Text>
      <Body>{body}</Body>
      {children}
    </View>
  );
}
