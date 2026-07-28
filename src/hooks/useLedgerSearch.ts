import { useMemo } from "react";

import type { Task } from "../api/types";
import { useThreadStore } from "../store/useThread";
import { chicagoToday, formatDuration } from "../utils/format";
import { useEveningBriefing, useMorningBriefing } from "./useBriefing";
import { useTasks } from "./useTasks";
import { useTodayTimeBlocks } from "./useTime";

export type SearchHitKind = "capture" | "task" | "time" | "briefing";

export interface SearchHit {
  id: string;
  kind: SearchHitKind;
  title: string;
  meta: string;
  /** Present only for kind === "task" — lets the result row render a real,
   * functional TaskRow instead of a read-only summary. */
  task?: Task;
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * Client-side search over data the ledger's own sections already load.
 * There is no server search endpoint (no `GET /api/search`) — the intent
 * doc is explicit that this filters already-loaded data rather than
 * inventing one. The queries below share query keys with
 * LedgerTasksSection / LedgerTimeSection / LedgerBriefingsSection, so
 * React Query dedupes them: mounting this hook alongside those sections
 * costs zero extra network requests, just an extra subscription.
 *
 * "Briefings" here means the same short today/yesterday archive the
 * Briefings section shows — see LedgerBriefingsSection's own comment on
 * why it isn't a real paged history (no list endpoint exists).
 */
export function useLedgerSearch(query: string): { hits: SearchHit[]; loading: boolean } {
  const today = chicagoToday();
  const yesterday = shiftDay(today, -1);

  const tasksQuery = useTasks({ status: "open" });
  const timeQuery = useTodayTimeBlocks(today);
  const todayMorning = useMorningBriefing(today);
  const todayEvening = useEveningBriefing(today);
  const yesterdayMorning = useMorningBriefing(yesterday);
  const yesterdayEvening = useEveningBriefing(yesterday);
  // Stable array reference from the store; filtering happens below inside
  // useMemo, not in the selector — see useTodayCaptures's identical note on
  // why (an allocating selector makes zustand's Object.is comparison see a
  // "change" on every read, which is the "Maximum update depth exceeded"
  // crash this codebase already hit once).
  const captures = useThreadStore((s) => s.captures);

  const loading =
    tasksQuery.isLoading || timeQuery.isLoading || todayMorning.isLoading || todayEvening.isLoading;

  const hits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const results: SearchHit[] = [];

    for (const capture of captures) {
      if (capture.text.toLowerCase().includes(needle)) {
        results.push({
          id: `capture-${capture.id}`,
          kind: "capture",
          title: capture.text,
          meta: capture.speaker === "fennoc" ? "FENNOC" : "YOU",
        });
      }
    }

    for (const task of tasksQuery.data ?? []) {
      if (task.title.toLowerCase().includes(needle)) {
        results.push({
          id: `task-${task.task_id}`,
          kind: "task",
          title: task.title,
          meta: (task.project || "TASK").toUpperCase(),
          task,
        });
      }
    }

    for (const block of timeQuery.data ?? []) {
      const label = block.label ? `${block.category} · ${block.label}` : block.category;
      if (label.toLowerCase().includes(needle)) {
        results.push({
          id: `time-${block.block_id}`,
          kind: "time",
          title: label,
          meta: formatDuration(block.duration_s),
        });
      }
    }

    const briefingSources: {
      id: string;
      dayLabel: string;
      kindLabel: string;
      text: string | null | undefined;
    }[] = [
      { id: "today-morning", dayLabel: "TODAY", kindLabel: "MORNING", text: todayMorning.data?.text },
      { id: "today-evening", dayLabel: "TODAY", kindLabel: "EVENING", text: todayEvening.data?.text },
      {
        id: "yesterday-morning",
        dayLabel: "YESTERDAY",
        kindLabel: "MORNING",
        text: yesterdayMorning.data?.text,
      },
      {
        id: "yesterday-evening",
        dayLabel: "YESTERDAY",
        kindLabel: "EVENING",
        text: yesterdayEvening.data?.text,
      },
    ];
    for (const source of briefingSources) {
      if (source.text && source.text.toLowerCase().includes(needle)) {
        results.push({
          id: `briefing-${source.id}`,
          kind: "briefing",
          title: source.text,
          meta: `${source.dayLabel} · ${source.kindLabel}`,
        });
      }
    }

    return results;
  }, [
    query,
    captures,
    tasksQuery.data,
    timeQuery.data,
    todayMorning.data,
    todayEvening.data,
    yesterdayMorning.data,
    yesterdayEvening.data,
  ]);

  return { hits, loading };
}
