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
// tokens`. Do not hand-edit a hex here without updating the source doc.
module.exports = {
  colors: {
    bg: { base: "#100E0B", raised: "#191512", overlay: "#1F1A16", float: "#241E19" },
    line: { hairline: "#2B2521", strong: "#3A322B" },
    ink: { DEFAULT: "#F2EAE0", secondary: "#B7ADA3", muted: "#8C8279", disabled: "#5C544D" },
    signal: { DEFAULT: "#F0A93B", on: "#1A1206", wash: "#2A2114" },
    positive: "#8FA167",
    clay: "#A8705A",
    alert: "#D4674A",
    day: {
      base: "#F7F1E8", raised: "#FFFCF7", overlay: "#FFFFFF",
      hairline: "#E4DACB", strong: "#CFC2AE",
      ink: "#1A1613", inkSecondary: "#57504A", inkMuted: "#7A7168",
      signal: "#9A5B00", signalWash: "#F7E4C4",
      positive: "#4E5C2E", clay: "#8A5342", alert: "#A33A1C",
    },
  },
};
