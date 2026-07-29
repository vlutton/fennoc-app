import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { Easing } from "react-native-reanimated";

import { useMotionPrefs } from "../store/useMotionPrefs";

/**
 * Motion tokens — durations and curves — for the interactions specced in
 * the design handoff's motion table. This is the reanimated/JS side of the
 * SAME tokens `tailwind.config.js`'s `theme.extend.transitionDuration` /
 * `transitionTimingFunction` blocks encode for the (currently unused on
 * native, but kept in sync) CSS side. If a duration or curve changes here,
 * change it there too, and vice versa — they must never drift apart.
 */

// --- Durations (ms) --------------------------------------------------------

/** `state.tick` — checkbox fill. */
export const STATE_TICK = 120;
/** `state.settle` — row in/out, opacity + 4px Y (reduced twin: opacity only). */
export const STATE_SETTLE = 180;
/** `presence.think` — three-column loop period (reduced twin: no loop). */
export const PRESENCE_THINK = 1400;
/** `presence.think` — per-column stagger. */
export const PRESENCE_THINK_STAGGER = 160;
/** `sheet.rise` — translateY 100%→0 (reduced twin: 160ms fade, no translate). */
export const SHEET_RISE = 320;

// --- Curves -----------------------------------------------------------------
//
// Exact control points from tailwind.config.js's `transitionTimingFunction`
// (`quiet` / `settle` / `lift`). Exported as factories, not shared constant
// instances — `Easing.bezier(...)` is called fresh per animation so nothing
// here is a mutable object multiple concurrent animations could stomp on.

/** `quiet` — cubic-bezier(0.2, 0, 0, 1). Checkbox fill, row in/out. */
export function quietEasing() {
  return Easing.bezier(0.2, 0, 0, 1);
}

/** `settle` — cubic-bezier(0.4, 0, 0.2, 1). `presence.think`'s column loop. */
export function settleEasing() {
  return Easing.bezier(0.4, 0, 0.2, 1);
}

/** `lift` — cubic-bezier(0.16, 1, 0.3, 1). Sheet rise. */
export function liftEasing() {
  return Easing.bezier(0.16, 1, 0.3, 1);
}

/**
 * Whether motion should be reduced right now: the OS's
 * `AccessibilityInfo.isReduceMotionEnabled()` signal, ORed with the in-app
 * override in `src/store/useMotionPrefs.ts`.
 *
 * The in-app override exists because "reduced motion" isn't only an OS
 * setting some people have already found and enabled — some people want it
 * who never set the OS flag (don't know it exists, or can't reach system
 * settings on this device), so the app offers its own switch on top of, not
 * instead of, the OS one.
 *
 * Per the design handoff: "Reduced motion is not 'off.' Every twin
 * preserves the information and drops only the travel." Callers use this to
 * choose the reduced twin, never to skip an interaction outright.
 */
export function useReducedMotion(): boolean {
  const override = useMotionPrefs((s) => s.reduceMotion);
  const [osReduceMotion, setOsReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setOsReduceMotion(value);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setOsReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return osReduceMotion || override;
}
