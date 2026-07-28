import { isAxiosError } from "axios";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CaptureBar } from "../components/CaptureBar";
import { CheckinCard } from "../components/CheckinCard";
import { FennocMark } from "../components/FennocMark";
import { NextStrip } from "../components/NextStrip";
import { StatusStrip } from "../components/StatusStrip";
import { useEveningBriefing, useMorningBriefing } from "../hooks/useBriefing";
import { usePendingCheckin, useReplyCheckin } from "../hooks/useHome";
import { useTodayCaptures } from "../store/useThread";
import { useTheme } from "../theme/useTheme";
import { chicagoToday } from "../utils/format";

interface ThreadScreenProps {
  onOpenSettings: () => void;
}

// Nominal on-screen times for briefing messages. `GET /api/briefing/*`
// returns the briefing's DATE but not the moment it was generated, and
// there's no `GET /api/thread` yet to supply a real per-message send time
// (see INT-023 intent doc, "1. Where messages come from" — proposed,
// unbuilt). These match the design handoff's own worked example
// ("06:45 · MORNING"); a real timestamp lands with the future thread
// endpoint.
const MORNING_BRIEFING_TIME = "06:45";
const EVENING_BRIEFING_TIME = "18:00";

type ThreadMessage =
  | { id: string; kind: "fennoc-briefing"; atMs: number; stamp: string; label: string }
  | { id: string; kind: "user-capture"; atMs: number; text: string };

/** Fennoc speaks unboxed — no bubble, no avatar. Fennoc is the environment;
 * the user is the guest. Do not symmetrise this with UserBubble below. */
function FennocMessage({ stamp, label }: { stamp: string; label: string }) {
  return (
    <View>
      <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
        {stamp}
      </Text>
      <Text className="mt-1 font-sans text-lead text-ink">{label}</Text>
      <Pressable
        accessibilityLabel="Read briefing"
        accessibilityRole="button"
        className="mt-2 h-touch flex-row items-center self-start rounded-sm border border-line-strong px-3 active:opacity-80"
        onPress={() => {
          // TODO(INT-024): open the markdown briefing reader sheet. The
          // full briefing body is deliberately not rendered inline here.
        }}
      >
        <Text className="font-sans-medium text-label text-ink">Read briefing</Text>
      </Pressable>
    </View>
  );
}

/** The user speaks in a bubble — right-aligned, max-width 84%. */
function UserBubble({ text }: { text: string }) {
  return (
    <View className="items-end">
      <View className="max-w-[84%] rounded-tl-md rounded-tr-md rounded-bl-md rounded-br-[4px] bg-bg-float px-4 py-3">
        <Text className="font-sans text-body text-ink">{text}</Text>
      </View>
    </View>
  );
}

function ThreadTerminus() {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-px flex-1 bg-line-hairline" />
      <Text
        className="font-mono-medium text-dataSm text-ink-muted"
        numberOfLines={1}
      >
        NOTHING ELSE · NEXT AFTER 17:00
      </Text>
      <View className="h-px flex-1 bg-line-hairline" />
    </View>
  );
}

/**
 * The thread — root screen of the app (INT-023). Composes the scroll
 * client-side (INT-023b) from what already exists: the morning/evening
 * briefing as a Fennoc message, this session's captures as user bubbles,
 * and the pending check-in as the persistent question card above the
 * composer. There is no `GET /api/thread` endpoint yet (see the intent
 * doc) — this is not that, and does not invent one.
 */
export function ThreadScreen({ onOpenSettings }: ThreadScreenProps) {
  const { palette } = useTheme();
  const today = chicagoToday();

  const morningBriefing = useMorningBriefing(today);
  const eveningBriefing = useEveningBriefing(today);
  const captures = useTodayCaptures();
  const pendingQuery = usePendingCheckin();
  const replyMutation = useReplyCheckin();

  const messages = useMemo(() => {
    const list: ThreadMessage[] = [];

    if (morningBriefing.data?.text && morningBriefing.data.date === today) {
      list.push({
        id: "briefing-morning",
        kind: "fennoc-briefing",
        atMs: new Date(`${today}T${MORNING_BRIEFING_TIME}:00`).getTime(),
        stamp: `${MORNING_BRIEFING_TIME} · MORNING`,
        label: "Morning briefing ready.",
      });
    }
    if (eveningBriefing.data?.text && eveningBriefing.data.date === today) {
      list.push({
        id: "briefing-evening",
        kind: "fennoc-briefing",
        atMs: new Date(`${today}T${EVENING_BRIEFING_TIME}:00`).getTime(),
        stamp: `${EVENING_BRIEFING_TIME} · EVENING`,
        label: "Evening briefing ready.",
      });
    }
    for (const capture of captures) {
      list.push({
        id: capture.id,
        kind: "user-capture",
        atMs: new Date(capture.createdAt).getTime(),
        text: capture.text,
      });
    }

    return list.sort((a, b) => a.atMs - b.atMs);
  }, [captures, eveningBriefing.data, morningBriefing.data, today]);

  const onOpenLedger = () => {
    // TODO(INT-024): open the ledger sheet. No-op until then.
  };

  const onCheckinReply = (text: string) => {
    const questionType = pendingQuery.data?.question_type;
    if (!questionType) return;
    replyMutation.mutate(
      { text, questionType },
      {
        onError: (error) => {
          // Already answered/expired elsewhere — the server's state wins;
          // resync so the card clears instead of surfacing a dead end.
          if (isAxiosError(error) && error.response?.status === 409) {
            void pendingQuery.refetch();
          }
        },
      },
    );
  };

  // 2. It persists above the composer until the query says otherwise —
  // there is no local-only dismiss that could hide it. See CheckinCard's
  // own "no dismiss button" note for the answer-recording side of this.
  const showCheckin = pendingQuery.data?.pending === true && !pendingQuery.isError;

  return (
    <SafeAreaView className="flex-1 bg-bg-base" edges={["top", "bottom"]}>
      <View className="h-16 flex-row items-center gap-3 border-b border-line-hairline px-4">
        <Pressable
          accessibilityHint="Long-press to open Settings"
          accessibilityLabel="Fennoc"
          accessibilityRole="button"
          className="h-touch w-touch items-center justify-center"
          onLongPress={onOpenSettings}
        >
          <FennocMark color={palette.ink.muted} size={24} />
        </Pressable>

        <Text
          className="font-sans-semibold text-ink"
          style={{ fontSize: 17, lineHeight: 22 }}
        >
          Fennoc
        </Text>

        <View className="flex-1" />

        <Pressable
          accessibilityLabel="Ledger"
          accessibilityRole="button"
          className="h-touch items-center justify-center rounded-sm border border-line-strong px-[18px] active:opacity-80"
          onPress={onOpenLedger}
        >
          <Text className="font-sans-medium text-label text-ink">
            Ledger
          </Text>
        </Pressable>
      </View>

      <StatusStrip />

      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow justify-end gap-[18px] px-4 py-5"
      >
        {messages.map((message) =>
          message.kind === "fennoc-briefing" ? (
            <FennocMessage key={message.id} label={message.label} stamp={message.stamp} />
          ) : (
            <UserBubble key={message.id} text={message.text} />
          ),
        )}
        <ThreadTerminus />
      </ScrollView>

      {showCheckin && pendingQuery.data ? (
        <CheckinCard
          onReply={onCheckinReply}
          pending={pendingQuery.data}
          sending={replyMutation.isPending}
        />
      ) : null}

      <NextStrip />
      <CaptureBar />
    </SafeAreaView>
  );
}
