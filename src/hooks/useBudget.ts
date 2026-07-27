import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { getBudget, setBudgetLimit } from "../api/client";
import type { Budget } from "../api/types";

export const budgetQueryKeys = {
  budget: ["budget"] as const,
};

/** The interruption budget (INT-021 `/api/budget`) — drives the status
 * strip's budget marks and the interruption controls sheet. */
export function useBudget(): UseQueryResult<Budget, Error> {
  return useQuery({
    queryKey: budgetQueryKeys.budget,
    queryFn: () => getBudget(),
    refetchInterval: 60_000,
  });
}

export function useSetBudgetLimit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (limit: number) => setBudgetLimit(limit),
    onSuccess: (data) => {
      queryClient.setQueryData(budgetQueryKeys.budget, data);
    },
  });
}
