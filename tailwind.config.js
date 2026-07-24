/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx,js,jsx}", "./App.tsx"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        sand: "#F5E6D3",
        terracotta: "#C67D5B",
        olive: "#3D4A2A",
        cream: "#FFF8F0",
      },
    },
  },
  plugins: [],
};
