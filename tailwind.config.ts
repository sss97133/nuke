import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "0.5rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: {
          DEFAULT: "hsl(var(--border))",
          dark: "#555555",
        },
        input: {
          DEFAULT: "hsl(var(--input))",
          dark: "#333333",
        },
        ring: {
          DEFAULT: "hsl(var(--ring))",
          dark: "#8E9196",
        },
        background: {
          DEFAULT: "#FFFFFF",
          dark: "#1A1F2C",
        },
        foreground: {
          DEFAULT: "#222222",
          dark: "#FFFFFF",
        },
        primary: {
          DEFAULT: "#333333",
          foreground: "#FFFFFF",
          dark: "#F1F1F1",
          "dark-foreground": "#222222",
        },
        secondary: {
          DEFAULT: "#C8C8C9",
          foreground: "#222222",
          dark: "#2A2A2A",
          "dark-foreground": "#FFFFFF",
        },
        destructive: {
          DEFAULT: "#991B1B",
          foreground: "#FFFFFF",
          dark: "#7F1D1D",
          "dark-foreground": "#FFFFFF",
        },
        muted: {
          DEFAULT: "#F1F1F1",
          foreground: "#666666",
          dark: "#333333",
          "dark-foreground": "#E5E5E5",
        },
        accent: {
          DEFAULT: "#D4D4D4",
          foreground: "#222222",
          dark: "#404040",
          "dark-foreground": "#FFFFFF",
        },
        popover: {
          DEFAULT: "#FFFFFF",
          foreground: "#222222",
          dark: "#1A1F2C",
          "dark-foreground": "#FFFFFF",
        },
        card: {
          DEFAULT: "#FFFFFF",
          foreground: "#222222",
          dark: "#1A1F2C",
          "dark-foreground": "#FFFFFF",
        },
      },
      fontSize: {
        xs: ["0.75rem", "1rem"],
        tiny: ["0.625rem", "0.875rem"],
        doc: ["0.8125rem", "1.25rem"],
      },
      fontFamily: {
        system: ["Monaco", "Consolas", "monospace"],
      },
      borderRadius: {
        lg: "0px",
        md: "0px",
        sm: "0px",
      },
      boxShadow: {
        classic: "inset 1px 1px 0px #FFFFFF, inset -1px -1px 0px #8E9196",
        "classic-pressed":
          "inset -1px -1px 0px #FFFFFF, inset 1px 1px 0px #8E9196",
        "classic-dark":
          "inset 1px 1px 0px #333333, inset -1px -1px 0px #000000",
        "classic-pressed-dark":
          "inset -1px -1px 0px #333333, inset 1px 1px 0px #000000",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
