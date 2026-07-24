import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatApiError } from "../api/client";
import type { Task } from "../api/types";
import { TaskRow } from "../components/TaskRow";
import {
  useCompleteTask,
  useDropTask,
  useOverdueTasks,
  useTasks,
  useTodayTasks,
} from "../hooks/useTasks";
import { colors } from "../theme/colors";

type Segment = "all" | "today" | "overdue";

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "overdue", label: "Overdue" },
];

const EMPTY_COPY: Record<Segment, string> = {
  all: "No open tasks. Nice.",
  today: "Nothing due today.",
  overdue: "Nothing overdue. 🔥",
};

export function TaskListScreen() {
  const [segment, setSegment] = useState<Segment>("all");

  const allQuery = useTasks({ status: "open" });
  const todayQuery = useTodayTasks();
  const overdueQuery = useOverdueTasks();
  const completeMutation = useCompleteTask();
  const dropMutation = useDropTask();

  const activeQuery = useMemo(() => {
    if (segment === "today") return todayQuery;
    if (segment === "overdue") return overdueQuery;
    return allQuery;
  }, [allQuery, overdueQuery, segment, todayQuery]);

  const tasks = activeQuery.data ?? [];
  const busy =
    completeMutation.isPending || dropMutation.isPending;

  const onComplete = useCallback(
    (task: Task) => {
      completeMutation.mutate(task.task_id);
    },
    [completeMutation],
  );

  const onDrop = useCallback(
    (task: Task) => {
      Alert.alert("Drop task?", task.title, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Drop",
          style: "destructive",
          onPress: () => dropMutation.mutate(task.task_id),
        },
      ]);
    },
    [dropMutation],
  );

  const onRefresh = useCallback(() => {
    void activeQuery.refetch();
  }, [activeQuery]);

  const onRetry = useCallback(() => {
    void activeQuery.refetch();
  }, [activeQuery]);

  const showInitialSpinner =
    activeQuery.isLoading && !activeQuery.data && !activeQuery.isError;

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <View className="px-4 pb-2 pt-4">
        <Text className="text-base font-semibold leading-6 text-olive">
          Tasks
        </Text>
        <View className="mt-3 flex-row rounded-xl bg-sand p-1">
          {SEGMENTS.map((item) => {
            const active = segment === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                className={`min-h-12 flex-1 items-center justify-center rounded-lg px-2 ${
                  active ? "bg-olive" : "bg-transparent"
                }`}
                onPress={() => setSegment(item.id)}
              >
                <Text
                  className={`text-base font-semibold leading-6 ${
                    active ? "text-cream" : "text-olive"
                  }`}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {showInitialSpinner ? (
        <View className="flex-1 items-center justify-center px-4">
          <ActivityIndicator color={colors.olive} size="large" />
          <Text className="mt-3 text-base leading-6 text-olive">
            Loading tasks…
          </Text>
        </View>
      ) : activeQuery.isError ? (
        <View className="flex-1 items-center justify-center px-4">
          <View className="w-full rounded-xl bg-sand p-4">
            <Text className="text-base leading-6 text-olive">
              ❌ {formatApiError(activeQuery.error)}
            </Text>
            <Pressable
              accessibilityRole="button"
              className="mt-4 min-h-12 items-center justify-center rounded-lg bg-terracotta px-4 active:opacity-80"
              onPress={onRetry}
            >
              <Text className="text-base font-semibold leading-6 text-cream">
                Retry
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <FlatList
          className="flex-1"
          contentContainerClassName="grow px-4 pb-8 pt-2"
          data={tasks}
          keyExtractor={(item) => item.task_id}
          ListEmptyComponent={
            <View className="mt-16 items-center px-4">
              <Text className="text-center text-base leading-6 text-olive">
                {EMPTY_COPY[segment]}
              </Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              colors={[colors.terracotta]}
              onRefresh={onRefresh}
              refreshing={activeQuery.isRefetching && !busy}
              tintColor={colors.terracotta}
            />
          }
          renderItem={({ item }) => (
            <TaskRow
              busy={busy}
              onComplete={onComplete}
              onDrop={onDrop}
              task={item}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}
