import { ToastAndroid } from "react-native";

export function toast(message: string): void {
  ToastAndroid.show(message, ToastAndroid.LONG);
}
