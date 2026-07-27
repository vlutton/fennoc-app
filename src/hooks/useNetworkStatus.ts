import * as Network from "expo-network";
import { useEffect, useState } from "react";

/**
 * Live device connectivity, mirrored from `expo-network`. Distinct from the
 * outbox's pending-item count (`useOutboxStatus`): this reflects the
 * OS-reported link state, used by the status strip's connection slot to
 * distinguish OFFLINE (no link) from N HELD (link present, items queued —
 * e.g. the API host is unreachable over Tailscale).
 */
export function useNetworkStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void Network.getNetworkStateAsync()
      .then((state) => {
        if (!cancelled) setIsOnline(state.isConnected !== false);
      })
      .catch(() => {
        // ignore — listener still covers transitions
      });

    const sub = Network.addNetworkStateListener((state) => {
      setIsOnline(state.isConnected !== false);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return isOnline;
}
