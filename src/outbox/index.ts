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
import { File } from "expo-file-system";
import { useMemo } from "react";

import {
  capture,
  completeTask,
  dropTask,
  replyCheckin,
  startTime,
  stopTime,
  uploadImage,
} from "../api/client";
import { deliverPhotoShotError, deliverPhotoShotResult } from "../store/useThread";
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

/**
 * The photo-capture hot path's held/offline queue (Step 11 — "Kept on
 * device · goes when you're back") — the SAME outbox every other offline
 * write already goes through, not a second one. `uri` must already be a
 * DURABLE file (see photoCapture.ts's `persistForHold`): the camera's own
 * capture URI lives in a cache directory the OS is free to reclaim, which
 * is fine for an immediate upload but not for something meant to survive
 * until the device is "back" — possibly well after this app process, and
 * the AsyncStorage-backed outbox item describing it, have both been
 * reloaded from a cold start.
 */
export function enqueueImageUpload(opts: {
  uri: string;
  mime: string;
  filename: string;
  /** Which thread entry (and which shot within it) this upload belongs to
   *  — see `deliverPhotoShotResult`'s note on why the batch might not
   *  exist anymore by the time this drains. */
  batchId: string;
  localShotId: string;
  /** Only ever set by the gallery/library flow — the camera hot path never
   *  passes a caption (Step 15: "no caption field"). */
  question?: string;
}): void {
  enqueueIfOffline("image_upload", {
    uri: opts.uri,
    mime: opts.mime,
    filename: opts.filename,
    batchId: opts.batchId,
    localShotId: opts.localShotId,
    question: opts.question,
  });
}

/**
 * Cancel any still-PENDING held-photo uploads belonging to a batch that was
 * just undone (see useThread.ts's `undoPhotoBatch`, called by ThreadScreen
 * just before this). Only removes items with status `"pending"` — a shot
 * genuinely still sitting on the device, never sent. An `"inflight"` item
 * is a request already in the air by the time Undo was pressed; nothing
 * here can recall bytes already on their way to the server, so those are
 * left alone and simply run their course — `deliverPhotoShotResult`'s
 * "stillOpen" check (useThread.ts) is what keeps that eventual result from
 * resurfacing in the thread once the batch is marked undone, since the
 * capture is still there, just filtered out of what renders.
 *
 * This used to be the ONE case Undo could be more than "hide it locally":
 * a held shot never left the device, so cancelling the outbox item and
 * deleting the local file is a genuine, complete undo. The already-sent
 * case now has its own real cleanup too — `DELETE /api/image/{id}` (see
 * `api/client.ts`'s `deleteImage`, called from `ThreadScreen.tsx`'s
 * `onUndoPhoto` / `deleteSentUploadsForBatch`, and from
 * `deliverPhotoShotResult` in `useThread.ts` for a shot that was still
 * mid-upload when Undo was tapped) — so this function is no longer the
 * only half of Undo that does something real; it's specifically the
 * held/offline half.
 */
export function cancelHeldUploadsForBatch(batchId: string): void {
  const items = useOutboxStore.getState().items;
  for (const item of items) {
    if (item.kind !== "image_upload" || item.status !== "pending") continue;
    if (String(item.payload.batchId ?? "") !== batchId) continue;

    // The durable copy (persistForHold, photoCapture.ts) has no other
    // purpose once this item is gone — same cleanup as a successful drain
    // (see the "image_upload" case in replayItem below), just triggered by
    // Undo instead of by the upload finishing.
    const uri = String(item.payload.uri ?? "");
    if (uri) {
      try {
        new File(uri).delete();
      } catch (deleteError) {
        console.warn("[outbox] undo cleanup failed", uri, deleteError);
      }
    }
    useOutboxStore.getState().removeItem(item.id);
  }
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
    case "image_upload": {
      const uri = String(item.payload.uri ?? "");
      const mime = String(item.payload.mime ?? "");
      const filename = String(item.payload.filename ?? "");
      const batchId = String(item.payload.batchId ?? "");
      const localShotId = String(item.payload.localShotId ?? "");
      const question =
        typeof item.payload.question === "string" ? item.payload.question : undefined;

      const result = await uploadImage(uri, mime, filename, question);
      deliverPhotoShotResult(batchId, localShotId, {
        imageId: result.id,
        extractedText: result.extracted_text,
        caption: result.caption ?? null,
      });

      // The durable copy (persistForHold, photoCapture.ts) served exactly
      // one purpose — surviving until this upload could run — and the
      // server has already discarded ITS copy per the endpoint's own
      // contract (see ImageUploadResult's doc comment). Deleting ours too
      // is the client-side half of the same "discard the image, keep the
      // read" rule, not an afterthought: best-effort only, since a failed
      // delete here must never turn a successful upload into a retry.
      try {
        new File(uri).delete();
      } catch (deleteError) {
        console.warn("[outbox] held-photo cleanup failed", uri, deleteError);
      }
      return;
    }
    default: {
      const _exhaustive: never = item.kind;
      void _exhaustive;
    }
  }
}

/**
 * Fires once an outbox item is permanently given up on — a genuine 4xx
 * (bad mime, oversized image, malformed request — nothing a retry would
 * fix) or `MAX_ATTEMPTS` retries exhausted (see store.ts's `bumpAttempt`).
 * Only `image_upload` items need a reaction: the other kinds either have
 * nowhere user-visible to report to (`complete`/`drop`/`time_*`) or already
 * echoed the user's own words into the thread at ENQUEUE time, not drain
 * time (`capture`, `checkin_reply` — see useHome.ts/useCapture's onSuccess).
 * A held photo is the one kind where the THREAD ENTRY ITSELF is still
 * waiting on this outcome (its shot sits in "held" until this resolves), so
 * it's the one kind that needs a drop routed back to it.
 *
 * Copy matches Step 11's worked example verbatim ("Held, and unreadable") —
 * "no retry button... says what it couldn't do in one line." The raw
 * axios/network error message that caused the drop is intentionally NOT
 * surfaced here — it's operator detail (a status code, a timeout string),
 * not something Fennoc would say out loud.
 */
function onOutboxItemDropped(item: OutboxItem): void {
  if (item.kind !== "image_upload") return;
  const batchId = String(item.payload.batchId ?? "");
  const localShotId = String(item.payload.localShotId ?? "");
  if (!batchId || !localShotId) return;
  deliverPhotoShotError(
    batchId,
    localShotId,
    "Can't read this one. It's on the thread if you want to tell me what it was.",
  );
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
            onOutboxItemDropped(current);
            console.warn(
              "[outbox] checkin_reply dropped on 409 (accepted limitation)",
              id,
            );
            continue;
          }

          if (status !== undefined && status >= 400 && status < 500) {
            useOutboxStore.getState().markDropped(id, message);
            onOutboxItemDropped(current);
            console.warn("[outbox] dropped on 4xx", current.kind, id, message);
            continue;
          }

          useOutboxStore.getState().bumpAttempt(id, message);
          // `bumpAttempt` itself calls `markDropped` once MAX_ATTEMPTS is
          // exceeded (store.ts) — invisible from here unless the resulting
          // status is re-read, since drain() only ever calls the store's
          // mutator, not the other way around.
          if (useOutboxStore.getState().items.find((i) => i.id === id)?.status === "dropped") {
            onOutboxItemDropped(current);
          }
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
