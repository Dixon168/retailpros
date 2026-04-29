/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // RetailPOS 设计系统颜色
        bg:     { DEFAULT: '#07090f' },
        s1:     { DEFAULT: '#0d1117' },
        s2:     { DEFAULT: '#111827' },
        s3:     { DEFAULT: '#1a2236' },
        border: { DEFAULT: '#1e2d42', 2: '#243347' },
        t:      { 2: '#8899b0', 3: '#3d5068' },
      },
      fontFamily: {
        sans: ['Syne', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      animation: {
        'pulse-border': 'pulse-border 2s infinite',
        'fade-up': 'fadeUp 0.3s ease both',
      },
      keyframes: {
        'pulse-border': {
          '0%,100%': { borderColor: 'rgba(59,130,246,0.35)' },
          '50%': { borderColor: 'rgba(59,130,246,0.7)' },
        },
        fadeUp: {
          from: { opacity: 0, transform: 'translateY(12px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        }
      }
    }
  },
  plugins: []
}
