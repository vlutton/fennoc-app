import { X } from "lucide-react-native";
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../theme/useTheme";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface BriefingSheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  text: string | null;
}

// The sheet caps at 80% of the window, like a summoned widget sheet
// (LedgerSheet's own comment on the ledger-vs-summoned distinction) —
// matches ReplySheet's identical cap for the same reason: this is one
// document's worth of prose, not the full-height ledger.
const MAX_HEIGHT_RATIO = 0.8;

/**
 * The full morning/evening briefing body — "Read briefing" (see
 * `FennocMessage` in ThreadScreen, and its "Read the rest" counterpart for
 * a long Fennoc reply). Reported from a real device: "Clicking the 'Read
 * briefing' button makes a noise but doesn't actually do anything" — that
 * was a `TODO(INT-024)` no-op; this sheet is what it now opens.
 *
 * Copies `ReplySheet.tsx`'s Modal-sheet pattern, including both traps that
 * file documents:
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
 *
 * `text` is `string | null` for symmetry with `useMorningBriefing` /
 * `useEveningBriefing`'s data shape, but the actual "don't open on nothing"
 * guard lives one level up: `FennocMessage` only renders the "Read
 * briefing" button (and therefore only ever gets a chance to open this
 * sheet) when it has real text — a button that opens nothing was literally
 * the reported bug, so it doesn't exist to open an empty sheet in the first
 * place. See ThreadScreen's wiring.
 */
export function BriefingSheet({ visible, onClose, title, text }: BriefingSheetProps) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <BriefingSheetContent onClose={onClose} text={text} title={title} />
      </SafeAreaProvider>
    </Modal>
  );
}

function BriefingSheetContent({
  onClose,
  title,
  text,
}: {
  onClose: () => void;
  title: string;
  text: string | null;
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
        style={{ height: sheetHeight, paddingTop: 12 }}
      >
        <View className="mt-3 h-1 w-9 self-center rounded-[2px] bg-line-strong" />

        <View className="flex-row items-center justify-between px-4 pb-3 pt-3">
          <Text className="font-sans-semibold text-title text-ink">{title}</Text>
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            className="h-touch w-touch items-center justify-center"
            onPress={onClose}
          >
            <X color={palette.ink.DEFAULT} size={22} />
          </Pressable>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="px-4 pb-8" style={{ paddingBottom: insets.bottom }}>
          <MarkdownRenderer text={text ?? ""} />
        </ScrollView>
      </View>
    </View>
  );
}
