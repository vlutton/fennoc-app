import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { DEFAULT_BASE_URL, migrateBaseUrl } from "./baseUrl";

const API_KEY_STORAGE_KEY = "fennoc-api-key";
const DEFAULT_USER_ID = "vince";

export type ThemePreference = "night" | "day" | "system";

/**
 * Older installs persisted `theme` as "light" | "dark" | "system" (the
 * values were renamed to match the design's night/day vocabulary). Normalize
 * anything else unrecognized to "system" too, so a corrupt/future value
 * never crashes the app on launch.
 */
function normalizeThemePreference(value: unknown): ThemePreference {
  if (value === "night" || value === "day" || value === "system") {
    return value;
  }
  if (value === "dark") return "night";
  if (value === "light") return "day";
  return "system";
}

interface AuthState {
  baseUrl: string;
  userId: string;
  theme: ThemePreference;
  hydrated: boolean;
  setBaseUrl: (url: string) => void;
  setUserId: (userId: string) => void;
  setTheme: (theme: ThemePreference) => void;
  setHydrated: (value: boolean) => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      baseUrl: DEFAULT_BASE_URL,
      userId: DEFAULT_USER_ID,
      // Night is the product default, not "follow the OS". Verified on an
      // Android 15 emulator: with "system" here, a fresh install on a
      // light-mode device renders the day palette, which is the opposite of
      // the intended first impression. "system" and "day" remain options in
      // Settings; they are just not the default.
      theme: "night",
      hydrated: false,
      setBaseUrl: (baseUrl) => set({ baseUrl }),
      setUserId: (userId) => set({ userId }),
      setTheme: (theme) => set({ theme }),
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: "fennoc-auth",
      storage: createJSONStorage(() => AsyncStorage),
      // v2 (2026-08-02): the server moved off the operator's laptop onto
      // `api.fennoc.com` (INT-058 inc. 0). `baseUrl` is in `partialize`
      // below, so it is persisted — which means changing `DEFAULT_BASE_URL`
      // alone does NOTHING to an install that has already rehydrated once.
      // Only a version bump runs `migrate`, and only `migrate` can move an
      // existing phone off the dead Tailscale host. That is the whole reason
      // this number changed.
      version: 2,
      // Runs for any install persisted at a lower version: v0/v1 theme values
      // ("light" | "dark"), and v1's Tailscale base URL. Written to be
      // version-agnostic rather than a switch on the incoming version —
      // every field is normalized unconditionally and every normalizer is
      // idempotent, so this is correct from any prior version and safe if it
      // somehow runs twice. Always returns a fully-populated shape so a
      // missing/garbled field can't crash rehydration.
      migrate: (persistedState) => {
        const state = (persistedState ?? {}) as Partial<{
          baseUrl: string;
          userId: string;
          theme: unknown;
        }>;
        return {
          baseUrl: migrateBaseUrl(state.baseUrl),
          userId: state.userId ?? DEFAULT_USER_ID,
          theme: normalizeThemePreference(state.theme),
        };
      },
      partialize: (state) => ({
        baseUrl: state.baseUrl,
        userId: state.userId,
        theme: state.theme,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.warn("fennoc-auth rehydrate failed", error);
        }
        useAuth.setState({ hydrated: true });
        // keep state reference used so eslint/ts don't complain if unused
        void state;
      },
    },
  ),
);

// Cover the already-hydrated case (e.g. fast reload).
if (useAuth.persist.hasHydrated()) {
  useAuth.setState({ hydrated: true });
} else {
  useAuth.persist.onFinishHydration(() => {
    useAuth.setState({ hydrated: true });
  });
}

export async function getKey(): Promise<string | null> {
  return SecureStore.getItemAsync(API_KEY_STORAGE_KEY);
}

export async function setKey(value: string): Promise<void> {
  if (!value) {
    await SecureStore.deleteItemAsync(API_KEY_STORAGE_KEY);
    return;
  }
  await SecureStore.setItemAsync(API_KEY_STORAGE_KEY, value);
}

export const authDefaults = {
  baseUrl: DEFAULT_BASE_URL,
  userId: DEFAULT_USER_ID,
} as const;
