import { Minus, Plus, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";

import type { Budget } from "../api/types";
import { READING_COLUMN_MAX_WIDTH } from "../theme/layout";
import { useTheme } from "../theme/useTheme";

interface InterruptionControlsSheetProps {
  visible: boolean;
  onClose: () => void;
  budget: Budget | undefined;
  onSetLimit: (limit: number) => void;
  pending: boolean;
}

const MIN_LIMIT = 0;
const MAX_LIMIT = 10;

/**
 * Opened by tapping the status strip. "A number you can move is a number
 * you believe": the budget is inspected AND directly editable here via
 * `setBudgetLimit()` — this is the interruption budget's only control
 * surface in the shell pass.
 */
export function InterruptionControlsSheet({
  visible,
  onClose,
  budget,
  onSetLimit,
  pending,
}: InterruptionControlsSheetProps) {
  const { palette } = useTheme();
  const [draftLimit, setDraftLimit] = useState(budget?.limit ?? 3);

  // Reset the draft to the server value each time the sheet opens, so a
  // stale in-progress edit from a prior open never silently resurfaces.
  useEffect(() => {
    if (visible) setDraftLimit(budget?.limit ?? 3);
  }, [visible, budget?.limit]);

  const remaining = budget?.remaining ?? 0;
  const limit = budget?.limit ?? draftLimit;
  const dirty = budget !== undefined && draftLimit !== budget.limit;

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel="Close interruption controls"
        accessibilityRole="button"
        className="flex-1 justify-end bg-bg-base/60"
        onPress={onClose}
      >
        {/* Swallow taps on the panel itself so they don't fall through to
            the scrim's dismiss handler above. */}
        <Pressable
          className="w-full gap-4 self-center rounded-t-sheet border-t border-line-strong bg-bg-overlay p-4"
          onPress={() => {}}
          // `maxWidth` centers the panel on a tablet (INT-060's reading
          // column); the scrim stays full-bleed.
          style={{ maxWidth: READING_COLUMN_MAX_WIDTH }}
        >
          <View className="flex-row items-center justify-between">
            <Text className="font-sans-semibold text-heading text-ink">
              Interruption budget
            </Text>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              className="h-touch w-touch items-center justify-center"
              onPress={onClose}
            >
              <X color={palette.ink.muted} size={20} />
            </Pressable>
          </View>

          <Text className="font-mono-medium text-dataSm text-ink-muted">
            {remaining} OF {limit} LEFT
          </Text>

          <View className="flex-row items-center justify-between rounded-md border border-line-hairline bg-bg-raised px-4 py-3">
            <Pressable
              accessibilityLabel="Decrease limit"
              accessibilityRole="button"
              className="h-touch w-touch items-center justify-center rounded-sm border border-line-strong active:opacity-80"
              disabled={draftLimit <= MIN_LIMIT}
              onPress={() => setDraftLimit((n) => Math.max(MIN_LIMIT, n - 1))}
            >
              <Minus
                color={
                  draftLimit <= MIN_LIMIT ? palette.ink.muted : palette.ink.DEFAULT
                }
                size={18}
              />
            </Pressable>
            <Text className="font-mono-medium text-title text-ink">
              {draftLimit}
            </Text>
            <Pressable
              accessibilityLabel="Increase limit"
              accessibilityRole="button"
              className="h-touch w-touch items-center justify-center rounded-sm border border-line-strong active:opacity-80"
              disabled={draftLimit >= MAX_LIMIT}
              onPress={() => setDraftLimit((n) => Math.min(MAX_LIMIT, n + 1))}
            >
              <Plus
                color={
                  draftLimit >= MAX_LIMIT ? palette.ink.muted : palette.ink.DEFAULT
                }
                size={18}
              />
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            className="h-touch items-center justify-center rounded-sm bg-ink active:opacity-80"
            disabled={!dirty || pending}
            onPress={() => onSetLimit(draftLimit)}
          >
            <Text className="font-sans-semibold text-label text-bg-base">
              {pending ? "Saving…" : "Save limit"}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
