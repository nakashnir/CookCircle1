import type { SVGProps } from 'react';

/**
 * Hand-curated SVG icon set for CookCircle chrome.
 *
 * Style: lucide-aligned (24x24, 1.6 stroke, round caps & joins). These
 * replace the emoji-as-iconography pattern (🍽 📍 ⏱ 🔍 ⭐) used in the
 * legacy CSS. Emoji can stay only as user-generated joy, never as
 * system iconography.
 *
 * Use with currentColor — color flows from the parent.
 */

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

function Base({
  size = 18,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Leaf: (p: IconProps) => (
    <Base {...p}>
      <path d="M11 20a8 8 0 0 1-8-8c0-5 4-9 9-9h6v6c0 5-4 9-9 9z" />
      <path d="M2 22 17 7" />
    </Base>
  ),
  Pin: (p: IconProps) => (
    <Base {...p}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </Base>
  ),
  Clock: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Base>
  ),
  Plate: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
    </Base>
  ),
  Search: (p: IconProps) => (
    <Base {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </Base>
  ),
  ArrowRight: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Base>
  ),
  ArrowLeft: (p: IconProps) => (
    <Base {...p}>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </Base>
  ),
  Check: (p: IconProps) => (
    <Base {...p}>
      <path d="m4 12 5 5 11-12" />
    </Base>
  ),
  Plus: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Base>
  ),
  Lock: (p: IconProps) => (
    <Base {...p}>
      <rect x="4" y="10" width="16" height="10" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Base>
  ),
  Spark: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M18.5 5.5l-2.8 2.8M8.3 15.7l-2.8 2.8" />
    </Base>
  ),
  Star: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3.5 14.5 9l6 .8-4.4 4.1 1.1 6L12 17l-5.2 2.9 1.1-6L3.5 9.8 9.5 9z" />
    </Base>
  ),
  Heart: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />
    </Base>
  ),
  /** A reputation dot — filled / hollow variants for star-alternative ratings. */
  Dot: ({ size = 12, filled = false, ...rest }: IconProps & { filled?: boolean }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.4}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <circle cx="6" cy="6" r="4.2" />
    </svg>
  ),
};

export type IconName = keyof typeof Icon;
