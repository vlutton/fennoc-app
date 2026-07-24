import { Text, View } from "react-native";

import type { TimeBlock } from "../api/types";
import { formatDuration } from "../utils/format";

interface CompositionBarProps {
  blocks: TimeBlock[];
}

interface CategoryShare {
  category: string;
  seconds: number;
  percent: number;
}

/** Static class map so Nativewind can see every width token. */
const WIDTH_BY_STEP: Record<number, string> = {
  0: "w-0",
  5: "w-[5%]",
  10: "w-[10%]",
  15: "w-[15%]",
  20: "w-1/5",
  25: "w-1/4",
  30: "w-[30%]",
  35: "w-[35%]",
  40: "w-2/5",
  45: "w-[45%]",
  50: "w-1/2",
  55: "w-[55%]",
  60: "w-3/5",
  65: "w-[65%]",
  70: "w-[70%]",
  75: "w-3/4",
  80: "w-4/5",
  85: "w-[85%]",
  90: "w-[90%]",
  95: "w-[95%]",
  100: "w-full",
};

function widthClass(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const step = Math.max(5, Math.round(clamped / 5) * 5);
  return WIDTH_BY_STEP[step] ?? "w-1/2";
}

function buildShares(blocks: TimeBlock[]): CategoryShare[] {
  const totals = new Map<string, number>();
  for (const block of blocks) {
    const key = block.category || "unknown";
    totals.set(key, (totals.get(key) ?? 0) + Math.max(0, block.duration_s));
  }

  const grand = Array.from(totals.values()).reduce((sum, n) => sum + n, 0);
  if (grand <= 0) return [];

  return Array.from(totals.entries())
    .map(([category, seconds]) => ({
      category,
      seconds,
      percent: Math.round((seconds / grand) * 100),
    }))
    .sort((a, b) => b.seconds - a.seconds);
}

export function CompositionBar({ blocks }: CompositionBarProps) {
  const shares = buildShares(blocks);

  if (shares.length === 0) {
    return (
      <View className="rounded-xl border border-sand bg-cream p-4">
        <Text className="text-base font-semibold leading-6 text-olive">
          Composition
        </Text>
        <Text className="mt-2 text-base leading-6 text-terracotta">
          No blocks yet today.
        </Text>
      </View>
    );
  }

  return (
    <View className="rounded-xl border border-sand bg-cream p-4">
      <Text className="mb-3 text-base font-semibold leading-6 text-olive">
        Composition
      </Text>
      {shares.map((share) => (
        <View key={share.category} className="mb-3">
          <View className="mb-1 flex-row items-center justify-between">
            <Text className="text-base leading-6 text-olive">
              {share.category}
            </Text>
            <Text className="text-sm leading-5 text-terracotta">
              {formatDuration(share.seconds)} · {share.percent}%
            </Text>
          </View>
          <View className="h-3 overflow-hidden rounded-lg bg-sand">
            <View
              className={`h-3 rounded-lg bg-terracotta ${widthClass(share.percent)}`}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
