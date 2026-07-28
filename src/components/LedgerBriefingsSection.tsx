import { Text, View } from "react-native";

import { useEveningBriefing, useMorningBriefing } from "../hooks/useBriefing";
import { chicagoToday } from "../utils/format";

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

interface Entry {
  id: string;
  dayLabel: string;
  kindLabel: string;
  text: string;
}

/**
 * The Ledger's Briefings section (INT-024): "a short archive list." There
 * is no `GET /api/briefing/list` — each day's briefing is its own request
 * keyed by date (see BriefingScreen's own day-by-day pager for the same
 * constraint) — so this fetches today's and yesterday's morning/evening
 * briefings directly rather than paging a real history. No unread state,
 * per the intent doc.
 */
export function LedgerBriefingsSection() {
  const today = chicagoToday();
  const yesterday = shiftDay(today, -1);

  const todayMorning = useMorningBriefing(today);
  const todayEvening = useEveningBriefing(today);
  const yesterdayMorning = useMorningBriefing(yesterday);
  const yesterdayEvening = useEveningBriefing(yesterday);

  const entries: Entry[] = [];
  if (todayMorning.data?.text) {
    entries.push({ id: "today-morning", dayLabel: "TODAY", kindLabel: "MORNING", text: todayMorning.data.text });
  }
  if (todayEvening.data?.text) {
    entries.push({ id: "today-evening", dayLabel: "TODAY", kindLabel: "EVENING", text: todayEvening.data.text });
  }
  if (yesterdayMorning.data?.text) {
    entries.push({
      id: "yesterday-morning",
      dayLabel: "YESTERDAY",
      kindLabel: "MORNING",
      text: yesterdayMorning.data.text,
    });
  }
  if (yesterdayEvening.data?.text) {
    entries.push({
      id: "yesterday-evening",
      dayLabel: "YESTERDAY",
      kindLabel: "EVENING",
      text: yesterdayEvening.data.text,
    });
  }

  return (
    <View>
      <Text className="mb-3 font-sans-semibold text-heading text-ink">Briefings</Text>
      {entries.length === 0 ? (
        <Text className="font-sans text-body text-ink-muted">No briefings yet.</Text>
      ) : (
        entries.map((entry) => (
          <View className="mb-2 rounded-md border border-line-hairline bg-bg-raised p-3" key={entry.id}>
            <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
              {entry.dayLabel} · {entry.kindLabel}
            </Text>
            <Text className="mt-1 font-sans text-body text-ink" numberOfLines={2}>
              {entry.text}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}
