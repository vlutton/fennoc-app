import { Check } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import type { Reminder } from "../api/types";
import { useOpenReminders, useReminderDone } from "../hooks/useReminders";
import { useTheme } from "../theme/useTheme";
import { formatReminderWhen, formatTimeOfDay } from "../utils/format";

/**
 * One reminder row. Same 64px/`bg-raised`/`line-hairline` card shape as
 * `TaskRow`/`LedgerBriefingsSection`'s rows, and the same "buttons exist,
 * not swipe-only" affordance rule the rest of this sheet already follows
 * (see LedgerTasksSection's Drop button) — `Done` is a plain tap target,
 * not a gesture the user has to discover.
 *
 * A fired-but-unclosed reminder ("the shade quietly announced this and
 * nobody closed it") shows its fired state instead of the condition —
 * "quietly": mono, muted, no alert color, no re-statement of urgency.
 */
function ReminderRow({
  reminder,
  onDone,
  busy,
}: {
  reminder: Reminder;
  onDone: (reminder: Reminder) => void;
  busy: boolean;
}) {
  const { palette } = useTheme();
  const fired = reminder.fired_at !== null;
  const metaLine = fired
    ? `FIRED ${formatTimeOfDay(reminder.fired_at) || "--:--"}`
    : formatReminderWhen(reminder.condition_value).toUpperCase();

  return (
    <View className="mb-2 min-h-16 flex-row items-center justify-between rounded-md border border-line-hairline bg-bg-raised px-4 py-3">
      <View className="mr-3 flex-1">
        <Text className="font-sans text-body text-ink" numberOfLines={3} selectable>
          {reminder.text}
        </Text>
        <Text className="mt-1 font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
          {metaLine}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={`Done: ${reminder.text}`}
        accessibilityRole="button"
        className="size-touch items-center justify-center active:opacity-80"
        disabled={busy}
        onPress={() => onDone(reminder)}
      >
        <Check color={palette.ink.muted} size={20} strokeWidth={2.5} />
      </Pressable>
    </View>
  );
}

/**
 * The Ledger's Reminders section (INT-057 commit 3): every open (not yet
 * closed) reminder, `GET /api/reminders`. There is exactly one group today
 * — "OPEN REMINDERS" — mirroring LedgerTasksSection's mono all-caps group
 * label convention (`OVERDUE · N`, `DUE TODAY · N`) rather than inventing
 * a different label style for the one section that happens to have only
 * one group so far.
 */
export function LedgerRemindersSection() {
  const remindersQuery = useOpenReminders();
  const doneMutation = useReminderDone();

  const reminders = remindersQuery.data ?? [];

  const onDone = (reminder: Reminder) => doneMutation.mutate(reminder.id);

  return (
    <View>
      <Text className="mb-3 font-sans-semibold text-heading text-ink">Reminders</Text>

      {remindersQuery.isLoading ? (
        <Text className="font-sans text-body text-ink-muted">Loading reminders…</Text>
      ) : reminders.length === 0 ? (
        <Text className="font-sans text-body text-ink-muted">Nothing here.</Text>
      ) : (
        <View>
          <Text className="mb-2 font-mono-medium text-dataSm text-ink-muted">
            OPEN REMINDERS · {reminders.length}
          </Text>
          {reminders.map((reminder) => (
            <ReminderRow
              busy={doneMutation.isPending}
              key={reminder.id}
              onDone={onDone}
              reminder={reminder}
            />
          ))}
        </View>
      )}
    </View>
  );
}
