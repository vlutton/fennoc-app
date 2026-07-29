import { isAxiosError } from "axios";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatApiError } from "../api/client";
import { CaptureBar } from "../components/CaptureBar";
import { CheckinCard } from "../components/CheckinCard";
import { FennocMark } from "../components/FennocMark";
import { LedgerSheet } from "../components/LedgerSheet";
import { NextStrip } from "../components/NextStrip";
import { ReplySheet } from "../components/ReplySheet";
import { StatusStrip } from "../components/StatusStrip";
import { useAgentMessagePoll } from "../hooks/useAgentMessage";
import { useEveningBriefing, useMorningBriefing } from "../hooks/useBriefing";
import { usePendingCheckin, useReplyCheckin } from "../hooks/useHome";
import { useThreadStore, useTodayCaptures } from "../store/useThread";
import { formatTimeOfDay } from "../utils/format";
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
  | { id: string; kind: "fennoc-line"; atMs: number; stamp: string; text: string }
  | { id: string; kind: "user-capture"; atMs: number; text: string }
  | {
      id: string;
      kind: "agent-turn";
      atMs: number;
      stamp: string;
      messageId: string;
      state: "thinking" | "done" | "error";
      text: string;
      body: string | null;
    };

/**
 * A plain thing Fennoc said — no action attached. Same unboxed treatment as
 * FennocMessage but without the briefing's "Read briefing" affordance, since
 * an acknowledgement has nothing to open.
 */
function FennocLine({ stamp, text }: { stamp: string; text: string }) {
  return (
    <View>
      <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
        {stamp}
      </Text>
      <Text className="mt-1 font-sans text-lead text-ink">{text}</Text>
    </View>
  );
}

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

/**
 * An agent turn still running (INT-029b). Deliberately just a stamp and a
 * static line — `signal` (amber) is reserved for exactly an unanswered
 * question and a running timer, so it does not belong here, and a looping
 * placeholder would only have to be thrown away once `presence.think`
 * (INT-025's actual signature interaction for this state) ships.
 */
function AgentThinking({ stamp }: { stamp: string }) {
  return (
    <View>
      <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
        {stamp}
      </Text>
      {/* TODO(INT-025): replace with the real presence.think mark. Not
          invented here — see the comment above this component. */}
      <Text className="mt-1 font-sans text-lead text-ink-muted">Thinking…</Text>
    </View>
  );
}

/** An agent turn that came back `error`. The user's bubble above it (pushed
 * by CaptureBar's onSuccess before the pending entry) stays visible — this
 * only replaces what Fennoc says, not what the user said. */
function AgentError({ stamp, error }: { stamp: string; error: string }) {
  return (
    <View>
      <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
        {stamp}
      </Text>
      <Text className="mt-1 font-sans text-lead text-alert">{error}</Text>
    </View>
  );
}

/**
 * Polls one in-flight agent turn (`GET /api/message/{id}`) and resolves it
 * into the thread store once the server reports `done` or `error`. Renders
 * nothing — ThreadScreen renders one of these per "thinking" entry, which
 * keeps the polling declarative and handles several queued turns at once
 * without any special-casing here.
 */
