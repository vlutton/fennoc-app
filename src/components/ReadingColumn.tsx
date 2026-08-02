import type { ReactNode } from "react";
import { View } from "react-native";

import { READING_COLUMN_MAX_WIDTH } from "../theme/layout";

/**
 * Centers its children in a column no wider than `READING_COLUMN_MAX_WIDTH`
 * (INT-060). A no-op on every iPhone — see the token's own comment.
 *
 * MUST BE APPLIED INSIDE EACH `Modal`, NOT ONLY AT THE ROOT. A `Modal`
 * renders into its own native root, so a container wrapping `<Root />` does
 * not reach the sheets — the same trap `App.tsx` and `ReplySheet.tsx` already
 * document for `SafeAreaProvider` insets. A root-only column would leave
 * every sheet full-bleed while the thread behind it sat in a column, which
 * reads as a bug rather than a decision.
 *
 * For bottom sheets, wrap the sheet *panel* and leave the scrim full-bleed:
 * the scrim's job is to cover the screen, and a centered scrim would let the
 * thread stay tappable down both margins while the sheet claims to be modal.
 */
export function ReadingColumn({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 items-center">
      <View className="w-full flex-1" style={{ maxWidth: READING_COLUMN_MAX_WIDTH }}>
        {children}
      </View>
    </View>
  );
}
