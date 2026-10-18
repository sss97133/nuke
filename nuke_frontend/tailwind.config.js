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
      'xs':  'var(--fs-8)',
      'sm':  'var(--fs-9)',
      'base': 'var(--fs-10)',
      'lg':  'var(--fs-11)',
      'xl':  'var(--fs-11)',
      '2xl': 'var(--fs-12)',
      '3xl': 'var(--fs-12)',
      '4xl': 'var(--fs-12)',
      '5xl': 'var(--fs-12)',
    },
    borderRadius: {
      DEFAULT: '0',
      none: '0',
      sm: '0',
      md: '0',
      lg: '0',
      xl: '0',
      '2xl': '0',
      '3xl': '0',
      full: '0',
    },
    boxShadow: {
      DEFAULT: 'none',
      sm: 'none',
      md: 'none',
      lg: 'none',
      xl: 'none',
      '2xl': 'none',
      inner: 'none',
      none: 'none',
    },
  },
  plugins: [],
}
