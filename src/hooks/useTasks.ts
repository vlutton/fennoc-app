import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  completeTask,
  dropTask,
  getOverdueTasks,
  getTasks,
  getTodayTasks,
} from "../api/client";
import type { GetTasksOpts, Task } from "../api/types";
import { enqueueIfOffline, isNetworkError } from "../outbox";

export const taskQueryKeys = {
  all: ["tasks", "all"] as const,
  today: ["tasks", "today"] as const,
  overdue: ["tasks", "overdue"] as const,
};

function invalidateTaskLists(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: taskQueryKeys.all }),
    queryClient.invalidateQueries({ queryKey: taskQueryKeys.today }),
    queryClient.invalidateQueries({ queryKey: taskQueryKeys.overdue }),
  ]);
}

export function useTasks(
  opts: GetTasksOpts = { status: "open" },
): UseQueryResult<Task[], Error> {
  return useQuery({
    queryKey: [...taskQueryKeys.all, opts],
    queryFn: () => getTasks(opts),
  });
}

export function useTodayTasks(): UseQueryResult<Task[], Error> {
  return useQuery({
    queryKey: taskQueryKeys.today,
    queryFn: () => getTodayTasks(),
  });
}

export function useOverdueTasks(): UseQueryResult<Task[], Error> {
  return useQuery({
    queryKey: taskQueryKeys.overdue,
    queryFn: () => getOverdueTasks(),
  });
}

export function useCompleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      try {
        return await completeTask(taskId);
      } catch (error) {
        if (isNetworkError(error)) {
          enqueueIfOffline("complete", { taskId });
          return { ok: true, queued: true as const };
        }
        throw error;
      }
    },
    onSuccess: () => invalidateTaskLists(queryClient),
  });
}

export function useDropTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskId: string) => {
      try {
        return await dropTask(taskId);
      } catch (error) {
        if (isNetworkError(error)) {
          enqueueIfOffline("drop", { taskId });
          return { ok: true, queued: true as const };
        }
        throw error;
      }
    },
    onSuccess: () => invalidateTaskLists(queryClient),
  });
}
