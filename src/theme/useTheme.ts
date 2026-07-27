import { useColorScheme } from "react-native";

import { type ThemePreference, useAuth } from "../store/useAuth";
import { dayPalette, nightPalette, type Palette } from "./colors";

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
   * Pick between a night-palette Tailwind className and its day-palette
   * counterpart based on the active theme, e.g.
   * `themeClass("bg-bg-base", "bg-day-base")`.
   *
   * This — plain conditional classNames — is how night/day switching is
   * wired, rather than Tailwind's `dark:` variant. On native, NativeWind's
   * dark mode is a binary flag bound to `Appearance.setColorScheme` (a
   * global, per-app OS override), not an arbitrary class-name matcher — that
   * only works that way on web. Forcing it would also be semantically
   * inverted here (night, not light, is our default) and would clobber our
   * own read of the true system scheme for the "system" preference.
   */
  themeClass: (nightClassName: string, dayClassName: string) => string;
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
    themeClass: (nightClassName, dayClassName) =>
      isDay ? dayClassName : nightClassName,
    // Light content (white-ish icons/text) reads on the near-black night
    // palette; dark content reads on the light day palette.
    statusBarStyle: isDay ? "dark" : "light",
  };
}
