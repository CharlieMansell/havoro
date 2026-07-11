/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef3ea',
          100: '#dbe8d3',
          500: '#3f8a5c',
          600: '#2a734a',
          700: '#1f6b45',
        },
        // Override Tailwind's default emerald/slate so every existing
        // bg-emerald-*/text-slate-* class picks up the house palette
        // (warm forest green + warm gray) without touching each component.
        emerald: {
          50:  '#eef3ea',
          100: '#dbe8d3',
          200: '#b9d1ab',
          300: '#96ba85',
          400: '#6ba876',
          500: '#3f8a5c',
          600: '#2a734a',
          700: '#1f6b45',
          800: '#164f34',
          900: '#123f2a',
        },
        slate: {
          50:  '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
        },
      },
    },
  },
  plugins: [],
};
