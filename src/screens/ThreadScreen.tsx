import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CaptureBar } from "../components/CaptureBar";
import { FennocMark } from "../components/FennocMark";
import { NextStrip } from "../components/NextStrip";
import { StatusStrip } from "../components/StatusStrip";
import { useTheme } from "../theme/useTheme";

interface ThreadScreenProps {
  onOpenSettings: () => void;
}

function ThreadTerminus() {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-px flex-1 bg-line-hairline" />
      <Text
        className="font-mono-medium text-dataSm text-ink-muted"
        numberOfLines={1}
      >
        NOTHING ELSE · NEXT AFTER 17:00
      </Text>
      <View className="h-px flex-1 bg-line-hairline" />
    </View>
  );
}

/**
 * The thread — root screen of the app (INT-023). Message rendering, the
 * check-in question card, and the ledger sheet are separate passes; the
 * scroll area is empty here on purpose. An empty state you can reach is
 * the structural opposite of a feed, so a bare thread with a terminus is a
 * legitimate first state, not a placeholder.
 */
export function ThreadScreen({ onOpenSettings }: ThreadScreenProps) {
  const { palette } = useTheme();

  const onOpenLedger = () => {
    // TODO(INT-024): open the ledger sheet. No-op until then.
  };

  return (
    <SafeAreaView className="flex-1 bg-bg-base" edges={["top", "bottom"]}>
      <View className="h-16 flex-row items-center gap-3 border-b border-line-hairline px-4">
        <Pressable
          accessibilityHint="Long-press to open Settings"
          accessibilityLabel="Fennoc"
          accessibilityRole="button"
          className="h-touch w-touch items-center justify-center"
          onLongPress={onOpenSettings}
        >
          <FennocMark color={palette.ink.muted} size={24} />
        </Pressable>

        <Text
          className="font-sans-semibold text-ink"
          style={{ fontSize: 17, lineHeight: 22 }}
        >
          Fennoc
        </Text>

        <View className="flex-1" />

        <Pressable
          accessibilityLabel="Ledger"
          accessibilityRole="button"
          className="h-touch items-center justify-center rounded-sm border border-line-strong px-[18px] active:opacity-80"
          onPress={onOpenLedger}
        >
          <Text className="font-sans-medium text-label text-ink">
            Ledger
          </Text>
        </Pressable>
      </View>

      <StatusStrip />

      <ScrollView
        className="flex-1"
        contentContainerClassName="flex-grow justify-end px-4 py-5"
      >
        <ThreadTerminus />
      </ScrollView>

      <NextStrip />
      <CaptureBar />
    </SafeAreaView>
  );
}
