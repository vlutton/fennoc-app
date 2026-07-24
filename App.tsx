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
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useOutboxBootstrap } from "./src/hooks/useOutboxBootstrap";
import { BriefingScreen } from "./src/screens/BriefingScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { TaskListScreen } from "./src/screens/TaskListScreen";
import { TimeScreen } from "./src/screens/TimeScreen";
import { useAuth } from "./src/store/useAuth";
import { colors } from "./src/theme/colors";

const Tab = createBottomTabNavigator();
const queryClient = new QueryClient();

const tabBarStyles = StyleSheet.create({
  bar: {
    backgroundColor: colors.sand,
    borderTopColor: colors.cream,
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

  if (!hydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-sand">
        <ActivityIndicator color={colors.olive} size="large" />
        <Text className="mt-3 text-base leading-6 text-olive">
          Loading Fennoc…
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-sand">
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.terracotta,
          tabBarInactiveTintColor: colors.olive,
          tabBarStyle: tabBarStyles.bar,
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
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <OutboxBootstrap />
        <NavigationContainer>
          <StatusBar style="dark" />
          <RootTabs />
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
