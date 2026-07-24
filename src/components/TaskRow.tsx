import { Check, Trash2 } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type { Task } from "../api/types";
import { colors } from "../theme/colors";
import { formatRelativeDue } from "../utils/format";
import { Pill } from "./Pill";

interface TaskRowProps {
  task: Task;
  onComplete: (task: Task) => void;
  onDrop: (task: Task) => void;
  busy?: boolean;
}

export function TaskRow({ task, onComplete, onDrop, busy = false }: TaskRowProps) {
  const due = formatRelativeDue(task.due_date);

  return (
    <View className="mb-3 rounded-xl border border-sand bg-cream p-4">
      <Text
        className="text-base font-semibold leading-6 text-olive"
        numberOfLines={1}
      >
        {task.title}
      </Text>

      <View className="mt-2 flex-row flex-wrap items-center gap-2">
        <Pill label={task.project} variant="project" />
        <Pill
          label={`P${task.priority}`}
          priority={task.priority}
          variant="priority"
        />
        {due ? <Text className="text-sm leading-5 text-terracotta">{due}</Text> : null}
      </View>

      {task.labels.length > 0 ? (
        <View className="mt-2 flex-row flex-wrap gap-2">
          {task.labels.map((label) => (
            <Pill key={`${task.task_id}-${label}`} label={label} variant="label" />
          ))}
        </View>
      ) : null}

      <View className="mt-4 flex-row justify-end gap-3">
        <Pressable
          accessibilityLabel={`Complete ${task.title}`}
          accessibilityRole="button"
          className="min-h-12 min-w-12 items-center justify-center rounded-lg bg-terracotta active:opacity-80"
          disabled={busy}
          onPress={() => onComplete(task)}
        >
          <Check color={colors.cream} size={22} strokeWidth={2.25} />
        </Pressable>
        <Pressable
          accessibilityLabel={`Drop ${task.title}`}
          accessibilityRole="button"
          className="min-h-12 min-w-12 items-center justify-center rounded-lg bg-sand active:opacity-80"
          disabled={busy}
          onPress={() => onDrop(task)}
        >
          <Trash2 color="#B4534A" size={22} strokeWidth={2} />
        </Pressable>
      </View>
    </View>
  );
}
