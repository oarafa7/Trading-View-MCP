import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0A0B0D",
        panel: "#111317",
        elevated: "#171A1F",
        border: "#23272E",
        accent: "#22D3EE", // cyan = live
        amber: "#F59E0B",
        danger: "#EF4444",
        ok: "#10B981",
        muted: "#8B929E",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
