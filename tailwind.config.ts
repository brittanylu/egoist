import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F5F4EF',
        ink: '#14161A',
        'ink-panel': '#1C1E22',
        muted: '#6B7078',
        hairline: '#E4E2DA',
        accent: '#E7E1F7',
        'accent-ink': '#4B3F8F',
        allow: '#1F7A4D',
        deny: '#B23A34',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        card: '14px',
      },
      fontSize: {
        '2xs': ['11px', '14px'],
      },
      letterSpacing: {
        tightest: '-0.03em',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'receipt-up': {
          '0%': { opacity: '0', transform: 'translateY(14px) scale(0.995)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 380ms cubic-bezier(0.22, 0.61, 0.36, 1) both',
        'fade-in': 'fade-in 300ms ease-out both',
        'slide-in-right': 'slide-in-right 300ms cubic-bezier(0.22, 0.61, 0.36, 1) both',
        'receipt-up': 'receipt-up 340ms cubic-bezier(0.22, 0.61, 0.36, 1) both',
      },
      transitionTimingFunction: {
        calm: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
