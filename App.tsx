import "./src/global.css";

import { NavigationContainer } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useOutboxBootstrap } from "./src/hooks/useOutboxBootstrap";
import { initNotifications } from "./src/notifications";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { ThreadScreen } from "./src/screens/ThreadScreen";
import { useAuth } from "./src/store/useAuth";
import { useTheme } from "./src/theme/useTheme";

const queryClient = new QueryClient();

// The thread is the whole app now (INT-023): no tab bar, no other root
// screen. Settings is reachable via a long-press on the Fennoc mark in the
// app bar, presented here as a full-screen Modal rather than a navigator
// route — SettingsScreen itself is untouched, this just supplies the
// close affordance it lost when it left the tab bar.
function Root() {
  const hydrated = useAuth((s) => s.hydrated);
  const { palette } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!hydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-base">
        <ActivityIndicator color={palette.ink.DEFAULT} size="large" />
        <Text className="mt-3 font-sans text-body text-ink">
          Loading Fennoc…
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg-base">
      <ThreadScreen onOpenSettings={() => setSettingsOpen(true)} />

      <Modal
        animationType="slide"
        onRequestClose={() => setSettingsOpen(false)}
        visible={settingsOpen}
      >
        <View className="h-16 flex-row items-center justify-between border-b border-line-hairline bg-bg-base px-4">
          <Text className="font-sans-semibold text-heading text-ink">
            Settings
          </Text>
          <Pressable
            accessibilityLabel="Close settings"
            accessibilityRole="button"
            className="h-touch w-touch items-center justify-center"
            onPress={() => setSettingsOpen(false)}
          >
            <X color={palette.ink.DEFAULT} size={24} />
          </Pressable>
        </View>
        <SettingsScreen />
      </Modal>
    </View>
  );
}

function OutboxBootstrap() {
  useOutboxBootstrap();
  return null;
}

// Registers the four INT-020 notification channels/categories and installs
// the foreground handler + response listener. Does NOT request permission —
// that's asked late, at a real trigger moment (see src/notifications/
// permissions.ts), never here at app mount.
function NotificationsBootstrap() {
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    initNotifications()
      .then((unsub) => {
        if (cancelled) {
          unsub();
          return;
        }
        unsubscribe = unsub;
      })
      .catch((error) => {
        console.warn("[notifications] init failed", error);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return null;
}

export default function App() {
  const { statusBarStyle, themeVars } = useTheme();

  // Each weight is its own registered family name (see the fontFamily
  // comment in tailwind.config.js for why: a single family + numeric
  // fontWeight doesn't reliably select the right file on React Native).
  const [fontsLoaded, fontError] = useFonts({
    "InstrumentSans-400": require("./assets/fonts/InstrumentSans-400.ttf"),
    "InstrumentSans-500": require("./assets/fonts/InstrumentSans-500.ttf"),
    "InstrumentSans-600": require("./assets/fonts/InstrumentSans-600.ttf"),
    "IBMPlexMono-400": require("./assets/fonts/IBMPlexMono-400.ttf"),
    "IBMPlexMono-500": require("./assets/fonts/IBMPlexMono-500.ttf"),
  });

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    // Root of the CSS-variable theme: `themeVars` sets the active palette's
    // `--color-*` custom properties here, once. Every `bg-bg-base` /
    // `text-ink` / `bg-sand` className anywhere in the tree resolves through
    // those variables, so swapping `themeVars` (via useTheme()) re-themes
    // the whole app without any component branching on the active theme.
    <View style={themeVars} className="flex-1">
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <OutboxBootstrap />
          <NotificationsBootstrap />
          <NavigationContainer>
            <StatusBar style={statusBarStyle} />
            <Root />
          </NavigationContainer>
        </QueryClientProvider>
      </SafeAreaProvider>
    </View>
  );
}
