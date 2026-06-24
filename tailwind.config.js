/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#1E40AF', dark: '#1E3A8A' },
        gold: { DEFAULT: '#F59E0B' },
        dtf: {
          text: '#1F2937',
          sub: '#6B7280',
          bg: '#F3F4F6',
          border: '#E5E7EB'
        }
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] }
    }
  },
  plugins: [require('@tailwindcss/forms')]
}
