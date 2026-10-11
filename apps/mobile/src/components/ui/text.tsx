import { Text, type TextProps } from "react-native";

// Arabic story text: the script face, right-aligned and laid out right to left.
export function Arabic({ className = "", style, ...props }: TextProps) {
  return <Text {...props} className={`font-script text-right text-foreground ${className}`} style={[{ writingDirection: "rtl" }, style]} />;
}

// Small-caps style label in the mono face, for part numbers, timings and counts.
export function Meta({ className = "", ...props }: TextProps) {
  return <Text {...props} className={`font-mono text-xs text-muted-foreground ${className}`} />;
}

// Screen title in the display face.
export function Title({ className = "", ...props }: TextProps) {
  return <Text {...props} accessibilityRole="header" className={`font-display text-3xl uppercase tracking-wide text-foreground ${className}`} />;
}

export function Body({ className = "", ...props }: TextProps) {
  return <Text {...props} className={`font-sans text-sm leading-5 text-muted-foreground ${className}`} />;
}

export function FieldError({ message }: { message?: string }) {
  return message ? <Text className="font-sans text-xs text-destructive">{message}</Text> : null;
}
