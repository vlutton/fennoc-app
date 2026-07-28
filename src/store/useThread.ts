import * as Crypto from "expo-crypto";
import { useMemo } from "react";
import { create } from "zustand";

/**
 * Session-local record of user captures, used only to render the user's
 * own bubbles back into the thread scroll (INT-023b).
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
 * bounded-to-today behaviour — that would change what this is.
 */
export interface ThreadCapture {
  id: string;
  text: string;
  createdAt: string; // ISO 8601
  /** Who said it. Fennoc speaks unboxed; the user speaks in a bubble. */
  speaker: "user" | "fennoc";
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
}

function entry(text: string, speaker: ThreadCapture["speaker"]): ThreadCapture {
  return { id: Crypto.randomUUID(), text, createdAt: new Date().toISOString(), speaker };
}

export const useThreadStore = create<ThreadState>()((set) => ({
  captures: [],
  addCapture: (text) =>
    set((state) => ({ captures: [...state.captures, entry(text, "user")] })),
  addFennocLine: (text) =>
    set((state) => ({ captures: [...state.captures, entry(text, "fennoc")] })),
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
  return useMemo(() => captures.filter((c) => isLocalToday(c.createdAt)), [captures]);
}
