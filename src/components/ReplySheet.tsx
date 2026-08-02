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

import { READING_COLUMN_MAX_WIDTH } from "../theme/layout";
import { useTheme } from "../theme/useTheme";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ReplySheetProps {
  visible: boolean;
  onClose: () => void;
  body: string | null;
  /** The message this sheet is showing the rest of — needed so the Reply
   *  button below has something to hand off to `onReply`. */
  messageId: string | null;
  /** The full reply text (lede + body), passed straight through as the
   *  composer's quote. See CaptureBar's note on why the quote itself is
   *  never re-sent to the server. */
  quote: string;
  onReply: (messageId: string, quote: string) => void;
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
export function ReplySheet({
  visible,
  onClose,
  body,
  messageId,
  quote,
  onReply,
}: ReplySheetProps) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <ReplySheetContent
          body={body}
          messageId={messageId}
          onClose={onClose}
          onReply={onReply}
          quote={quote}
        />
      </SafeAreaProvider>
    </Modal>
  );
}

function ReplySheetContent({
  body,
  onClose,
  messageId,
  quote,
  onReply,
}: {
  body: string | null;
  onClose: () => void;
  messageId: string | null;
  quote: string;
  onReply: (messageId: string, quote: string) => void;
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
        className="w-full self-center rounded-t-sheet border-t border-line-strong bg-bg-overlay"
        // No top inset: the sheet is bottom-anchored at 80% of the window, so
        // its top edge never reaches the status bar and `insets.top` would
        // only add ~50px of dead space above the drag handle. The nested
        // SafeAreaProvider above still matters — `insets.bottom` below is the
        // one that would resolve to 0 through a Modal and let the last line
        // of text sit under the gesture bar.
        // `maxWidth` centers the panel on a tablet (INT-060's reading
        // column); the scrim above stays full-bleed so the thread behind it
        // does not stay tappable down both margins.
        style={{ height: sheetHeight, paddingTop: 12, maxWidth: READING_COLUMN_MAX_WIDTH }}
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

        {/* Unlike the inline CTA in ThreadScreen (only shown when the reply
            looks like a question), this sheet always offers Reply — the user
            already explicitly opened it to read more, so the affordance is
            never noise here. Styled identically to "Read the rest" /
            "Read briefing" elsewhere. */}
        <View className="px-4 pb-3">
          <Pressable
            accessibilityLabel="Reply"
            accessibilityRole="button"
            className="h-touch flex-row items-center self-start rounded-sm border border-line-strong px-3 active:opacity-80"
            onPress={() => {
              if (messageId) onReply(messageId, quote);
            }}
          >
            <Text className="font-sans-medium text-label text-ink">Reply</Text>
          </Pressable>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pb-8"
          style={{ paddingBottom: insets.bottom }}
        >
          {/* Reply bodies ARE markdown — the server splits a long reply into
              lede + body without reformatting either half, so whatever the
              model emitted comes through verbatim. This used to render as
              plain text on the reasoning that it "adds no new rendering
              surface," which was defensible when replies were short and
              mostly prose. It stopped being true: real replies arrive with
              headings, bullets and bold, and plain text showed the syntax
              instead of the formatting.

              BriefingSheet already renders the same kind of content through
              MarkdownRenderer, so this is the existing surface, not a new
              one. Selectability used to be lost here — react-native-
              markdown-display's default render rules don't thread it
              through on their own — but MarkdownRenderer now overrides the
              leaf text rules to carry `selectable`, so copying a reply
              works the same as copying any other thread text. See its own
              comment for the propagation details. */}
          <MarkdownRenderer text={body ?? ""} />
        </ScrollView>
      </View>
    </View>
  );
}
