import type { Config } from "tailwindcss";

export default {
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
      padding: '0.5rem',
      screens: {
        '2xl': '1400px'
      }
    },
    extend: {
      colors: {
        border: '#8E9196',
        input: '#C8C8C9',
        ring: '#555555',
        background: '#FFFFFF',
        foreground: '#222222',
        primary: {
          DEFAULT: '#333333',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: '#C8C8C9',
          foreground: '#222222',
        },
        destructive: {
          DEFAULT: '#991B1B',
          foreground: '#FFFFFF',
        },
        muted: {
          DEFAULT: '#F1F1F1',
          foreground: '#666666',
        },
        accent: {
          DEFAULT: '#D4D4D4',
          foreground: '#222222',
        },
        popover: {
          DEFAULT: '#FFFFFF',
          foreground: '#222222',
        },
        card: {
          DEFAULT: '#FFFFFF',
          foreground: '#222222',
        },
      },
      fontSize: {
        'xs': ['0.75rem', '1rem'],
        'tiny': ['0.625rem', '0.875rem'],
        'doc': ['0.8125rem', '1.25rem'],
      },
      fontFamily: {
        'system': ['Apple Symbols', 'Monaco', 'Consolas', 'monospace'],
      },
      borderRadius: {
        lg: '0px',
        md: '0px',
        sm: '0px'
      },
      boxShadow: {
        'classic': 'inset 1px 1px 0px #FFFFFF, inset -1px -1px 0px #8E9196',
        'classic-pressed': 'inset -1px -1px 0px #FFFFFF, inset 1px 1px 0px #8E9196',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out'
      }
    }
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;