/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        heading: ['Manrope', 'sans-serif'],
        body: ['IBM Plex Sans', 'sans-serif'],
      },
      colors: {
        surface: '#121214',
        'surface-hover': '#1A1A1D',
        accent: '#2563EB',
        'accent-hover': '#1D4ED8',
      },
    },
  },
  plugins: [],
};
