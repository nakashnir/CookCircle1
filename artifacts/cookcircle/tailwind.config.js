/** @type {import('tailwindcss').Config} */
//
// CookCircle Tailwind config.
//
// Sprint 1: extended additively to surface the design tokens defined in
// src/styles/tokens.css. Legacy palette keys (cream/forest/ember, custom
// shadows, radius xl2) are KEPT so existing classes in index.css and
// utility usages in App.tsx continue to work unchanged.
//
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
        // New: tabular monospace for stat values and ledger-style numbers.
        mono:    ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        // ----- Editorial Pantry additions -----
        // Editorial paper layer (warmer than zinc, cooler than cream).
        paper: {
          DEFAULT: 'var(--paper)',
          tint:    'var(--paper-tint)',
          deep:    'var(--paper-deep)',
        },
        // Near-black olive — type heroes and dark surfaces.
        ink: {
          DEFAULT: 'var(--ink)',
          2:       'var(--ink-2)',
          3:       'var(--ink-3)',
          muted:   'var(--ink-muted)',
          soft:    'var(--ink-soft)',
          faint:   'var(--ink-faint)',
        },
        // Rare high-energy accent (urgent expiry, hot CTAs). Use sparingly.
        emberpop: 'var(--ember-pop)',
        clay: {
          100: 'var(--clay-100)',
          300: 'var(--clay-300)',
          500: 'var(--clay-500)',
        },

        // ----- Legacy (kept verbatim for backwards compat) -----
        cream: {
          50:  '#fdfbf6',
          100: '#faf5ec',
          200: '#f3ead8',
          300: '#e9dcc0',
        },
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
          // New deeper rung for ink-tone forest used in tokens.
          ink: 'var(--forest-800)',
        },
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
      // ----- Type scale aligned to tokens.css -----
      fontSize: {
        'display-xl': ['var(--t-display-xl)', { lineHeight: 'var(--lh-display)', letterSpacing: 'var(--track-display)' }],
        'display-lg': ['var(--t-display-lg)', { lineHeight: 'var(--lh-display)', letterSpacing: 'var(--track-display)' }],
        'display-md': ['var(--t-display-md)', { lineHeight: 'var(--lh-tight)',   letterSpacing: 'var(--track-display)' }],
        'display-sm': ['var(--t-display-sm)', { lineHeight: 'var(--lh-tight)',   letterSpacing: 'var(--track-tight)' }],
      },
      letterSpacing: {
        display: 'var(--track-display)',
        eyebrow: 'var(--track-eyebrow)',
      },
      lineHeight: {
        display: 'var(--lh-display)',
      },
      // ----- Shadow scale -----
      boxShadow: {
        // Legacy (kept):
        'card':       '0 1px 2px rgba(28, 53, 32, 0.04), 0 8px 24px -12px rgba(28, 53, 32, 0.12)',
        'card-hover': '0 2px 4px rgba(28, 53, 32, 0.06), 0 18px 40px -16px rgba(28, 53, 32, 0.22)',
        'soft':       '0 1px 2px rgba(28, 53, 32, 0.05)',
        'inset-soft': 'inset 0 0 0 1px rgba(28, 53, 32, 0.06)',
        // New token-aligned ladder:
        's1':           'var(--shadow-s1)',
        's2':           'var(--shadow-s2)',
        's3':           'var(--shadow-s3)',
        's4':           'var(--shadow-s4)',
        'glow-ember':   'var(--shadow-glow-ember)',
        'glow-forest':  'var(--shadow-glow-forest)',
        'inset-line':   'var(--shadow-inset-line)',
        'focus':        'var(--focus-ring)',
        'focus-accent': 'var(--focus-ring-accent)',
      },
      // ----- Radius scale -----
      borderRadius: {
        // Legacy (kept):
        'xl2': '1.25rem',
        // New token-aligned ladder:
        'xs':  'var(--radius-xs)',
        'sm':  'var(--radius-sm)',
        'md':  'var(--radius-md)',
        'lg':  'var(--radius-lg)',
        'xl':  'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      // ----- Container widths -----
      maxWidth: {
        'narrow':  'var(--container-narrow)',
        'prose-c': 'var(--container-prose)',
        'wide':    'var(--container-wide)',
        'bleed':   'var(--container-bleed)',
      },
      // ----- Motion timing for arbitrary `transition-` utilities -----
      transitionDuration: {
        fast: '180ms',
        mid:  '320ms',
        slow: '600ms',
        hero: '900ms',
      },
      transitionTimingFunction: {
        soft:  'cubic-bezier(0.22, 1, 0.36, 1)',
        snap:  'cubic-bezier(0.5, 0, 0.1, 1)',
        glide: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
}
