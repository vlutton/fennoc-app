export const colors = {
  sand: "#F5E6D3",
  terracotta: "#C67D5B",
  olive: "#3D4A2A",
  cream: "#FFF8F0",
} as const;

export type ColorName = keyof typeof colors;
