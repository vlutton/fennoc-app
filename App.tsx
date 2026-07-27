import "./src/global.css";

import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import {
  Clock,
  FileText,
  House,
  ListChecks,
  Settings,
} from "lucide-react-native";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useOutboxBootstrap } from "./src/hooks/useOutboxBootstrap";
import { initNotifications } from "./src/notifications";
import { BriefingScreen } from "./src/screens/BriefingScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { TaskListScreen } from "./src/screens/TaskListScreen";
import { TimeScreen } from "./src/screens/TimeScreen";
import { useAuth } from "./src/store/useAuth";
import { useTheme } from "./src/theme/useTheme";

const Tab = createBottomTabNavigator();
const queryClient = new QueryClient();

// Layout-only; colour comes from the active palette (see `useTheme`) so the
// tab bar actually responds to the night/day toggle.
const tabBarStyles = StyleSheet.create({
  bar: {
    height: 64,
    paddingBottom: 8,
    paddingTop: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
});

function RootTabs() {
  const hydrated = useAuth((s) => s.hydrated);
  const { palette } = useTheme();

  const tabBarColorStyle = useMemo(
    () => ({
      backgroundColor: palette.bg.raised,
      borderTopColor: palette.line.strong,
    }),
    [palette],
  );

  if (!hydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-bg-base">
        <ActivityIndicator color={palette.ink.DEFAULT} size="large" />
        <Text className="mt-3 text-base leading-6 text-ink">
          Loading Fennoc…
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg-base">
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: palette.clay,
          tabBarInactiveTintColor: palette.ink.DEFAULT,
          tabBarStyle: [tabBarStyles.bar, tabBarColorStyle],
          tabBarLabelStyle: tabBarStyles.label,
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarIcon: ({ color, size }) => (
              <House color={color} size={size} strokeWidth={1.75} />
            ),
          }}
        />
        <Tab.Screen
          name="Tasks"
          component={TaskListScreen}
          options={{
            tabBarIcon: ({ color, size }) => (
              <ListChecks color={color} size={size} strokeWidth={1.75} />
            ),
          }}
        />
        <Tab.Screen
          name="Time"
          component={TimeScreen}
          options={{
            tabBarIcon: ({ color, size }) => (
              <Clock color={color} size={size} strokeWidth={1.75} />
            ),
          }}
        />
        <Tab.Screen
          name="Briefings"
          component={BriefingScreen}
          options={{
            tabBarIcon: ({ color, size }) => (
              <FileText color={color} size={size} strokeWidth={1.75} />
            ),
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarIcon: ({ color, size }) => (
              <Settings color={color} size={size} strokeWidth={1.75} />
            ),
          }}
        />
      </Tab.Navigator>
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
            <RootTabs />
          </NavigationContainer>
        </QueryClientProvider>
      </SafeAreaProvider>
    </View>
  );
}
