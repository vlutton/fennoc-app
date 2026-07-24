import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import type { CheckinCurrent, PendingCheckin } from "../api/types";
import { colors } from "../theme/colors";

interface CheckinCardProps {
  pending: PendingCheckin;
  currentActivity?: CheckinCurrent;
  onReply: (text: string) => void;
  sending?: boolean;
  ack?: string | null;
}

export function CheckinCard({
  pending,
  currentActivity,
  onReply,
  sending = false,
  ack = null,
}: CheckinCardProps) {
  const [text, setText] = useState("");

  const canSend = text.trim().length > 0 && !sending;

  return (
    <View className="mb-4 rounded-xl border border-sand bg-cream p-4">
      <Text className="text-base font-semibold leading-6 text-olive">
        ⏱  {pending.question_text ?? "What are you working on?"}
      </Text>

      {currentActivity?.active ? (
        <Text className="mt-2 text-sm leading-5 text-olive opacity-70">
          Fennoc thinks: {currentActivity.category ?? "unknown"}
          {currentActivity.label ? ` · ${currentActivity.label}` : ""}
        </Text>
      ) : null}

      {ack ? (
        <Text className="mt-3 text-base leading-6 text-terracotta">{ack}</Text>
      ) : (
        <>
          <TextInput
            autoCapitalize="sentences"
            autoCorrect
            className="mt-3 min-h-12 rounded-lg border border-sand bg-white px-3 text-base leading-6 text-olive"
            editable={!sending}
            onChangeText={setText}
            placeholder="Your reply…"
            placeholderTextColor="#9CA38A"
            value={text}
          />
          <View className="mt-3 flex-row justify-end">
            <Pressable
              accessibilityRole="button"
              className="min-h-12 min-w-12 items-center justify-center rounded-lg bg-terracotta px-4 active:opacity-80"
              disabled={!canSend}
              onPress={() => {
                const trimmed = text.trim();
                if (!trimmed) return;
                onReply(trimmed);
              }}
            >
              {sending ? (
                <ActivityIndicator color={colors.cream} />
              ) : (
                <Text className="text-base font-semibold leading-6 text-cream">
                  Reply
                </Text>
              )}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
