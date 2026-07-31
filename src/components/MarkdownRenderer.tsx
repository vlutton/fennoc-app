import { useMemo } from "react";
import Markdown from "react-native-markdown-display";

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

export function MarkdownRenderer({ text }: MarkdownRendererProps) {
  const { palette } = useTheme();
  const markdownStyles = useMemo(() => buildMarkdownStyles(palette), [palette]);
  return <Markdown style={markdownStyles}>{text}</Markdown>;
}
