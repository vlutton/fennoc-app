/** @type {import('tailwindcss').Config} */
const { colors } = require("./src/theme/tokens");

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
  // Theme switching instead uses plain conditional classNames driven by
  // `useTheme()` — see src/theme/useTheme.ts and App.tsx.
  theme: {
    extend: {
      colors: {
        ...colors,
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
        sand: colors.bg.base,
        cream: colors.bg.raised,
        olive: colors.ink.DEFAULT,
        terracotta: colors.clay,
      },
      fontFamily: {
        sans: ['InstrumentSans'], mono: ['IBMPlexMono'],
      },
      fontSize: {
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
