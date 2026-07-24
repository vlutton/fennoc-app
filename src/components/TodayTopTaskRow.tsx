import { Pressable, Text, View } from "react-native";

import type { Task } from "../api/types";

interface TodayTopTaskRowProps {
  task: Task;
  onPress: () => void;
}

export function TodayTopTaskRow({ task, onPress }: TodayTopTaskRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      className="mb-2 min-h-12 flex-row items-center rounded-xl border border-sand bg-cream px-3 py-3 active:opacity-80"
      onPress={onPress}
    >
      <Text className="mr-2 text-base leading-6 text-terracotta">▸</Text>
      <View className="flex-1">
        <Text
          className="text-base font-semibold leading-6 text-olive"
          numberOfLines={1}
        >
          {task.title}
        </Text>
        <Text className="mt-0.5 text-sm leading-5 text-olive opacity-70" numberOfLines={1}>
          {task.project}
        </Text>
      </View>
    </Pressable>
  );
}
