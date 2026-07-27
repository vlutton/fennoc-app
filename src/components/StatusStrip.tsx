import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { useBudget, useSetBudgetLimit } from "../hooks/useBudget";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { useOutboxStatus } from "../outbox";
import { InterruptionControlsSheet } from "./InterruptionControlsSheet";

interface StatusSlot {
  label: string;
  /** SYNCED reads quiet (`ink-muted`); anything else is a claim on
   * attention and reads brighter (`ink-secondary`). */
  emphasized: boolean;
}

/**
 * Exactly one slot is shown besides the (always-present, always-leftmost)
 * budget marks. Chosen by priority, highest first; the first non-null
 * candidate wins. Hard deadline / stake-at-risk are later intents — add
 * their providers ABOVE the connection slot to preserve the documented
 * priority order (hard deadline today > stake at risk > connection state >
 * SYNCED) without touching the slots below them.
 */
/** Most marks the 28dp strip can carry before it looks like a progress bar. */
const MAX_BUDGET_MARKS = 5;

function pickStatusSlot(params: {
  isOnline: boolean;
  heldCount: number;
}): StatusSlot {
  const candidates: Array<StatusSlot | null> = [
    // Priority 1 — hard deadline today. Not wired yet (no backend source).
    null,
    // Priority 2 — stake at risk. Not wired yet (no backend source).
    null,
    // Priority 3 — connection state.
    !params.isOnline
      ? { label: "OFFLINE", emphasized: true }
      : params.heldCount > 0
        ? { label: `${params.heldCount} HELD`, emphasized: true }
        : null,
    // Priority 4 — fallback. Always available, so this is never reached as
    // null and the loop below always terminates.
    { label: "SYNCED", emphasized: false },
  ];
  for (const candidate of candidates) {
    if (candidate) return candidate;
  }
  /* istanbul ignore next -- unreachable: the fallback candidate above is never null */
  return { label: "SYNCED", emphasized: false };
}

/** "06:30" from an `Budget.reset_at` local-time ISO string. */
function formatResetTime(resetAt: string): string {
  const parsed = new Date(resetAt);
  if (Number.isNaN(parsed.getTime())) return "";
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function BudgetMark({ filled }: { filled: boolean }) {
  // The design source shows filled marks in `signal`, but this build's hard
  // rule is stricter: signal is reserved for exactly two things (an
  // unanswered question, a running timer), not decoration on a permanent
  // strip. Filled marks use `ink` instead — still a clear filled/outline
  // contrast without spending the reserved colour.
  return (
    <View
      className={
        filled
          ? "h-[7px] w-[7px] rotate-45 bg-ink"
          : "h-[7px] w-[7px] rotate-45 border border-line-strong"
      }
    />
  );
}

/**
 * Height 28, always present, directly under the app bar. Tapping opens the
 * interruption controls sheet — an instrument reading, not a score: no
 * streaks, no "you saved N interruptions," no congratulation.
 */
export function StatusStrip() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const budgetQuery = useBudget();
  const setLimitMutation = useSetBudgetLimit();
  const { pendingCount } = useOutboxStatus();
  const isOnline = useNetworkStatus();

  const budget = budgetQuery.data;
  const limit = budget?.limit ?? 3;
  const remaining = budget?.remaining ?? limit;

  const budgetLabel =
    budget && remaining <= 0
      ? `0 OF ${limit} · NEXT WINDOW ${formatResetTime(budget.reset_at)}`
      : `${remaining} OF ${limit} LEFT`;

  const slot = pickStatusSlot({ isOnline, heldCount: pendingCount });

  return (
    <>
      <Pressable
        accessibilityLabel="Interruption controls"
        accessibilityRole="button"
        className="h-strip flex-row items-center gap-[10px] border-b border-line-hairline px-5"
        // The strip is visually 28px tall per spec, but every interactive
        // element needs a 48×48 touch target — hitSlop widens the tappable
        // area without changing the visible row height.
        hitSlop={{ top: 10, bottom: 10 }}
        onPress={() => setSheetOpen(true)}
      >
        {/*
          One mark per unit of the CURRENT limit, not a fixed three. The limit
          is user-adjustable from the interruption sheet, so hardcoding three
          renders "2 OF 2 LEFT" beside three marks with one hollow — which
          reads as 2 of 3 and contradicts its own label. Capped so a limit of
          10 does not overrun the 28dp strip.
        */}
        <View className="flex-row items-center gap-1">
          {Array.from({ length: Math.min(limit, MAX_BUDGET_MARKS) }, (_, i) => (
            <BudgetMark filled={i < remaining} key={i} />
          ))}
        </View>
        <Text
          className="font-mono-medium text-dataSm text-ink-muted"
          numberOfLines={1}
        >
          {budgetLabel}
        </Text>
        <View className="h-[11px] w-px bg-line-hairline" />
        <Text
          className={
            slot.emphasized
              ? "font-mono-medium text-dataSm text-ink-secondary"
              : "font-mono-medium text-dataSm text-ink-muted"
          }
          numberOfLines={1}
        >
          {slot.label}
        </Text>
      </Pressable>

      <InterruptionControlsSheet
        budget={budget}
        onClose={() => setSheetOpen(false)}
        onSetLimit={(next) => setLimitMutation.mutate(next)}
        pending={setLimitMutation.isPending}
        visible={sheetOpen}
      />
    </>
  );
}
