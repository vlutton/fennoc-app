import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  capture,
  getCheckinCoverage,
  getCheckinCurrentActivity,
  getPendingCheckin,
  getStatus,
  getTodayTasks,
  replyCheckin,
} from "../api/client";
import type {
  CaptureOpts,
  CaptureResult,
  CheckinCoverage,
  CheckinCurrent,
  CheckinReply,
  PendingCheckin,
  Status,
  Task,
} from "../api/types";

export const homeQueryKeys = {
  status: ["status"] as const,
  todayTop3: ["tasks", "today"] as const,
  pendingCheckin: ["checkin", "pending"] as const,
  checkinCurrent: ["checkin", "current"] as const,
  checkinCoverage: ["checkin", "coverage"] as const,
};

export function useStatus(): UseQueryResult<Status, Error> {
  return useQuery({
    queryKey: homeQueryKeys.status,
    queryFn: () => getStatus(),
  });
}

export function useTodayTop3(): UseQueryResult<Task[], Error> {
  return useQuery({
    queryKey: homeQueryKeys.todayTop3,
    queryFn: () => getTodayTasks(),
    select: (data) => data.slice(0, 3),
  });
}

export function usePendingCheckin(): UseQueryResult<PendingCheckin, Error> {
  return useQuery({
    queryKey: homeQueryKeys.pendingCheckin,
    queryFn: () => getPendingCheckin(),
    refetchInterval: 60_000,
  });
}

export function useCheckinCurrentActivity(): UseQueryResult<
  CheckinCurrent,
  Error
> {
  return useQuery({
    queryKey: homeQueryKeys.checkinCurrent,
    queryFn: () => getCheckinCurrentActivity(),
    refetchInterval: 60_000,
  });
}

export function useCheckinCoverage(
  day?: string,
): UseQueryResult<CheckinCoverage, Error> {
  return useQuery({
    queryKey: [...homeQueryKeys.checkinCoverage, day ?? "today"] as const,
    queryFn: () => getCheckinCoverage(day),
  });
}

export function useReplyCheckin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      text,
      questionType,
    }: {
      text: string;
      questionType: string;
    }): Promise<CheckinReply> => replyCheckin(text, questionType),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: homeQueryKeys.pendingCheckin,
        }),
        queryClient.invalidateQueries({
          queryKey: homeQueryKeys.checkinCoverage,
        }),
      ]),
  });
}

export function useCapture() {
  return useMutation({
    mutationFn: ({
      text,
      opts,
    }: {
      text: string;
      opts?: CaptureOpts;
    }): Promise<CaptureResult> => capture(text, opts),
  });
}
