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
  | "time_stop";

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
