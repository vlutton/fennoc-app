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
import { useOutboxStore } from "../outbox";
import { colors } from "../theme/colors";

type Segment = "all" | "today" | "overdue";
type DomainFilter = "all" | "work" | "personal";

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "overdue", label: "Overdue" },
];

const DOMAIN_SEGMENTS: { id: DomainFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "work", label: "Work" },
  { id: "personal", label: "Personal" },
];

const EMPTY_COPY: Record<Segment, string> = {
  all: "No open tasks. Nice.",
  today: "Nothing due today.",
  overdue: "Nothing overdue. 🔥",
};

function emptyCopy(segment: Segment, domain: DomainFilter): string {
  if (domain === "all") return EMPTY_COPY[segment];
  if (domain === "work") {
    if (segment === "today") return "No work tasks due today.";
    if (segment === "overdue") return "No overdue work tasks.";
    return "No work tasks.";
  }
  if (segment === "today") return "No personal tasks due today.";
  if (segment === "overdue") return "No overdue personal tasks.";
  return "No personal tasks.";
}

export function TaskListScreen() {
  const [segment, setSegment] = useState<Segment>("all");
  const [domainFilter, setDomainFilter] = useState<DomainFilter>("all");

  // All segment: server-side domain filter via ?domain=
  const allQuery = useTasks({
    status: "open",
    domain: domainFilter === "all" ? undefined : domainFilter,
  });
  // Today/Overdue endpoints don't take domain — filter client-side below.
  const todayQuery = useTodayTasks();
  const overdueQuery = useOverdueTasks();
  const completeMutation = useCompleteTask();
  const dropMutation = useDropTask();

  // Tasks whose complete/drop action is queued in the offline outbox and
  // hasn't reached the server yet — rendered "held" (solid, dashed edge)
  // rather than a spinner/disabled row. See TaskRow's `held` prop.
  const outboxItems = useOutboxStore((s) => s.items);
  const heldTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of outboxItems) {
      if (
        (item.kind === "complete" || item.kind === "drop") &&
        (item.status === "pending" || item.status === "inflight")
      ) {
        const taskId = item.payload.taskId;
        if (typeof taskId === "string") ids.add(taskId);
      }
    }
    return ids;
  }, [outboxItems]);

  const activeQuery = useMemo(() => {
    if (segment === "today") return todayQuery;
    if (segment === "overdue") return overdueQuery;
    return allQuery;
  }, [allQuery, overdueQuery, segment, todayQuery]);

  const tasks = useMemo(() => {
    const raw = activeQuery.data ?? [];
    // Server already filtered the All segment; only client-slice Today/Overdue.
    if (segment === "all" || domainFilter === "all") return raw;
    const needle = `domain:${domainFilter}`;
    return raw.filter((t) => t.labels.includes(needle));
  }, [activeQuery.data, domainFilter, segment]);

  const busy = completeMutation.isPending || dropMutation.isPending;

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

        {/* Domain filter (orthogonal, above time filter) */}
        <View className="mt-3 flex-row rounded-xl bg-sand p-1">
          {DOMAIN_SEGMENTS.map((item) => {
            const active = domainFilter === item.id;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                className={`min-h-12 flex-1 items-center justify-center rounded-lg px-2 ${
                  active ? "bg-olive" : "bg-transparent"
                }`}
                onPress={() => setDomainFilter(item.id)}
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

        {/* Time filter (existing) */}
        <View className="mt-2 flex-row rounded-xl bg-sand p-1">
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
                {emptyCopy(segment, domainFilter)}
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
              held={heldTaskIds.has(item.task_id)}
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
