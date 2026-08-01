import * as Crypto from "expo-crypto";
import { useMemo } from "react";
import { create } from "zustand";

import { deleteImage, formatApiError } from "../api/client";
import type { AgentAction } from "../api/types";

/**
 * Session-local record of user captures, used only to render the user's
 * own bubbles back into the thread scroll (INT-023b). Also holds the
 * client-side view of an in-flight or finished agent turn (INT-029b) — the
 * `agent` field below — so the thread can show a Fennoc entry immediately
 * on submit and resolve it in place once the server's async turn completes.
 *
 * This is explicitly NOT the durable thread the backend blueprint proposes
 * (`GET /api/thread` — proposed, unbuilt; see INT-023 intent doc, "1. Where
 * messages come from"). It is deliberately:
 *   - in-memory only, no `persist` middleware — nothing here survives an
 *     app restart, and
 *   - filtered to the local calendar day on read (`useTodayCaptures`), so
 *     a session that happens to straddle midnight can't leak yesterday's
 *     bubbles into today's thread.
 *
 * A real, durable, multi-device thread store is a later increment. Do not
 * mistake this for it, and do not add `persist` here to "fix" the
 * bounded-to-today behaviour — that would change what this is. The `agent`
 * entries are exactly as session-local and non-durable as everything else
 * here: a poll started this session resolves this session, and a restart
 * loses the pending state along with the rest of the thread.
 */
export interface ThreadCapture {
  id: string;
  text: string;
  createdAt: string; // ISO 8601
  /** Who said it. Fennoc speaks unboxed; the user speaks in a bubble. */
  speaker: "user" | "fennoc";
  /** Present only on Fennoc entries produced by an agent turn (INT-029b). */
  agent?: {
    messageId: string;
    state: "thinking" | "done" | "error";
    /** The collapsed remainder of a long reply; null when the reply fit in the lede. */
    body: string | null;
    /**
     * The turn's receipt rows (INT-050) — null until the turn resolves
     * `done`, and null forever for a turn from a server build that doesn't
     * send `actions` yet (see `AgentAction`'s own doc comment in
     * api/types.ts). `qualifiesForReceipt` (components/Receipt.tsx) is the
     * one place that decides whether this is enough to show anything.
     */
    actions: AgentAction[] | null;
  };
  /**
   * Present only on Fennoc entries produced by the photo-capture hot path
   * (Step 11 of the design handoff — "a photo is a sentence you didn't have
   * to say"). See `PhotoBatch` below for why this is a batch of shots
   * rather than a single result.
   */
  photo?: PhotoBatch;
}

/** One shutter press (or one gallery pick) within a `PhotoBatch`. */
export type PhotoShotState = "uploading" | "held" | "done" | "error";

export interface PhotoShot {
  /**
   * Locally generated id, stable for this shot's entire lifecycle —
   * including a trip through the outbox and a later drain, possibly in a
   * different app session. This is how a held shot's eventual result (or
   * failure) finds its way back to the right slot instead of being
   * mistaken for a new one — see `deliverPhotoShotResult` below.
   */
  localId: string;
  state: PhotoShotState;
  /**
   * The on-device file backing this shot. Present while "uploading" (the
   * in-flight request needs it) and "held" (the outbox needs it — see
   * src/capture/photoCapture.ts's note on why held shots get COPIED to
   * durable storage rather than referencing the camera's cache URI
   * directly). Cleared to null once `state` becomes "done": the client
   * discards its own copy the moment the server has, which is exactly the
   * "discard the image, keep a generous read" rule this endpoint exists to
   * honour (Step 15) — there is deliberately no lingering local copy to
   * build a "view full size" affordance out of later.
   */
  localUri: string | null;
  /** The server's row id once uploaded — see ImageUploadResult's own note
   *  on what it is (and is not) still good for. */
  imageId: string | null;
  /** The one-pass extraction result. Null until `state` is "done". */
  extractedText: string | null;
  /** One line, no retry button (Step 11's "Reading" rules) — set on
   *  "error" and on a "held" shot that eventually exhausts its retries. */
  errorText: string | null;
}

