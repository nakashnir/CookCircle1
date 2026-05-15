import type { ReactNode } from 'react';

/**
 * Editorial eyebrow / kicker label.
 *
 * Renders as: `№ 03  ·  TONIGHT IN TEL AVIV` — uppercase, wide-tracked,
 * with an optional numeric prefix for that newspapery byline feel.
 * Sits above titles to give pages and cards a sense of placement.
 *
 * Usage:
 *   <Eyebrow num={3}>Tonight in Tel Aviv</Eyebrow>
 *   <Eyebrow>From the community</Eyebrow>
 */
export function Eyebrow({
  num,
  children,
  tone = 'var(--ink-soft)',
  size = 'md',
  rule = false,
  className,
}: {
  /** Optional numeric prefix shown as `№ 03`. Pads to 2 digits. */
  num?: number;
  children: ReactNode;
  tone?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Add a horizontal rule after the label (newspaper section feel). */
  rule?: boolean;
  className?: string;
}) {
  const fontSize = size === 'sm' ? 10.5 : size === 'lg' ? 13 : 12;
  const padded = num != null ? String(num).padStart(2, '0') : null;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: tone,
        fontFamily: 'var(--font-sans)',
        fontSize,
        fontWeight: 700,
        letterSpacing: 'var(--track-eyebrow)',
        textTransform: 'uppercase',
        lineHeight: 1,
      }}
    >
      {padded != null && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 500,
            letterSpacing: '0.04em',
            opacity: 0.85,
          }}
          aria-hidden="true"
        >
          № {padded}
        </span>
      )}
      {padded != null && (
        <span
          style={{
            width: 14,
            height: 1,
            background: 'currentColor',
            opacity: 0.4,
          }}
          aria-hidden="true"
        />
      )}
      <span>{children}</span>
      {rule && (
        <span
          style={{
            flex: 1,
            height: 1,
            background: 'currentColor',
            opacity: 0.2,
            marginLeft: 4,
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
