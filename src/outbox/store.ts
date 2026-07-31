import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type OutboxKind =
  | "complete"
  | "drop"
  | "capture"
  | "checkin_reply"
  | "time_start"
  | "time_stop"
  // A held photo (Step 11's "Kept on device · goes when you're back") — the
  // capture hot path's offline path, reusing this same queue rather than a
  // parallel one. See src/capture/photoCapture.ts for where these get
  // enqueued, and the `image_upload` case in ./index.ts's `replayItem` for
  // what draining one actually does.
  | "image_upload";

export type OutboxStatus = "pending" | "inflight" | "done" | "dropped";

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  payload: Record<string, unknown>;
  idempotency_key?: string;
  status: OutboxStatus;
  attempts: number;
  last_error?: string;
  created_at: string;
}

export type EnqueueInput = {
  kind: OutboxKind;
  payload: Record<string, unknown>;
  idempotency_key?: string;
};

interface OutboxState {
  items: OutboxItem[];
  draining: boolean;
  enqueue: (item: EnqueueInput) => string;
  markInflight: (id: string) => void;
  markDone: (id: string) => void;
  markDropped: (id: string, error?: string) => void;
  bumpAttempt: (id: string, error: string) => void;
  setDraining: (value: boolean) => void;
  resetInflightToPending: () => void;
  /**
   * Drop an item outright, with no `dropped`-status trace left behind —
   * unlike `markDropped`, which is for a delivery that was ATTEMPTED and
   * failed permanently. The one caller today (`cancelHeldUploadsForBatch`,
   * src/outbox/index.ts) is for a held photo whose SEND was taken back via
   * Undo before it ever left the device: there was no attempt, so there's
   * nothing to record — the item should look like it never happened.
   */
  removeItem: (id: string) => void;
}

const MAX_ATTEMPTS = 5;

export const useOutboxStore = create<OutboxState>()(
  persist(
    (set, get) => ({
      items: [],
      draining: false,

      enqueue: (input) => {
        const id = Crypto.randomUUID();
        const item: OutboxItem = {
          id,
          kind: input.kind,
          payload: input.payload,
          idempotency_key: input.idempotency_key,
          status: "pending",
          attempts: 0,
          created_at: new Date().toISOString(),
        };
        set((state) => ({ items: [...state.items, item] }));
        console.warn("[outbox] enqueued", item.kind, id);
        return id;
      },

      markInflight: (id) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, status: "inflight" as const } : item,
          ),
        }));
      },

      markDone: (id) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, status: "done" as const } : item,
          ),
        }));
      },

      markDropped: (id, error) => {
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "dropped" as const,
                  last_error: error ?? item.last_error,
                }
              : item,
          ),
        }));
      },

      bumpAttempt: (id, error) => {
        const current = get().items.find((item) => item.id === id);
        if (!current) return;
        const attempts = current.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          get().markDropped(id, error || "exhausted retries");
          return;
        }
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "pending" as const,
                  attempts,
                  last_error: error,
                }
              : item,
          ),
        }));
      },

      removeItem: (id) => {
        set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
      },

      setDraining: (value) => set({ draining: value }),

      resetInflightToPending: () => {
        set((state) => ({
          items: state.items.map((item) =>
            item.status === "inflight"
              ? { ...item, status: "pending" as const }
              : item,
          ),
        }));
      },
    }),
    {
      name: "fennoc-outbox",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ items: state.items }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn("[outbox] rehydrate failed", error);
          return;
        }
        // Crash-mid-flight: reset inflight → pending so they retry on next drain.
        state?.resetInflightToPending();
      },
    },
  ),
);

export { MAX_ATTEMPTS };
