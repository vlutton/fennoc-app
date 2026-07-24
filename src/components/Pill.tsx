import { Text, View } from "react-native";

type PillVariant = "project" | "priority" | "label";

interface PillProps {
  label: string;
  variant: PillVariant;
  priority?: number;
}

function priorityClasses(priority: number | undefined): string {
  switch (priority) {
    case 1:
      return "bg-terracotta border-terracotta";
    case 2:
      return "bg-olive border-olive";
    case 3:
      return "bg-cream border-sand";
    default:
      return "bg-sand border-sand";
  }
}

function priorityTextClasses(priority: number | undefined): string {
  switch (priority) {
    case 1:
    case 2:
      return "text-cream";
    default:
      return "text-olive";
  }
}

function containerClasses(variant: PillVariant, priority?: number): string {
  if (variant === "priority") return priorityClasses(priority);
  if (variant === "project") return "bg-sand border-sand";
  return "bg-cream border-sand";
}

function textClasses(variant: PillVariant, priority?: number): string {
  if (variant === "priority") return priorityTextClasses(priority);
  return "text-olive";
}

export function Pill({ label, variant, priority }: PillProps) {
  return (
    <View
      className={`rounded-lg border px-2 py-1 ${containerClasses(variant, priority)}`}
    >
      <Text
        className={`text-xs font-medium leading-4 ${textClasses(variant, priority)}`}
      >
        {label}
      </Text>
    </View>
  );
}
