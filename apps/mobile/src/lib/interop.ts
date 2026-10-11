import { cssInterop } from "nativewind";
import { SafeAreaView } from "react-native-safe-area-context";

// NativeWind only styles React Native's own components by default; this one comes from a library.
cssInterop(SafeAreaView, { className: "style" });
