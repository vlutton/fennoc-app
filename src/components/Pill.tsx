import { Text, View } from "react-native";

type PillVariant = "project" | "priority" | "label" | "domain";

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

function domainContainerClasses(label: string): string {
  if (label === "domain:work" || label === "Work") {
    return "bg-cream border-terracotta";
  }
  if (label === "domain:personal" || label === "Personal") {
    return "bg-sand border-sand";
  }
  return "bg-cream border-sand";
}

function prettifyDomainLabel(label: string): string {
  if (label === "domain:work") return "Work";
  if (label === "domain:personal") return "Personal";
  return label;
}

function containerClasses(
  variant: PillVariant,
  priority: number | undefined,
  label: string,
): string {
  if (variant === "priority") return priorityClasses(priority);
  if (variant === "project") return "bg-sand border-sand";
  if (variant === "domain") return domainContainerClasses(label);
  return "bg-cream border-sand";
}

function textClasses(variant: PillVariant, priority?: number): string {
  if (variant === "priority") return priorityTextClasses(priority);
  if (variant === "domain") return "text-olive";
  return "text-olive";
}

export function Pill({ label, variant, priority }: PillProps) {
  const display =
    variant === "domain" ? prettifyDomainLabel(label) : label;

  return (
    <View
      className={`rounded-lg border px-2 py-1 ${containerClasses(variant, priority, label)}`}
    >
      <Text
        className={`text-xs font-medium leading-4 ${textClasses(variant, priority)}`}
      >
        {display}
      </Text>
    </View>
  );
}
