import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FFFFFF', // --bg
        surface: '#FAFAF8', // --bg-soft
        ink: '#0A0A0A', // --text
        muted: '#4B5563', // --muted
        hairline: '#D6D6D6', // --border
        allow: '#15803D',
        deny: '#B91C1C',
        // One accent per tier of the chain, used at hairline weight only: a rail, a
        // badge outline, a 4% wash. Both sit far enough from allow/deny in hue that
        // a tinted card never reads as a verdict.
        tier: {
          agent: '#9A4F26', // primary agent — warm, one card, top of the machine chain
          sub: '#3A4E8C', // subagents — cool, recessive, however many there are
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        // A true italic, for emphasis words inside headings. Geist ships no italic,
        // so a synthetic slant is avoided in favour of a real one.
        italic: ['var(--font-instrument-serif)', 'Georgia', 'serif'],
      },
      borderRadius: {
        card: '10px',
      },
      fontSize: {
        '2xs': ['11px', '14px'],
      },
      letterSpacing: {
        tightest: '-0.03em',
      },
      lineHeight: {
        display: '1.05',
      },
      keyframes: {
        // Quiet fades only: no travel, no bounce.
        fade: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      animation: {
        fade: 'fade 320ms ease-out both',
        'fade-slow': 'fade 520ms ease-out both',
        receipt: 'fade 380ms ease-out both',
      },
      transitionTimingFunction: {
        calm: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
