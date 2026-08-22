/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F0F4F8',
        ink: '#2C3E50',
        stage: {
          enquiry: '#3B82F6',
          nurture: '#14B8A6',
          booking: '#22C55E',
          finance: '#06B6D4',
          rto: '#F97316',
          delivery: '#EA580C',
        },
      },
    },
  },
  plugins: [],
}
