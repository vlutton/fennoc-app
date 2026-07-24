import * as Network from "expo-network";
import { useEffect, useRef } from "react";

import { drain } from "../outbox";

/**
 * Subscribe to connectivity and drain the outbox on reconnect.
 * Fire-and-forget — never blocks initial render.
 */
export function useOutboxBootstrap(): void {
  const wasOnline = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tryDrain = (reason: string) => {
      if (cancelled) return;
      console.warn("[outbox] drain trigger:", reason);
      void drain().catch((error) => {
        console.warn("[outbox] drain failed", error);
      });
    };

    // Drain once on mount (persisted items from a prior offline session).
    tryDrain("mount");

    void Network.getNetworkStateAsync()
      .then((state) => {
        wasOnline.current = state.isConnected !== false;
      })
      .catch(() => {
        // ignore — listener still covers transitions
      });

    const sub = Network.addNetworkStateListener((state) => {
      const online = state.isConnected !== false;
      const prev = wasOnline.current;
      wasOnline.current = online;
      if (online && prev === false) {
        tryDrain("online");
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
}
