import { useCallback, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useReducedMotion } from '../lib/useReducedMotion';
import { dur, ease } from '../lib/motion';

/**
 * Profile — Trust Portrait.
 *
 * A layered, editorial "trust seal" that turns the profile's social-proof
 * section into the signature moment of the product.
 *
 * Visual stack (back → front):
 *   1. Warm ambient halo (radial gradient blob, GPU-cheap)
 *   2. Outer dotted ring — 24 dots, filled count = min(completedPickups, 24).
 *      Communicates "how many handoffs have actually happened."
 *   3. Rating arc — SVG conic-style stroke-dasharray, 0..5 → 0..360°.
 *      Ember-toned. Reads as a sundial of trust earned.
 *   4. Inner disc — donor's initials in big Fraunces, with a dot indicator.
 *   5. Cursor-parallax — each layer shifts slightly opposite the cursor for
 *      a 2.5D depth feel on hover-capable devices. Disabled on touch and
 *      under prefers-reduced-motion.
 *
 * Below the seal: a typographic ledger with the rating value, review count,
 * name, email, and trust badge.
 *
 * Pure presentation component. No backend access.
 */

export interface TrustPortraitProps {
  /** User's full display name; first/last initial extracted internally. */
  displayName: string;
  /** Public email for the social-proof line. */
  email: string;
  /** 0..5 average rating. 0 means "no rating yet". */
  rating: number;
  /** Number of reviews received. */
  reviewsReceived: number;
  /** Number of pickups completed (donor + recipient combined). */
  completedPickups: number;
  /** Computed trust label ("Trusted neighbor" / "Community member" / etc.). */
  trustLabel: string;
}

const RING_DOT_COUNT = 24;

function initialsFrom(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!)
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function TrustPortrait({
  displayName,
  email,
  rating,
  reviewsReceived,
  completedPickups,
  trustLabel,
}: TrustPortraitProps) {
  const reduced = useReducedMotion();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [mx, setMx] = useState(0); // -1..1 cursor offset from center
  const [my, setMy] = useState(0);

  const handleMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (reduced) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    setMx(Math.max(-1, Math.min(1, nx)));
    setMy(Math.max(-1, Math.min(1, ny)));
  }, [reduced]);

  const handleLeave = useCallback(() => {
    setMx(0);
    setMy(0);
  }, []);

  // Numbers
  const has = rating > 0 && reviewsReceived > 0;
  const ratingShown = has ? rating.toFixed(1) : '—';
  const ratingPct = Math.max(0, Math.min(1, rating / 5));
  const initials = initialsFrom(displayName);
  const dotsFilled = Math.max(0, Math.min(RING_DOT_COUNT, completedPickups));

  // Geometry
  const SIZE = 260;
  const CENTER = SIZE / 2;
  const ARC_RADIUS = 96;
  const ARC_STROKE = 4.5;
  const ARC_CIRC = 2 * Math.PI * ARC_RADIUS;
  const ARC_DASH = ARC_CIRC * ratingPct;
  const DOT_RADIUS = 116;

  // Cursor parallax (subtle — under 12px max travel per layer)
  const lay = (mult: number): React.CSSProperties => ({
    transform: reduced
      ? 'translate3d(0,0,0)'
      : `translate3d(${(-mx * mult).toFixed(2)}px, ${(-my * mult).toFixed(2)}px, 0)`,
    transition: 'transform 400ms cubic-bezier(0.22, 1, 0.36, 1)',
    willChange: 'transform',
  });

  return (
    <motion.section
      className="cc-trust"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: dur.slow, ease: ease.soft }}
      aria-label="Community reputation"
    >
      <div
        ref={wrapRef}
        className="cc-trust-seal"
        style={{ width: SIZE, height: SIZE }}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      >
        {/* Layer 1 — ambient halo */}
        <div className="cc-trust-halo" style={lay(4)} aria-hidden="true" />

        {/* Layer 2 — outer dotted ring (completed pickups quantified) */}
        <svg
          className="cc-trust-ring"
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={lay(8)}
          aria-hidden="true"
          focusable="false"
        >
          {Array.from({ length: RING_DOT_COUNT }).map((_, i) => {
            const angle = (i / RING_DOT_COUNT) * Math.PI * 2 - Math.PI / 2;
            const cx = CENTER + Math.cos(angle) * DOT_RADIUS;
            const cy = CENTER + Math.sin(angle) * DOT_RADIUS;
            const isOn = i < dotsFilled;
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={isOn ? 3 : 2}
                fill={isOn ? 'var(--forest-600)' : 'rgba(28, 53, 32, 0.18)'}
                opacity={isOn ? 0.92 : 0.7}
              />
            );
          })}
        </svg>

        {/* Layer 3 — rating arc */}
        <svg
          className="cc-trust-arc"
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={lay(6)}
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id="ccTrustArcGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FF7E48" />
              <stop offset="55%" stopColor="#E07A3C" />
              <stop offset="100%" stopColor="#C95F28" />
            </linearGradient>
          </defs>
          {/* track */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={ARC_RADIUS}
            fill="none"
            stroke="rgba(28, 53, 32, 0.10)"
            strokeWidth={ARC_STROKE}
          />
          {/* progress */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={ARC_RADIUS}
            fill="none"
            stroke="url(#ccTrustArcGrad)"
            strokeWidth={ARC_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${ARC_DASH} ${ARC_CIRC - ARC_DASH}`}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
            style={{ transition: 'stroke-dasharray 600ms cubic-bezier(0.22, 1, 0.36, 1)' }}
          />
        </svg>

        {/* Layer 4 — inner disc with initials */}
        <div className="cc-trust-disc" style={lay(2)}>
          <span className="cc-trust-disc-initials" aria-hidden="true">
            {initials}
          </span>
          <span className="cc-trust-disc-pulse" aria-hidden="true" />
        </div>
      </div>

      {/* Ledger */}
      <div className="cc-trust-ledger">
        <div className="cc-trust-ledger-eyebrow">
          <span className="cc-trust-ledger-num">№</span>
          <span>Community reputation</span>
        </div>
        <div className="cc-trust-ledger-rating">
          <span className="cc-trust-ledger-value">{ratingShown}</span>
          <span className="cc-trust-ledger-out">
            {has ? 'out of 5' : 'no reviews yet'}
          </span>
        </div>
        <div className="cc-trust-ledger-counts">
          <span className="cc-trust-ledger-count">
            <span className="cc-trust-ledger-count-num">{reviewsReceived}</span>
            <span className="cc-trust-ledger-count-lbl">
              {reviewsReceived === 1 ? 'review' : 'reviews'}
            </span>
          </span>
          <span className="cc-trust-ledger-dot" aria-hidden="true" />
          <span className="cc-trust-ledger-count">
            <span className="cc-trust-ledger-count-num">{completedPickups}</span>
            <span className="cc-trust-ledger-count-lbl">
              {completedPickups === 1 ? 'pickup' : 'pickups'}
            </span>
          </span>
        </div>
        <div className="cc-trust-ledger-id">
          <div className="cc-trust-ledger-name">{displayName}</div>
          <div className="cc-trust-ledger-email">{email}</div>
        </div>
        <div className="cc-trust-ledger-badge">{trustLabel}</div>
        <p className="cc-trust-ledger-copy">
          Built from completed pickups and reviews left by neighbors.
        </p>
      </div>
    </motion.section>
  );
}
