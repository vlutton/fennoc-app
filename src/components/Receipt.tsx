import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import type { AgentAction } from "../api/types";
import { quietEasing, STATE_TICK, useReducedMotion } from "../theme/motion";

/**
 * INT-050 — "the receipt: opening up a long turn."
 *
 * Step 11b's fix for a real transcript where one user message triggered
 * seven operations and Fennoc's reply was 400 words of prose explaining all
 * of it — the useful part (the ordering of the day) was the last sentence.
 * This is the collapsed header + expandable line-list that replaces the
 * prose: `READ N THINGS · WROTE M`, tap to see one row per action in the
 * order they happened.
 *
 * It's a receipt, not a monologue — Step 11b is explicit that this is "not
 * raw model reasoning surfaced to the user," it's the same ledger writes
 * the receipt mechanism already records, re-rendered one line per
 * operation. This component only renders the `actions` array the server
 * sends; it never infers, summarises, or narrates on its own.
 *
 * PRD §5.1's "parse receipt" (batch command shows exactly what it
 * understood, per-line undo) is this same component, generalised — not a
 * separate feature. Per-line undo stays scoped to the original batch-
 * capture case for now (the intent's own recorded lean, not a ruling): a
 * row like "declined to touch the shelving" has no obvious undo semantics,
 * and rows mixing writes and declines on one turn would need per-row-type
 * undo logic nothing has designed yet. This build is read-only —
 * TODO(INT-050) if/when the batch-capture case adopts this same component.
 */

/**
 * The single gate for whether a turn's receipt is worth showing at all —
 * kept in one function per the task brief, so "when does the header
 * appear" has exactly one answer everywhere it's asked. Per the intent's
 * threshold (INT-050 "The threshold: not every turn"): two or more ledger
 * writes, a photo read (any `"read"` action — the only read case this
 * build's server produces per INT-046), or a decline. A one-line answer —
 * zero or one action, no read, no decline — never carries the header:
 * "a disclosure on every turn trains the eye to ignore it."
 */
export function qualifiesForReceipt(actions: AgentAction[] | null | undefined): boolean {
  if (!actions || actions.length === 0) return false;
  const writeCount = actions.reduce((n, a) => (a.kind === "write" ? n + 1 : n), 0);
  const hasRead = actions.some((a) => a.kind === "read");
  const hasDecline = actions.some((a) => a.kind === "decline");
  return writeCount >= 2 || hasRead || hasDecline;
}

const KIND_LABEL: Record<AgentAction["kind"], string> = {
  write: "WRITE",
  read: "READ",
  decline: "DECLINE",
};

interface ReceiptProps {
  actions: AgentAction[];
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Collapsed: `READ N THINGS · WROTE M`, mono, `ink.disabled` (`#5C544D`).
 * Expanded (tap the header): the same header lifted to `ink.muted`
 * (closest existing token to the design's `#8C8279` — see the task brief's
 * own instruction to use the ink tokens rather than a new hex literal),
 * plus one row per action, in order, sentence + kind marker. Decline rows
 * render exactly like the others — Step 11b calls them out as "the part
 * users actually go looking for," not a lesser or hidden case.
 *
 * Grey, deliberately, never amber (INT-050's own words): this is available
 * to the user, not asking for their attention, so it never borrows the
 * colour reserved for that.
 */
export function Receipt({ actions, expanded, onToggle }: ReceiptProps) {
  const reducedMotion = useReducedMotion();
  const writeCount = actions.reduce((n, a) => (a.kind === "write" ? n + 1 : n), 0);
  const readCount = actions.reduce((n, a) => (a.kind === "read" ? n + 1 : n), 0);

  const rowsOpacity = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    if (reducedMotion) {
      rowsOpacity.value = expanded ? 1 : 0;
      return;
    }
    // `state.tick`, 120ms — the shortest named duration in this app's
    // motion scale, and squarely inside the "120-180ms class-B ease" the
    // task brief allows for this component. Nothing here exceeds it.
    rowsOpacity.value = withTiming(expanded ? 1 : 0, {
      duration: STATE_TICK,
      easing: quietEasing(),
    });
  }, [expanded, reducedMotion, rowsOpacity]);

  const rowsStyle = useAnimatedStyle(() => ({ opacity: rowsOpacity.value }));

  return (
    <View className="mt-2">
      <Pressable
        accessibilityHint={expanded ? "Tap to collapse" : "Tap to show what this turn did"}
        accessibilityLabel={`Read ${readCount} things, wrote ${writeCount}`}
        accessibilityRole="button"
        hitSlop={4}
        onPress={onToggle}
      >
        <Text
          className={
            expanded
              ? "font-mono-medium text-dataSm text-ink-muted"
              : "font-mono-medium text-dataSm text-ink-disabled"
          }
          numberOfLines={1}
        >
          READ {readCount} THINGS · WROTE {writeCount}
        </Text>
      </Pressable>
      {expanded ? (
        // Animated.View only carries the fade — NativeWind's className
        // doesn't resolve on react-native-reanimated's Animated.View
        // without registering it via cssInterop (see LedgerSheet.tsx's and
        // Strip.tsx's identical note), so the layout/spacing styling lives
        // on the plain View nested inside it instead.
        <Animated.View style={rowsStyle}>
          <View className="mt-2 gap-3">
            {actions.map((action, index) => (
              // No stable id on an action row (the server contract is just
              // `{text, kind}`) — index is fine here because this array is
              // never reordered or filtered in place, only ever rendered
              // whole, in the order the server sent it.
              <View className="flex-row items-start gap-3" key={index}>
                <Text className="flex-1 font-sans text-body text-ink" selectable>
                  {action.text}
                </Text>
                <Text
                  className="font-mono-medium text-dataSm text-ink-muted"
                  numberOfLines={1}
                >
                  {KIND_LABEL[action.kind]}
                </Text>
              </View>
            ))}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}
