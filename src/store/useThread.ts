import * as Crypto from "expo-crypto";
import { useMemo } from "react";
import { create } from "zustand";

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
  };
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
    result: { text: string; body: string | null; state: "done" | "error" },
  ) => void;
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
  addAgentPending: (messageId) =>
    set((state) => ({
      captures: [
        ...state.captures,
        {
          ...entry("", "fennoc"),
          agent: { messageId, state: "thinking", body: null },
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
              agent: { ...c.agent, body: result.body, state: result.state },
            }
          : c,
      ),
    })),
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
