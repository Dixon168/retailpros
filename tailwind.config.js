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
        // ── Linear-style design tokens (Dixon picked style C) ──
        // Single accent color + slate grays. Applied through
        // .linear-theme scope so it doesn't clobber the dark POS
        // dashboard palette above.
        lx: {           // "lx" = linear-accent
          50:  '#eef0fc',
          100: '#dee2f8',
          500: '#5E6AD2',   // primary
          600: '#4854c4',   // hover
          700: '#3b47a8',
        },
      },
      fontFamily: {
        sans:    ['Syne', 'sans-serif'],
        mono:    ['DM Mono', 'monospace'],
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
