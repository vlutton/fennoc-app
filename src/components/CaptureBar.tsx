import { isAxiosError } from "axios";
import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { colors } from "../theme/colors";
import { useCapture } from "../hooks/useHome";
import { enqueueCapture } from "../outbox";

type Feedback = "captured" | "queued" | "error" | null;

function isNetworkError(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  return (
    error.code === "ERR_NETWORK" ||
    error.code === "ECONNABORTED" ||
    !error.response
  );
}

export function CaptureBar() {
  const [text, setText] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        onSuccess: () => {
          setText("");
          showFeedback("captured");
        },
        onError: (error) => {
          if (isNetworkError(error)) {
            enqueueCapture({
              text: trimmed,
              idempotency_key: idempotencyKey,
              source_ref: "fennoc-app",
            });
            setText("");
            showFeedback("queued");
            return;
          }
          const message =
            error instanceof Error ? error.message : "Capture failed";
          showFeedback("error", message);
        },
      },
    );
  };

  const pending = captureMutation.isPending;

  return (
    <View className="mt-2 rounded-xl border border-sand bg-cream p-3">
      <View className="flex-row items-center gap-2">
        <TextInput
          autoCapitalize="sentences"
          autoCorrect
          className="min-h-12 flex-1 rounded-lg border border-sand bg-white px-3 text-base leading-6 text-olive"
          editable={!pending}
          onChangeText={setText}
          onSubmitEditing={onSubmit}
          placeholder="Capture a thought…"
          placeholderTextColor="#9CA38A"
          returnKeyType="send"
          value={text}
        />
        <Pressable
          accessibilityLabel="Send capture"
          accessibilityRole="button"
          className="min-h-12 min-w-12 items-center justify-center rounded-lg bg-olive active:opacity-80"
          disabled={pending || text.trim().length === 0}
          onPress={onSubmit}
        >
          {pending ? (
            <ActivityIndicator color={colors.cream} />
          ) : (
            <Text className="text-base font-semibold leading-6 text-cream">
              ⏰
            </Text>
          )}
        </Pressable>
      </View>

      {feedback === "captured" ? (
        <Text className="mt-2 text-sm leading-5 text-olive">captured</Text>
      ) : null}
      {feedback === "queued" ? (
        <Text className="mt-2 text-sm leading-5 text-terracotta">queued</Text>
      ) : null}
      {feedback === "error" ? (
        <Text className="mt-2 text-sm leading-5 text-terracotta">
          {errorMsg ?? "error"}
        </Text>
      ) : null}
    </View>
  );
}
