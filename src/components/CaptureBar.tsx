import * as Crypto from "expo-crypto";
import { Keyboard as KeyboardIcon, Mic } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { useCapture } from "../hooks/useHome";
import { useTheme } from "../theme/useTheme";

type Feedback = "captured" | "queued" | "error" | null;

/**
 * `bg.float`, 1px top border `line.strong`, padding 14/16, gap 14. The
 * 48×48 keyboard button is a peer that focuses the composer; it never
 * becomes the resting state. The 72×72 mic is the largest target on
 * screen and the default input.
 *
 * Voice capture itself (listening, auto-stop on silence, haptic + tone
 * confirmation) is INT-025 scope. This shell wires the mic to the same
 * capture mutation the composer's text uses — tapping it sends whatever
 * has been typed. With nothing typed it's a no-op (see comment below)
 * rather than a fake "recording" state with no real transcription behind
 * it.
 */
export function CaptureBar() {
  const { palette } = useTheme();
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<TextInput>(null);
  const captureMutation = useCapture();

  useEffect(() => {
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

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

  const onSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || captureMutation.isPending) return;

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

  const pending = captureMutation.isPending;

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
          accessibilityLabel="Capture"
          accessibilityRole="button"
          className="h-mic w-mic items-center justify-center rounded-full bg-ink active:opacity-80"
          disabled={pending}
          onPress={onMicPress}
        >
          {pending ? (
            <ActivityIndicator color={palette.bg.base} />
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
