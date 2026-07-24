import type { LucideIcon } from "lucide-react-native";
import { Text, View } from "react-native";

import { colors } from "../theme/colors";

interface PlaceholderProps {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
}

export function Placeholder({
  title,
  subtitle = "Coming soon",
  icon: Icon,
}: PlaceholderProps) {
  return (
    <View className="flex-1 items-center justify-center bg-cream px-6">
      <View className="min-h-12 min-w-12 items-center justify-center rounded-xl bg-sand p-4">
        <Icon color={colors.olive} size={32} strokeWidth={1.75} />
      </View>
      <Text className="mt-4 text-center text-base font-semibold leading-6 text-olive">
        {title}
      </Text>
      <Text className="mt-2 text-center text-base leading-6 text-terracotta">
        {subtitle}
      </Text>
    </View>
  );
}
