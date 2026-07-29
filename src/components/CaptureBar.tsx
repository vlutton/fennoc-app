import * as Crypto from "expo-crypto";
import { ArrowUp, Keyboard as KeyboardIcon, Mic, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { useCapture } from "../hooks/useHome";
import { useSendAgentMessage } from "../hooks/useAgentMessage";
import { isNetworkError } from "../outbox";
import { useThreadStore } from "../store/useThread";
import { useTheme } from "../theme/useTheme";

type Feedback = "captured" | "queued" | "error" | null;

/**
 * `bg.float`, 1px top border `line.strong`, padding 14/16, gap 14. The
 * 48×48 keyboard button is a peer that focuses the composer; it never
 * becomes the resting state. The 72×72 mic is the largest target on
 * screen and the default input.
 *
 * Voice capture itself (listening, auto-stop on silence, haptic + tone
 * confirmation) is INT-025 scope. This shell wires the mic to the same send
 * path the composer's text uses — tapping it sends whatever has been
 * typed. With nothing typed it's a no-op (see comment below) rather than a
 * fake "recording" state with no real transcription behind it.
 *
 * Product decision (INT-029b): the composer talks to the *agent*
 * (`POST /api/message`), not `/api/capture`, because the thread is a
 * conversation — Fennoc reads the message and replies in-thread, which
 * `/api/capture` has no way to do. `/api/capture` remains underneath it as
 * the instant, offline-safe path: `useCapture` (still wired below) is what
 * actually queues to the outbox, and is exactly what runs when the agent
 * send fails because the device has no network — a thought must still land
 * somewhere even if there's no one to read it yet.
 */
export function CaptureBar() {
  const { palette } = useTheme();
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const captureMutation = useCapture();
  const sendAgentMessage = useSendAgentMessage();
  // Selected as an action reference, not derived state — see the store's own
  // "Maximum update depth exceeded" warning on why a selector here must
  // never allocate.
  const addCapture = useThreadStore((s) => s.addCapture);
  const addAgentPending = useThreadStore((s) => s.addAgentPending);
  const replyingTo = useThreadStore((s) => s.replyingTo);
  const setReplyingTo = useThreadStore((s) => s.setReplyingTo);

  useEffect(() => {
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  // Focus the composer the moment `replyingTo` transitions from null to
  // non-null (i.e. a Reply CTA was just pressed elsewhere in the tree).
  // CaptureBar owns its own TextInput ref, so this is the simplest way to
  // react to that transition without leaking the ref across the tree.
  const wasReplyingRef = useRef(false);
  useEffect(() => {
    if (replyingTo && !wasReplyingRef.current) {
      inputRef.current?.focus();
    }
    wasReplyingRef.current = replyingTo !== null;
  }, [replyingTo]);

  const showFeedback = (kind: Feedback, msg?: string) => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setFeedback(kind);
    setErrorMsg(msg ?? null);
    // Success and queued self-clear — Fennoc doesn't announce that it did its
    // job. An ERROR must not: it is telling you a thought did not save, and the
    // text is still sitting in the composer waiting to be retried. Auto-hiding
    // that after 1.5s is how a capture goes missing silently, which is the one
    // outcome this product cannot afford. It clears on the next attempt.
    if (kind === "error") return;
    clearTimer.current = setTimeout(() => {
      setFeedback(null);
      setErrorMsg(null);
    }, 1500);
  };

  // Fallback path: the existing /api/capture mutation, used only when the
  // agent send fails offline. It already queues to the outbox and echoes
  // the user's own bubble in its own onSuccess (see useHome.ts), so this
  // wrapper only needs to translate its result into composer feedback.
  const fallbackToCapture = (trimmed: string) => {
    const idempotencyKey = Crypto.randomUUID();
    captureMutation.mutate(
      {
        text: trimmed,
        opts: {
          idempotency_key: idempotencyKey,
          source_ref: "fennoc-app",
        },
      },
      {
        onSuccess: (result) => {
          setText("");
          setReplyingTo(null);
          showFeedback(result.queued ? "queued" : "captured");
        },
        onError: (error) => {
          const message =
            error instanceof Error ? error.message : "Capture failed";
          showFeedback("error", message);
        },
      },
    );
  };

  const onSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || sendAgentMessage.isPending || captureMutation.isPending) return;

    // A lingering ERROR "clears on the next attempt" (see showFeedback
    // above) — that only happens if something here actually clears it, since
    // a successful agent send below doesn't call showFeedback itself.
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setFeedback(null);
    setErrorMsg(null);

    // `trimmed` is sent as-is, never prefixed with `replyingTo.quote`. The
    // app's thread is one continuous Hermes session, so the agent already
    // has its own question in context — the quote strip above is purely a
    // user-facing affordance for what "Reply" is answering. Sending the raw
    // answer also keeps this input identical to what Telegram sends, which
    // is what the INT-029 acceptance test depends on.
    sendAgentMessage.mutate(trimmed, {
      onSuccess: (result) => {
        // The user's own bubble, then a pending Fennoc entry the
        // AgentTurnWatcher (ThreadScreen) will resolve once the turn
        // finishes — see useThread.ts's addAgentPending/resolveAgent.
        addCapture(trimmed);
        addAgentPending(result.id);
        setText("");
        setReplyingTo(null);
      },
      onError: (error) => {
        // A thought must never go missing because the network dropped:
        // fall back to the offline-safe capture path, which queues to the
        // outbox. A real (non-network) server error on /api/message is
        // reported as-is instead — falling back there would silently
        // re-route a genuine agent failure through a different endpoint.
        if (isNetworkError(error)) {
          fallbackToCapture(trimmed);
          return;
        }
        const message = error instanceof Error ? error.message : "Send failed";
        showFeedback("error", message);
      },
    });
  };

  const pending = sendAgentMessage.isPending || captureMutation.isPending;
  const hasText = text.trim().length > 0;

  const onMicPress = () => {
    if (text.trim().length > 0) {
      onSubmit();
      return;
    }
    // TODO(INT-025): the signature listening/thinking/done sequence and
    // real speech capture. Nothing is typed, so there is nothing to send —
    // do not fake a "listening" state with no transcription behind it.
  };

  return (
    <View className="gap-[14px] border-t border-line-strong bg-bg-float px-4 py-[14px]">
      {/* The quoted strip for whatever "Reply" (ThreadScreen / ReplySheet)
          most recently targeted. UI affordance only — see the comment above
          sendAgentMessage.mutate in onSubmit for why the quote itself is
          never sent. Left accent uses the same border-line-strong token as
          the rest of the border; `signal` (amber) is reserved for an
          unanswered question / running timer, not this strip.

          Surface is `bg.raised`, NOT `bg.float` — the composer bar this sits
          inside is already `bg.float`, so a float-on-float strip has zero
          contrast and reads as a bare outline. Recessed is also the right
          metaphor for a quote: it belongs beneath what you're writing, not
          floating above it. */}
      {replyingTo ? (
        <View className="flex-row items-start gap-2 rounded-sm border border-line-strong border-l-2 bg-bg-raised px-3 py-2">
          <View className="flex-1">
            <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
              REPLYING TO
            </Text>
            <Text className="mt-1 font-sans text-caption text-ink-secondary" numberOfLines={2}>
              {replyingTo.quote}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Cancel reply"
            accessibilityRole="button"
            className="h-touch w-touch items-center justify-center"
            onPress={() => setReplyingTo(null)}
          >
            <X color={palette.ink.muted} size={18} />
          </Pressable>
        </View>
      ) : null}

      <View className="flex-row items-center gap-[14px]">
        <Pressable
          accessibilityLabel="Open keyboard"
          accessibilityRole="button"
          className="h-touch w-touch items-center justify-center rounded-sm border border-line-strong active:opacity-80"
          onPress={() => inputRef.current?.focus()}
        >
          <KeyboardIcon color={palette.ink.DEFAULT} size={20} />
        </Pressable>

        <TextInput
          autoCapitalize="sentences"
          autoCorrect
          className="flex-1 font-sans text-body text-ink"
          editable={!pending}
          onChangeText={setText}
          onSubmitEditing={onSubmit}
          placeholder="Say anything"
          placeholderTextColor={palette.ink.muted}
          ref={inputRef}
          returnKeyType="send"
          value={text}
        />

        <Pressable
          accessibilityLabel={hasText ? "Send" : "Capture"}
          accessibilityRole="button"
          className="h-mic w-mic items-center justify-center rounded-full bg-ink active:opacity-80"
          disabled={pending}
          onPress={onMicPress}
        >
          {pending ? (
            <ActivityIndicator color={palette.bg.base} />
          ) : hasText ? (
            // Reported from a real device: "the microphone icon is throwing
            // me… maybe it should toggle to a paper plane when I start
            // typing." onMicPress already sends typed text (see its comment
            // above) — this just makes that existing behaviour legible.
            // Same size/shape/fill as the mic; only the glyph changes.
            <ArrowUp color={palette.bg.base} size={28} />
          ) : (
            <Mic color={palette.bg.base} size={28} />
          )}
        </Pressable>
      </View>

      {feedback === "captured" ? (
        <Text className="font-sans text-caption text-ink-muted">
          Captured.
        </Text>
      ) : null}
      {feedback === "queued" ? (
        <Text className="font-sans text-caption text-ink-secondary">
          Held. Will send.
        </Text>
      ) : null}
      {feedback === "error" ? (
        <Text className="font-sans text-caption text-alert">
          {errorMsg ?? "Capture failed."}
        </Text>
      ) : null}
    </View>
  );
}
