/**
 * Persisted offline outbox (INT-014f).
 *
 * Replaces the 014e in-memory stub. CaptureBar still imports enqueueCapture().
 *
 * Accepted limitation — checkin_reply is fire-once, drop-on-conflict:
 * the server consumes the pending check-in on first successful reply.
 * A replay after that returns 409; we markDropped immediately and do NOT
 * retry. The activity text is not recoverable once the pending is gone.
 */

import { isAxiosError } from "axios";
import { useMemo } from "react";

import {
  capture,
  completeTask,
  dropTask,
  replyCheckin,
  startTime,
  stopTime,
} from "../api/client";
import {
  type EnqueueInput,
  type OutboxItem,
  type OutboxKind,
  useOutboxStore,
} from "./store";

export type { OutboxItem, OutboxKind } from "./store";
export { useOutboxStore } from "./store";

export function isNetworkError(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  return (
    error.code === "ERR_NETWORK" ||
    error.code === "ECONNABORTED" ||
    !error.response
  );
}

export function enqueueIfOffline(
  kind: OutboxKind,
  payload: Record<string, unknown>,
  idempotency_key?: string,
): { queued: true; id: string } {
  const id = useOutboxStore.getState().enqueue({
    kind,
    payload,
    idempotency_key,
  });
  return { queued: true, id };
}

/** Backward-compatible 014e seam used by CaptureBar. */
export function enqueueCapture(opts: {
  text: string;
  idempotency_key: string;
  source_ref?: string;
}): void {
  enqueueIfOffline(
    "capture",
    {
      text: opts.text,
      source_ref: opts.source_ref ?? "fennoc-app",
    },
    opts.idempotency_key,
  );
}

async function replayItem(item: OutboxItem): Promise<void> {
  switch (item.kind) {
    case "complete": {
      const taskId = String(item.payload.taskId ?? "");
      await completeTask(taskId);
      return;
    }
    case "drop": {
      const taskId = String(item.payload.taskId ?? "");
      await dropTask(taskId);
      return;
    }
    case "capture": {
      const text = String(item.payload.text ?? "");
      const source_ref =
        typeof item.payload.source_ref === "string"
          ? item.payload.source_ref
          : "fennoc-app";
      await capture(text, {
        idempotency_key: item.idempotency_key,
        source_ref,
      });
      return;
    }
    case "checkin_reply": {
      const text = String(item.payload.text ?? "");
      const questionType = String(item.payload.questionType ?? "");
      await replyCheckin(text, questionType);
      return;
    }
    case "time_start": {
      const category = String(item.payload.category ?? "work");
      const label =
        typeof item.payload.label === "string" ? item.payload.label : undefined;
      await startTime({ category, label });
      return;
    }
    case "time_stop": {
      await stopTime();
      return;
    }
    default: {
      const _exhaustive: never = item.kind;
      void _exhaustive;
    }
  }
}

let drainPromise: Promise<void> | null = null;

/** Single-flight FIFO replay of pending outbox items. */
export async function drain(): Promise<void> {
  if (drainPromise) return drainPromise;

  drainPromise = (async () => {
    const store = useOutboxStore.getState();
    store.setDraining(true);
    try {
      // Snapshot pending ids in FIFO order; re-read state each step.
      const pendingIds = store.items
        .filter((item) => item.status === "pending")
        .map((item) => item.id);

      for (const id of pendingIds) {
        const current = useOutboxStore.getState().items.find((i) => i.id === id);
        if (!current || current.status !== "pending") continue;

        useOutboxStore.getState().markInflight(id);
        try {
          await replayItem(current);
          useOutboxStore.getState().markDone(id);
          console.warn("[outbox] drained", current.kind, id);
        } catch (error) {
          const status = isAxiosError(error) ? error.response?.status : undefined;
          const message =
            error instanceof Error ? error.message : "unknown drain error";

          // Fire-once drop-on-conflict for check-in replies (see file header).
          if (current.kind === "checkin_reply" && status === 409) {
            useOutboxStore
              .getState()
              .markDropped(id, "conflict (already consumed)");
            console.warn(
              "[outbox] checkin_reply dropped on 409 (accepted limitation)",
              id,
            );
            continue;
          }

          if (status !== undefined && status >= 400 && status < 500) {
            useOutboxStore.getState().markDropped(id, message);
            console.warn("[outbox] dropped on 4xx", current.kind, id, message);
            continue;
          }

          useOutboxStore.getState().bumpAttempt(id, message);
          console.warn("[outbox] retry later", current.kind, id, message);
        }
      }
    } finally {
      useOutboxStore.getState().setDraining(false);
      drainPromise = null;
    }
  })();

  return drainPromise;
}

export function useOutboxStatus(): {
  pendingCount: number;
  draining: boolean;
} {
  const items = useOutboxStore((s) => s.items);
  const draining = useOutboxStore((s) => s.draining);
  const pendingCount = useMemo(
    () =>
      items.filter(
        (item) => item.status === "pending" || item.status === "inflight",
      ).length,
    [items],
  );
  return { pendingCount, draining };
}

/** Test helper. */
export function _peekOutbox(): readonly OutboxItem[] {
  return useOutboxStore.getState().items;
}

export type { EnqueueInput };
