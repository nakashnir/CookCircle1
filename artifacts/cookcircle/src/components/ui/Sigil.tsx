import { motion } from 'motion/react';
import { useReducedMotion } from '../../lib/useReducedMotion';
import { dur, ease } from '../../lib/motion';

/**
 * CookCircle brand mark — "Sigil".
 *
 * A circle of small dots converging to a single full dot at the center.
 * Reads as: the community gathering around a shared meal. Replaces the
 * legacy 🌿 emoji in chrome (header, auth, hero) so the brand renders
 * consistently across operating systems.
 *
 * Sizes via the `size` prop (CSS px). Color inherits from `currentColor`
 * unless `tone` is overridden.
 */
export function Sigil({
  size = 32,
  tone = 'currentColor',
  background = 'var(--forest-800)',
  rounded = true,
  animated = false,
  className,
}: {
  size?: number;
  tone?: string;
  background?: string;
  rounded?: boolean;
  animated?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const showMotion = animated && !reduced;

  const dots = [
    { x: 50, y: 14 },   // top
    { x: 75, y: 25 },   // top-right
    { x: 86, y: 50 },   // right
    { x: 75, y: 75 },   // bottom-right
    { x: 50, y: 86 },   // bottom
    { x: 25, y: 75 },   // bottom-left
    { x: 14, y: 50 },   // left
    { x: 25, y: 25 },   // top-left
  ];

  const Wrapper = showMotion ? motion.span : 'span';

  return (
    <Wrapper
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: rounded ? Math.round(size * 0.32) : 0,
        background,
        boxShadow:
          'inset 0 0 0 1px rgba(255,255,255,0.06), 0 6px 16px -8px rgba(15,28,18,0.45)',
        color: tone,
      }}
      {...(showMotion
        ? {
            initial: { rotate: -8, scale: 0.92 },
            animate: { rotate: 0, scale: 1 },
            transition: { duration: dur.slow, ease: ease.soft },
          }
        : {})}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 100 100"
        width={Math.round(size * 0.62)}
        height={Math.round(size * 0.62)}
        fill="none"
        role="presentation"
      >
        {/* outer dots */}
        {dots.map((d, i) =>
          showMotion ? (
            <motion.circle
              key={i}
              cx={d.x}
              cy={d.y}
              r={5}
              fill={tone}
              opacity={0.85}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 0.85, scale: 1 }}
              transition={{
                duration: dur.mid,
                ease: ease.soft,
                delay: 0.05 + i * 0.04,
              }}
            />
          ) : (
            <circle
              key={i}
              cx={d.x}
              cy={d.y}
              r={5}
              fill={tone}
              opacity={0.85}
            />
          ),
        )}
        {/* center filled dot */}
        {showMotion ? (
          <motion.circle
            cx={50}
            cy={50}
            r={10}
            fill={tone}
            initial={{ scale: 0.2, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: dur.mid, ease: ease.soft, delay: 0.42 }}
          />
        ) : (
          <circle cx={50} cy={50} r={10} fill={tone} />
        )}
      </svg>
    </Wrapper>
  );
}
