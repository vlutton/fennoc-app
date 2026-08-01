import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import type { PendingCheckin } from "../api/types";
import { useBudget } from "../hooks/useBudget";
import { useTheme } from "../theme/useTheme";
import { formatTimeOfDay } from "../utils/format";

interface CheckinCardProps {
  pending: PendingCheckin;
  /** Records any answer — including "Not now" — via the existing checkin
   * reply mutation. There is no separate dismiss path. */
  onReply: (text: string) => void;
  sending?: boolean;
}

/**
 * The check-in card (INT-023 §3) — the single most important component in
 * the product. Six things make it read as a question rather than a
 * notification; each is called out below. This rewrites the presentation
 * only — `onReply` still goes through the real `/api/checkin/reply`
 * mutation the caller supplies (INT-023b task, "keep its data wiring").
 */
export function CheckinCard({ pending, onReply, sending = false }: CheckinCardProps) {
  const { palette } = useTheme();
  const budgetQuery = useBudget();
  const [answering, setAnswering] = useState(false);
  const [text, setText] = useState("");

  const budget = budgetQuery.data;
  const limit = budget?.limit ?? 3;
  const remaining = budget?.remaining ?? limit;
  const time = formatTimeOfDay(pending.sent_at) || "--:--";
  // Budget reads as REMAINING everywhere (PRD §10 R1) — "1 LEFT", never
  // "PING 2 OF 3". Must never disagree with the status strip's own label.
  const stamp = `${time} · ${remaining} LEFT`;

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    onReply(trimmed);
    setText("");
    setAnswering(false);
  };

  return (
    <View className="relative mx-4 mb-3">
      {/* 1. Open geometry — 1px `signal` border on top/left/right only,
          radius 12/12/0/0, nearest-token background. The bottom edge is
          absent; two 20×1px `signal` stubs below imply continuation. The
          card is a sentence with a blank in it. */}
      <View className="rounded-t-md border-l border-r border-t border-signal bg-bg-raised p-4">
        <Text className="font-mono-medium text-dataSm text-ink-muted" numberOfLines={1}>
          {stamp}
        </Text>

        {/* 5. text-display — the only element in the entire product
            allowed display size. Selectable: this is the question itself,
            substantive text worth quoting back, and nothing on this Text
            has a press handler for selection to fight — the card's own
            taps all live on the Answer/Not now buttons below. */}
        <Text className="mt-2 font-sans-semibold text-display text-ink" selectable>
          {pending.question_text ?? "What are you working on?"}
        </Text>

        {answering ? (
          <View className="mt-4 gap-3">
            <TextInput
              autoCapitalize="sentences"
              autoCorrect
              autoFocus
              className="min-h-12 rounded-sm border border-line-strong bg-bg-base px-3 font-sans text-body text-ink"
              editable={!sending}
              onChangeText={setText}
              onSubmitEditing={() => submit(text)}
              placeholder="Say your answer…"
              placeholderTextColor={palette.ink.muted}
              returnKeyType="send"
              value={text}
            />
            <View className="flex-row gap-3">
              <Pressable
                accessibilityLabel="Send answer"
                accessibilityRole="button"
                className="h-touch flex-1 items-center justify-center rounded-sm bg-signal active:opacity-80"
                disabled={!text.trim() || sending}
                onPress={() => submit(text)}
              >
                <Text className="font-sans-semibold text-label text-signal-on">Send</Text>
              </Pressable>
              {/* 3. No dismiss button — "Not now" is itself an answer,
                  recorded through the same reply mutation as any other
                  text, never a local-only dismissal. */}
              <Pressable
                accessibilityLabel="Not now"
                accessibilityRole="button"
                className="h-touch items-center justify-center rounded-sm border border-line-strong px-4 active:opacity-80"
                disabled={sending}
                onPress={() => onReply("Not now")}
              >
                <Text className="font-sans-medium text-label text-ink">Not now</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View className="mt-4 flex-row gap-3">
            {/* 4. Pre-armed mic. Real voice capture (straight into
                listening from this tap, no separate focus step) is
                INT-025 scope and isn't built yet. TODO(INT-025): replace
                this with the listening/thinking/done sequence. Until
                then it wires to the same text reply path the rest of the
                app uses — autofocusing the revealed field below is the
                closest available stand-in for "no focus step" without a
                microphone pipeline. */}
            <Pressable
              accessibilityLabel="Answer"
              accessibilityRole="button"
              className="h-touch flex-1 items-center justify-center rounded-sm bg-signal active:opacity-80"
              disabled={sending}
              onPress={() => setAnswering(true)}
            >
              <Text className="font-sans-semibold text-label text-signal-on">Answer</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Not now"
              accessibilityRole="button"
              className="h-touch items-center justify-center rounded-sm border border-line-strong px-4 active:opacity-80"
              disabled={sending}
              onPress={() => onReply("Not now")}
            >
              <Text className="font-sans-medium text-label text-ink">Not now</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View className="absolute -bottom-px left-0 h-px w-5 bg-signal" />
      <View className="absolute -bottom-px right-0 h-px w-5 bg-signal" />
    </View>
  );
}
