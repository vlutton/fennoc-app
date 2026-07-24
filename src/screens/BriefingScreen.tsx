import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatApiError } from "../api/client";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import {
  useEveningBriefing,
  useMorningBriefing,
} from "../hooks/useBriefing";
import { useOutboxStatus } from "../outbox";
import { colors } from "../theme/colors";
import { chicagoToday } from "../utils/format";

type Kind = "morning" | "evening";

const MAX_DAYS_BACK = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setTime(date.getTime() + delta * DAY_MS);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aDate = new Date(ay, am - 1, ad).getTime();
  const bDate = new Date(by, bm - 1, bd).getTime();
  return Math.round((aDate - bDate) / DAY_MS);
}

function formatDayLabel(day: string): string {
  const today = chicagoToday();
  if (day === today) return "Today";
  if (day === shiftDay(today, -1)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function BriefingScreen() {
  const today = chicagoToday();
  const [kind, setKind] = useState<Kind>("morning");
  const [day, setDay] = useState(today);
  const { pendingCount, draining } = useOutboxStatus();

  const morningQuery = useMorningBriefing(day);
  const eveningQuery = useEveningBriefing(day);
  const activeQuery = kind === "morning" ? morningQuery : eveningQuery;

  const canGoForward = day < today;
  const canGoBack = daysBetween(today, day) < MAX_DAYS_BACK;

  const onBack = useCallback(() => {
    if (!canGoBack) return;
    setDay((prev) => shiftDay(prev, -1));
  }, [canGoBack]);

  const onForward = useCallback(() => {
    if (!canGoForward) return;
    setDay((prev) => {
      const next = shiftDay(prev, 1);
      return next > today ? today : next;
    });
  }, [canGoForward, today]);

  const onRefresh = useCallback(() => {
    void activeQuery.refetch();
  }, [activeQuery]);

  const emptyCopy = useMemo(
    () => `No ${kind} briefing for ${day}.`,
    [day, kind],
  );

  const text = activeQuery.data?.text ?? null;
  const loading = activeQuery.isLoading && !activeQuery.data;
  const hasError = activeQuery.isError && !activeQuery.data;

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="grow px-4 pb-8 pt-4"
        refreshControl={
          <RefreshControl
            colors={[colors.terracotta]}
            onRefresh={onRefresh}
            refreshing={activeQuery.isRefetching}
            tintColor={colors.terracotta}
          />
        }
      >
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="text-base font-semibold leading-6 text-olive">
            Briefings
          </Text>
          {pendingCount > 0 ? (
            <Text className="text-sm leading-5 text-terracotta">
              {draining ? "syncing…" : `${pendingCount} queued`}
            </Text>
          ) : null}
        </View>

        <View className="mb-4 flex-row gap-2">
          {(["morning", "evening"] as const).map((item) => {
            const active = kind === item;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                className={`min-h-12 flex-1 items-center justify-center rounded-lg px-3 ${
                  active ? "bg-olive" : "bg-sand"
                }`}
                onPress={() => setKind(item)}
              >
                <Text
                  className={`text-base font-semibold leading-6 ${
                    active ? "text-cream" : "text-olive"
                  }`}
                >
                  {item === "morning" ? "Morning" : "Evening"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View className="mb-4 flex-row items-center justify-between">
          <Pressable
            accessibilityLabel="Previous day"
            accessibilityRole="button"
            className={`min-h-12 min-w-12 items-center justify-center rounded-lg ${
              canGoBack ? "bg-terracotta" : "bg-sand"
            }`}
            disabled={!canGoBack}
            onPress={onBack}
          >
            <Text
              className={`text-base font-semibold leading-6 ${
                canGoBack ? "text-cream" : "text-olive opacity-50"
              }`}
            >
              ←
            </Text>
          </Pressable>

          <Text className="text-base font-semibold leading-6 text-olive">
            {formatDayLabel(day)}
          </Text>

          <Pressable
            accessibilityLabel="Next day"
            accessibilityRole="button"
            className={`min-h-12 min-w-12 items-center justify-center rounded-lg ${
              canGoForward ? "bg-terracotta" : "bg-sand"
            }`}
            disabled={!canGoForward}
            onPress={onForward}
          >
            <Text
              className={`text-base font-semibold leading-6 ${
                canGoForward ? "text-cream" : "text-olive opacity-50"
              }`}
            >
              →
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View className="min-h-32 items-center justify-center rounded-xl bg-sand p-4">
            <ActivityIndicator color={colors.olive} size="large" />
            <Text className="mt-3 text-base leading-6 text-olive">
              Loading {kind} briefing…
            </Text>
          </View>
        ) : hasError ? (
          <View className="rounded-xl bg-sand p-4">
            <Text className="text-base leading-6 text-olive">
              ❌ {formatApiError(activeQuery.error)}
            </Text>
            <Pressable
              accessibilityRole="button"
              className="mt-4 min-h-12 items-center justify-center rounded-lg bg-terracotta px-4 active:opacity-80"
              onPress={() => void activeQuery.refetch()}
            >
              <Text className="text-base font-semibold leading-6 text-cream">
                Retry
              </Text>
            </Pressable>
          </View>
        ) : !text ? (
          <View className="rounded-xl bg-sand p-4">
            <Text className="text-base leading-6 text-olive opacity-70">
              {emptyCopy}
            </Text>
          </View>
        ) : (
          <View className="rounded-xl border border-sand bg-cream p-4">
            <MarkdownRenderer text={text} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
