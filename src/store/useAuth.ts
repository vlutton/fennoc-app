import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const API_KEY_STORAGE_KEY = "fennoc-api-key";
const DEFAULT_BASE_URL =
  "https://vinces-macbook-air.tail46861b.ts.net:8643";
const DEFAULT_USER_ID = "vince";

export type ThemePreference = "light" | "dark" | "system";

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
      theme: "system",
      hydrated: false,
      setBaseUrl: (baseUrl) => set({ baseUrl }),
      setUserId: (userId) => set({ userId }),
      setTheme: (theme) => set({ theme }),
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: "fennoc-auth",
      storage: createJSONStorage(() => AsyncStorage),
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
