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
import { enqueueIfOffline, isNetworkError } from "../outbox";
import { useThreadStore } from "../store/useThread";

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
    mutationFn: async ({
      text,
      questionType,
    }: {
      text: string;
      questionType: string;
    }): Promise<CheckinReply & { queued?: true }> => {
      try {
        return await replyCheckin(text, questionType);
      } catch (error) {
        if (isNetworkError(error)) {
          enqueueIfOffline("checkin_reply", { text, questionType });
          return { ok: true, ack: "queued", queued: true };
        }
        throw error;
      }
    },
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
    mutationFn: async ({
      text,
      opts,
    }: {
      text: string;
      opts?: CaptureOpts;
    }): Promise<CaptureResult & { queued?: true }> => {
      try {
        return await capture(text, opts);
      } catch (error) {
        if (isNetworkError(error)) {
          enqueueIfOffline(
            "capture",
            {
              text,
              source_ref: opts?.source_ref ?? "fennoc-app",
            },
            opts?.idempotency_key,
          );
          return { ok: true, event_id: null, queued: true };
        }
        throw error;
      }
    },
    // Session-local thread bubble for what the user just said (INT-023b —
    // see src/store/useThread.ts). Fires on both the online and the
    // offline/queued path: the user spoke either way, independent of
    // delivery status, and the bubble represents the utterance, not the
    // delivery receipt.
    onSuccess: (_result, variables) => {
      useThreadStore.getState().addCapture(variables.text);
    },
  });
}
