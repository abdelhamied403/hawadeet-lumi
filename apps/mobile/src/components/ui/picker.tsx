import { Feather } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

export type PickerOption<T extends string> = { value: T; label: string };

// A select: shows the chosen option, and opens a sheet of options from the bottom of the screen.
export function Picker<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder = "Choose",
  tone = "desk",
}: {
  label: string;
  value: T | null;
  options: PickerOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  tone?: "desk" | "paper";
}) {
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value);
  const paper = tone === "paper";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${chosen?.label ?? placeholder}`}
        onPress={() => setOpen(true)}
        className={`min-h-11 flex-row items-center justify-between gap-2 rounded-md border px-3 py-2 ${paper ? "border-paper-ink/25 bg-white/60" : "border-border bg-strip"}`}
      >
        <Text numberOfLines={1} className={`flex-1 font-sans text-sm ${paper ? "text-paper-ink" : chosen ? "text-foreground" : "text-muted-foreground"}`}>
          {chosen?.label ?? placeholder}
        </Text>
        <Feather name="chevron-down" size={16} color={paper ? "#22201b" : "#8da3a1"} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Close" className="flex-1 bg-black/60" onPress={() => setOpen(false)} />
        <View className="max-h-[70%] rounded-t-2xl border-t border-border bg-card pb-6">
          <Text className="px-5 pb-2 pt-4 font-sans-medium text-sm text-muted-foreground">{label}</Text>
          <ScrollView>
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className="min-h-12 flex-row items-center justify-between gap-3 px-5 py-3 active:bg-secondary"
                >
                  <Text className={`flex-1 font-sans text-base ${selected ? "text-primary" : "text-foreground"}`}>{option.label}</Text>
                  {selected && <Feather name="check" size={18} color="#e9a23b" />}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
