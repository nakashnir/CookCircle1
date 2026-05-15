/**
 * MetaArc — tiny SVG ring that visualises a 0..1 value (expiry urgency,
 * pickup progress, etc.). Fills counter-clockwise from 12 o'clock so a
 * full ring reads "lots of time" and a sliver reads "almost out."
 *
 * Designed as the signature card micro-graphic that distinguishes this
 * food app from the photo-on-top template every other one ships.
 *
 * `progress` is clamped to 0..1. Values past 0.66 stay forest, 0.33..0.66
 * shift to ember, < 0.33 shift to ember-pop (urgent).
 */
export function MetaArc({
  progress,
  size = 36,
  stroke = 3,
  label,
  tone,
  className,
}: {
  /** 0..1 — 1 = full ring, 0 = empty. */
  progress: number;
  size?: number;
  stroke?: number;
  /** Optional inner text (1–2 chars max). */
  label?: string;
  /** Override the auto-toned color. */
  tone?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, progress));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * clamped;

  // Auto-tone by urgency, but allow override
  const autoTone =
    clamped > 0.66
      ? 'var(--forest-500)'
      : clamped > 0.33
      ? 'var(--ember-400)'
      : 'var(--ember-pop)';
  const fg = tone ?? autoTone;

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        width: size,
        height: size,
        color: fg,
      }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.16}
          strokeWidth={stroke}
        />
        {/* progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray var(--mo-mid, 320ms) var(--ease-soft)' }}
        />
      </svg>
      {label && (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: Math.round(size * 0.32),
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'var(--ink-2)',
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
