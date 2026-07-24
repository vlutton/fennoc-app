import { Text, View } from "react-native";

import type { TimeBlock } from "../api/types";
import { formatDuration } from "../utils/format";

interface TimeBlockRowProps {
  block: TimeBlock;
}

export function TimeBlockRow({ block }: TimeBlockRowProps) {
  const title = block.label
    ? `${block.category} · ${block.label}`
    : block.category;

  return (
    <View className="mb-2 flex-row items-center justify-between rounded-xl border border-sand bg-cream px-4 py-3">
      <Text
        className="mr-3 flex-1 text-base leading-6 text-olive"
        numberOfLines={1}
      >
        {title}
      </Text>
      <Text className="text-base font-medium leading-6 text-terracotta">
        {formatDuration(block.duration_s)}
      </Text>
    </View>
  );
}
