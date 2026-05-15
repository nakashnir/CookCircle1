import { motion } from 'motion/react';
import { Eyebrow, Icon, MetaArc } from './ui';
import { dur, ease, spring } from '../lib/motion';
import type { DonationWithDistance, User, DonationStatus, DietaryTag } from '../lib/api';

/**
 * DonationCard — the signature card of the product.
 *
 * Editorial layout: image on top with a MetaArc time-ring in the corner
 * (signature micro-graphic that visualises expiry urgency), a numbered
 * mono eyebrow giving the card its byline, a Fraunces title, and a
 * conversational "from <donor>'s kitchen" line. Hover applies a soft
 * spring lift + image zoom.
 *
 * Pure presentation; the donor object is resolved in the parent feed.
 */

/* ------------------------------------------------------------------ helpers */
function expiryHint(iso: string): { label: string; progress: number; soon: boolean } | null {
  if (!iso) return null;
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  const ms = target - Date.now();
  if (ms < 0) return { label: 'Expired', progress: 0, soon: true };

  const hours = ms / (1000 * 60 * 60);
  // Progress: 48h+ = full ring, 0h = empty
  const progress = Math.max(0, Math.min(1, hours / 48));

  let label: string;
  if (hours < 1) {
    const m = Math.max(1, Math.round(ms / (1000 * 60)));
    label = `${m}m`;
  } else if (hours < 24) {
    label = `${Math.round(hours)}h`;
  } else {
    const d = Math.round(hours / 24);
    label = `${d}d`;
  }
  return { label, progress, soon: hours < 6 };
}

function pickFoodEmojiFallback(foodType?: string | null): string {
  // Keep emoji as last-resort image fallback ONLY — never used in chrome.
  // Kept here so cards without a real photo still get a tasteful glyph.
  if (!foodType) return '🥘';
  const t = foodType.toLowerCase();
  if (t.includes('bread') || t.includes('bake')) return '🍞';
  if (t.includes('soup'))   return '🍲';
  if (t.includes('salad'))  return '🥗';
  if (t.includes('fruit'))  return '🍓';
  if (t.includes('veg'))    return '🥕';
  if (t.includes('past'))   return '🍝';
  if (t.includes('rice'))   return '🍚';
  if (t.includes('cheese')) return '🧀';
  if (t.includes('drink'))  return '🥤';
  return '🥘';
}

function isPlaceholderUrl(url?: string | null): boolean {
  if (!url) return true;
  return /\bplaceholder\b/i.test(url);
}

function statusLabel(status: DonationStatus): string {
  switch (status) {
    case 'available':  return 'Available';
    case 'reserved':   return 'Reserved';
    case 'picked_up':  return 'Picked up';
    case 'cancelled':  return 'Cancelled';
    case 'expired':    return 'Expired';
    default:           return String(status);
  }
}

function dietaryLabel(tag: DietaryTag): string {
  const labels: Record<DietaryTag, string> = {
    kosher: 'Kosher',
    gluten_free: 'Gluten-free',
    vegan: 'Vegan',
    vegetarian: 'Vegetarian',
  };
  return labels[tag] ?? tag;
}

