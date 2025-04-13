/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        glass: {
          primary: 'rgba(255, 255, 255, 0.1)',
          secondary: 'rgba(255, 255, 255, 0.05)',
          accent: 'rgba(255, 255, 255, 0.2)',
          dark: 'rgba(0, 0, 0, 0.4)',
        }
      },
      backdropBlur: {
        'glass': '16px',
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
      },
      borderColor: {
        'glass': 'rgba(255, 255, 255, 0.1)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
} 