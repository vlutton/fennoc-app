import { Check, Trash2 } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type { Task } from "../api/types";
import { useTheme } from "../theme/useTheme";
import { formatRelativeDue, formatTimeOfDay } from "../utils/format";

interface TaskRowProps {
  task: Task;
  onComplete: (task: Task) => void;
  onDrop: (task: Task) => void;
  busy?: boolean;
  /**
   * True when this task's completion/drop is queued in the offline outbox
   * (`src/outbox/`) and hasn't reached the server yet. Renders the "held"
   * treatment instead of the normal open/done state — solid and complete,
   * dashed edge, **never a spinner**: the thought/action is already the
   * user's, only delivery is pending. A spinner says "this might not have
   * worked," and then they do it twice.
   */
  held?: boolean;
}

type RowState = "open" | "done" | "held";

function metaLine(task: Task, state: RowState): string {
  if (state === "held") return "HELD · WILL SEND";

  const project = (task.project || "").toUpperCase();

  if (state === "done") {
    const at = formatTimeOfDay(task.completed_at);
    return at ? `DONE ${at}` : "DONE";
  }

  const due = formatRelativeDue(task.due_date);
  return due ? `${project} · DUE ${due.toUpperCase()}` : project;
}

/**
 * Min-height 64, `bg-raised`, 1px `line-hairline`, radius 12. Three states,
 * three treatments — open, done, held (INT-023b §4).
 */
export function TaskRow({ task, onComplete, onDrop, busy = false, held = false }: TaskRowProps) {
  const { palette } = useTheme();
  const state: RowState = held ? "held" : task.status === "completed" ? "done" : "open";
  const checkboxInteractive = state === "open" && !busy;

  // mb-3: list spacing, not part of the component spec itself — callers
  // that lay these out with their own gap (a future ledger list) can
  // override/ignore it; TaskListScreen relies on it today.
  const containerClass =
    state === "held"
      ? "mb-3 min-h-[64px] flex-row items-center gap-3 rounded-md border border-dashed border-line-strong bg-bg-raised py-2 pl-3 pr-2"
      : "mb-3 min-h-[64px] flex-row items-center gap-3 rounded-md border border-line-hairline bg-bg-raised py-2 pl-3 pr-2";

  const checkboxVisualClass =
    state === "done"
      ? "h-6 w-6 items-center justify-center rounded-[6px] bg-positive"
      : state === "held"
        ? "h-6 w-6 rounded-[6px] border-2 border-dashed border-line-strong"
        : "h-6 w-6 rounded-[6px] border-2 border-line-strong";

  return (
    <View className={containerClass}>
      <Pressable
        accessibilityLabel={state === "done" ? `${task.title}, done` : `Complete ${task.title}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: state === "done", disabled: !checkboxInteractive }}
        className="h-touch w-touch items-center justify-center"
        disabled={!checkboxInteractive}
        onPress={() => onComplete(task)}
      >
        <View className={checkboxVisualClass}>
          {state === "done" ? <Check color={palette.bg.base} size={14} strokeWidth={3} /> : null}
        </View>
      </Pressable>

      <View className="flex-1">
        <Text
          className={
            state === "done"
              ? "font-sans text-body text-ink-muted line-through"
              : "font-sans text-body text-ink"
          }
          numberOfLines={1}
        >
          {task.title}
        </Text>
        <Text className="mt-1 font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
          {metaLine(task, state)}
        </Text>
      </View>

      {state === "open" ? (
        <Pressable
          accessibilityLabel={`Drop ${task.title}`}
          accessibilityRole="button"
          className="h-touch w-touch items-center justify-center active:opacity-80"
          disabled={busy}
          onPress={() => onDrop(task)}
        >
          {/*
            `ink.muted`, not `alert`. The design reserves alert for "destructive
            confirm only. Rare." — one drop control per row means alert on every
            row of the ledger, which dilutes it exactly the way an over-used
            `signal` would. Alert belongs on a confirm step, not on the resting
            affordance.

            TODO(INT-027): dropping is currently immediate and irreversible with
            no confirm. The design's answer is the set-down flow, where nothing
            is destroyed — items are handed over with a condition and come back.
          */}
          <Trash2 color={palette.ink.muted} size={18} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}
