import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { briefingEvening, briefingMorning } from "../api/client";
import type { Briefing } from "../api/types";
import { chicagoToday } from "../utils/format";

export const briefingQueryKeys = {
  morning: (day: string) => ["briefing", "morning", day] as const,
  evening: (day: string) => ["briefing", "evening", day] as const,
};

export function useMorningBriefing(
  day?: string,
): UseQueryResult<Briefing, Error> {
  const resolved = day ?? chicagoToday();
  return useQuery({
    queryKey: briefingQueryKeys.morning(resolved),
    queryFn: () => briefingMorning(resolved),
  });
}

export function useEveningBriefing(
  day?: string,
): UseQueryResult<Briefing, Error> {
  const resolved = day ?? chicagoToday();
  return useQuery({
    queryKey: briefingQueryKeys.evening(resolved),
    queryFn: () => briefingEvening(resolved),
  });
}