/* ------------------------------------------------------------------ image */
function CardImage({ url, foodType, seedId }: { url?: string | null; foodType?: string | null; seedId: number }) {
  const isPlaceholder = isPlaceholderUrl(url);
  const gradIdx = ((seedId ?? 0) + (foodType ? foodType.length : 0)) % 6;
  if (!isPlaceholder && url) {
    return (
      <img
        src={url}
        alt={foodType ?? 'Shared food'}
        className="cc-card-photo"
        loading="lazy"
      />
    );
  }
  // Typographic plate fallback — Fraunces over a warm grad. Far more grown-up
  // than the legacy oversized 🥣 emoji.
  return (
    <div className={`cc-card-plate cc-grad-${gradIdx}`} role="img" aria-label={foodType ?? 'Shared food'}>
      <span className="cc-card-plate-glyph" aria-hidden>
        {pickFoodEmojiFallback(foodType)}
      </span>
      <span className="cc-card-plate-text">{foodType ?? 'Surplus food'}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ card */
export function DonationCard({
  donation,
  donor,
  onViewDetails,
  index = 0,
}: {
  donation: DonationWithDistance;
  donor: User;
  onViewDetails: (id: number) => void;
  index?: number;
}) {
  const expiry = expiryHint(donation.expiryDate);
  const initials = donor.displayName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const firstName = donor.displayName.split(' ')[0];

  // Card position in the feed gives us a stable number, capped to 99.
  const stationNumber = Math.min(index + 1, 99);
  const showExpiry =
    expiry && (donation.status === 'available' || donation.status === 'reserved');

  return (
    <motion.article
      className={`cc-card cc-card--status-${donation.status}`}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: dur.mid,
        delay: Math.min(index * 0.06, 0.4),
        ease: ease.soft,
      }}
      whileHover={{ y: -6 }}
      whileTap={{ scale: 0.995 }}
      // Keep the whole card clickable but preserve focus on inner button
      onClick={() => onViewDetails(donation.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onViewDetails(donation.id);
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      {/* Image plate — layoutId enables Feed→Details shared-layout transition.
          Motion handles position+size animation across the screen change;
          contents (chrome pills, arc) crossfade naturally. */}
      <motion.div
        layoutId={`donation-photo-${donation.id}`}
        className="cc-card-image"
      >
        <CardImage
          url={donation.imageUrl}
          foodType={donation.foodType}
          seedId={donation.id}
        />

        {/* Status — top left, glassy */}
        <span className={`cc-status cc-status--${donation.status}`}>
          <span className="cc-status-dot" />
          {statusLabel(donation.status)}
        </span>

        {/* Time-arc — top right, signature micro-graphic */}
        {showExpiry && (
          <div className="cc-card-arc" aria-label={`Expires in ${expiry!.label}`}>
            <MetaArc
              progress={expiry!.progress}
              size={46}
              stroke={3.5}
              label={expiry!.label}
            />
          </div>
        )}

        {/* Distance — bottom right */}
        {donation.distanceKm != null && (
          <span className="cc-card-distance">
            <Icon.Pin size={12} />
            {donation.distanceKm.toFixed(1)} km
          </span>
        )}
      </motion.div>

      {/* Body */}
      <div className="cc-card-body">
        <Eyebrow num={stationNumber} size="sm">
          {donation.city}
        </Eyebrow>

        <h3 className="cc-card-title">{donation.title}</h3>

        {donation.foodType && (
          <p className="cc-card-type">{donation.foodType}</p>
        )}

        <div className="cc-card-byline">
          <span className="cc-card-avatar" aria-hidden>{initials}</span>
          <span className="cc-card-byline-text">
            From <span className="cc-card-byline-name">{firstName}</span>'s kitchen
          </span>
          <span className="cc-card-rating" title={`${donor.rating.toFixed(1)} of 5`}>
            <Icon.Star size={13} />
            <span>{donor.rating.toFixed(1)}</span>
          </span>
        </div>

        <div className="cc-card-meta">
          <span className="cc-card-meta-item">
            <Icon.Plate size={13} />
            <span>{donation.quantity}</span>
          </span>
          {donation.dietaryTags.length > 0 && (
            <span className="cc-card-tagstrip">
              {donation.dietaryTags.map((t) => (
                <span key={t} className="cc-tag">{dietaryLabel(t)}</span>
              ))}
            </span>
          )}
        </div>

        <motion.button
          type="button"
          className="cc-card-cta"
          onClick={(e) => {
            e.stopPropagation();
            onViewDetails(donation.id);
          }}
          transition={spring.snappy}
          aria-label={`View details for ${donation.title}`}
        >
          <span>View details</span>
          <Icon.ArrowRight size={15} />
        </motion.button>
      </div>
    </motion.article>
  );
}
