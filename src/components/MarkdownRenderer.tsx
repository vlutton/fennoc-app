import Markdown from "react-native-markdown-display";

import { colors } from "../theme/colors";

/**
 * Sanctioned style-object escape hatch (same precedent as App.tsx tab bar
 * StyleSheet). react-native-markdown-display consumes markdownStyles, not
 * Nativewind className.
 */
const markdownStyles = {
  body: {
    color: colors.olive,
    fontSize: 16,
    lineHeight: 24,
  },
  heading1: {
    color: colors.terracotta,
    fontWeight: "600" as const,
    fontSize: 22,
    lineHeight: 28,
    marginTop: 8,
    marginBottom: 4,
  },
  heading2: {
    color: colors.terracotta,
    fontWeight: "600" as const,
    fontSize: 18,
    lineHeight: 24,
    marginTop: 8,
    marginBottom: 4,
  },
  heading3: {
    color: colors.olive,
    fontWeight: "600" as const,
    fontSize: 16,
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 4,
  },
  paragraph: {
    color: colors.olive,
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
    color: colors.olive,
    marginVertical: 2,
  },
  bullet_list_icon: {
    color: colors.terracotta,
    marginRight: 8,
  },
  strong: {
    fontWeight: "700" as const,
    color: colors.olive,
  },
  em: {
    fontStyle: "italic" as const,
  },
  link: {
    color: colors.terracotta,
  },
  code_inline: {
    backgroundColor: colors.sand,
    color: colors.olive,
    padding: 2,
    borderRadius: 4,
    fontFamily: "monospace",
  },
  fence: {
    backgroundColor: colors.sand,
    color: colors.olive,
    padding: 8,
    borderRadius: 8,
    marginVertical: 8,
  },
  blockquote: {
    backgroundColor: colors.sand,
    borderLeftColor: colors.terracotta,
    borderLeftWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginVertical: 8,
  },
  hr: {
    backgroundColor: colors.sand,
    height: 1,
    marginVertical: 12,
  },
};

interface MarkdownRendererProps {
  text: string;
}

export function MarkdownRenderer({ text }: MarkdownRendererProps) {
  return <Markdown style={markdownStyles}>{text}</Markdown>;
}
