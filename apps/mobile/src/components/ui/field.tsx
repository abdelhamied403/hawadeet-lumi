import { Text, TextInput, View, type TextInputProps } from "react-native";

const TONE = {
  desk: { frame: "border-border bg-strip text-foreground", placeholder: "#5f7674" },
  paper: { frame: "border-paper-ink/25 bg-white/60 text-paper-ink", placeholder: "#22201b66" },
};

export type FieldProps = TextInputProps & {
  label?: string;
  tone?: keyof typeof TONE;
  // Arabic story text: script face, right to left.
  arabic?: boolean;
  className?: string;
};

export function Field({ label, tone = "desk", arabic = false, multiline, className = "", style, ...props }: FieldProps) {
  return (
    <View className="gap-1.5">
      {label && <Text className={`font-sans-medium text-sm ${tone === "paper" ? "text-paper-ink/70" : "text-foreground"}`}>{label}</Text>}
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        multiline={multiline}
        placeholderTextColor={TONE[tone].placeholder}
        textAlignVertical={multiline ? "top" : "center"}
        className={`min-h-11 rounded-md border px-3 py-2 ${arabic ? "font-script text-xl" : "font-sans text-base"} ${TONE[tone].frame} ${className}`}
        style={[arabic ? { writingDirection: "rtl", textAlign: "right" } : null, style]}
      />
    </View>
  );
}
