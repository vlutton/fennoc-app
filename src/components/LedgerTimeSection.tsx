import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

import { useOpenTimer, useTodayTimeBlocks } from "../hooks/useTime";
import { chicagoToday, formatClock, formatDuration } from "../utils/format";

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 22;
const BLOCK_COUNT = DAY_END_HOUR - DAY_START_HOUR; // 16, one per hour, 06:00–22:00
const HOUR_MS = 3_600_000;
/** Below this, a gap is noise (block-to-block rounding), not "leaked" time. */
const MIN_GAP_MS = 60_000;

type BlockState = "tracked" | "running" | "untracked";

interface Interval {
  startMs: number;
  endMs: number;
}

interface Gap {
  startMs: number;
  endMs: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Midnight local time for a "YYYY-MM-DD" day string. */
function dayBaseMs(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The Ledger's Time section (INT-024). The day bar and the untracked-gap
 * rows are both computed client-side from `GET /api/time/blocks` +
 * `GET /api/time/open` — there's no backend concept of "gaps," only
 * completed blocks and (optionally) one open one, so this derives them by
 * walking the 06:00–22:00 window and finding what neither one covers.
 *
 * "now" is a snapshot taken once at mount, not a ticking clock — the sheet
 * is opened fresh each time (see LedgerSheet), so a render-time snapshot is
 * as current as the section ever needs to be without adding a 1s interval
 * to a view the user is holding open only briefly.
 */
export function LedgerTimeSection() {
  const today = chicagoToday();
  const blocksQuery = useTodayTimeBlocks(today);
  const openQuery = useOpenTimer();

  const nowMs = useMemo(() => Date.now(), []);

  const blocks = blocksQuery.data ?? [];
  const openTimer = openQuery.data;
  const running = openTimer?.active === true && !!openTimer.started_at;

  const totalTrackedS = useMemo(() => blocks.reduce((sum, b) => sum + b.duration_s, 0), [blocks]);

  const dayStartMs = dayBaseMs(today) + DAY_START_HOUR * HOUR_MS;
  const dayEndMs = dayBaseMs(today) + DAY_END_HOUR * HOUR_MS;
  const windowEndMs = Math.min(dayEndMs, nowMs);

  const runningInterval: Interval | null = useMemo(() => {
    if (!running || !openTimer?.started_at) return null;
    const s = Date.parse(openTimer.started_at);
    return Number.isFinite(s) ? { startMs: s, endMs: nowMs } : null;
  }, [running, openTimer?.started_at, nowMs]);

  const blockIntervals = useMemo<Interval[]>(() => {
    const list: Interval[] = [];
    for (const block of blocks) {
      const s = Date.parse(block.started_at);
      const e = Date.parse(block.ended_at);
      if (Number.isFinite(s) && Number.isFinite(e)) list.push({ startMs: s, endMs: e });
    }
    return list;
  }, [blocks]);

  const dayBar = useMemo<BlockState[]>(() => {
    const states: BlockState[] = [];
    for (let i = 0; i < BLOCK_COUNT; i++) {
      const hourStart = dayStartMs + i * HOUR_MS;
      const hourEnd = hourStart + HOUR_MS;
      let state: BlockState = "untracked";
      if (runningInterval && overlaps(hourStart, hourEnd, runningInterval.startMs, runningInterval.endMs)) {
        state = "running";
      } else {
        for (const iv of blockIntervals) {
          if (overlaps(hourStart, hourEnd, iv.startMs, iv.endMs)) {
            state = "tracked";
            break;
          }
        }
      }
      states.push(state);
    }
    return states;
  }, [dayStartMs, blockIntervals, runningInterval]);

  const gaps = useMemo<Gap[]>(() => {
    if (windowEndMs <= dayStartMs) return [];
    const covered = runningInterval ? [...blockIntervals, runningInterval] : blockIntervals;
    const sorted = [...covered].sort((a, b) => a.startMs - b.startMs);

    const merged: Interval[] = [];
    for (const iv of sorted) {
      const clippedStart = Math.max(iv.startMs, dayStartMs);
      const clippedEnd = Math.min(iv.endMs, windowEndMs);
      if (clippedEnd <= clippedStart) continue;
      const last = merged[merged.length - 1];
      if (last && clippedStart <= last.endMs) {
        last.endMs = Math.max(last.endMs, clippedEnd);
      } else {
        merged.push({ startMs: clippedStart, endMs: clippedEnd });
      }
    }

    const result: Gap[] = [];
    let cursor = dayStartMs;
    for (const iv of merged) {
      if (iv.startMs - cursor >= MIN_GAP_MS) result.push({ startMs: cursor, endMs: iv.startMs });
      cursor = Math.max(cursor, iv.endMs);
    }
    if (windowEndMs - cursor >= MIN_GAP_MS) result.push({ startMs: cursor, endMs: windowEndMs });
    return result;
  }, [blockIntervals, runningInterval, dayStartMs, windowEndMs]);

  const sortedBlocks = useMemo(
    () => [...blocks].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)),
    [blocks],
  );

