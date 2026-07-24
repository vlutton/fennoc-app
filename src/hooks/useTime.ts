import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  getOpenTimer,
  getTodayTimeBlocks,
  startTime,
  stopTime,
} from "../api/client";
import type { OpenTimer, TimeBlock, TimeStartOpts } from "../api/types";
import { chicagoToday } from "../utils/format";

export const timeQueryKeys = {
  open: ["time", "open"] as const,
  blocks: (day: string) => ["time", "blocks", day] as const,
};

function invalidateTimeQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  day: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: timeQueryKeys.open }),
    queryClient.invalidateQueries({ queryKey: timeQueryKeys.blocks(day) }),
    queryClient.invalidateQueries({ queryKey: ["time", "blocks"] }),
  ]);
}

export function useOpenTimer(): UseQueryResult<OpenTimer, Error> {
  return useQuery({
    queryKey: timeQueryKeys.open,
    queryFn: () => getOpenTimer(),
    refetchInterval: false,
    refetchOnWindowFocus: true,
  });
}

export function useTodayTimeBlocks(
  day?: string,
): UseQueryResult<TimeBlock[], Error> {
  const resolvedDay = day ?? chicagoToday();
  return useQuery({
    queryKey: timeQueryKeys.blocks(resolvedDay),
    queryFn: () => getTodayTimeBlocks(resolvedDay),
    refetchOnWindowFocus: true,
  });
}

export function useStartTime() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (opts: TimeStartOpts) => startTime(opts),
    onSuccess: () => invalidateTimeQueries(queryClient, chicagoToday()),
  });
}

export function useStopTime() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => stopTime(),
    onSuccess: () => invalidateTimeQueries(queryClient, chicagoToday()),
  });
}