function AgentTurnWatcher({ messageId }: { messageId: string }) {
  const resolveAgent = useThreadStore((s) => s.resolveAgent);
  const { data, isError, error } = useAgentMessagePoll(messageId);

  useEffect(() => {
    // A poll that can't reach the server has to terminate somewhere. React
    // Query has already exhausted its retries by the time `isError` is set,
    // and leaving the entry on "Thinking…" indefinitely is the one outcome
    // this product can't afford — the same rule the capture error follows.
    // Resolving to `error` is terminal (the watcher unmounts, since it only
    // renders for "thinking" entries), so the user re-sends rather than
    // waiting on a spinner that will never resolve. Their own bubble stays.
    if (isError) {
      resolveAgent(messageId, {
        text: formatApiError(error) || "Couldn't reach Fennoc.",
        body: null,
        state: "error",
      });
      return;
    }
    if (!data) return;
    if (data.status === "done") {
      resolveAgent(messageId, {
        text: data.reply_lede ?? data.reply ?? "",
        body: data.reply_body,
        state: "done",
      });
    } else if (data.status === "error") {
      resolveAgent(messageId, {
        text: data.error ?? "That didn't go through.",
        body: null,
        state: "error",
      });
    }
  }, [data, error, isError, messageId, resolveAgent]);

  return null;
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
  const [ledgerOpen, setLedgerOpen] = useState(false);

  const morningBriefing = useMorningBriefing(today);
  const eveningBriefing = useEveningBriefing(today);
  const captures = useTodayCaptures();
  // Select the actions individually — a selector returning a fresh object each
  // read is what caused the "Maximum update depth exceeded" crash earlier.
  const addCapture = useThreadStore((s) => s.addCapture);
  const addFennocLine = useThreadStore((s) => s.addFennocLine);
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
      const atMs = new Date(capture.createdAt).getTime();
      if (capture.speaker === "fennoc" && capture.agent) {
        list.push({
          id: capture.id,
          kind: "agent-turn",
          atMs,
          stamp: formatTimeOfDay(capture.createdAt),
          messageId: capture.agent.messageId,
          state: capture.agent.state,
          text: capture.text,
          body: capture.agent.body,
        });
        continue;
      }
      list.push(
        capture.speaker === "fennoc"
          ? {
              id: capture.id,
              kind: "fennoc-line",
              atMs,
              stamp: formatTimeOfDay(capture.createdAt),
              text: capture.text,
            }
          : { id: capture.id, kind: "user-capture", atMs, text: capture.text },
      );
    }

    return list.sort((a, b) => a.atMs - b.atMs);
  }, [captures, eveningBriefing.data, morningBriefing.data, today]);

  // Every currently-"thinking" agent entry gets its own poller — see
  // AgentTurnWatcher above. Derived in useMemo, not read off the zustand
  // selector directly, for the same reason `useTodayCaptures` filters in a
  // useMemo rather than the selector: a selector that allocates (`.filter`
  // here) makes every store read look like a change.
  const pendingAgentIds = useMemo(
    () =>
      captures
        .filter((c) => c.agent?.state === "thinking")
        .map((c) => c.agent?.messageId)
        .filter((id): id is string => id !== undefined),
    [captures],
  );

  const [openReplyBody, setOpenReplyBody] = useState<string | null>(null);

  const onOpenLedger = () => {
    setLedgerOpen(true);
  };

  const onCheckinReply = (text: string) => {
    const questionType = pendingQuery.data?.question_type;
    if (!questionType) return;
    replyMutation.mutate(
      { text, questionType },
      {
        onSuccess: (result) => {
          // Answering used to leave nothing behind: the card unmounted and the
          // thread was unchanged, which reads as "it ignored me". Echo the
          // answer, then Fennoc's own ack — the server returns either a
          // confirmation or a follow-up question depending on whether the
          // reply actually parsed, so this stays honest when parsing fails.
          addCapture(text);
          if (result?.ack) addFennocLine(result.ack);
        },
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
        {messages.map((message) => {
          if (message.kind === "fennoc-briefing") {
            return (
              <FennocMessage key={message.id} label={message.label} stamp={message.stamp} />
            );
          }
          if (message.kind === "fennoc-line") {
            return <FennocLine key={message.id} stamp={message.stamp} text={message.text} />;
          }
          if (message.kind === "agent-turn") {
            if (message.state === "thinking") {
              return <AgentThinking key={message.id} stamp={message.stamp} />;
            }
            if (message.state === "error") {
              return (
                <AgentError
                  key={message.id}
                  error={message.text || "That didn't go through."}
                  stamp={message.stamp}
                />
              );
            }
            return (
              <View key={message.id}>
                <FennocLine stamp={message.stamp} text={message.text} />
                {message.body !== null ? (
                  <Pressable
                    accessibilityLabel="Read the rest"
                    accessibilityRole="button"
                    className="mt-2 h-touch flex-row items-center self-start rounded-sm border border-line-strong px-3 active:opacity-80"
                    onPress={() => setOpenReplyBody(message.body)}
                  >
                    <Text className="font-sans-medium text-label text-ink">Read the rest</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }
          return <UserBubble key={message.id} text={message.text} />;
        })}
        <ThreadTerminus />
      </ScrollView>

      {/* One poller per in-flight agent turn (see AgentTurnWatcher above).
          Renders nothing — this just keeps polling declarative for however
          many turns are queued at once. */}
      {pendingAgentIds.map((messageId) => (
        <AgentTurnWatcher key={messageId} messageId={messageId} />
      ))}

      {/*
        The manifest sets android:windowSoftInputMode="adjustResize", but Expo
        enables edge-to-edge on Android by default and under edge-to-edge the
        window no longer resizes for the keyboard — so the composer, the
        check-in card, and any capture error message all end up UNDERNEATH it.
        Reported from a real device: "the onscreen keyboard drew over the text
        box so I could not see what I was typing."

        Everything the keyboard must not cover goes inside this.
      */}
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
        {showCheckin && pendingQuery.data ? (
          <CheckinCard
            onReply={onCheckinReply}
            pending={pendingQuery.data}
            sending={replyMutation.isPending}
          />
        ) : null}

        <NextStrip />
        <CaptureBar />
      </KeyboardAvoidingView>

      <LedgerSheet onClose={() => setLedgerOpen(false)} visible={ledgerOpen} />
      <ReplySheet
        body={openReplyBody}
        onClose={() => setOpenReplyBody(null)}
        visible={openReplyBody !== null}
      />
    </SafeAreaView>
  );
}
