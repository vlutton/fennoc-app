import { X } from "lucide-react-native";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  SafeAreaProvider,
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { useTheme } from "../theme/useTheme";

interface ReplySheetProps {
  visible: boolean;
  onClose: () => void;
  body: string | null;
}

// The sheet caps at 80% of the window, like a summoned widget sheet
// (LedgerSheet's own comment on the ledger-vs-summoned distinction): this
// is short collapsed prose, not the full-height ledger.
const MAX_HEIGHT_RATIO = 0.8;

/**
 * The collapsed remainder of a long Fennoc reply ("Read the rest" — see
 * FennocMessage's identical "Read briefing" pattern in ThreadScreen).
 * Follows `LedgerSheet.tsx`'s Modal-sheet pattern, but plain and static: no
 * rise/scrim animation, no sections — just the body text.
 *
 * Two traps already recorded in the backlog, both handled explicitly here:
 *
 * 1. `react-native-safe-area-context`'s `SafeAreaProvider` lives at the App
 *    root, and its insets do not propagate through an RN `Modal` — the
 *    Modal renders into a separate native root, so a `SafeAreaView` inside
 *    it resolves to a 0 inset on Android and content draws under the status
 *    bar. This sheet nests its OWN `SafeAreaProvider` (seeded with
 *    `initialWindowMetrics` so the first frame isn't a 0-inset flash) and
 *    reads insets from that, rather than relying on the app-root provider.
 * 2. A `maxHeight` with no `height` collapsed the ledger sheet to zero
 *    height with nothing rendered, because `maxHeight` only caps — it does
 *    not size a `flex-1` child. The scroll container below gets a real,
 *    computed `height`, not a bare `maxHeight`.
 */
export function ReplySheet({ visible, onClose, body }: ReplySheetProps) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ReplySheetContent body={body} onClose={onClose} />
      </SafeAreaProvider>
    </Modal>
  );
}

function ReplySheetContent({
  body,
  onClose,
}: {
  body: string | null;
  onClose: () => void;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const sheetHeight = windowHeight * MAX_HEIGHT_RATIO;

  return (
    <View className="flex-1 justify-end">
      <Pressable
        accessibilityLabel="Close"
        accessibilityRole="button"
        className="flex-1 bg-bg-base opacity-60"
        onPress={onClose}
      />

      <View
        className="rounded-t-sheet border-t border-line-strong bg-bg-overlay"
        // No top inset: the sheet is bottom-anchored at 80% of the window, so
        // its top edge never reaches the status bar and `insets.top` would
        // only add ~50px of dead space above the drag handle. The nested
        // SafeAreaProvider above still matters — `insets.bottom` below is the
        // one that would resolve to 0 through a Modal and let the last line
        // of text sit under the gesture bar.
        style={{ height: sheetHeight, paddingTop: 12 }}
      >
        <View className="mt-3 h-1 w-9 self-center rounded-[2px] bg-line-strong" />

        <View className="flex-row items-center justify-between px-4 pb-3 pt-3">
          <Text className="font-sans-semibold text-title text-ink">The rest</Text>
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            className="h-touch w-touch items-center justify-center"
            onPress={onClose}
          >
            <X color={palette.ink.DEFAULT} size={22} />
          </Pressable>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pb-8"
          style={{ paddingBottom: insets.bottom }}
        >
          {/* Reply bodies are markdown-ish (the server splits a longer reply
              into lede + body, it doesn't reformat it) but MarkdownRenderer
              isn't reached for here — plain, selectable text is honest for
              this increment and adds no new rendering surface. */}
          <Text className="font-sans text-body text-ink" selectable>
            {body ?? ""}
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}
