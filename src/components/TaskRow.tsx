import * as Haptics from "expo-haptics";
import { Check, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

import type { Task } from "../api/types";
import { quietEasing, STATE_SETTLE, STATE_TICK, useReducedMotion } from "../theme/motion";
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
  const reducedMotion = useReducedMotion();
  const state: RowState = held ? "held" : task.status === "completed" ? "done" : "open";

  // Reported from a real device: "Checking the boxes needs to be
  // satisfying, currently they just sit there for a second and kind of
  // disappear, the actual box never checks." `checked` is a local,
  // session-only "I just tapped complete" flag — NOT an optimistic cache
  // write (TanStack Query still owns that via useCompleteTask's
  // invalidation, see onPressComplete below). It only drives the fill-in
  // and leave animations; the row's actual removal from the list still
  // happens once the parent's query refetches without this task.
  const [checked, setChecked] = useState(false);
  const checkboxInteractive = state === "open" && !busy && !checked;

  // Reported from a real device: "most of the todos are highly truncated, but
  // there is no way for me to click to see the full content — I can't check off
  // an unknown task." The title was clamped to ONE line, which breaks the row's
  // whole job: the title IS the task's identity, and you cannot decide to
  // complete something you can't read.
  //
  // Two changes, deliberately both: the resting clamp goes to 3 lines (which
  // makes almost every real title fully readable without any interaction), and
  // tapping the text column reveals the rest. The tap is what the operator
  // actually asked for; the 3-line default is so they rarely need it.
  const [expanded, setExpanded] = useState(false);

  // Checkbox fill (`state.tick`, 120ms, `quiet`). Starts already-filled with
  // NO animation for a row that mounts already `done` (server-driven state,
  // e.g. a completed-tasks list) — it only animates in from a fresh tap. Per
  // the design's motion table, `state.tick`'s reduced twin is "unchanged",
  // so this one is never gated on reducedMotion.
  const fillOpacity = useSharedValue(state === "done" ? 1 : 0);
  // Row leave (`state.settle`, 180ms, `quiet`): opacity always; translateY
  // only when motion isn't reduced — the reduced twin drops the travel, not
  // the information (design handoff's rule, see src/theme/motion.ts).
  const rowOpacity = useSharedValue(1);
  const rowTranslateY = useSharedValue(0);

  const onPressComplete = () => {
    if (!checkboxInteractive) return;
    // Guard against double-taps: once checked locally, non-interactive (see
    // checkboxInteractive above) — this flips that immediately, synchronously
    // with the tap, not after the animation or the server round-trip.
    setChecked(true);

    // Haptics fire at the same moment as the visual fill, and are never
    // gated on reduced motion — the design explicitly keeps them in the
    // reduced-motion twin, and this is the single biggest contributor to
    // "satisfying". A haptics failure must never be able to break a
    // completion, hence the swallowed catch.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    fillOpacity.value = withTiming(1, { duration: STATE_TICK, easing: quietEasing() });
    rowOpacity.value = withDelay(
      STATE_TICK,
      withTiming(0, { duration: STATE_SETTLE, easing: quietEasing() }),
    );
    if (!reducedMotion) {
      rowTranslateY.value = withDelay(
        STATE_TICK,
        withTiming(4, { duration: STATE_SETTLE, easing: quietEasing() }),
      );
    }

    // Local visual state only, not an optimistic cache write — the row
    // itself unmounts once the caller's query refetches without this task.
    onComplete(task);
  };

  const rowAnimatedStyle = useAnimatedStyle(() => ({
    opacity: rowOpacity.value,
    transform: [{ translateY: rowTranslateY.value }],
  }));
  const fillAnimatedStyle = useAnimatedStyle(() => ({ opacity: fillOpacity.value }));

  // mb-3: list spacing, not part of the component spec itself — callers
  // that lay these out with their own gap (a future ledger list) can
  // override/ignore it; TaskListScreen relies on it today.
  const containerClass =
    state === "held"
      ? "mb-3 min-h-[64px] flex-row items-center gap-3 rounded-md border border-dashed border-line-strong bg-bg-raised py-2 pl-3 pr-2"
      : "mb-3 min-h-[64px] flex-row items-center gap-3 rounded-md border border-line-hairline bg-bg-raised py-2 pl-3 pr-2";

  // Filled (done, or just-checked) never has a border — matches the
  // original "done" treatment. Open/held keep their border; the fill
  // overlay below is what animates the box from empty to filled, not this
  // className, so it stays a plain conditional (no per-frame class churn).
  const checkboxVisualClass =
    state === "done" || checked
      ? "h-6 w-6 items-center justify-center rounded-[6px]"
      : state === "held"
        ? "h-6 w-6 rounded-[6px] border-2 border-dashed border-line-strong"
        : "h-6 w-6 items-center justify-center rounded-[6px] border-2 border-line-strong";

  return (
    <Animated.View style={rowAnimatedStyle}>
      <View className={containerClass}>
        <Pressable
          accessibilityLabel={state === "done" || checked ? `${task.title}, done` : `Complete ${task.title}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: state === "done" || checked, disabled: !checkboxInteractive }}
          className="h-touch w-touch items-center justify-center"
          disabled={!checkboxInteractive}
          onPress={onPressComplete}
        >
          <View className={checkboxVisualClass}>
            {state === "done" || checked ? (
              <Animated.View
                style={[StyleSheet.absoluteFill, fillAnimatedStyle, styles.checkboxFill, { backgroundColor: palette.positive }]}
              >
                <Check color={palette.bg.base} size={14} strokeWidth={3} />
              </Animated.View>
            ) : null}
          </View>
        </Pressable>

        {/* NOT `selectable` (see the app-wide text-selectability pass this
            row was audited under). The title Text below is the Pressable's
            OWN tap target — this is a genuine conflict, not an oversight:
            RN's native text-selection gesture is implemented with its own
            platform-level recognizers on the Text view, which are known
            (widely reported against RN's Text/Touchable pairing, especially
            on Android's `setTextIsSelectable`) to compete with — and on some
            platforms swallow — a wrapping Pressable's own touch handling,
            not just its long-press. This component's tap-to-expand is the
            entire reason the row is readable at all (see `expanded` above),
            so risking it silently breaking to gain selection here is the
            wrong trade without a real device to verify the outcome on.
            Flagged, not fixed — see the task's final report. */}
        <Pressable
          accessibilityHint={expanded ? "Tap to collapse the title" : "Tap to show the full title"}
          accessibilityLabel={task.title}
          accessibilityRole="button"
          className="flex-1 py-1"
          onPress={() => setExpanded((value) => !value)}
        >
          <Text
            className={
              state === "done"
                ? "font-sans text-body text-ink-muted line-through"
                : "font-sans text-body text-ink"
            }
            numberOfLines={expanded ? undefined : 3}
          >
            {task.title}
          </Text>
          <Text className="mt-1 font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
            {metaLine(task, state)}
          </Text>
        </Pressable>

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
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  checkboxFill: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
});
