import { useMemo } from "react";
import { Text } from "react-native";
import Markdown, { type RenderRules } from "react-native-markdown-display";

import type { Palette } from "../theme/colors";
import { useTheme } from "../theme/useTheme";

/**
 * Sanctioned style-object escape hatch (same precedent as App.tsx tab bar
 * StyleSheet). react-native-markdown-display consumes markdownStyles, not
 * Nativewind className.
 *
 * Built from the ACTIVE palette rather than the static `colors` shim. That
 * shim is night-only by design — it says so — and reading `colors.olive` here
 * meant markdown text was always night ink. The surfaces around it (sheets,
 * cards) are theme-aware through Nativewind, so in light mode this rendered
 * near-white text on a near-white background: the morning briefing was
 * present, correctly laid out, and invisible.
 *
 * Anything drawing through a style prop instead of a className has to take
 * the palette explicitly; there is no ambient theme for StyleSheet objects.
 */
function buildMarkdownStyles(palette: Palette) {
  const ink = palette.ink.DEFAULT;
  const accent = palette.clay;
  const wash = palette.bg.raised;
  return {
  body: {
    color: ink,
    fontSize: 16,
    lineHeight: 24,
  },
  heading1: {
    color: accent,
    fontWeight: "600" as const,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 8,
    marginBottom: 4,
  },
  heading2: {
    color: accent,
    fontWeight: "600" as const,
    fontSize: 18,
    lineHeight: 24,
    marginTop: 8,
    marginBottom: 4,
  },
  heading3: {
    color: ink,
    fontWeight: "600" as const,
    fontSize: 16,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 4,
  },
  paragraph: {
    color: ink,
    fontSize: 16,
    lineHeight: 24,
    marginTop: 0,
    marginBottom: 8,
  },
  bullet_list: {
    marginVertical: 4,
  },
  ordered_list: {
    marginVertical: 4,
  },
  list_item: {
    color: ink,
    marginVertical: 2,
  },
  bullet_list_icon: {
    color: accent,
    marginRight: 8,
  },
  strong: {
    fontWeight: "700" as const,
    color: ink,
  },
  em: {
    fontStyle: "italic" as const,
  },
  link: {
    color: accent,
  },
  code_inline: {
    backgroundColor: wash,
    color: ink,
    padding: 2,
    borderRadius: 4,
    fontFamily: "monospace",
  },
  fence: {
    backgroundColor: wash,
    color: ink,
    padding: 8,
    borderRadius: 8,
    marginVertical: 8,
  },
  blockquote: {
    backgroundColor: wash,
    borderLeftColor: accent,
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginVertical: 8,
  },
  hr: {
    backgroundColor: wash,
    height: 1,
    marginVertical: 12,
  },
  };
}

interface MarkdownRendererProps {
  text: string;
}

/**
 * "Adding `selectable` to a wrapper does not automatically propagate into a
 * markdown renderer's internal `<Text>` children" — and it doesn't here.
 * `react-native-markdown-display`'s own render rules (its `renderRules.js`)
 * render every leaf of parsed prose as a bare `<Text>` with no `selectable`
 * prop, and RN defaults that to `false`. Those leaves are not descendants of
 * one outer `<Text>` this component controls — they're direct children of
 * `<View>` block wrappers (`paragraph`/`heading*`/`list_item`), so wrapping
 * `<Markdown>` itself in a selectable `<Text>` reaches none of them. Each
 * leaf rule needs the prop itself.
 *
 * `groupTextTokens` (the library's own token pass, `src/lib/util/
 * groupTextTokens.js`) already merges every run of consecutive inline
 * tokens — plain text, **strong**, *em*, `code`, links, line breaks —
 * into ONE `textgroup` node before the library renders it; the inline
 * children (`strong`/`em`/`code_inline`/etc., each its own nested `<Text>`
 * per the default rules) are what `textgroup` wraps. So overriding
 * `textgroup` alone is what makes a whole sentence with mixed formatting
 * selectable as one unit — RN flattens nested `<Text>` into a single native
 * text block, so the un-touched `strong`/`em`/`code_inline` rules inherit
 * it from their selectable `textgroup` parent and don't need their own
 * override. `text` (a bare top-level text node outside any inline run —
 * rare, but the library ships a default rule for it) gets the same
 * treatment for the same reason `textgroup` does. `code_block` and `fence`
 * are block tokens — `groupTextTokens` never folds them into a `textgroup`
 * — so they render as their own standalone `<Text>` and need `selectable`
 * set directly.
 *
 * This is confirmed by reading `renderRules.js` itself, not assumed: the
 * six rules below are copied from its defaults with only `selectable`
 * added, and `getRenderer` (`index.js`) merges a `rules` prop with the
 * library's defaults (`{...renderRules, ...(rules || {})}`) rather than
 * replacing them, so overriding just these six leaves every other rule —
 * lists, links, images, tables, code styling — untouched.
 */
const selectableRules: RenderRules = {
  textgroup: (node, children, parent, styles) => (
    <Text key={node.key} selectable style={styles.textgroup}>
      {children}
    </Text>
  ),
  text: (node, children, parent, styles, inheritedStyles = {}) => (
    <Text key={node.key} selectable style={[inheritedStyles, styles.text]}>
      {node.content}
    </Text>
  ),
  code_block: (node, children, parent, styles, inheritedStyles = {}) => {
    // Same trailing-newline trim as the library's own default rule — the
    // parser sends an extra one, and this rule only exists to add
    // `selectable`, not to change what's shown.
    let { content } = node;
    if (typeof node.content === "string" && node.content.endsWith("\n")) {
      content = node.content.slice(0, -1);
    }
    return (
      <Text key={node.key} selectable style={[inheritedStyles, styles.code_block]}>
        {content}
      </Text>
    );
  },
  fence: (node, children, parent, styles, inheritedStyles = {}) => {
    let { content } = node;
    if (typeof node.content === "string" && node.content.endsWith("\n")) {
      content = node.content.slice(0, -1);
    }
    return (
      <Text key={node.key} selectable style={[inheritedStyles, styles.fence]}>
        {content}
      </Text>
    );
  },
};

export function MarkdownRenderer({ text }: MarkdownRendererProps) {
  const { palette } = useTheme();
  const markdownStyles = useMemo(() => buildMarkdownStyles(palette), [palette]);
  return (
    <Markdown rules={selectableRules} style={markdownStyles}>
      {text}
    </Markdown>
  );
}
