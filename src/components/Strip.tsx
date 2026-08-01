import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import { ChevronDown, Pause } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import type { OpenTimer, Task } from "../api/types";
import { formatApiError } from "../api/client";
import { useSendAgentMessage } from "../hooks/useAgentMessage";
import { useCapture } from "../hooks/useHome";
import { useCompleteTask, useTodayTasks } from "../hooks/useTasks";
import { useOpenTimer, useStopTime } from "../hooks/useTime";
import { isNetworkError } from "../outbox";
import { useThreadStore } from "../store/useThread";
import { quietEasing, STATE_SETTLE, useReducedMotion } from "../theme/motion";
import { useTheme } from "../theme/useTheme";
import { formatClock } from "../utils/format";

/**
 * INT-048 — "the strip only exists while work is in progress."
 *
 * This replaces the old permanent, always-filled Next strip (INT-023/10d):
 * a 72px slot that was reserved even when empty and auto-filled by a
 * priority list (running timer, then a scheduled event, then the next
 * task, then nothing). Steps 11-13 of the design memo refined that widget
 * and then rejected the premise underneath it — "a permanent slot has to be
 * filled, so it gets filled with the best available guess whether or not
 * there's a good one. That's the mechanism that turns an assistant into a
 * manager." Suggestions now surface as sentences in the thread, never as a
 * standing card; the ONLY thing that still earns this real estate is work
 * actually in progress. See intents/INT-048-next-strip-lifecycle.md.
 *
 * What survives from the old widget (per the intent's own survivor table):
 * one geometry — `[glyph][primary]` — merging with the running timer
 * rather than sitting beside it; the 2.5s green resolution (`#8FA167`,
 * never on a control); swipe right = done / swipe down = not-now, both
 * reversible, neither ever the only way.
 *
 * What this build deliberately does NOT implement (the memo is bigger than
 * one build):
 *   - TODO(INT-048): long-press -> WHY THIS, and override-as-speech
 *     re-ranking (step 12b). There is no more auto-suggested occupant for
 *     the user to disagree with in this build, so there is nothing to
 *     explain or override yet.
 *   - TODO(INT-048): the sub-line auto-advance ("then 3 calls" -> "then 2
 *     calls"). That required the dead priority-ranked task list; a real
 *     replacement needs a real sequence source from the server.
 *   - TODO(INT-048): "Done hands back to words" (step 13a, moment 5) — the
 *     server naming a next candidate ("Start Vaughn / I'm done for now").
 *     No such data exists yet, so Done's resolution simply lets the strip
 *     leave once the 2.5s window closes, which the task brief calls out as
 *     the correct behaviour in the absence of that data.
 *   - TODO(INT-048): the tick ("already did it", `CLOSED · NO TIME
 *     RECORDED`) has no reachable entry point in THIS build. Its old home
 *     was the auto-populated "actionable, not yet started" strip state —
 *     exactly the occupant 13's reversal kills ("Fennoc chooses" is dead;
 *     only a running timer survives as an automatic occupant). A
 *     not-started task is now only a sentence in the thread, and the memo
 *     doesn't specify how such a sentence would carry an inline tick
 *     control (this is INT-048's own open question #2/#3 territory). The
 *     mechanism itself — resolve without inventing a duration — is kept
 *     alive below as the `Resolution` union's `"closed-no-time"` branch
 *     (see `resolutionLabel` and `commitResolution`), wired and ready the
 *     moment a real entry point exists; it is simply unreachable from the
 *     UI today.
 *   - TODO(INT-048): the three-overrides-in-a-week learned-suppression rule
 *     (INT-033/034 territory) — there is nothing to override yet either.
 *
 * API gap, degraded gracefully: `OpenTimerResponse` (`GET /api/time/open`)
 * carries no `task_id` — only a free-text `label`. There is no server-side
 * link between a running timer and a ledger task, so "Done... completes
 * the task in one tap" is only possible when `resolveTaskForTimer` below
 * can match the timer's label against today's open tasks by title. When it
 * can't, Done still stops the clock and logs the time honestly — it just
 * can't also close a task nothing here can identify. The real fix is a
 * `task_id` column on the open-timer cursor; tracked as TODO(INT-048), not
 * built here (this is a client-only change).
 */

