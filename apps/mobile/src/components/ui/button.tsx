import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";

type Variant = "primary" | "outline" | "ghost" | "paper";

const FRAME: Record<Variant, string> = {
  primary: "bg-primary active:opacity-80",
  outline: "border border-border bg-card active:bg-secondary",
  ghost: "active:bg-secondary",
  paper: "active:bg-paper-ink/10",
};
const LABEL: Record<Variant, string> = {
  primary: "text-primary-foreground",
  outline: "text-foreground",
  ghost: "text-foreground",
  paper: "text-paper-ink",
};

export function Button({
  label,
  variant = "primary",
  size = "md",
  busy = false,
  disabled,
  className = "",
  ...props
}: Omit<PressableProps, "children"> & { label: string; variant?: Variant; size?: "sm" | "md" | "lg"; busy?: boolean; className?: string }) {
  const off = disabled || busy;
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy }}
      disabled={off}
      // 44pt minimum touch height, whatever the visual size.
      className={`min-h-11 flex-row items-center justify-center gap-2 rounded-md ${size === "lg" ? "px-5 py-3" : size === "sm" ? "px-3 py-2" : "px-4 py-2.5"} ${FRAME[variant]} ${off ? "opacity-50" : ""} ${className}`}
    >
      {busy && <ActivityIndicator size="small" color={variant === "primary" ? "#1a1304" : "#e4ece8"} />}
      <Text className={`font-sans-medium ${size === "sm" ? "text-sm" : "text-base"} ${LABEL[variant]}`}>{label}</Text>
    </Pressable>
  );
}
