import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import type { OpenTimer } from "../api/types";
import { colors } from "../theme/colors";
import { formatClock } from "../utils/format";

export const TIME_CATEGORIES = [
  "work",
  "deep_work",
  "planning",
  "admin",
  "social",
  "entertainment",
  "family",
  "health",
  "commute",
  "maintenance",
  "unknown",
] as const;

export type TimeCategory = (typeof TIME_CATEGORIES)[number];

interface TimerCardProps {
  open: OpenTimer;
  onStart: (opts: { category: string; label?: string }) => void;
  onStop: () => void;
  starting?: boolean;
  stopping?: boolean;
}

export function TimerCard({
  open,
  onStart,
  onStop,
  starting = false,
  stopping = false,
}: TimerCardProps) {
  const [category, setCategory] = useState<TimeCategory>("work");
  const [label, setLabel] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!open.active || !open.started_at) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open.active, open.started_at]);

  if (open.active) {
    const startedAt = open.started_at ? Date.parse(open.started_at) : NaN;
    const elapsedMs = Number.isFinite(startedAt) ? nowMs - startedAt : 0;
    const pending = stopping;

    return (
      <View className="rounded-xl border border-sand bg-cream p-4">
        <Text className="font-mono text-3xl font-semibold leading-10 text-olive">
          {formatClock(elapsedMs)}
        </Text>
        <Text className="mt-2 text-base leading-6 text-terracotta">
          {open.category ?? "unknown"}
          {open.label ? ` · ${open.label}` : ""}
        </Text>
        <Pressable
          accessibilityRole="button"
          className="mt-4 min-h-12 items-center justify-center rounded-lg bg-terracotta px-4 active:opacity-80"
          disabled={pending}
          onPress={onStop}
        >
          {pending ? (
            <ActivityIndicator color={colors.cream} />
          ) : (
            <Text className="text-base font-semibold leading-6 text-cream">
              STOP
            </Text>
          )}
        </Pressable>
      </View>
    );
  }

  const pending = starting;

  return (
    <View className="rounded-xl border border-sand bg-cream p-4">
      <Text className="text-base font-semibold leading-6 text-olive">
        Start timer
      </Text>

      <Text className="mb-2 mt-4 text-base font-medium leading-6 text-olive">
        Category
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2">
          {TIME_CATEGORIES.map((item) => {
            const active = category === item;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                className={`min-h-12 items-center justify-center rounded-lg px-3 ${
                  active ? "bg-olive" : "bg-sand"
                }`}
                onPress={() => setCategory(item)}
              >
                <Text
                  className={`text-sm font-medium leading-5 ${
                    active ? "text-cream" : "text-olive"
                  }`}
                >
                  {item}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <Text className="mb-2 mt-4 text-base font-medium leading-6 text-olive">
        Label (optional)
      </Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        className="min-h-12 rounded-lg border border-sand bg-white px-3 text-base leading-6 text-olive"
        onChangeText={setLabel}
        placeholder="coding"
        placeholderTextColor="#9CA38A"
        value={label}
      />

      <Pressable
        accessibilityRole="button"
        className="mt-4 min-h-12 items-center justify-center rounded-lg bg-olive px-4 active:opacity-80"
        disabled={pending}
        onPress={() =>
          onStart({
            category,
            label: label.trim() || undefined,
          })
        }
      >
        {pending ? (
          <ActivityIndicator color={colors.cream} />
        ) : (
          <Text className="text-base font-semibold leading-6 text-cream">
            START
          </Text>
        )}
      </Pressable>
    </View>
  );
}
