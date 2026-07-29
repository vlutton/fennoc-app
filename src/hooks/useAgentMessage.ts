import {
  useMutation,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";

import { getAgentMessage, sendAgentMessage } from "../api/client";
import type { AgentMessage, AgentMessageCreated } from "../api/types";

/**
 * The client half of the Fennoc agent bridge (INT-029b). `sendAgentMessage`
 * kicks off an async turn (`POST /api/message` — 202, row just created);
 * `getAgentMessage` polls the row until the server marks it `done` or
 * `error`. Turns take 9–35 seconds end to end, so a short fixed poll
 * interval — not a single fetch-and-wait — is the correct shape here.
 */
export const agentMessageQueryKeys = {
  message: (id: string) => ["agentMessage", id] as const,
};

export function useSendAgentMessage() {
  return useMutation<AgentMessageCreated, Error, string>({
    mutationFn: (text: string) => sendAgentMessage(text),
  });
}

/**
 * Polls `GET /api/message/{id}` every 1.5s while the turn is still
 * `queued` or `running`, and stops polling once it's `done` or `error` —
 * react-query's function form of `refetchInterval` reads the latest query
 * result to decide, so this never turns into an unbounded poll.
 */
export function useAgentMessagePoll(
  messageId: string,
): UseQueryResult<AgentMessage, Error> {
  return useQuery({
    queryKey: agentMessageQueryKeys.message(messageId),
    queryFn: () => getAgentMessage(messageId),
    // Stop only on a terminal status. Written as "keep going unless done"
    // rather than "go while queued/running" on purpose: if the first fetch
    // fails the status is `undefined`, and the whitelist form would silently
    // stop polling and strand the thread on "Thinking…" forever.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "done" || status === "error" ? false : 1500;
    },
  });
}
