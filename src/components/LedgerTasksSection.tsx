import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import type { Task } from "../api/types";
import { useCompleteTask, useDropTask, useOverdueTasks, useTasks, useTodayTasks } from "../hooks/useTasks";
import { useOutboxStore } from "../outbox";
import { chicagoToday } from "../utils/format";
import { TaskRow } from "./TaskRow";

type TaskFilter = "all" | "today" | "overdue";

const FILTERS: { id: TaskFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "today", label: "Today" },
  { id: "overdue", label: "Overdue" },
];

interface Group {
  key: string;
  label: string;
  tasks: Task[];
}

/** "YYYY-MM-DD" prefix comparison — due_date is either a bare date or a
 * full ISO timestamp (see GetTasksOpts/Task in api/types.ts); slicing to
 * 10 chars normalizes both to a comparable calendar day. */
function dueBucket(task: Task, today: string): "overdue" | "today" | "later" {
  if (!task.due_date) return "later";
  const bare = task.due_date.slice(0, 10);
  if (bare < today) return "overdue";
  if (bare === today) return "today";
  return "later";
}

/**
 * The Ledger's Tasks section (INT-024). Filter pills mirror
 * TaskListScreen's three segments (all/today/overdue) — that screen is
 * unrouted (see its own header comment), so this is the first place those
 * segments are actually reachable in the shipped app. `held` state comes
 * from the same offline outbox TaskListScreen already wires up; this is
 * also the first time it's rendered anywhere live (TaskListScreen never
 * shipped a route either).
 *
 * Filter state is local and intentionally NOT persisted — see LedgerSheet's
 * comment on why a fresh mount per open is sufficient to satisfy "filter
 * persistence: none".
 */
export function LedgerTasksSection() {
  const [filter, setFilter] = useState<TaskFilter>("all");

  const today = chicagoToday();
  const allQuery = useTasks({ status: "open" });
  const todayQuery = useTodayTasks();
  const overdueQuery = useOverdueTasks();

  const completeMutation = useCompleteTask();
  const dropMutation = useDropTask();
  const busy = completeMutation.isPending || dropMutation.isPending;

  // Same pattern as TaskListScreen: select the raw items array (stable
  // reference, no allocation in the selector) and derive the held-id set in
  // useMemo below.
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

  const groups = useMemo<Group[]>(() => {
    if (filter === "today") {
      const tasks = todayQuery.data ?? [];
      return tasks.length ? [{ key: "today", label: `DUE TODAY · ${tasks.length}`, tasks }] : [];
    }
    if (filter === "overdue") {
      const tasks = overdueQuery.data ?? [];
      return tasks.length ? [{ key: "overdue", label: `OVERDUE · ${tasks.length}`, tasks }] : [];
    }

    const all = allQuery.data ?? [];
    const overdue: Task[] = [];
    const dueToday: Task[] = [];
    const later: Task[] = [];
    for (const task of all) {
      const bucket = dueBucket(task, today);
      if (bucket === "overdue") overdue.push(task);
      else if (bucket === "today") dueToday.push(task);
      else later.push(task);
    }

    const result: Group[] = [];
    if (overdue.length) result.push({ key: "overdue", label: `OVERDUE · ${overdue.length}`, tasks: overdue });
    if (dueToday.length) result.push({ key: "today", label: `DUE TODAY · ${dueToday.length}`, tasks: dueToday });
    if (later.length) result.push({ key: "later", label: `LATER · ${later.length}`, tasks: later });
    return result;
  }, [filter, allQuery.data, todayQuery.data, overdueQuery.data, today]);

  const onComplete = useCallback((task: Task) => completeMutation.mutate(task.task_id), [completeMutation]);
  const onDrop = useCallback(
    (task: Task) => {
      Alert.alert("Drop task?", task.title, [
        { text: "Cancel", style: "cancel" },
        { text: "Drop", style: "destructive", onPress: () => dropMutation.mutate(task.task_id) },
      ]);
    },
    [dropMutation],
  );

  const isLoading =
    filter === "today" ? todayQuery.isLoading : filter === "overdue" ? overdueQuery.isLoading : allQuery.isLoading;
  const hasAny = groups.some((g) => g.tasks.length > 0);

  return (
    <View>
      <Text className="mb-3 font-sans-semibold text-heading text-ink">Tasks</Text>

      <View className="mb-4 flex-row gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              className={`h-10 items-center justify-center rounded-full border px-5 ${
                active ? "border-ink bg-ink" : "border-line-strong bg-transparent"
              }`}
              key={f.id}
              // h40 pill, 48×48 minimum touch target rule: widen the tappable
              // area with hitSlop rather than growing the visible pill (same
              // fix StatusStrip's BudgetMark uses for its 28px strip).
              hitSlop={{ top: 4, bottom: 4 }}
              onPress={() => setFilter(f.id)}
            >
              <Text className={`font-sans-medium text-label ${active ? "text-bg-base" : "text-ink"}`}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading && !hasAny ? (
        <Text className="font-sans text-body text-ink-muted">Loading tasks…</Text>
      ) : !hasAny ? (
        <Text className="font-sans text-body text-ink-muted">Nothing here.</Text>
      ) : (
        groups.map((group) => (
          <View className="mb-4" key={group.key}>
            <Text className="mb-2 font-mono-medium text-dataSm text-ink-muted">{group.label}</Text>
            {group.tasks.map((task) => (
              <TaskRow
                busy={busy}
                held={heldTaskIds.has(task.task_id)}
                key={task.task_id}
                onComplete={onComplete}
                onDrop={onDrop}
                task={task}
              />
            ))}
          </View>
        ))
      )}
    </View>
  );
}
