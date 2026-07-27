/** @type {import('tailwindcss').Config} */
const { cssVarNames } = require("./src/theme/tokens");

// `rgb(var(--x) / <alpha-value>)` is the NativeWind v4 pattern that lets a
// Tailwind colour stay driven by a CSS custom property (set at runtime via
// `vars()` — see src/theme/useTheme.ts / App.tsx) while still supporting
// Tailwind's alpha modifiers (`bg-bg-base/50`, etc).
const rgbVar = (name) => `rgb(var(${name}) / <alpha-value>)`;

module.exports = {
  content: ["./src/**/*.{ts,tsx,js,jsx}", "./App.tsx"],
  presets: [require("nativewind/preset")],
  // Deliberately NOT using Tailwind's `dark:` variant / `darkMode` config to
  // drive night vs day. On native, NativeWind's dark mode is not an
  // arbitrary class name matcher (that's web-only, via DOM selectors) — it's
  // a binary "light"/"dark" flag wired straight to React Native's
  // `Appearance.setColorScheme`, a *global, per-app OS-level override*.
  // Forcing that just to swap our in-app palette is both semantically
  // inverted (our default is "night"; Tailwind's unprefixed/dark: pairing
  // assumes "light" is the default) and would clobber our own ability to
  // read the true system scheme for the "system" preference afterwards.
  //
  // Theme switching is CSS-variable driven instead: every colour below
  // resolves through `rgb(var(--color-x) / <alpha-value>)`, and `useTheme()`
  // sets those variables' actual values once at the app root via
  // NativeWind's `vars()` (src/theme/useTheme.ts, App.tsx). Components never
  // branch on the active theme themselves — `bg-bg-base` / `text-ink` etc.
  // just re-resolve automatically when the root's vars() swap.
  theme: {
    extend: {
      colors: {
        bg: {
          base: rgbVar(cssVarNames.bg.base),
          raised: rgbVar(cssVarNames.bg.raised),
          overlay: rgbVar(cssVarNames.bg.overlay),
          float: rgbVar(cssVarNames.bg.float),
        },
        line: {
          hairline: rgbVar(cssVarNames.line.hairline),
          strong: rgbVar(cssVarNames.line.strong),
        },
        ink: {
          DEFAULT: rgbVar(cssVarNames.ink.DEFAULT),
          secondary: rgbVar(cssVarNames.ink.secondary),
          muted: rgbVar(cssVarNames.ink.muted),
          disabled: rgbVar(cssVarNames.ink.disabled),
        },
        signal: {
          DEFAULT: rgbVar(cssVarNames.signal.DEFAULT),
          on: rgbVar(cssVarNames.signal.on),
          wash: rgbVar(cssVarNames.signal.wash),
        },
        positive: rgbVar(cssVarNames.positive),
        clay: rgbVar(cssVarNames.clay),
        alert: rgbVar(cssVarNames.alert),

        // TRANSITIONAL — remove in INT-023/024 once the screens are rewritten.
        //
        // 182 classNames across 16 files still say bg-sand / text-olive /
        // bg-cream / text-terracotta. Dropping those token names without
        // aliasing them renders the whole app unstyled, and `tsc` cannot catch
        // it because Tailwind classes are just strings.
        //
        // Mapping follows the ORIGINAL semantics, not the name:
        //   sand       was the page background, inset rows and borders
        //   cream      was the card surface (lighter than sand)
        //   olive      was primary text
        //   terracotta was the accent
        // In night mode elevation is lightness, so the card must be LIGHTER
        // than the page: cream -> bg.raised, sand -> bg.base. Mapping these
        // the other way round inverts every card in the app.
        //
        // These reuse the SAME CSS variables as their target token above
        // (not new ones), so they stay theme-aware for free — no separate
        // day-mode value to keep in sync.
        sand: rgbVar(cssVarNames.bg.base),
        cream: rgbVar(cssVarNames.bg.raised),
        olive: rgbVar(cssVarNames.ink.DEFAULT),
        terracotta: rgbVar(cssVarNames.clay),
      },
      // Font weights and custom TrueType fonts don't reliably combine on
      // React Native: a single registered family name + a numeric
      // `fontWeight` style does not dependably select the matching weight
      // file (most documented on iOS; see expo-font / RN font-loading
      // guidance). So each weight is registered as its OWN family name in
      // App.tsx's `useFonts()` call, and gets its own `font-*` utility here.
      // `font-sans` / `font-mono` are just the regular (400) weight, applied
      // app-wide by Tailwind's base layer as the default. For any heavier
      // weight, the `fontWeight` set below in `fontSize` is NOT enough on
      // its own (Tailwind's fontSize plugin only ever emits font-weight, not
      // font-family, from that tuple) — pair the size class with the
      // matching `font-sans-medium` / `font-sans-semibold` / `font-mono-medium`
      // utility explicitly, e.g. `className="text-heading font-sans-semibold"`.
      fontFamily: {
        sans: ['InstrumentSans-400'],
        'sans-medium': ['InstrumentSans-500'],
        'sans-semibold': ['InstrumentSans-600'],
        mono: ['IBMPlexMono-400'],
        'mono-medium': ['IBMPlexMono-500'],
      },
      fontSize: {
        // NOTE: `fontWeight` here documents the INTENDED weight for each
        // size and still emits a real `font-weight` style — but per the
        // fontFamily comment above, it cannot by itself select the correct
        // custom font file. Pair these with the matching font-sans-* /
        // font-mono-* utility at the call site.
        display:  ['32px', { lineHeight: '38px', letterSpacing: '-0.64px', fontWeight: '600' }],
        title:    ['24px', { lineHeight: '31px', letterSpacing: '-0.36px', fontWeight: '600' }],
        heading:  ['20px', { lineHeight: '27px', fontWeight: '600' }],
        lead:     ['18px', { lineHeight: '27px' }],
        body:     ['16px', { lineHeight: '24px' }],
        label:    ['14px', { lineHeight: '20px', fontWeight: '500' }],
        caption:  ['13px', { lineHeight: '19px' }],
        micro:    ['11px', { lineHeight: '14px', letterSpacing: '0.88px', fontWeight: '500' }],
        data:     ['14px', { lineHeight: '20px', fontWeight: '500' }],
        dataSm:   ['11px', { lineHeight: '14px', letterSpacing: '1.1px', fontWeight: '500' }],
      },
      spacing: {
        1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px', 8: '32px', 12: '48px', 16: '64px',
        touch: '48px', mic: '72px', strip: '28px',
      },
      borderRadius: { sm: '8px', md: '12px', lg: '20px', sheet: '28px', full: '999px' },
      boxShadow: {
        e1: '0 1px 2px rgba(26,22,19,0.06)',
        e2: '0 8px 24px rgba(26,22,19,0.14)',
        e3: '0 -8px 24px rgba(26,22,19,0.18)',
      },
      transitionTimingFunction: {
        quiet:  'cubic-bezier(0.2, 0, 0, 1)',
        settle: 'cubic-bezier(0.4, 0, 0.2, 1)',
        lift:   'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        tick: '120ms', settle: '180ms', listen: '220ms',
        disintegrate: '280ms', travel: '220ms', land: '100ms',
        rise: '320ms', dismiss: '220ms', seal: '240ms',
      },
    },
  },
  plugins: [],
};
