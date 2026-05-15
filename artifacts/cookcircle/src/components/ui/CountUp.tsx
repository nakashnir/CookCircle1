import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../../lib/useReducedMotion';

/**
 * CountUp — animates a numeric value from 0 → target on mount.
 *
 * - Skips the animation under prefers-reduced-motion and lands on the final
 *   value instantly.
 * - Renders strings unchanged (e.g., "1.4 kg") so the stat ribbon can mix
 *   numeric and string values without special-casing.
 * - Uses requestAnimationFrame; no React state churn during the ramp.
 */
export function CountUp({
  value,
  duration = 600,
  className,
}: {
  value: number | string;
  duration?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState<string>(() => formatStart(value, reduced));
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // If non-numeric or reduced, just land on the final value.
    const target = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
    if (reduced || !Number.isFinite(target) || target === 0) {
      setDisplay(String(value));
      return;
    }
    const start = performance.now();
    const isInt = Number.isInteger(target);
    const suffix = typeof value === 'string' ? extractSuffix(value) : '';
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = target * eased;
      setDisplay(isInt ? String(Math.round(current)) + suffix : current.toFixed(1) + suffix);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(String(value));
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // Re-run if the upstream value changes
  }, [value, duration, reduced]);

  return <span className={className}>{display}</span>;
}

function formatStart(value: number | string, reduced: boolean): string {
  if (reduced) return String(value);
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n) || n === 0) return String(value);
  const suffix = typeof value === 'string' ? extractSuffix(value) : '';
  return '0' + suffix;
}

function extractSuffix(s: string): string {
  // Capture trailing non-numeric suffix like "kg" or "%"
  const m = s.match(/[a-zA-Z%]+$/);
  return m ? m[0] : '';
}
