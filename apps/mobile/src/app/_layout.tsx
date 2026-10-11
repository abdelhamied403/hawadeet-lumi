import "../../global.css";
import "@/lib/interop";

import { Amiri_400Regular, Amiri_700Bold } from "@expo-google-fonts/amiri";
import { BigShouldersDisplay_800ExtraBold } from "@expo-google-fonts/big-shoulders-display";
import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono";
import { IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold } from "@expo-google-fonts/ibm-plex-sans";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { SessionProvider, useSession } from "@/lib/session";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  const [fontsLoaded, fontError] = useFonts({
    Amiri_400Regular,
    Amiri_700Bold,
    BigShouldersDisplay_800ExtraBold,
    IBMPlexMono_400Regular,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
  });

  // A font that fails to load falls back to the system face; the app is still usable.
  if (!fontsLoaded && !fontError) return null;

  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <StatusBar style="light" />
        <Screens />
      </SessionProvider>
    </QueryClientProvider>
  );
}

function Screens() {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "loading") void SplashScreen.hideAsync();
  }, [status]);

  if (status === "loading") return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0f1a1e" } }}>
      <Stack.Protected guard={status === "signedIn"}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="episodes/[id]" />
      </Stack.Protected>
      <Stack.Protected guard={status === "signedOut"}>
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
