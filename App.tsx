import "./src/global.css";

import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import {
  Clock,
  FileText,
  House,
  ListChecks,
  Settings,
} from "lucide-react-native";
import { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useOutboxBootstrap } from "./src/hooks/useOutboxBootstrap";
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
  const { palette, themeClass } = useTheme();

  const tabBarColorStyle = useMemo(
    () => ({
      backgroundColor: palette.bg.raised,
      borderTopColor: palette.line.strong,
    }),
    [palette],
  );

  if (!hydrated) {
    return (
      <View
        className={`flex-1 items-center justify-center ${themeClass("bg-bg-base", "bg-day-base")}`}
      >
        <ActivityIndicator color={palette.ink.DEFAULT} size="large" />
        <Text className={`mt-3 text-base leading-6 ${themeClass("text-ink", "text-day-ink")}`}>
          Loading Fennoc…
        </Text>
      </View>
    );
  }

  return (
    <View className={`flex-1 ${themeClass("bg-bg-base", "bg-day-base")}`}>
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

export default function App() {
  const { statusBarStyle } = useTheme();

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <OutboxBootstrap />
        <NavigationContainer>
          <StatusBar style={statusBarStyle} />
          <RootTabs />
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
