import { isAxiosError } from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatApiError } from "../api/client";
import { BriefingSheet } from "../components/BriefingSheet";
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
  | {
      id: string;
      kind: "fennoc-briefing";
      atMs: number;
      stamp: string;
      label: string;
      /** What the "Read briefing" sheet should show as its title/body. */
      title: string;
      text: string;
    }
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

/**
 * Fennoc speaks unboxed — no bubble, no avatar. Fennoc is the environment;
 * the user is the guest. Do not symmetrise this with UserBubble below.
 *
 * `onOpen` is undefined exactly when there's nothing to open — the caller
 * (ThreadScreen) only supplies it once it has real briefing text in hand.
 * The "Read briefing" button is therefore only ever rendered when it would
 * actually do something: reported from a real device, "Clicking the 'Read
 * briefing' button makes a noise but doesn't actually do anything" was the
 * bug, and a button with nothing behind it is exactly that bug, so this
 * component doesn't render one to guard against a null body — see
 * BriefingSheet's own note.
 */
function FennocMessage({
  stamp,
  label,
  onOpen,
}: {
  stamp: string;
  label: string;
  onOpen?: () => void;
}) {
  return (
    <View>
      <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
        {stamp}
      </Text>
      <Text className="mt-1 font-sans text-lead text-ink">{label}</Text>
      {onOpen ? (
        <Pressable
          accessibilityLabel="Read briefing"
          accessibilityRole="button"
          className="mt-2 h-touch flex-row items-center self-start rounded-sm border border-line-strong px-3 active:opacity-80"
          onPress={onOpen}
        >
          <Text className="font-sans-medium text-label text-ink">Read briefing</Text>
        </Pressable>
      ) : null}
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
 * An agent turn still running (INT-029b) — `presence.think`, the design's
 * signature "it is working" animation. `signal` (amber) is reserved for
 * exactly an unanswered question and a running timer, so it still doesn't
 * belong here; the mark plus the "THINKING" label carry that meaning
 * instead. The full presence state machine (listening/done) remains
 * INT-025 — this only builds the "thinking" state.
 */
function AgentThinking({ stamp }: { stamp: string }) {
  const { palette } = useTheme();
  return (
    <View>
      <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
        {stamp}
      </Text>
      <View className="mt-1 flex-row items-center gap-2">
        <FennocMark color={palette.ink.muted} size={28} state="thinking" />
        <Text className="font-mono-medium text-dataSm text-ink-muted">THINKING</Text>
      </View>
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

/**
 * What the composer's "REPLYING TO" strip should show for a given reply.
 *
 * Not the lede. When Fennoc asks something, the question is usually the LAST
 * thing it says — often buried at the end of a collapsed body — and the lede
 * is a heading like "Full plate. Tue Jul 28.", which tells you nothing about
 * what you're answering. So: quote the final question if there is one, and
 * fall back to the opening line only when there isn't.
 *
 * Whitespace is collapsed because the raw reply is `lede\n\nbody`, and a
 * two-line clamp spends one of its lines on the blank.
 */
function quoteFor(fullText: string): string {
  const flat = fullText.replace(/\s+/g, " ").trim();
  const questions = flat.match(/[^.!?]*\?/g);
  if (questions && questions.length > 0) {
    return questions[questions.length - 1].trim();
  }
  return flat;
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
  const setReplyingTo = useThreadStore((s) => s.setReplyingTo);
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
        title: "Morning briefing",
        text: morningBriefing.data.text,
      });
    }
    if (eveningBriefing.data?.text && eveningBriefing.data.date === today) {
      list.push({
        id: "briefing-evening",
        kind: "fennoc-briefing",
        atMs: new Date(`${today}T${EVENING_BRIEFING_TIME}:00`).getTime(),
        stamp: `${EVENING_BRIEFING_TIME} · EVENING`,
        label: "Evening briefing ready.",
        title: "Evening briefing",
        text: eveningBriefing.data.text,
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

  // Holds the message the "Read the rest" sheet is currently showing — its
  // body (the sheet's content), and its messageId/quote (so the sheet's own
  // always-visible Reply button, see ReplySheet, has something to hand off
  // to onReply below).
  const [openReplyMessage, setOpenReplyMessage] = useState<{
    messageId: string;
    body: string;
    quote: string;
  } | null>(null);

  // Which briefing (if any) the "Read briefing" sheet is currently showing —
  // see FennocMessage's onOpen and BriefingSheet below.
  const [openBriefing, setOpenBriefing] = useState<{ title: string; text: string } | null>(null);

  const scrollRef = useRef<ScrollView>(null);

  const onOpenLedger = () => {
    setLedgerOpen(true);
  };

  // Fix for a reported bug: "after the thinking went away it had responded
  // but it was below the text box so I couldn't see it and didn't realize
  // it." The ScrollView never auto-scrolled, so a reply landing below the
  // fold was invisible and read as "it didn't answer". onContentSizeChange
  // fires whenever the content height changes — which covers all three
  // cases that matter here: the user's own bubble appearing, the
  // "Thinking…" entry appearing, and that entry resolving into a reply
  // (a further height change). Do not simplify this away.
  const onThreadContentSizeChange = () => {
    scrollRef.current?.scrollToEnd({ animated: true });
  };

  // Shared by both Reply entry points (the inline CTA on an agent reply in
  // the thread, and ReplySheet's always-visible Reply button): close the
  // sheet if it's open (a no-op if it wasn't) and hand the message off to
  // the composer via the store. CaptureBar focuses itself once
  // `replyingTo` goes from null to non-null — see its own effect.
  const onReply = (messageId: string, quote: string) => {
    setOpenReplyMessage(null);
    setReplyingTo({ messageId, quote });
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
        onContentSizeChange={onThreadContentSizeChange}
        ref={scrollRef}
      >
        {messages.map((message) => {
          if (message.kind === "fennoc-briefing") {
            return (
              <FennocMessage
                key={message.id}
                label={message.label}
                onOpen={() => setOpenBriefing({ title: message.title, text: message.text })}
                stamp={message.stamp}
              />
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
            // The full reply — lede plus the collapsed body, when there is
            // one — is what both the "does this need a Reply CTA" heuristic
            // and the composer's quoted strip work from, so a question
            // buried in the collapsed part still surfaces the button.
            const fullReplyText = message.body
              ? `${message.text}\n\n${message.body}`
              : message.text;
            // Heuristic, not a real question-detector: a "?" anywhere in the
            // reply. Cheap and honest for the reported case (a question with
            // no way to answer); a boxed "Reply" under every Fennoc line
            // would be noise Fennoc's unboxed voice doesn't want. Revisit if
            // this proves too broad or too narrow in practice.
            const hasQuestion = fullReplyText.includes("?");
            // See quoteFor: the strip shows the QUESTION, not the lede.
            const replyQuote = quoteFor(fullReplyText);
            return (
              <View key={message.id}>
                <FennocLine stamp={message.stamp} text={message.text} />
                {message.body !== null || hasQuestion ? (
                  <View className="mt-2 flex-row items-center gap-2">
                    {message.body !== null ? (
                      <Pressable
                        accessibilityLabel="Read the rest"
                        accessibilityRole="button"
                        className="h-touch flex-row items-center self-start rounded-sm border border-line-strong px-3 active:opacity-80"
                        onPress={() =>
                          setOpenReplyMessage({
                            messageId: message.messageId,
                            body: message.body as string,
                            quote: replyQuote,
                          })
                        }
                      >
                        <Text className="font-sans-medium text-label text-ink">Read the rest</Text>
                      </Pressable>
                    ) : null}
                    {hasQuestion ? (
                      <Pressable
                        accessibilityLabel="Reply"
                        accessibilityRole="button"
                        className="h-touch flex-row items-center self-start rounded-sm border border-line-strong px-3 active:opacity-80"
                        onPress={() => onReply(message.messageId, replyQuote)}
                      >
                        <Text className="font-sans-medium text-label text-ink">Reply</Text>
                      </Pressable>
                    ) : null}
                  </View>
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
        body={openReplyMessage?.body ?? null}
        messageId={openReplyMessage?.messageId ?? null}
        onClose={() => setOpenReplyMessage(null)}
        onReply={onReply}
        quote={openReplyMessage?.quote ?? ""}
        visible={openReplyMessage !== null}
      />
      <BriefingSheet
        onClose={() => setOpenBriefing(null)}
        text={openBriefing?.text ?? null}
        title={openBriefing?.title ?? ""}
        visible={openBriefing !== null}
      />
    </SafeAreaView>
  );
}
