/**
 * CookCircle motion tokens.
 *
 * Mirrors the timing/easing values in src/styles/tokens.css so JS-driven
 * motion (motion/react) and CSS-driven motion stay coherent. Use these
 * instead of hard-coded ms/cubic-bezier strings.
 *
 * Companion to:
 *   - 12-principles-of-animation skill (audit findings)
 *   - to-spring-or-not-to-spring skill (when to pick spring vs ease)
 *   - mastering-animate-presence skill (exit animations)
 */

import type { Transition } from 'motion/react';

/** Duration scale in seconds (motion/react native unit). */
export const dur = {
  fast: 0.18,
  mid:  0.32,
  slow: 0.6,
  hero: 0.9,
} as const;

/** Cubic-bezier easings as motion/react tuples. */
export const ease = {
  /** Calm enter — out-expo-ish. Default for content reveal. */
  soft:  [0.22, 1, 0.36, 1] as const,
  /** Punchy — for clicks, taps, snap dismissals. */
  snap:  [0.5, 0, 0.1, 1] as const,
  /** Generic UI glide. */
  glide: [0.4, 0, 0.2, 1] as const,
} as const;

/** Named spring presets. Use for layout shifts and physical-feeling motion. */
export const spring = {
  /** Layout shifts, drawer slides. Settled feel, no overshoot. */
  calm:    { type: 'spring', stiffness: 180, damping: 28, mass: 1 } satisfies Transition,
  /** Cards, modals, primary attention shifts. Slight overshoot. */
  soft:    { type: 'spring', stiffness: 220, damping: 26, mass: 0.9 } satisfies Transition,
  /** Bouncy, playful — reserve for delight moments. */
  bouncy:  { type: 'spring', stiffness: 300, damping: 18, mass: 0.8 } satisfies Transition,
  /** Snappy click feedback. */
  snappy:  { type: 'spring', stiffness: 420, damping: 32, mass: 0.7 } satisfies Transition,
} as const;

/** Reusable transition presets. */
export const transitions = {
  fadeIn:     { duration: dur.mid,  ease: ease.soft } satisfies Transition,
  fadeInSlow: { duration: dur.slow, ease: ease.soft } satisfies Transition,
  riseIn:     { duration: dur.mid,  ease: ease.soft } satisfies Transition,
  hover:      { duration: dur.fast, ease: ease.glide } satisfies Transition,
  tap:        { duration: 0.12,     ease: ease.snap }  satisfies Transition,
} as const;

/** Common variant pairs for entrance animations. */
export const variants = {
  /** Fade + small lift — default for hero copy, card meta. */
  rise: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    exit:    { opacity: 0, y: -8 },
  },
  /** Fade only — for reduced-motion-friendly fallback. */
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit:    { opacity: 0 },
  },
  /** Stagger parent — pair with child {hidden,visible}. */
  staggerParent: (delayChildren = 0.1, staggerChildren = 0.07) => ({
    hidden:  {},
    visible: { transition: { delayChildren, staggerChildren } },
  }),
  staggerChild: {
    hidden:  { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0, transition: { duration: dur.mid, ease: ease.soft } },
  },
} as const;
