import { useMemo } from "react";
import { Alert, Text, View } from "react-native";

import type { Task } from "../api/types";
import { useCompleteTask, useDropTask } from "../hooks/useTasks";
import { type SearchHit, useLedgerSearch } from "../hooks/useLedgerSearch";
import { useOutboxStore } from "../outbox";
import { TaskRow } from "./TaskRow";

/**
 * The one merged list the search field produces — "searches captures,
 * tasks, time labels and briefings in one list," per the intent doc, not
 * four separate result panes. Task hits render a real, functional TaskRow
 * (complete/drop both work from here); the other three kinds are read-only
 * summaries, since there's nowhere else in the app to act on a capture, a
 * time-block label, or a briefing snippet either.
 */
export function LedgerSearchResults({ query }: { query: string }) {
  const { hits, loading } = useLedgerSearch(query);

  const completeMutation = useCompleteTask();
  const dropMutation = useDropTask();
  const busy = completeMutation.isPending || dropMutation.isPending;

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

  const onComplete = (task: Task) => completeMutation.mutate(task.task_id);
  const onDrop = (task: Task) => {
    Alert.alert("Drop task?", task.title, [
      { text: "Cancel", style: "cancel" },
      { text: "Drop", style: "destructive", onPress: () => dropMutation.mutate(task.task_id) },
    ]);
  };

  if (loading && hits.length === 0) {
    return <Text className="font-sans text-body text-ink-muted">Searching…</Text>;
  }
  if (hits.length === 0) {
    return <Text className="font-sans text-body text-ink-muted">No matches.</Text>;
  }

  return (
    <View>
      {hits.map((hit: SearchHit) => {
        if (hit.kind === "task" && hit.task) {
          return (
            <TaskRow
              busy={busy}
              held={heldTaskIds.has(hit.task.task_id)}
              key={hit.id}
              onComplete={onComplete}
              onDrop={onDrop}
              task={hit.task}
            />
          );
        }
        return (
          <View className="mb-2 rounded-md border border-line-hairline bg-bg-raised p-3" key={hit.id}>
            <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
              {hit.kind.toUpperCase()} · {hit.meta}
            </Text>
            <Text className="mt-1 font-sans text-body text-ink" numberOfLines={2}>
              {hit.title}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
