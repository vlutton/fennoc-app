// Single canonical source for the Fennoc colour tokens.
//
// This is plain CommonJS (not TypeScript) on purpose: `tailwind.config.js`
// is loaded directly by Node (via Metro's config loader), and this file is
// also imported at runtime by `colors.ts` inside the app bundle. Keeping it
// as a dependency-free data literal means both consumers can `require`/
// `import` it safely — unlike importing `tailwind.config.js` itself, which
// pulls in `nativewind/preset` (postcss, tailwindcss internals) that are
// build-tool-only and must never end up in the React Native bundle.
//
// Values copied verbatim from design_handoff_fennoc/README.md `## Design
// tokens`, with the Fennoc Photo Capture.dc.html Step 18 token delta
// (2026-07-31) layered on top — eight hex values warmed a few degrees plus
// the new `mark` token (see the Step 18 spec's `1 · Token delta` table). Do
// not hand-edit a hex here without updating the source doc.
const colors = {
  bg: { base: "#120E0A", raised: "#1C1611", overlay: "#241D16", float: "#241E19" },
  line: { hairline: "#2E2620", strong: "#3F352C" },
  ink: { DEFAULT: "#F2EAE0", secondary: "#BFB2A4", muted: "#94887A", disabled: "#5C544D" },
  signal: { DEFAULT: "#F0A93B", on: "#1A1206", wash: "#2A2114" },
  // Warm-neutral, in-app-only rendering of the mark ("mark/ui" per the
  // handoff — distinct from "mark/brand", the full-amber app icon/launch/
  // onboarding/App Store version, which stays `signal`'s #F0A93B and lives
  // only in un-themeable assets: app.json, android/, assets/). Step 18 §3,
  // "Loud at the door, quiet in the room."
  mark: "#C6A98A",
  positive: "#8FA167",
  clay: "#A8705A",
  alert: "#D4674A",
  day: {
    base: "#F7F1E8", raised: "#FFFCF7", overlay: "#FFFFFF",
    hairline: "#E4DACB", strong: "#CFC2AE",
    ink: "#1A1613", inkSecondary: "#57504A", inkMuted: "#7A7168",
    signal: "#9A5B00", signalWash: "#F7E4C4",
    positive: "#4E5C2E", clay: "#8A5342", alert: "#A33A1C",
    // The four fields below have no day-mode value in design_handoff's
    // README (or, for `mark`, in the Step 18 spec, which only gives the
    // night value). `float` and `signalOn` are still unused today (no
    // `bg-bg-float` / `bg-signal-on` classNames exist anywhere) and only
    // defined here so every CSS variable tailwind.config.js references has
    // SOME day-mode value once vars() swaps the palette. `inkDisabled` IS
    // surfaced now — colors.ts's `Palette.ink.disabled` reads it, for
    // FennocMark's `presence.think` third column (INT-025's motion spec).
    // If `float` or `signalOn` become load-bearing too, replace these with
    // real design values the same way.
    float: "#FFFFFF", // day's overlay is already pure white; float can't go lighter
    inkDisabled: "#9A8F82", // fainter than inkMuted, same direction as night's ratio
    signalOn: "#FFFCF7", // day's signal is a dark amber (unlike night's bright one) — needs light "on" text, not dark
    // NEEDS DESIGN PASS: no day-mode `mark` value shipped in Step 18 (the
    // spec's token-delta table only gives the night hex, "in-app only").
    // Derived rather than guessed flat: night's mark (#C6A98A) sits lighter
    // and warmer than night's ink.muted (#94887A) by a fixed per-channel
    // ratio (~1.34x R, ~1.24x G, ~1.13x B); applied that same ratio to day's
    // inkMuted (#7A7168) to keep the mark's relative "warm but quiet"
    // position consistent across themes. Flag for a real design value
    // before this ships to day-mode users.
    mark: "#A38D76",
  },
};

