/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
      },
      colors: {
        // Warm cream / parchment surfaces
        cream: {
          50: '#fdfbf6',
          100: '#faf5ec',
          200: '#f3ead8',
          300: '#e9dcc0',
        },
        // Forest green primary
        forest: {
          50:  '#f1f6f1',
          100: '#dde9de',
          200: '#bcd0bd',
          300: '#8fb091',
          400: '#5e8861',
          500: '#3f6a44',
          600: '#2f5634',
          700: '#244429',
          800: '#1c3520',
          900: '#152818',
        },
        // Warm terracotta / saffron accent
        ember: {
          50:  '#fdf3ec',
          100: '#fbe1cc',
          200: '#f6c294',
          300: '#ee9c5a',
          400: '#e07a3c',
          500: '#c95f28',
          600: '#a64a1f',
          700: '#7e3818',
        },
      },
      boxShadow: {
        'card':       '0 1px 2px rgba(28, 53, 32, 0.04), 0 8px 24px -12px rgba(28, 53, 32, 0.12)',
        'card-hover': '0 2px 4px rgba(28, 53, 32, 0.06), 0 18px 40px -16px rgba(28, 53, 32, 0.22)',
        'soft':       '0 1px 2px rgba(28, 53, 32, 0.05)',
        'inset-soft': 'inset 0 0 0 1px rgba(28, 53, 32, 0.06)',
      },
      borderRadius: {
        'xl2': '1.25rem',
      },
    },
  },
  plugins: [],
}