// "2.5-second green resolution" (step 11 of the design memo). This is a
// state HOLD duration, not a transition — distinct from the 120-320ms
// transition tokens in theme/motion.ts, which govern the fade this state
// animates in and out with.
const RESOLUTION_HOLD_MS = 2500;

const SWIPE_DONE_THRESHOLD_PX = 88;
const SWIPE_TRAY_THRESHOLD_PX = 44;
const SWIPE_ACTIVATE_PX = 6;

const PAUSE_GLYPH_SIZE = 48;

type NotNowVerb = "later" | "set-down";

const STOP_CHIPS = [
  { key: "break", label: "Just a break", text: "Just a break." },
  { key: "blocker", label: "Hit a blocker", text: "Hit a blocker." },
  { key: "something", label: "Something came up", text: "Something came up." },
] as const;

/**
 * Best-effort match from a running timer's free-text `label` to today's
 * open tasks, so Done can complete the right ledger row. Exact match only
 * (trimmed, case-insensitive) — a fuzzy match risks completing the WRONG
 * task, which is worse than completing none. See the file header's API-gap
 * note: this whole function is a workaround for `OpenTimerResponse` having
 * no `task_id`, not a real solution to it.
 */
export function resolveTaskForTimer(
  tasks: Task[] | undefined,
  timer: Pick<OpenTimer, "label">,
): Task | null {
  const label = timer.label?.trim().toLowerCase();
  if (!label) return null;
  return tasks?.find((t) => t.title.trim().toLowerCase() === label) ?? null;
}

/** "24 MIN" / "1 HR 10 MIN" / "45 SEC" — the design's own copy shape for a
 *  resolved duration, distinct from the running clock's `HH:MM:SS`. */
export function formatResolutionDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds} SEC`;
  const totalMinutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours} HR ${minutes} MIN`;
  if (hours > 0) return `${hours} HR`;
  return `${minutes} MIN`;
}

type Resolution =
  | { kind: "logged"; durationMs: number; taskId: string | null; title: string }
  /**
   * Reserved for the tick (see the file-header TODO) — completing a task
   * that was never timed. Nothing in this build constructs one yet, but
   * the renderer and commit path both handle it correctly so wiring a real
   * entry point later doesn't also require touching this logic.
   */
  | { kind: "closed-no-time"; taskId: string; title: string };

function resolutionLabel(resolution: Resolution): string {
  if (resolution.kind === "logged") {
    return `LOGGED ${formatResolutionDuration(resolution.durationMs)}`;
  }
  // Never invents a duration — this is the whole point of the tick.
  return "CLOSED · NO TIME RECORDED";
}

/** `state.settle` (180ms, `quiet`) fade-in for the strip's transient
 *  sub-states (resolution / stop-question / not-now tray). Reduced motion's
 *  twin is static — full opacity immediately, no travel, per the design's
 *  "every twin preserves the information and drops only the travel" rule
 *  (see theme/motion.ts, and TaskRow's identical gating). */
