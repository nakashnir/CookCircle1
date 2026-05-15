import { useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import { CountUp, Eyebrow, Icon } from './ui';
import { dur, ease, variants } from '../lib/motion';
import { useReducedMotion } from '../lib/useReducedMotion';

/**
 * Editorial feed hero — magazine masthead for the donation feed.
 *
 * Replaces the legacy `.hero-panel` block (impact stats nested on the right).
 * The hero now owns the full bleed of the editorial statement; the impact
 * numbers move into a separate hairline-ruled ribbon underneath via
 * `<StatRibbon>` so the headline gets to breathe.
 *
 * Receives the four impact figures already computed by DonationFeed, so it
 * stays a pure presentation component.
 */
export interface FeedHeroProps {
  /** Optional greeting (first-name display) shown in the eyebrow. */
  greetingName?: string;
  /** Impact ribbon items — ordered. */
  impact: Array<{ value: string | number; label: string }>;
  /** Forwards the create donation CTA — primary action. */
  onCreate: () => void;
}

export function FeedHero({ greetingName, impact, onCreate }: FeedHeroProps) {
  const eyebrowText = greetingName
    ? `Hello, ${greetingName.split(' ')[0]}`
    : 'Tonight in your area';

  const reduced = useReducedMotion();
  const railRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number | null>(null);

  // Cursor parallax — uses CSS variables, write once per animation frame
  // (no React state churn). Disabled under reduced-motion.
  const handleRailMove = useCallback((e: React.MouseEvent) => {
    if (reduced) return;
    const el = railRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      el.style.setProperty('--rail-mx', String(Math.max(-1, Math.min(1, nx))));
      el.style.setProperty('--rail-my', String(Math.max(-1, Math.min(1, ny))));
    });
  }, [reduced]);

  const handleRailLeave = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    el.style.setProperty('--rail-mx', '0');
    el.style.setProperty('--rail-my', '0');
  }, []);

  return (
    <section className="cc-feed-hero" aria-labelledby="cc-feed-hero-title">
      {/* Ambient depth (single decorative element; respects reduced motion via CSS) */}
      <div className="cc-feed-hero-mesh" aria-hidden="true">
        <span className="cc-mesh-blob cc-mesh-blob--ember" />
        <span className="cc-mesh-blob cc-mesh-blob--forest" />
        <span className="cc-mesh-grain" />
      </div>

      <motion.div
        className="cc-feed-hero-content"
        variants={variants.staggerParent(0.1, 0.08)}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={variants.staggerChild}>
          <Eyebrow num={1} rule>{eyebrowText}</Eyebrow>
        </motion.div>

        <motion.h1
          id="cc-feed-hero-title"
          className="cc-feed-hero-title"
          variants={variants.staggerChild}
        >
          What's on the table
          <br />
          <em className="cc-italic">in your neighborhood.</em>
        </motion.h1>

        <motion.p className="cc-feed-hero-lede" variants={variants.staggerChild}>
          Fresh dishes, baked goods, pantry surplus — shared by people nearby,
          ready to be picked up on your way home.
        </motion.p>

        <motion.div className="cc-feed-hero-actions" variants={variants.staggerChild}>
          <motion.button
            type="button"
            className="cc-cta-primary cc-cta-primary--lg"
            onClick={onCreate}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            transition={{ duration: dur.fast, ease: ease.glide }}
          >
            <Icon.Plus size={16} />
            <span>Share something today</span>
          </motion.button>
          <a href="#cc-feed-grid" className="cc-cta-link">
            Browse the feed <Icon.ArrowRight size={14} />
          </a>
        </motion.div>
      </motion.div>

      {/* Right-side editorial card (lg+ only): a "what to expect" preview frame */}
      <motion.aside
        ref={railRef}
        className="cc-feed-hero-rail"
        aria-hidden="true"
        initial={{ opacity: 0, x: 24, rotate: 1.5 }}
        animate={{ opacity: 1, x: 0, rotate: 1.5 }}
        transition={{ duration: dur.slow, ease: ease.soft, delay: 0.35 }}
        onMouseMove={handleRailMove}
        onMouseLeave={handleRailLeave}
        style={{ ['--rail-mx' as any]: 0, ['--rail-my' as any]: 0 }}
      >
        <div className="cc-feed-hero-rail-frame">
          <div className="cc-feed-hero-rail-corner">№ 02 · Tonight</div>
          <div className="cc-feed-hero-rail-pile">
            <div className="cc-feed-hero-rail-card cc-feed-hero-rail-card--back" />
            <div className="cc-feed-hero-rail-card cc-feed-hero-rail-card--mid" />
            <div className="cc-feed-hero-rail-card cc-feed-hero-rail-card--front">
              {/* Editorial food thumbnail — inline SVG, GPU-cheap, no emoji */}
              <div className="cc-feed-hero-rail-thumb">
                <svg
                  className="cc-feed-hero-rail-thumb-art"
                  viewBox="0 0 120 80"
                  preserveAspectRatio="xMidYMid slice"
                  aria-hidden="true"
                  focusable="false"
                >
                  <defs>
                    <linearGradient id="ccTomatoSky" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FDE4C1" />
                      <stop offset="100%" stopColor="#F6C294" />
                    </linearGradient>
                    <radialGradient id="ccTomatoHalo" cx="50%" cy="48%" r="45%">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.55)" />
                      <stop offset="100%" stopColor="rgba(255,255,255,0)" />
                    </radialGradient>
                  </defs>
                  <rect width="120" height="80" fill="url(#ccTomatoSky)" />
                  <rect width="120" height="80" fill="url(#ccTomatoHalo)" />
                  {/* leaf shadow */}
                  <ellipse cx="74" cy="64" rx="22" ry="3" fill="rgba(28,53,32,0.10)" />
                  {/* small tomato */}
                  <g transform="translate(38 26)">
                    <path d="M14 8 Q12 4 16 3 Q19 2 22 5 Q26 1 30 4 Q34 0 36 6"
                          stroke="#3F6A44" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                    <circle cx="24" cy="22" r="14" fill="#E07A3C" />
                    <circle cx="24" cy="22" r="14" fill="url(#ccTomatoHalo)" />
                    <path d="M19 14 Q23 11 28 13" stroke="rgba(255,255,255,0.6)" strokeWidth="2.2" fill="none" strokeLinecap="round" />
                  </g>
                  {/* big tomato */}
                  <g transform="translate(60 14)">
                    <path d="M16 12 Q14 6 19 5 Q23 4 26 7 Q31 2 35 6 Q40 1 43 8 Q47 4 49 11"
                          stroke="#3F6A44" strokeWidth="2" fill="none" strokeLinecap="round" />
                    <circle cx="32" cy="32" r="20" fill="#C95F28" />
                    <circle cx="32" cy="32" r="20" fill="url(#ccTomatoHalo)" />
                    <path d="M22 22 Q28 16 36 19" stroke="rgba(255,255,255,0.55)" strokeWidth="3" fill="none" strokeLinecap="round" />
                  </g>
                </svg>
                <span className="cc-feed-hero-rail-thumb-pill">
                  <span className="cc-feed-hero-rail-thumb-pill-dot" />
                  Available
                </span>
              </div>
              <div className="cc-feed-hero-rail-eyebrow">№ 07 · RAANANA · 0.8 KM</div>
              <div className="cc-feed-hero-rail-title">Garden tomatoes</div>
              <div className="cc-feed-hero-rail-sub">Picked this morning · 6 portions</div>
              <div className="cc-feed-hero-rail-meta">
                <span className="cc-feed-hero-rail-avatar">EL</span>
                <span>From Eitan's garden</span>
                <span className="cc-feed-hero-rail-arc" />
              </div>
            </div>
          </div>
        </div>
      </motion.aside>

      <StatRibbon items={impact} />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  StatRibbon — masthead-style hairline-ruled impact strip                   */
/* -------------------------------------------------------------------------- */

function StatRibbon({ items }: { items: FeedHeroProps['impact'] }) {
  return (
    <motion.dl
      className="cc-stat-ribbon"
      aria-label="Community impact"
      variants={variants.staggerParent(0.5, 0.07)}
      initial="hidden"
      animate="visible"
    >
      {items.map((item, i) => (
        <motion.div key={item.label} className="cc-stat-cell" variants={variants.staggerChild}>
          <dt className="cc-stat-num" aria-hidden="true">
            <span className="cc-stat-num-marker">0{i + 1}</span>
            <span className="cc-stat-num-value">
              <CountUp value={item.value} duration={720} />
            </span>
          </dt>
          <dd className="cc-stat-label">{item.label}</dd>
        </motion.div>
      ))}
    </motion.dl>
  );
}
