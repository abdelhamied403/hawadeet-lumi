import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, Pressable, ScrollView, Text, View } from "react-native";
import { isScheduled, statusLabel, STEP_COPY, stepTiming } from "@/lib/steps";
import type { StepName, StepSummary } from "@/services/veogen";

const FRAME_WIDTH = 116;
// The lit frame's amber edge. A plain style: the animated view is not styled by class names.
const SAFELIGHT = { position: "absolute", top: -1, right: -1, bottom: -1, left: -1, borderRadius: 3, borderWidth: 2, borderColor: "#e9a23b" } as const;

// The film's sprocket holes: a row of cut-outs along the top and bottom edges of the strip.
function Sprockets({ count }: { count: number }) {
  return (
    <View className="h-2.5 flex-row items-center justify-around" importantForAccessibility="no-hide-descendants">
      {Array.from({ length: count }, (_, index) => (
        <View key={index} className="h-1.5 w-2 rounded-[2px] bg-background" />
      ))}
    </View>
  );
}

// The amber safelight on the frame that needs a decision. Still when the phone asks for reduced motion.
function Safelight() {
  const [glow] = useState(() => new Animated.Value(0.35));
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) return glow.setValue(1);
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0.35, duration: 1200, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => loop?.stop();
  }, [glow]);
  return <Animated.View pointerEvents="none" style={[SAFELIGHT, { opacity: glow }]} />;
}

// The six steps as frames on a strip of film. The frame that needs a decision is lit.
export function Filmstrip({ steps, selected, onSelect }: { steps: StepSummary[]; selected: StepName; onSelect: (step: StepName) => void }) {
  const scroller = useRef<ScrollView>(null);
  const selectedIndex = steps.findIndex((step) => step.name === selected);
  // Keep the frame in play in view: six frames do not fit across a phone.
  useEffect(() => {
    scroller.current?.scrollTo({ x: Math.max(0, (selectedIndex - 1) * (FRAME_WIDTH + 6)), animated: true });
  }, [selectedIndex]);

  return (
    <ScrollView ref={scroller} horizontal showsHorizontalScrollIndicator={false} className="bg-strip" accessibilityRole="tablist">
      <View>
        <Sprockets count={steps.length * 6} />
        <View className="flex-row gap-1.5 px-1.5">
          {steps.map((step, index) => {
            const needsYou = (step.status === "review" && !isScheduled(step)) || step.status === "failed";
            const busy = step.status === "running" || step.status === "queued";
            const timing = stepTiming(step);
            const current = selected === step.name;
            return (
              <Pressable
                key={step.name}
                accessibilityRole="tab"
                accessibilityState={{ selected: current }}
                accessibilityLabel={`Step ${index + 1}, ${STEP_COPY[step.name].label}: ${statusLabel(step)}${timing ? `, ${timing}` : ""}`}
                onPress={() => onSelect(step.name)}
                style={{ width: FRAME_WIDTH }}
                className={`h-28 justify-between rounded-sm border bg-card p-2.5 active:bg-secondary ${current ? "border-foreground/50" : "border-transparent"} ${step.status === "waiting" ? "opacity-55" : ""}`}
              >
                {needsYou && <Safelight />}
                <View className="flex-row items-center justify-between">
                  <Text className="font-mono text-xs text-muted-foreground">{index + 1}</Text>
                  {step.status === "approved" && <Feather name="check" size={16} color="#62b89b" />}
                  {busy && <ActivityIndicator size="small" color="#8da3a1" />}
                  {step.status === "failed" && <Feather name="alert-triangle" size={16} color="#e0635a" />}
                </View>
                <View>
                  <Text className="font-display text-xl uppercase leading-6 tracking-wide text-foreground">{STEP_COPY[step.name].label}</Text>
                  <Text className={`font-sans text-xs ${step.status === "failed" ? "text-destructive" : needsYou ? "text-primary" : "text-muted-foreground"}`}>
                    {statusLabel(step)}
                  </Text>
                  {timing && (
                    <Text numberOfLines={1} className="font-sans text-xs text-muted-foreground">
                      {timing}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
        <Sprockets count={steps.length * 6} />
      </View>
    </ScrollView>
  );
}

// A one-line version of the strip for lists.
export function FilmstripMini({ steps }: { steps: StepSummary[] }) {
  return (
    <View className="flex-row gap-0.5" importantForAccessibility="no-hide-descendants">
      {steps.map((step) => (
        <View
          key={step.name}
          className={`h-3 w-5 rounded-[2px] ${
            step.status === "approved"
              ? "bg-ok"
              : step.status === "review" && !isScheduled(step)
                ? "bg-primary"
                : step.status === "failed"
                  ? "bg-destructive"
                  : step.status === "running" || step.status === "queued" || isScheduled(step)
                    ? "bg-muted-foreground"
                    : "bg-secondary"
          }`}
        />
      ))}
    </View>
  );
}