function FadeInRow({
  children,
  reducedMotion,
}: {
  children: ReactNode;
  reducedMotion: boolean;
}) {
  const opacity = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withTiming(1, { duration: STATE_SETTLE, easing: quietEasing() });
  }, [reducedMotion, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

function NowLabel() {
  return (
    <>
      <Text
        className="w-10 font-mono-medium text-ink-muted"
        numberOfLines={1}
        style={{ fontSize: 10.5, lineHeight: 13 }}
      >
        NOW
      </Text>
      <View className="h-6 w-px bg-line-hairline" />
    </>
  );
}

/**
 * The strip — root export. Renders nothing at all unless a timer is
 * running (or a just-triggered resolution/question/tray sub-state is
 * still holding the screen for its beat) — no reserved slot, no empty
 * dashed state, no scheduled or suggested occupant. See the file header
 * for what's deliberately deferred.
 */
export function Strip() {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotion();

  const openTimerQuery = useOpenTimer();
  const stopTimeMutation = useStopTime();
  const completeTaskMutation = useCompleteTask();
  const todayTasksQuery = useTodayTasks();
  const sendAgentMessage = useSendAgentMessage();
  const captureMutation = useCapture();
  const addCapture = useThreadStore((s) => s.addCapture);
  const addAgentPending = useThreadStore((s) => s.addAgentPending);

  const timer = openTimerQuery.data;
  const running = timer?.active === true;

  // Ticks once a second while a timer is running, so the elapsed-time
  // reads below stay live. `Date.now()` itself is only ever called from
  // inside this interval callback (never directly in the render body or
  // in an event handler reachable from the PanResponder chain below) —
  // this project's lint rules (react-hooks/purity) flag `Date.now()` as
  // an impure call anywhere they can't prove it's confined to a deferred
  // callback, and a plain interval callback is unambiguously one.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const [resolution, setResolution] = useState<Resolution | null>(null);
  // A shared value, not `useRef` — `onDone` (which sets this) is called
  // from the PanResponder built below, and this project's `react-hooks/refs`
  // lint rule doesn't recognise `PanResponder.create`'s callback props as a
  // deferred boundary the way it does a JSX `onPress`, so a plain ref
  // touched anywhere in that call graph gets flagged as a render-time ref
  // access even though it never actually runs during render. See the
  // PanResponder construction below for the fuller note.
  //
  // Deliberately no unmount-cleanup effect cancelling this: if the strip
  // unmounts mid-window (e.g. the screen navigates away) the deferred
  // commit still fires on its own schedule and still does the right thing
  // — the stop/complete calls are exactly what the user asked for by not
  // hitting Undo in time, unmounted component or not. `setResolution`
  // becoming a no-op on an unmounted component is harmless (React 19 does
  // not warn for it).
  const resolveTimer = useSharedValue<ReturnType<typeof setTimeout> | null>(null);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);

  // Both of the above are sub-states of ONE running session and must not
  // survive into a different one. Without this, either can go stale and
  // hijack a later, unrelated session: e.g. Stop opens the question for
  // timer A (which is now correctly inactive — that's what "Stop" means);
  // if a brand new timer B starts before the question is answered,
  // `questionOpen` would otherwise still be true and the question branch
  // is checked before the running-row branch, so B's row would be replaced
  // by A's stale question. Symmetrically, swiping the tray open and then
  // having the timer stop from elsewhere (not via the tray's own buttons)
  // leaves `trayOpen` stuck true, ready to hijack the next session's row
  // the same way. `timer.started_at` is this session's identity — it's
  // present only while a timer is genuinely running, so comparing against
  // the last one this component has actually acted on is what lets this
  // reset exactly when a NEW running session appears, without ALSO firing
  // the instant Stop makes the CURRENT session inactive (which would close
  // the question it just opened).
  //
  // This is "adjusting state when a prop changes" (react.dev's own name for
  // the pattern) — a plain conditional setState call during render, NOT
  // inside a `useEffect`. That's deliberate, not a style choice: an extra
  // effect round-trip here would let the stale question/tray flash for one
  // frame before correcting itself, and this project's lint rules flag a
  // bare `setState` call in an effect body regardless (see the `nowMs`
  // effect above for the same constraint from the other direction).
  const [acknowledgedStartedAt, setAcknowledgedStartedAt] = useState<string | null>(null);
  if (timer?.active && timer.started_at && timer.started_at !== acknowledgedStartedAt) {
    setQuestionOpen(false);
    setTrayOpen(false);
    setAcknowledgedStartedAt(timer.started_at);
  }

  // Drag feedback for the swipe gestures below. Driven from PanResponder's
  // JS-thread callbacks (there is no react-native-gesture-handler in this
  // app — see package.json — so PanResponder, RN core, is the dependency-
  // free way to recognise the gesture; reanimated shared values can be
  // assigned from JS-thread callbacks just as well as from a worklet, and
  // this keeps the visual feedback on the same motion primitives the rest
  // of the app uses).
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // A shared value, not `useRef` — this project's lint rules
  // (react-hooks/refs) don't allow a plain ref's `.current` to be read or
  // written from inside a callback built during render (which is exactly
  // what every PanResponder handler below is, since `PanResponder.create`
  // is a plain function call the linter has no special deferred-handler
  // knowledge of, unlike a JSX `onPress` prop). A reanimated shared value
  // is a different primitive the rule doesn't recognise, and behaves
  // identically here — mutable storage read and written from plain JS-
  // thread callbacks, persisted across the many `onPanResponderMove` calls
  // within a single gesture stroke.
  const dragAxis = useSharedValue<"none" | "x" | "y">("none");

  const settleDrag = () => {
    translateX.value = withTiming(0, { duration: STATE_SETTLE, easing: quietEasing() });
    translateY.value = withTiming(0, { duration: STATE_SETTLE, easing: quietEasing() });
  };

  /**
   * Sends a plain message through the same path CaptureBar's composer
   * uses (`POST /api/message`, falling back to the offline-safe
   * `/api/capture` queue on a network error) — this is how the memo wants
   * every one of these verbs handled: "the answer goes through the
   * existing message path as text... the agent handles the routing." This
   * component does not interpret break/blocker/something-came-up/later/
   * set-down itself, and does not build any client-side condition or
   * waiting state — INT-027 already owns that machinery server-side.
   *
   * TODO(INT-048): this mirrors CaptureBar.tsx's onSubmit fallback almost
   * exactly. Worth extracting into a shared `useSendThreadMessage` hook if
   * a third call site shows up — not done here to keep this change scoped
   * to the strip and avoid touching CaptureBar's already-battle-tested
   * send path.
   */
  const sendStripMessage = (text: string) => {
    sendAgentMessage.mutate(text, {
      onSuccess: (result) => {
        addCapture(text);
        addAgentPending(result.id);
      },
      onError: (error) => {
        if (isNetworkError(error)) {
          captureMutation.mutate({
            text,
            opts: { idempotency_key: Crypto.randomUUID(), source_ref: "fennoc-app" },
          });
          return;
        }
        console.error("[strip] message send failed:", formatApiError(error));
      },
    });
  };

  // Fires the two real writes once the 2.5s window has closed
  // uninterrupted. By this point the resolution row is already gone (the
  // strip has visually "left") and there is no more UI surface to hold a
  // spinner or error on — this is fire-and-forget, same discipline as
  // ThreadScreen's own `deleteSentUploadsForBatch`: never swallowed
  // silently, logged loudly on failure, because a failure here means the
  // user believes their time/task was logged when it may not have been.
  const commitResolution = (pending: Resolution) => {
    if (pending.kind === "logged") {
      stopTimeMutation.mutate(undefined, {
        onError: (error) => {
          console.error("[strip] stop time failed after resolution:", formatApiError(error));
        },
      });
    }
    if (pending.taskId) {
      completeTaskMutation.mutate(pending.taskId, {
        onError: (error) => {
          console.error("[strip] complete task failed after resolution:", formatApiError(error));
        },
      });
    }
  };

  const beginResolution = (pending: Resolution) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setResolution(pending);
    resolveTimer.value = setTimeout(() => {
      resolveTimer.value = null;
      setResolution(null);
      commitResolution(pending);
    }, RESOLUTION_HOLD_MS);
  };

  // Done — swipe right and the button both call this, so they "produce
  // byte-identical ledger writes" (INT-048's own test plan). Stops the
  // clock AND completes the task in one action; never invents a duration
  // because it always has a real one (a running timer, by definition, has
  // been running for some elapsed time).
  const onDone = () => {
    if (!timer?.active || resolution) return;
    const startedAt = timer.started_at ? Date.parse(timer.started_at) : NaN;
    const elapsedMs = Number.isFinite(startedAt) ? nowMs - startedAt : 0;
    const matched = resolveTaskForTimer(todayTasksQuery.data, timer);
    beginResolution({
      kind: "logged",
      durationMs: elapsedMs,
      taskId: matched?.task_id ?? null,
      title: timer.label ?? matched?.title ?? "",
    });
  };

  // Undo, for the 2.5s window only. No server call has been made yet at
  // this point — see beginResolution/commitResolution above — so "undo" is
  // simply cancelling the deferred commit and returning to the running
  // row, not a compensating write. There is no reopen/uncomplete endpoint
  // on the server to call even if this DID commit immediately (see
  // api/schema.gen.ts — no such route exists), so deferring the real
  // mutations until the window closes uninterrupted is what makes "Undo"
  // an honest word here instead of a lie.
  const onUndoResolution = () => {
    if (resolveTimer.value) {
      clearTimeout(resolveTimer.value);
      resolveTimer.value = null;
    }
    setResolution(null);
  };

  // Stop asks a question; it does not pause-and-wait. `stopTime()` fires
  // immediately and for real — unlike Done's resolution there is no 2.5s
  // undo window here, because stopping the clock is never wrong: "abandoning
  // something half-done is where the useful signal is" (step 13), and the
  // three chips plus the composer are what capture that signal, not a
  // reversible commit.
  const onStop = () => {
    if (!timer?.active || resolution || stopTimeMutation.isPending) return;
    stopTimeMutation.mutate(undefined, {
      onSuccess: () => setQuestionOpen(true),
    });
  };

  const onStopChip = (text: string) => {
    sendStripMessage(text);
    setQuestionOpen(false);
  };

  // "Set it down" / "Later today": neither has a dedicated API (see the
  // file header) — both stop the clock (this device's work here is over)
  // and hand the actual routing to the agent as a plain sentence, same
  // discipline as the Stop chips above. "Skip" needs no handler of its own:
  // it just closes the tray (see the JSX below) and changes nothing, which
  // is the entire point of that verb per the memo ("the one that changes
  // nothing, and says so").
  const onNotNowVerb = (verb: NotNowVerb) => {
    if (!timer?.active) return;
    const title = timer.label?.trim() || "this";
    const text =
      verb === "later"
        ? `Put "${title}" off until later today.`
        : `Set "${title}" down for now.`;
    setTrayOpen(false);
    stopTimeMutation.mutate();
    sendStripMessage(text);
  };

  // Rebuilt fresh every render — deliberately NOT memoised via `useRef` /
  // `useState`. `PanResponder.create` itself has no setup cost (no
  // subscription, no native registration; it just returns a plain object
  // of callback props), so there is nothing to gain from persisting one
  // instance, and real gains to lose: a memoised instance built once would
  // permanently close over whichever render's `onDone` (which reads
  // `timer` / `resolution` / `todayTasksQuery.data`) happened to be
  // current at mount, going stale on every render after. Rebuilding each
  // render means every handler always closes over the CURRENT render's
  // values — correct by construction, no "latest ref" indirection needed.
  // A render CAN happen mid-gesture (the elapsed-clock tick above fires
  // every second the row is mounted, independent of any touch), swapping
  // this object's identity while a finger is still down — that's fine:
  // React Native reads the responder's handler PROPS fresh from the
  // current fiber at the moment each native touch event is dispatched, the
  // same way a `Pressable`'s `onPress` always fires whichever closure was
  // current on its last render, not whichever was current when the finger
  // first touched down.
  //
  // `onMoveShouldSetPanResponder` — NOT the `...Capture` variant. Capture
  // fires top-down, before the nested Done/Stop `Pressable`s below get a
  // chance to claim the touch for themselves, so it would steal ordinary
  // finger jitter during a TAP (a few px of drift is normal) as a swipe
  // attempt and silently eat the button press. The non-capture form only
  // gets consulted once nothing has already claimed the responder for that
  // touch — which is exactly "the touch didn't start on a button" — so
  // taps on Done/Stop stay reliable and a swipe starting on the open part
  // of the row (the clock/label area) is still recognised.
  const panResponder = PanResponder.create({
    onMoveShouldSetPanResponder: (_evt, gesture) =>
      Math.abs(gesture.dx) > SWIPE_ACTIVATE_PX || Math.abs(gesture.dy) > SWIPE_ACTIVATE_PX,
    onPanResponderGrant: () => {
      dragAxis.value = "none";
    },
    onPanResponderMove: (_evt, gesture) => {
      if (dragAxis.value === "none") {
        dragAxis.value = Math.abs(gesture.dx) >= Math.abs(gesture.dy) ? "x" : "y";
      }
      if (dragAxis.value === "x") {
        translateX.value = Math.max(0, gesture.dx);
      } else {
        translateY.value = Math.max(0, gesture.dy);
      }
    },
    onPanResponderRelease: (_evt, gesture) => {
      const axis = dragAxis.value;
      dragAxis.value = "none";
      settleDrag();
      if (axis === "x" && gesture.dx > SWIPE_DONE_THRESHOLD_PX) {
        onDone();
        return;
      }
      if (axis === "y" && gesture.dy > SWIPE_TRAY_THRESHOLD_PX) {
        setTrayOpen(true);
      }
    },
    onPanResponderTerminate: () => {
      dragAxis.value = "none";
      settleDrag();
    },
  });

  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));

  // --- Resolution: the 2.5s green (or, for the tick, neutral) hold -------
  if (resolution) {
    const isLogged = resolution.kind === "logged";
    return (
      <FadeInRow reducedMotion={reducedMotion}>
        <View
          className={
            isLogged
              ? "mx-4 mb-3 min-h-16 flex-row items-center gap-3 rounded-md border border-positive bg-bg-raised px-4 py-3"
              : "mx-4 mb-3 min-h-16 flex-row items-center gap-3 rounded-md border border-line-hairline bg-bg-raised px-4 py-3"
          }
        >
          <View className="flex-1">
            <Text className="font-sans text-body text-ink-muted" numberOfLines={2}>
              {resolution.title || "Done"}
            </Text>
            {/* Green — #8FA167, the `positive` token — is reserved for
                exactly this: state that has already resolved. It never
                appears on a control (Undo below stays neutral ink), and it
                never appears anywhere else in this component. */}
            <Text
              className={
                isLogged
                  ? "mt-1 font-mono-medium text-dataSm text-positive"
                  : "mt-1 font-mono-medium text-dataSm text-ink-muted"
              }
              numberOfLines={1}
            >
              {resolutionLabel(resolution)}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Undo"
            accessibilityRole="button"
            className="h-touch items-center justify-center rounded-sm px-3 active:opacity-80"
            hitSlop={8}
            onPress={onUndoResolution}
          >
            <Text className="font-sans-medium text-label text-ink-secondary">Undo</Text>
          </Pressable>
        </View>
      </FadeInRow>
    );
  }

  // --- Stop is a question, not a pause ------------------------------------
  if (questionOpen) {
    return (
      <FadeInRow reducedMotion={reducedMotion}>
        <View className="mx-4 mb-3 gap-3 rounded-md border border-line-hairline bg-bg-raised px-4 py-3">
          <Text className="font-sans text-body text-ink">
            Is this a break, or did you hit something?
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {STOP_CHIPS.map((chip) => (
              <Pressable
                accessibilityLabel={chip.label}
                accessibilityRole="button"
                className="h-touch items-center justify-center rounded-sm border border-line-strong px-3 active:opacity-80"
                key={chip.key}
                onPress={() => onStopChip(chip.text)}
              >
                <Text className="font-sans-medium text-label text-ink">{chip.label}</Text>
              </Pressable>
            ))}
          </View>
          {/* Chips are shortcuts, never the vocabulary — the composer
              below (CaptureBar, rendered by ThreadScreen under this
              component) is always the real answer surface. This line is
              only a pointer to it, not a second input. */}
          <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
            …OR JUST TELL ME
          </Text>
        </View>
      </FadeInRow>
    );
  }

  // --- Nothing running: no strip, no reserved space, no guess ------------
  if (!running || !timer) {
    return null;
  }

  // --- Not-now tray: swipe down expands the running row into this --------
  if (trayOpen) {
    return (
      <FadeInRow reducedMotion={reducedMotion}>
        <View className="mx-4 mb-3 gap-2 rounded-md border border-line-hairline bg-bg-raised px-4 py-3">
          <Pressable
            accessibilityLabel="Later today"
            accessibilityRole="button"
            className="h-touch items-center justify-center rounded-sm border border-line-strong px-3 active:opacity-80"
            disabled={stopTimeMutation.isPending}
            onPress={() => onNotNowVerb("later")}
          >
            <Text className="font-sans-medium text-label text-ink">Later today</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Set it down"
            accessibilityRole="button"
            className="h-touch items-center justify-center rounded-sm border border-line-strong px-3 active:opacity-80"
            disabled={stopTimeMutation.isPending}
            onPress={() => onNotNowVerb("set-down")}
          >
            <Text className="font-sans-medium text-label text-ink">Set it down</Text>
          </Pressable>
          {/* Full-width, at the bottom — "the tray is ordered by how much
              of the truth each verb tells... skip is the one that changes
              nothing and admits it." Closing the tray is the entire
              action: the timer keeps running, untouched. */}
          <Pressable
            accessibilityLabel="Skip — leave it where it is"
            accessibilityRole="button"
            className="h-touch items-center justify-center rounded-sm border border-line-strong px-3 active:opacity-80"
            onPress={() => setTrayOpen(false)}
          >
            <Text className="font-sans-medium text-label text-ink-secondary">
              Skip — leave it where it is
            </Text>
          </Pressable>
        </View>
      </FadeInRow>
    );
  }

  // --- Running: the only automatic occupant left ---------------------------
  const startedAt = timer.started_at ? Date.parse(timer.started_at) : NaN;
  const elapsedMs = Number.isFinite(startedAt) ? nowMs - startedAt : 0;
  const busy = stopTimeMutation.isPending;

  return (
    <View>
      {/* Animated.View only carries the drag transform — NativeWind's
          className doesn't resolve on react-native-reanimated's
          Animated.View without registering it via cssInterop (see
          LedgerSheet.tsx's identical note), so all the visual styling
          lives on the plain View nested inside it instead. The gesture
          handlers live on this outer, transform-only layer so the whole
          row's hit area participates in the drag. */}
      <Animated.View style={dragStyle} {...panResponder.panHandlers}>
        <View className="mx-4 mb-1 min-h-16 flex-row items-center gap-3 rounded-md border border-signal bg-signal-wash px-4 py-3">
          <NowLabel />
          <View className="flex-1">
            <Text className="font-mono-medium text-body text-signal" numberOfLines={1}>
              {formatClock(elapsedMs)}
            </Text>
            <Text className="font-sans text-dataSm text-ink-secondary" numberOfLines={1}>
              {timer.label || "Working"}
              {timer.category ? ` · ${timer.category.toUpperCase()}` : ""}
            </Text>
          </View>
          {/* Pause survives as a 48px glyph — "the phone call that
              interrupts you." Tapping it stops the clock for real (see
              onStop) and opens the question above; it does not complete
              anything, which is what makes it the quiet alternative to
              Done. */}
          <Pressable
            accessibilityLabel="Stop — is this a break, or did you hit something?"
            accessibilityRole="button"
            className="items-center justify-center rounded-sm border border-line-strong active:opacity-80"
            disabled={busy}
            onPress={onStop}
            style={{ height: PAUSE_GLYPH_SIZE, width: PAUSE_GLYPH_SIZE }}
          >
            <Pause color={palette.ink.DEFAULT} size={22} />
          </Pressable>
          {/* Done — the primary target. Stops the clock AND completes the
              task in one tap; see onDone. Swipe right (this same row's
              PanResponder, above) is the identical action, not a second
              implementation of it. */}
          <Pressable
            accessibilityLabel="Done — stop and complete"
            accessibilityRole="button"
            className="h-touch items-center justify-center rounded-sm bg-signal px-4 active:opacity-80"
            disabled={busy}
            onPress={onDone}
          >
            <Text className="font-sans-semibold text-label text-signal-on">Done</Text>
          </Pressable>
        </View>
      </Animated.View>
      {/* Swipe down is the primary route into the not-now tray, but "neither
          is ever the only way" — this small handle is the non-gesture,
          screen-reader-reachable equivalent. Deliberately minimal (not a
          third full-size control) so the row above stays a single
          [glyph][primary] geometry. */}
      <Pressable
        accessibilityLabel="Not now — later, set it down, or skip"
        accessibilityRole="button"
        className="mx-4 mb-3 h-5 items-center justify-center active:opacity-60"
        hitSlop={8}
        onPress={() => setTrayOpen(true)}
      >
        <ChevronDown color={palette.ink.disabled} size={16} />
      </Pressable>
    </View>
  );
}
