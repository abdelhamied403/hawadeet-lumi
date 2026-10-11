import { Feather } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      hitSlop={10}
      className={`h-7 w-12 justify-center rounded-full px-0.5 ${value ? "bg-primary" : "bg-secondary"}`}
    >
      <View className={`size-6 rounded-full ${value ? "self-end bg-primary-foreground" : "self-start bg-muted-foreground"}`} />
    </Pressable>
  );
}

// A level from 0 to 1, moved in fixed steps with the two buttons.
export function LevelStepper({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const move = (by: number) => onChange(Math.min(1, Math.max(0, Math.round((value + by) * 100) / 100)));
  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-medium text-sm text-foreground">{label}</Text>
        <Text className="font-mono text-xs text-muted-foreground">{Math.round(value * 100)}%</Text>
      </View>
      <View className="flex-row items-center gap-3">
        <StepButton icon="minus" label={`Lower ${label}`} onPress={() => move(-step)} disabled={value <= 0} />
        <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
          <View className="h-full bg-primary" style={{ width: `${value * 100}%` }} />
        </View>
        <StepButton icon="plus" label={`Raise ${label}`} onPress={() => move(step)} disabled={value >= 1} />
      </View>
    </View>
  );
}

function StepButton({ icon, label, onPress, disabled }: { icon: "minus" | "plus"; label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className={`size-11 items-center justify-center rounded-md border border-border bg-card active:bg-secondary ${disabled ? "opacity-40" : ""}`}
    >
      <Feather name={icon} size={18} color="#e4ece8" />
    </Pressable>
  );
}

export function Checkbox({ label, checked, onChange, tone = "desk" }: { label: string; checked: boolean; onChange: (checked: boolean) => void; tone?: "desk" | "paper" }) {
  const ink = tone === "paper" ? "#22201b" : "#e4ece8";
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={() => onChange(!checked)}
      className="min-h-11 flex-row items-center gap-2"
    >
      <View className={`size-5 items-center justify-center rounded border ${tone === "paper" ? "border-paper-ink/50" : "border-border"} ${checked ? (tone === "paper" ? "bg-paper-ink" : "bg-primary") : ""}`}>
        {checked && <Feather name="check" size={14} color={tone === "paper" ? "#ede6d6" : "#1a1304"} />}
      </View>
      <Text className="font-sans text-sm" style={{ color: ink }}>
        {label}
      </Text>
    </Pressable>
  );
}
