import { create } from "zustand";

/**
 * In-app override for reduced motion, layered on top of the OS-level
 * `AccessibilityInfo.isReduceMotionEnabled()` signal (see
 * `src/theme/motion.ts`'s `useReducedMotion`). Some people want reduced
 * motion who never set the OS flag — they don't know the setting exists, or
 * they're on a device where they can't touch system settings — so this
 * gives the app its own switch instead of only trusting the OS one.
 *
 * Deliberately tiny and unpersisted: a single boolean plus its setter. If a
 * durable per-device preference turns out to matter, add zustand's
 * `persist` middleware here the same way `src/store/useAuth.ts` does — do
 * not grow this store's shape beyond that without a reason.
 */
interface MotionPrefsState {
  reduceMotion: boolean;
  setReduceMotion: (value: boolean) => void;
}

export const useMotionPrefs = create<MotionPrefsState>()((set) => ({
  reduceMotion: false,
  setReduceMotion: (value) => set({ reduceMotion: value }),
}));