  return (
    <View>
      <View className="mb-3 flex-row items-baseline justify-between">
        <Text className="font-sans-semibold text-heading text-ink">Today</Text>
        <Text className="font-mono-medium text-dataSm text-ink-muted">
          {formatDuration(totalTrackedS)} TRACKED
        </Text>
      </View>

      <View className="mb-4 flex-row gap-[2px]">
        {dayBar.map((state, i) => (
          <View
            className={[
              "h-8 flex-1",
              // tracked = positive, running = signal (the day bar's running
              // block is one of exactly two places `signal` is allowed —
              // see the ThreadScreen/CheckinCard convention). Untracked uses
              // the darkest surface token, not the raw `#1C1815` the design
              // doc names — no-hex-literals rule; bg-base is that token.
              state === "tracked" ? "bg-positive" : state === "running" ? "bg-signal" : "bg-bg-base",
              i === 0 ? "rounded-l-[2px]" : "",
              i === BLOCK_COUNT - 1 ? "rounded-r-[2px]" : "",
            ].join(" ")}
            key={i}
          />
        ))}
      </View>

      {gaps.map((gap) => (
        <View
          className="mb-3 min-h-[64px] justify-center rounded-md border border-dashed border-line-strong bg-bg-raised px-4 py-3"
          key={gap.startMs}
        >
          <Text className="font-mono-medium text-body text-ink-muted" selectable>
            {formatClock(gap.endMs - gap.startMs)}
          </Text>
          <Text className="mt-1 font-sans text-dataSm text-ink-muted" selectable>
            Attention leaked here
          </Text>
          {/* "TAP TO NAME IT" below stays non-selectable on purpose: it's the
              label ON a Pressable (the row's own tap target, currently a
              no-op pending a real endpoint — see the comment inside), not
              read-only prose, so selection would compete with that tap
              rather than sit beside it. */}
          <Pressable
            accessibilityLabel={`Name the gap between ${hhmm(gap.startMs)} and ${hhmm(gap.endMs)}`}
            accessibilityRole="button"
            className="mt-2 h-touch flex-row items-center self-start"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={() => {
              // No endpoint retroactively labels a past gap as a time block —
              // POST /api/time/start always starts a NEW timer at "now," it
              // can't backfill 10:00–12:00 after the fact. Inert until one
              // exists, same as CaptureBar's voice no-op: never fake success.
            }}
          >
            <Text className="font-mono-medium text-dataSm text-ink-muted">
              {hhmm(gap.startMs)}–{hhmm(gap.endMs)} · TAP TO NAME IT
            </Text>
          </Pressable>
        </View>
      ))}

      {sortedBlocks.length === 0 && gaps.length === 0 ? (
        <Text className="font-sans text-body text-ink-muted">Nothing tracked yet today.</Text>
      ) : (
        sortedBlocks.map((block) => (
          <View
            className="mb-2 min-h-[64px] flex-row items-center justify-between rounded-md border border-line-hairline bg-bg-raised px-4 py-3"
            key={block.block_id}
          >
            <Text className="mr-3 flex-1 font-sans text-body text-ink" numberOfLines={1} selectable>
              {block.label ? `${block.category} · ${block.label}` : block.category}
            </Text>
            <Text className="font-mono-medium text-dataSm text-ink-muted" selectable>
              {formatDuration(block.duration_s)}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}
