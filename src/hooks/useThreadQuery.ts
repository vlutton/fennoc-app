import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { getThread, resolveOvernight } from "../api/client";
import type { ResolveOvernightAction, ResolveOvernightResult, Thread } from "../api/types";

/**
 * `GET /api/thread` (INT-057 commit 2) — the durable thread ThreadScreen
 * renders from. Named `useThreadQuery`, not `useThread`, to keep it
 * unambiguous next to `src/store/useThread.ts` (the session-local overlay
 * store) — this file is the server half, that one is the client half; see
 * the store's own header comment for how the two combine.
 */
export const threadQueryKeys = {
  // `expand` is sorted before joining into the key: two calls passing the
  // same set of dates in a different order must hit the same cache entry,
  // not silently refetch/duplicate because array identity or order
  // differed. Callers (ThreadScreen) derive `expand` from a `Record<string,
  // boolean>`, whose key iteration order is not something to depend on.
  thread: (expand: string[]) => ["thread", [...expand].sort()] as const,
};

/**
 * Polls every 60s, matching this app's existing convention for
 * "background-refresh, no interaction needed" queries (`usePendingCheckin`,
 * `useCheckinCurrentActivity`, `useBudget` all do the same). Mutations that
 * change the thread's shape (`useResolveOvernight` below; ThreadScreen's
 * own agent-turn resolution and photo delivery) additionally invalidate
 * this query directly rather than waiting out the interval, so the 60s
 * figure only bounds the worst case, not the typical one.
 */
export function useThread(expand: string[]): UseQueryResult<Thread, Error> {
  return useQuery({
    queryKey: threadQueryKeys.thread(expand),
    queryFn: () => getThread(expand),
    refetchInterval: 60_000,
  });
}

/**
 * `POST /api/time/resolve-overnight` — the overnight card's three actions
 * (step 18a). Invalidates every cached thread page (not just the current
 * `expand` set) on success: resolving the timer removes `open_timer` from
 * the response and, for `"done"`, also changes what the affected day's
 * turns/line look like once the server recomputes them — both are only
 * visible after a refetch, and there is no reason to leave a stale
 * `open_timer` sitting in an expanded day's cached page just because that
 * particular `expand` combination wasn't the one active when this fired.
 */
export function useResolveOvernight() {
  const queryClient = useQueryClient();
  return useMutation<
    ResolveOvernightResult,
    Error,
    { blockId: string; action: ResolveOvernightAction; minutes?: number }
  >({
    mutationFn: ({ blockId, action, minutes }) => resolveOvernight(blockId, action, minutes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["thread"] });
    },
  });
}
