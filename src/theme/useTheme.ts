import { vars } from "nativewind";
import { useColorScheme } from "react-native";

import { type ThemePreference, useAuth } from "../store/useAuth";
import { dayPalette, dayVars, nightPalette, nightVars, type Palette } from "./colors";

export type ActiveTheme = "night" | "day";

/**
 * Resolve a stored theme preference plus the OS colour scheme into the
 * theme that should actually render.
 *
 * Night is the default: an explicit "night" preference always wins, and so
 * does an indeterminate/unknown OS scheme (i.e. `useColorScheme()` returning
 * `null`/`undefined`) when the preference is "system". Day only renders for
 * an explicit "day" preference, or "system" while the OS reports "light".
 */
export function resolveActiveTheme(
  preference: ThemePreference,
  systemScheme: ReturnType<typeof useColorScheme>,
): ActiveTheme {
  if (preference === "day") return "day";
  if (preference === "night") return "night";
  // preference === "system"
  return systemScheme === "light" ? "day" : "night";
}

export interface UseThemeResult {
  /** The raw stored preference ("night" | "day" | "system"). */
  preference: ThemePreference;
  /** The theme that should actually be rendered right now. */
  active: ActiveTheme;
  isDay: boolean;
  isNight: boolean;
  /** Resolved colour palette for the active theme. */
  palette: Palette;
  /**
   * NativeWind `vars()` style object for the active theme's CSS custom
   * properties (`--color-bg-base`, `--color-ink`, etc — see
   * src/theme/tokens.js). Apply it to a `style` prop on a root-level `View`
   * (see App.tsx) and every descendant using `bg-bg-base`, `text-ink`,
   * `bg-sand`, etc. re-themes automatically — no per-element theme
   * awareness needed. Switching the active theme just swaps which vars()
   * object is applied at the root.
   */
  themeVars: ReturnType<typeof vars>;
  /** `expo-status-bar` style that keeps status bar content legible. */
  statusBarStyle: "light" | "dark";
}

export function useTheme(): UseThemeResult {
  const preference = useAuth((s) => s.theme);
  const systemScheme = useColorScheme();
  const active = resolveActiveTheme(preference, systemScheme);
  const isDay = active === "day";

  return {
    preference,
    active,
    isDay,
    isNight: !isDay,
    palette: isDay ? dayPalette : nightPalette,
    themeVars: vars(isDay ? dayVars : nightVars),
    // Light content (white-ish icons/text) reads on the near-black night
    // palette; dark content reads on the light day palette.
    statusBarStyle: isDay ? "dark" : "light",
  };
}
