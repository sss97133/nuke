/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
    // Preflight paints every border gray-200 (#e5e7eb) unless told otherwise. Measured 2026-10-12:
    // about half of the visibly bordered boxes on the vehicle profile carried it. The token is the default.
    borderColor: ({ theme }) => ({ ...theme('colors'), DEFAULT: 'var(--border)' }),
    fontSize: {
      xs: 'var(--text-caption)', sm: 'var(--text-callout)', base: 'var(--text-body)',
      lg: '17px', xl: '20px', '2xl': '24px', '3xl': '30px', '4xl': '36px', '5xl': '48px',
    },
    borderRadius: {
      DEFAULT: 'var(--radius)', none: '0', sm: '6px', md: 'var(--radius-sm)',
      lg: 'var(--radius)', xl: 'var(--radius-lg)', '2xl': '24px', '3xl': '30px', full: '9999px',
    },
    boxShadow: {
      DEFAULT: 'var(--shadow)', sm: '0 1px 3px rgb(0 0 0 / 6%)',
      md: '0 4px 16px rgb(0 0 0 / 8%)', lg: 'var(--shadow-lg)',
      xl: 'var(--shadow-lg)', '2xl': '0 20px 60px rgb(0 0 0 / 18%)',
      inner: 'inset 0 1px 2px rgb(0 0 0 / 6%)', none: 'none',
    },
  },
  plugins: [],
}
