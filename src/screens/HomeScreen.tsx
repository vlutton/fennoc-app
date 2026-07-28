import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { isAxiosError } from "axios";
import { useCallback, useState } from "react";
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
import { CaptureBar } from "../components/CaptureBar";
import { CheckinCard } from "../components/CheckinCard";
import { StatusStrip } from "../components/StatusStrip";
import { TodayTopTaskRow } from "../components/TodayTopTaskRow";
import {
  usePendingCheckin,
  useReplyCheckin,
  useStatus,
  useTodayTop3,
} from "../hooks/useHome";
import { useTodayTasks } from "../hooks/useTasks";
import { colors } from "../theme/colors";

type RootTabParamList = {
  Home: undefined;
  Tasks: undefined;
  Time: undefined;
  Briefings: undefined;
  Settings: undefined;
};

export function HomeScreen() {
  const navigation =
    useNavigation<BottomTabNavigationProp<RootTabParamList, "Home">>();
  const statusQuery = useStatus();
  const todayTop3Query = useTodayTop3();
  const todayAllQuery = useTodayTasks();
  const pendingQuery = usePendingCheckin();
  const replyMutation = useReplyCheckin();
  const [checkinHidden, setCheckinHidden] = useState(false);

  const onRefresh = useCallback(() => {
    setCheckinHidden(false);
    void Promise.all([
      statusQuery.refetch(),
      todayTop3Query.refetch(),
      todayAllQuery.refetch(),
      pendingQuery.refetch(),
    ]);
  }, [pendingQuery, statusQuery, todayAllQuery, todayTop3Query]);

  const goToTasks = useCallback(() => {
    navigation.navigate("Tasks");
  }, [navigation]);

  const onReply = useCallback(
    (text: string) => {
      const qt = pendingQuery.data?.question_type;
      if (!qt) return;
      replyMutation.mutate(
        { text, questionType: qt },
        {
          onError: (error) => {
            if (isAxiosError(error) && error.response?.status === 409) {
              setCheckinHidden(true);
              void pendingQuery.refetch();
            }
          },
        },
      );
    },
    [pendingQuery, replyMutation],
  );

  const statusLoading = statusQuery.isLoading && !statusQuery.data;
  const todayCount = todayAllQuery.data?.length ?? todayTop3Query.data?.length ?? 0;
  const top3 = todayTop3Query.data ?? [];
  const showCheckin =
    !checkinHidden &&
    pendingQuery.data?.pending === true &&
    !pendingQuery.isError;

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="grow px-4 pb-8 pt-4"
        refreshControl={
          <RefreshControl
            colors={[colors.terracotta]}
            onRefresh={onRefresh}
            refreshing={
              statusQuery.isRefetching ||
              todayTop3Query.isRefetching ||
              pendingQuery.isRefetching
            }
            tintColor={colors.terracotta}
          />
        }
      >
        <Text className="mb-3 text-base font-semibold leading-6 text-olive">
          Home
        </Text>

        {statusLoading ? (
          <View className="mb-4 min-h-12 flex-row items-center rounded-xl bg-sand px-3 py-3">
            <ActivityIndicator color={colors.olive} />
            <Text className="ml-3 text-base leading-6 text-olive">
              Loading status…
            </Text>
          </View>
        ) : statusQuery.isError && !statusQuery.data ? (
          <View className="mb-4 rounded-xl bg-sand p-4">
            <Text className="text-base leading-6 text-olive">
              ❌ {formatApiError(statusQuery.error)}
            </Text>
            <Pressable
              accessibilityRole="button"
              className="mt-3 min-h-12 items-center justify-center rounded-lg bg-terracotta px-4 active:opacity-80"
              onPress={() => void statusQuery.refetch()}
            >
              <Text className="text-base font-semibold leading-6 text-cream">
                Retry
              </Text>
            </Pressable>
          </View>
        ) : statusQuery.data ? (
          // StatusStrip was rewritten for INT-023 (thread shell) and is now
          // self-contained — it reads the budget/connection state itself
          // and no longer takes status/count props. This screen is unused
          // (the thread is root now) but kept on disk for a later pass.
          <StatusStrip />
        ) : null}

        <Text className="mb-2 text-base font-semibold leading-6 text-olive">
          Top 3 today
        </Text>

        {todayTop3Query.isLoading && !todayTop3Query.data ? (
          <View className="mb-4 min-h-12 items-center justify-center rounded-xl bg-sand py-4">
            <ActivityIndicator color={colors.olive} />
          </View>
        ) : todayTop3Query.isError && !todayTop3Query.data ? (
          <View className="mb-4 rounded-xl bg-sand p-4">
            <Text className="text-base leading-6 text-olive">
              ❌ {formatApiError(todayTop3Query.error)}
            </Text>
          </View>
        ) : top3.length === 0 ? (
          <View className="mb-4 rounded-xl bg-sand p-4">
            <Text className="text-base leading-6 text-olive opacity-70">
              Nothing due today.
            </Text>
          </View>
        ) : (
          <View className="mb-4">
            {top3.map((task) => (
              <TodayTopTaskRow
                key={task.task_id}
                onPress={goToTasks}
                task={task}
              />
            ))}
          </View>
        )}

        {showCheckin && pendingQuery.data ? (
          <CheckinCard
            onReply={onReply}
            pending={pendingQuery.data}
            sending={replyMutation.isPending}
          />
        ) : null}

        {replyMutation.isError &&
        !(isAxiosError(replyMutation.error) && replyMutation.error.response?.status === 409) ? (
          <Text className="mb-3 text-sm leading-5 text-terracotta">
            ❌ {formatApiError(replyMutation.error)}
          </Text>
        ) : null}

        <CaptureBar />
      </ScrollView>
    </SafeAreaView>
  );
}
