import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatApiError } from "../api/client";
import type { OpenTimer, TimeBlock } from "../api/types";
import { CompositionBar } from "../components/CompositionBar";
import { TimeBlockRow } from "../components/TimeBlockRow";
import { TimerCard } from "../components/TimerCard";
import {
  useOpenTimer,
  useStartTime,
  useStopTime,
  useTodayTimeBlocks,
} from "../hooks/useTime";
import { colors } from "../theme/colors";
import { chicagoToday } from "../utils/format";

const IDLE_OPEN: OpenTimer = { active: false };

export function TimeScreen() {
  const day = chicagoToday();
  const openQuery = useOpenTimer();
  const blocksQuery = useTodayTimeBlocks(day);
  const startMutation = useStartTime();
  const stopMutation = useStopTime();

  const blocksNewestFirst = useMemo(() => {
    const blocks = blocksQuery.data ?? [];
    return [...blocks].sort((a, b) => {
      const aTs = Date.parse(a.started_at) || 0;
      const bTs = Date.parse(b.started_at) || 0;
      return bTs - aTs;
    });
  }, [blocksQuery.data]);

  const onRefresh = useCallback(() => {
    void Promise.all([openQuery.refetch(), blocksQuery.refetch()]);
  }, [blocksQuery, openQuery]);

  const onRetry = useCallback(() => {
    void Promise.all([openQuery.refetch(), blocksQuery.refetch()]);
  }, [blocksQuery, openQuery]);

  const onStart = useCallback(
    (opts: { category: string; label?: string }) => {
      startMutation.mutate(opts);
    },
    [startMutation],
  );

  const onStop = useCallback(() => {
    stopMutation.mutate();
  }, [stopMutation]);

  const initialLoading =
    (openQuery.isLoading && !openQuery.data && !openQuery.isError) ||
    (blocksQuery.isLoading && !blocksQuery.data && !blocksQuery.isError);

  const error = openQuery.error ?? blocksQuery.error;
  const hasError = openQuery.isError || blocksQuery.isError;

  const listHeader = (
    <View className="pb-4">
      <Text className="mb-3 text-base font-semibold leading-6 text-olive">
        Time
      </Text>
      <TimerCard
        onStart={onStart}
        onStop={onStop}
        open={openQuery.data ?? IDLE_OPEN}
        starting={startMutation.isPending}
        stopping={stopMutation.isPending}
      />
      <Text className="mb-2 mt-6 text-base font-semibold leading-6 text-olive">
        Today
      </Text>
    </View>
  );

  const listFooter = (
    <View className="pb-4 pt-2">
      <CompositionBar blocks={blocksNewestFirst} />
    </View>
  );

  if (initialLoading) {
    return (
      <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
        <View className="flex-1 items-center justify-center px-4">
          <ActivityIndicator color={colors.olive} size="large" />
          <Text className="mt-3 text-base leading-6 text-olive">
            Loading time…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (hasError && !openQuery.data && !blocksQuery.data) {
    return (
      <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
        <View className="flex-1 items-center justify-center px-4">
          <View className="w-full rounded-xl bg-sand p-4">
            <Text className="text-base leading-6 text-olive">
              ❌ {formatApiError(error)}
            </Text>
            <Pressable
              accessibilityRole="button"
              className="mt-4 min-h-12 items-center justify-center rounded-lg bg-terracotta px-4 active:opacity-80"
              onPress={onRetry}
            >
              <Text className="text-base font-semibold leading-6 text-cream">
                Retry
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <FlatList
        className="flex-1"
        contentContainerClassName="grow px-4 pb-8 pt-4"
        data={blocksNewestFirst}
        keyExtractor={(item: TimeBlock) => item.block_id}
        ListEmptyComponent={
          <View className="mb-4 rounded-xl bg-sand p-4">
            <Text className="text-base leading-6 text-olive">
              No blocks logged today yet.
            </Text>
          </View>
        }
        ListFooterComponent={listFooter}
        ListHeaderComponent={listHeader}
        refreshControl={
          <RefreshControl
            colors={[colors.terracotta]}
            onRefresh={onRefresh}
            refreshing={
              (openQuery.isRefetching || blocksQuery.isRefetching) &&
              !startMutation.isPending &&
              !stopMutation.isPending
            }
            tintColor={colors.terracotta}
          />
        }
        renderItem={({ item }) => <TimeBlockRow block={item} />}
      />
    </SafeAreaView>
  );
}
