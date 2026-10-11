/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      // Veogen: an editing bay at night. Petrol-dark desk, amber safelight for whatever needs a decision,
      // and one light surface: the script page. Same tokens as the web dashboard.
      colors: {
        background: "#0f1a1e",
        foreground: "#e4ece8",
        card: "#16252b",
        primary: { DEFAULT: "#e9a23b", foreground: "#1a1304" },
        secondary: "#1d3037",
        muted: { DEFAULT: "#1d3037", foreground: "#8da3a1" },
        destructive: "#e0635a",
        border: "#2b4048",
        paper: { DEFAULT: "#ede6d6", ink: "#22201b" },
        ok: "#62b89b",
        strip: "#0a1215",
      },
      // Android picks a font file per family name, so each weight is its own family.
      fontFamily: {
        sans: ["IBMPlexSans_400Regular"],
        "sans-medium": ["IBMPlexSans_500Medium"],
        "sans-semibold": ["IBMPlexSans_600SemiBold"],
        display: ["BigShouldersDisplay_800ExtraBold"],
        script: ["Amiri_400Regular"],
        "script-bold": ["Amiri_700Bold"],
        mono: ["IBMPlexMono_400Regular"],
      },
    },
  },
  plugins: [],
};
