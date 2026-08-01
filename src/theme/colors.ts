// Derives typed colour data from the single canonical source,
// `src/theme/tokens.js` — the same file `tailwind.config.js` requires to
// build the Tailwind theme. There is exactly one place these hex values are
// authored; nothing here re-declares a colour.
//
// (We import `tokens.js` rather than `tailwind.config.js` itself: the config
// file's `presets: [require("nativewind/preset")]` pulls in postcss/
// tailwindcss internals meant for the build toolchain, not the RN runtime
// bundle. `tokens.js` is dependency-free data, safe to import from app code.)
import tokens from "./tokens";

export type NightColors = typeof tokens.colors;
export type DayColors = NightColors["day"];

/**
 * Space-separated "R G B" triples keyed by CSS custom property name (e.g.
 * `--color-bg-base`), one map per theme. Feed either straight into
 * NativeWind's `vars()` to produce the style object `useTheme()` returns as
 * `themeVars` — see src/theme/useTheme.ts. Precomputed once in tokens.js so
 * this file and tailwind.config.js can never reference different variable
 * names for the same token.
 */
export const nightVars: Record<string, string> = tokens.nightVars;
export const dayVars: Record<string, string> = tokens.dayVars;

/** Raw token object, shaped exactly like `tailwind.config.js`'s theme.extend.colors. */
export const rawTokens = tokens.colors;

/** A palette shape shared by both night and day, for theme-aware consumers. */
export interface Palette {
  bg: { base: string; raised: string; overlay: string };
  line: { hairline: string; strong: string };
  ink: { DEFAULT: string; secondary: string; muted: string; disabled: string };
  signal: { DEFAULT: string; wash: string };
  positive: string;
  clay: string;
  alert: string;
  /** Warm-neutral, in-app-only rendering of the mark ("mark/ui" — see tokens.js). */
  mark: string;
}

export const nightPalette: Palette = {
  bg: {
    base: rawTokens.bg.base,
    raised: rawTokens.bg.raised,
    overlay: rawTokens.bg.overlay,
  },
  line: {
    hairline: rawTokens.line.hairline,
    strong: rawTokens.line.strong,
  },
  ink: {
    DEFAULT: rawTokens.ink.DEFAULT,
    secondary: rawTokens.ink.secondary,
    muted: rawTokens.ink.muted,
    disabled: rawTokens.ink.disabled,
  },
  signal: {
    DEFAULT: rawTokens.signal.DEFAULT,
    wash: rawTokens.signal.wash,
  },
  positive: rawTokens.positive,
  clay: rawTokens.clay,
  alert: rawTokens.alert,
  mark: rawTokens.mark,
};

export const dayPalette: Palette = {
  bg: {
    base: rawTokens.day.base,
    raised: rawTokens.day.raised,
    overlay: rawTokens.day.overlay,
  },
  line: {
    hairline: rawTokens.day.hairline,
    strong: rawTokens.day.strong,
  },
  ink: {
    DEFAULT: rawTokens.day.ink,
    secondary: rawTokens.day.inkSecondary,
    muted: rawTokens.day.inkMuted,
    disabled: rawTokens.day.inkDisabled,
  },
  signal: {
    DEFAULT: rawTokens.day.signal,
    wash: rawTokens.day.signalWash,
  },
  positive: rawTokens.day.positive,
  clay: rawTokens.day.clay,
  alert: rawTokens.day.alert,
  mark: rawTokens.day.mark,
};

// --- Legacy compatibility shim -------------------------------------------
//
// Existing call sites (App.tsx tab bar styles, several screens/components)
// import `colors` and read `.sand` / `.terracotta` / `.olive` / `.cream` as
// flat hex strings for native style props (StyleSheet, icon `color` props),
// not Tailwind classNames. Those brand names are deliberately absent from
// the new token set (see tailwind.config.js / design notes: no sand/
// terracotta/cream/olive tokens). This shim keeps the same import shape so
// those call sites keep compiling, sourced from the new token set instead of
// duplicated hex literals. It is intentionally static (night palette only) —
// these call sites aren't wired to the theme toggle; that lands when the
// screens themselves are redesigned (INT-023/024). App.tsx's actual
// theme-reactive chrome (tab bar, root background, StatusBar) uses
// `useTheme()` / `nightPalette` / `dayPalette` above instead of this shim.
// Must match the legacy aliases in tailwind.config.js exactly — the same names
// are consumed both as classNames and as flat hex here, and if the two drift a
// component styled half by className and half by style prop gets two different
// colours. sand = page (bg.base), cream = card (bg.raised): in night mode
// elevation is lightness, so the card is the lighter of the two.
export const colors = {
  sand: nightPalette.bg.base,
  cream: nightPalette.bg.raised,
  olive: nightPalette.ink.DEFAULT,
  terracotta: nightPalette.clay,
} as const;

export type ColorName = keyof typeof colors;