export interface PhotoBatch {
  /**
   * Groups every shutter press taken during one camera-open session into a
   * single thread entry — "multi-shot arrives as one message and produces
   * one read, not three" (Step 11's capture rules). Minted once per
   * camera-open by the caller (CameraCapture), not by anything in this
   * store: this store only knows how to append a shot to an existing batch
   * or start a new one, never when a "session" begins or ends.
   */
  batchId: string;
  /** Shutter-press order. */
  shots: PhotoShot[];
  /**
   * Wall-clock ms of the FIRST shot in the batch. Anchors the 10s undo
   * window (`isPhotoUndoAvailable`) to the message's creation, not to
   * whichever shot most recently resolved — pressing the shutter twice
   * does not reset a clock that's already running.
   */
  createdAtMs: number;
  /**
   * True once the user taps Undo inside the window. An undone batch is
   * filtered out of the rendered thread (see ThreadScreen) rather than
   * deleted from `captures` outright — see `undoPhotoBatch`'s own note on
   * why removal-by-filter, not removal-by-splice, is the honest thing to
   * do here.
   */
  undone: boolean;
}

/** "Undo lives on the sent message for 10s" (Step 11's capture rules). */
export const PHOTO_UNDO_WINDOW_MS = 10_000;

/**
 * Pure function, exported specifically so the 10s window is checkable
 * without a running timer, a component, or a camera — pass any two
 * timestamps and get a boolean back. The live countdown UI (PhotoMessage)
 * is a thin wrapper that re-evaluates this once a second; the RULE itself
 * lives here, once.
 */
export function isPhotoUndoAvailable(createdAtMs: number, nowMs: number = Date.now()): boolean {
  return nowMs - createdAtMs < PHOTO_UNDO_WINDOW_MS;
}

interface ThreadState {
  captures: ThreadCapture[];
  addCapture: (text: string) => void;
  /**
   * Append a line Fennoc said.
   *
   * Used for the acknowledgement after a check-in reply. Pass the server's own
   * `ack` string rather than composing one here — `process_check_in_reply`
   * returns either a confirmation or a follow-up question depending on whether
   * the reply actually parsed, so inventing a cheerful "Tracking it." locally
   * would claim success the server never reported.
   */
  addFennocLine: (text: string) => void;
  /**
   * Append a placeholder Fennoc entry for an agent turn that was just
   * submitted (`POST /api/message` returned `id`). Empty text, `state:
   * "thinking"` — `AgentTurnWatcher` resolves it via `resolveAgent` once the
   * poll reports `done` or `error`.
   */
  addAgentPending: (messageId: string) => void;
  /**
   * Resolve a pending agent entry in place, by `agent.messageId`. Updates
   * `text`, `agent.body`, and `agent.state` without touching `createdAt`, so
   * the entry doesn't jump in the thread's chronological sort. A no-op if no
   * entry with that message id is found (e.g. it was never added this
   * session).
   */
  resolveAgent: (
    messageId: string,
    result: {
      text: string;
      body: string | null;
      state: "done" | "error";
      /** Omit for an error resolution — there is no turn to report a receipt for. */
      actions?: AgentAction[] | null;
    },
  ) => void;
  /** What the composer is currently answering, for the quoted strip above it.
   *  UI state only — see the note in CaptureBar on why the quote is not sent. */
  replyingTo: { messageId: string; quote: string } | null;
  setReplyingTo: (value: { messageId: string; quote: string } | null) => void;

  /**
   * Whether a turn's receipt (INT-050) is currently expanded, keyed by
   * `agent.messageId`. In-memory only, same as the rest of this store — "a
   * thread scrolled back to keeps whatever expansion state the user left it
   * in" only needs to survive a scroll, not an app restart, and matches
   * `useThread`'s existing session-local semantics exactly (see the file
   * header). Missing key means collapsed, not "expand once and forget" —
   * there is no need for a separate "seen" flag.
   */
  receiptExpanded: Record<string, boolean>;
  toggleReceiptExpanded: (messageId: string) => void;

