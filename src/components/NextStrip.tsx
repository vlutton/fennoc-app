import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useTodayTasks } from "../hooks/useTasks";
import { useOpenTimer, useStartTime, useStopTime } from "../hooks/useTime";
import { formatClock } from "../utils/format";

const ROW_CLASS =
  "mx-4 mb-3 min-h-[64px] flex-row items-center gap-3 rounded-md px-4 py-3";

function NextLabel() {
  return (
    <>
      <Text
        className="w-10 font-mono-medium text-ink-muted"
        numberOfLines={1}
        style={{ fontSize: 10.5, lineHeight: 13 }}
      >
        NEXT
      </Text>
      <View className="h-6 w-px bg-line-hairline" />
    </>
  );
}

/**
 * Persistent slot directly above the capture bar. Shows exactly one thing,
 * never a list, and never disappears — including the empty state — so the
 * layout never shifts under a thumb already moving toward the capture bar.
 *
 * Four states from the design: scheduled/read-only, actionable, running
 * (merges with the timer), empty. This shell wires running (the open
 * timer) and actionable (the next open task, with a Start action) from the
 * existing hooks; a genuine "scheduled, read-only" source (e.g. a calendar
 * item) doesn't exist on the backend yet, so it falls through to the same
 * actionable rendering as the next task. No new backend calls are made.
 */
export function NextStrip() {
  const openTimerQuery = useOpenTimer();
  const stopTimeMutation = useStopTime();
  const startTimeMutation = useStartTime();
  const todayTasksQuery = useTodayTasks();

  const [expanded, setExpanded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const timer = openTimerQuery.data;
  const running = timer?.active === true;

  useEffect(() => {
    if (!running || !timer?.started_at) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, timer?.started_at]);

  if (running && timer) {
    const startedAt = timer.started_at ? Date.parse(timer.started_at) : NaN;
    const elapsedMs = Number.isFinite(startedAt) ? nowMs - startedAt : 0;

    return (
      <View className={`${ROW_CLASS} border border-signal bg-signal-wash`}>
        <NextLabel />
        <View className="flex-1">
          <Text
            className="font-mono-medium text-body text-signal"
            numberOfLines={1}
          >
            {formatClock(elapsedMs)}
          </Text>
          <Text
            className="font-sans text-dataSm text-ink-secondary"
            numberOfLines={1}
          >
            RUNNING
            {timer.category ? ` · ${timer.category.toUpperCase()}` : ""}
            {timer.label ? ` · ${timer.label}` : ""}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Stop timer"
          accessibilityRole="button"
          className="h-touch items-center justify-center rounded-sm bg-signal px-4 active:opacity-80"
          disabled={stopTimeMutation.isPending}
          onPress={() => stopTimeMutation.mutate()}
        >
          <Text className="font-sans-semibold text-label text-signal-on">
            Stop
          </Text>
        </Pressable>
      </View>
    );
  }

  const nextTask = todayTasksQuery.data?.[0];
  const remaining = Math.max(0, (todayTasksQuery.data?.length ?? 0) - 1);

  if (nextTask) {
    return (
      <View className={`${ROW_CLASS} border border-line-hairline bg-bg-raised`}>
        <NextLabel />
        {/*
          Two rounds of feedback landed here. First the title was clamped to
          ONE line ("CA Trip: Set Thu 7/30 rever…"); two lines was still not
          enough — "I am still not sure what it was asking me to start
          tracking, something about Avis and california return trip."

          The real problem is that agent-authored task titles are long
          compound sentences, and no fixed clamp makes those readable. So the
          clamp goes to three lines AND the whole block is tappable to show
          the rest, exactly as the ledger rows now work. Consistency matters
          here: the same gesture should reveal the same thing everywhere.
        */}
        <Pressable
          accessibilityHint={expanded ? "Tap to collapse" : "Tap to show the full task"}
          accessibilityLabel={nextTask.title}
          accessibilityRole="button"
          className="flex-1 py-1"
          onPress={() => setExpanded((value) => !value)}
        >
          <Text className="font-sans text-body text-ink" numberOfLines={expanded ? undefined : 3}>
            {nextTask.title}
          </Text>
          {/*
            The sub line carries SEQUENCING, not just metadata. The design's
            rationale for this whole component is that "the ordering of the
            day" was the single most useful thing the assistant produced and
            it was buried in a paragraph — so the strip's job is to say what
            is next and what follows it, which is what the spec's worked
            example ("RUNNING · THEN 3 CALLS") shows. A bare "HOME · DUE
            TODAY" is metadata about one row; it isn't a sequence.
          */}
          <Text
            className="font-mono-medium text-dataSm text-ink-muted"
            numberOfLines={1}
          >
            {(nextTask.project || "TASK").toUpperCase()}
            {nextTask.due_date ? " · DUE TODAY" : ""}
            {remaining > 0 ? ` · THEN ${remaining} MORE` : ""}
          </Text>
        </Pressable>
        {/*
          Labelled "Start timer", not "Start". Reported: "there's a Start
          button, I'm not sure what action I'm supposed to take or what Start
          does." It was never ambiguous in the code — it begins a time-tracking
          block against this task — but the button never said so, and the only
          place that became clear was AFTER pressing it, when the strip flipped
          to a running clock. A control whose meaning is only discoverable by
          triggering it is not labelled.

          TODO: `category` is hardcoded to "work", so a personal task gets
          tracked as work. Needs a real category source (the task's project is
          the obvious candidate) — not guessed at here.
        */}
        <Pressable
          accessibilityLabel={`Start a timer for ${nextTask.title}`}
          accessibilityRole="button"
          className="h-touch items-center justify-center rounded-sm border border-line-strong px-3 active:opacity-80"
          disabled={startTimeMutation.isPending}
          onPress={() =>
            startTimeMutation.mutate({
              category: "work",
              label: nextTask.title,
            })
          }
        >
          <Text className="font-sans-medium text-label text-ink">Start timer</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      className={`${ROW_CLASS} border border-dashed border-line-strong opacity-70`}
    >
      <NextLabel />
      <Text
        className="flex-1 font-sans text-body text-ink-muted"
        numberOfLines={1}
      >
        Nothing scheduled.
      </Text>
    </View>
  );
}
