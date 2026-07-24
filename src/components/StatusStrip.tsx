import { Text, View } from "react-native";

import type { Status } from "../api/types";

interface StatusStripProps {
  status: Status;
  todayCount: number;
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <View className="min-h-12 flex-row items-center rounded-full bg-sand px-3 py-2">
      <Text className="text-sm font-medium leading-5 text-olive">{label}</Text>
      <Text className="ml-2 text-base font-semibold leading-6 text-terracotta">
        {value}
      </Text>
    </View>
  );
}

export function StatusStrip({ status, todayCount }: StatusStripProps) {
  return (
    <View className="mb-4 flex-row flex-wrap gap-2">
      <StatPill label="Open" value={status.open} />
      <StatPill label="Overdue" value={status.overdue} />
      <StatPill label="Today" value={todayCount} />
    </View>
  );
}
