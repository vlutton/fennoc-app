import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { getReminders, reminderDone } from "../api/client";
import type { Reminder } from "../api/types";

/** `GET /api/reminders` / reminder actions (INT-057 commit 3) — the
 *  ledger's OPEN REMINDERS group. */
export const reminderQueryKeys = {
  open: ["reminders", "open"] as const,
};

export function useOpenReminders(): UseQueryResult<Reminder[], Error> {
  return useQuery({
    queryKey: reminderQueryKeys.open,
    queryFn: () => getReminders(),
  });
}

export function useReminderDone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reminderDone(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: reminderQueryKeys.open });
    },
  });
}
