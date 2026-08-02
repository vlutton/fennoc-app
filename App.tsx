import "./src/global.css";

import { NavigationContainer } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";

import { ReadingColumn } from "./src/components/ReadingColumn";
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
      {/* The column is INSIDE the `bg-bg-base` view, so an iPad's margins are
          the app's own background rather than bare white/black gutters. */}
      <ReadingColumn>
        <ThreadScreen onOpenSettings={() => setSettingsOpen(true)} />
      </ReadingColumn>

      <Modal
        animationType="slide"
        onRequestClose={() => setSettingsOpen(false)}
        visible={settingsOpen}
      >
        {/* `react-native-safe-area-context`'s app-root `SafeAreaProvider`
            (above, wrapping `<Root />`) does not reach in here — a `Modal`
            renders into its own native root, so any `SafeAreaView` inside
            resolves to a 0 inset and draws under the status bar/clock. Same
            trap, same fix, as `ReplySheet.tsx` / `CameraCapture.tsx`: nest a
            SEPARATE `SafeAreaProvider`, seeded with `initialWindowMetrics`
            so the first frame isn't a 0-inset flash while the real
            measurement comes in.

            THIS bar is what takes the top inset, not `SettingsScreen`. It is
            the topmost element inside the Modal, so it is the one the
            operator saw overlapping the clock. `SettingsScreen` used to own
            the screen's top edge — back when it was a tab-bar route, before
            it gained this header (see the note above `Root`) — and it kept
            an `edges={["top"]}` that has been describing a layout that no
            longer exists. Left in place it would have inserted a phantom
            status-bar-height gap BELOW this bar while the bar itself stayed
            under the clock: the reported bug, plus a new one. Its root is a
            plain `View` now, and the inset is claimed here, once, by the
            element actually at the top. */}
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          {/* Its own `ReadingColumn`: this Modal has its own native root, so
              the one wrapping `ThreadScreen` above does not reach in here. */}
          <View className="flex-1 bg-bg-base">
            <ReadingColumn>
              <SafeAreaView className="bg-bg-base" edges={["top"]}>
                <View className="h-16 flex-row items-center justify-between border-b border-line-hairline px-4">
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
              </SafeAreaView>
              <SettingsScreen />
            </ReadingColumn>
          </View>
        </SafeAreaProvider>
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