  /**
   * Start a new photo-batch thread entry with its first shot. Called once
   * per camera-open session, on the FIRST shutter press — every press after
   * that within the same session calls `appendPhotoShot` instead. Which of
   * the two to call is the caller's decision (see photoCapture.ts); this
   * store has no notion of "session" to infer it from.
   */
  addPhotoBatch: (batchId: string, firstShot: PhotoShot) => void;
  /** Second (or third...) shutter press in an already-open batch. A no-op,
   *  loudly (`console.warn`), if `batchId` doesn't match an existing entry —
   *  that would mean a caller bug (a shot trying to join a batch that was
   *  never started), not a real runtime state to silently swallow. */
  appendPhotoShot: (batchId: string, shot: PhotoShot) => void;
  /** Patch one shot in place by `localId` — how an upload resolves (success,
   *  failure, or the transition into "held") without disturbing the other
   *  shots in the same batch or the batch's position in the thread. */
  updatePhotoShot: (batchId: string, localShotId: string, patch: Partial<PhotoShot>) => void;
  /**
   * Undo, IF the 10s window (from the batch's first shot) hasn't closed.
   * Returns whether it actually applied — the caller (PhotoMessage) uses
   * that to know whether to show any feedback, and it's what makes this
   * genuinely unit-testable: call it with a mocked `nowMs` past the window
   * and assert it returns false and leaves the batch alone.
   */
  undoPhotoBatch: (batchId: string, nowMs?: number) => boolean;
}

function entry(text: string, speaker: ThreadCapture["speaker"]): ThreadCapture {
  return { id: Crypto.randomUUID(), text, createdAt: new Date().toISOString(), speaker };
}

export const useThreadStore = create<ThreadState>()((set, get) => ({
  captures: [],
  addCapture: (text) =>
    set((state) => ({ captures: [...state.captures, entry(text, "user")] })),
  addFennocLine: (text) =>
    set((state) => ({ captures: [...state.captures, entry(text, "fennoc")] })),
  addAgentPending: (messageId) =>
    set((state) => ({
      captures: [
        ...state.captures,
        {
          ...entry("", "fennoc"),
          agent: { messageId, state: "thinking", body: null, actions: null },
        },
      ],
    })),
  resolveAgent: (messageId, result) =>
    set((state) => ({
      captures: state.captures.map((c) =>
        c.agent?.messageId === messageId
          ? {
              ...c,
              text: result.text,
              agent: {
                ...c.agent,
                body: result.body,
                state: result.state,
                actions: result.actions ?? null,
              },
            }
          : c,
      ),
    })),
  replyingTo: null,
  setReplyingTo: (value) => set({ replyingTo: value }),

  receiptExpanded: {},
  toggleReceiptExpanded: (messageId) =>
    set((state) => ({
      receiptExpanded: {
        ...state.receiptExpanded,
        [messageId]: !state.receiptExpanded[messageId],
      },
    })),

  addPhotoBatch: (batchId, firstShot) =>
    set((state) => {
      const createdAtMs = Date.now();
      const capture: ThreadCapture = {
        id: Crypto.randomUUID(),
        // The visible text for a photo entry is entirely derived from
        // `photo.shots` at render time (ThreadScreen / PhotoMessage) — this
        // field exists on every ThreadCapture but is deliberately unused for
        // photo entries rather than kept in sync with the shots array twice.
        text: "",
        createdAt: new Date(createdAtMs).toISOString(),
        speaker: "fennoc",
        photo: { batchId, shots: [firstShot], createdAtMs, undone: false },
      };
      return { captures: [...state.captures, capture] };
    }),

  appendPhotoShot: (batchId, shot) =>
    set((state) => {
      const target = state.captures.find((c) => c.photo?.batchId === batchId);
      if (!target?.photo) {
        // A shot arrived for a batch this store never started — a caller
        // bug (see the interface comment above), not a state this store
        // should paper over by silently starting a new batch on the shot's
        // behalf, since that would defeat the "one message" rule it's
        // trying to keep.
        console.warn("[thread] appendPhotoShot: no batch", batchId);
        return state;
      }
      return {
        captures: state.captures.map((c) =>
          c.photo?.batchId === batchId
            ? { ...c, photo: { ...c.photo, shots: [...c.photo.shots, shot] } }
            : c,
        ),
      };
    }),

  updatePhotoShot: (batchId, localShotId, patch) =>
    set((state) => ({
      captures: state.captures.map((c) => {
        if (c.photo?.batchId !== batchId) return c;
        return {
          ...c,
          photo: {
            ...c.photo,
            shots: c.photo.shots.map((shot) =>
              shot.localId === localShotId ? { ...shot, ...patch } : shot,
            ),
          },
        };
      }),
    })),

  undoPhotoBatch: (batchId, nowMs = Date.now()) => {
    const batch = get().captures.find((c) => c.photo?.batchId === batchId)?.photo;
    if (!batch || !isPhotoUndoAvailable(batch.createdAtMs, nowMs)) return false;
    set((state) => ({
      captures: state.captures.map((c) =>
        c.photo?.batchId === batchId ? { ...c, photo: { ...c.photo, undone: true } } : c,
      ),
    }));
    return true;
  },
}));

function isLocalToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * Today's captures only — see the bounded-to-today note above.
 *
 * The selector returns the raw array (a stable reference) and the filtering
 * happens in `useMemo`. Filtering *inside* the selector allocates a new array
 * on every store read, and zustand compares results with `Object.is`, so every
 * read looks like a change — which renders, which reads, which renders. That
 * is a "Maximum update depth exceeded" crash, and `tsc` cannot see it.
 */
export function useTodayCaptures(): ThreadCapture[] {
  const captures = useThreadStore((s) => s.captures);
  return useMemo(
    () =>
      captures.filter(
        (c) => isLocalToday(c.createdAt) && !c.photo?.undone,
      ),
    [captures],
  );
}

/**
 * Route a finished shot's result back into the thread.
 *
 * Called from two different places, deliberately treated identically here:
 * the immediate online upload (photoCapture.ts's `captureShot`, same
 * session, the batch is definitely still around) and the outbox draining a
 * HELD shot (src/outbox's `image_upload` case) — which can happen much
 * later, potentially after an app restart. `useThreadStore` is intentionally
 * session-local and unpersisted (see the file header), so a restart wipes
 * the batch this shot belongs to. When that's happened there is nothing to
 * attach the result to, so it surfaces as a fresh, ungrouped Fennoc line
 * instead of being silently swallowed — "goes when you're back" has to mean
 * something even after the app itself has been relaunched in the meantime.
 */
export function deliverPhotoShotResult(
  batchId: string,
  localShotId: string,
  result: { imageId: string; extractedText: string },
): void {
  const store = useThreadStore.getState();
  const capture = store.captures.find((c) => c.photo?.batchId === batchId);
  if (capture?.photo) {
    store.updatePhotoShot(batchId, localShotId, {
      state: "done",
      imageId: result.imageId,
      extractedText: result.extractedText,
      localUri: null,
    });
    if (capture.photo.undone) {
      // The shot was still in flight (uploading, or draining from the
      // outbox) at the exact moment Undo was tapped — too late for
      // ThreadScreen's onUndoPhoto (which only sees shots already in
      // `"done"` state when it fires deleteSentUploadsForBatch /
      // cancelHeldUploadsForBatch). This delivery is the first moment this
      // shot IS the already-sent case Undo is supposed to cover, so the
      // server-side cleanup happens right here instead of never happening
      // at all. Best-effort, like every other delete on this path — logged
      // loudly on failure, never swallowed; there's no UI surface to warn
      // on since the batch is already hidden.
      deleteImage(result.imageId).catch((error: unknown) => {
        console.error(
          "[thread] Undo (late-arriving upload): server-side image delete failed — the extracted-text row may still exist",
          result.imageId,
          formatApiError(error),
        );
      });
    }
    return;
  }
  store.addFennocLine(result.extractedText);
}

/** The failure twin of `deliverPhotoShotResult` — see its comment for why
 *  both branches exist. `text` should already be the one-line, no-retry
 *  copy the design calls for (Step 11's "Reading" rules); this function
 *  doesn't compose it, only routes it. */
export function deliverPhotoShotError(batchId: string, localShotId: string, text: string): void {
  const store = useThreadStore.getState();
  const stillOpen = store.captures.some((c) => c.photo?.batchId === batchId);
  if (stillOpen) {
    store.updatePhotoShot(batchId, localShotId, { state: "error", errorText: text });
    return;
  }
  store.addFennocLine(text);
}