// Space-separated "R G B" triple, the format `vars()` / the generated
// `rgb(var(--x) / <alpha-value>)` Tailwind colours expect (no `rgb()`
// wrapper, no commas).
function hexToRgbTriple(hex) {
  const value = hex.replace("#", "");
  const r = parseInt(value.substring(0, 2), 16);
  const g = parseInt(value.substring(2, 4), 16);
  const b = parseInt(value.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

// Canonical map from each token's semantic path to the CSS custom property
// name both tailwind.config.js (building `rgb(var(--x) / <alpha-value>)`
// colours) and the runtime `vars()` call (src/theme/colors.ts /
// src/theme/useTheme.ts) reference. Defined once here so the two can never
// drift out of sync.
const cssVarNames = {
  bg: {
    base: "--color-bg-base",
    raised: "--color-bg-raised",
    overlay: "--color-bg-overlay",
    float: "--color-bg-float",
  },
  line: {
    hairline: "--color-line-hairline",
    strong: "--color-line-strong",
  },
  ink: {
    DEFAULT: "--color-ink",
    secondary: "--color-ink-secondary",
    muted: "--color-ink-muted",
    disabled: "--color-ink-disabled",
  },
  signal: {
    DEFAULT: "--color-signal",
    on: "--color-signal-on",
    wash: "--color-signal-wash",
  },
  positive: "--color-positive",
  clay: "--color-clay",
  alert: "--color-alert",
  mark: "--color-mark",
};

function buildVars(palette) {
  return {
    [cssVarNames.bg.base]: hexToRgbTriple(palette.bg.base),
    [cssVarNames.bg.raised]: hexToRgbTriple(palette.bg.raised),
    [cssVarNames.bg.overlay]: hexToRgbTriple(palette.bg.overlay),
    [cssVarNames.bg.float]: hexToRgbTriple(palette.bg.float),
    [cssVarNames.line.hairline]: hexToRgbTriple(palette.line.hairline),
    [cssVarNames.line.strong]: hexToRgbTriple(palette.line.strong),
    [cssVarNames.ink.DEFAULT]: hexToRgbTriple(palette.ink.DEFAULT),
    [cssVarNames.ink.secondary]: hexToRgbTriple(palette.ink.secondary),
    [cssVarNames.ink.muted]: hexToRgbTriple(palette.ink.muted),
    [cssVarNames.ink.disabled]: hexToRgbTriple(palette.ink.disabled),
    [cssVarNames.signal.DEFAULT]: hexToRgbTriple(palette.signal.DEFAULT),
    [cssVarNames.signal.on]: hexToRgbTriple(palette.signal.on),
    [cssVarNames.signal.wash]: hexToRgbTriple(palette.signal.wash),
    [cssVarNames.positive]: hexToRgbTriple(palette.positive),
    [cssVarNames.clay]: hexToRgbTriple(palette.clay),
    [cssVarNames.alert]: hexToRgbTriple(palette.alert),
    [cssVarNames.mark]: hexToRgbTriple(palette.mark),
  };
}

// Space-separated RGB triples for each theme, ready to spread into
// NativeWind's `vars()` at the app root (see src/theme/useTheme.ts).
const nightVars = buildVars({
  bg: colors.bg,
  line: colors.line,
  ink: colors.ink,
  signal: colors.signal,
  positive: colors.positive,
  clay: colors.clay,
  alert: colors.alert,
  mark: colors.mark,
});

const dayVars = buildVars({
  bg: { base: colors.day.base, raised: colors.day.raised, overlay: colors.day.overlay, float: colors.day.float },
  line: { hairline: colors.day.hairline, strong: colors.day.strong },
  ink: {
    DEFAULT: colors.day.ink,
    secondary: colors.day.inkSecondary,
    muted: colors.day.inkMuted,
    disabled: colors.day.inkDisabled,
  },
  signal: { DEFAULT: colors.day.signal, on: colors.day.signalOn, wash: colors.day.signalWash },
  positive: colors.day.positive,
  clay: colors.day.clay,
  alert: colors.day.alert,
  mark: colors.day.mark,
});

module.exports = { colors, cssVarNames, nightVars, dayVars };
