import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { dur, ease } from './lib/motion';
import { AuthScreen } from './components/AuthScreen';
import { Header } from './components/Header';
import { FeedHero } from './components/FeedHero';
import { DonationCard } from './components/DonationCard';
import { TrustPortrait } from './components/TrustPortrait';
import { CountUp, Eyebrow, Icon } from './components/ui';
import {
  api,
  type DietaryTag,
  type Donation,
  type DonationListOptions,
  type DonationStatus,
  type DonationWithDistance,
  type GeocodePreview,
  type PickupRequest,
  type RequestStatus,
  type Review,
  type User,
  type HealthStatus,
} from './lib/api';
import {
  PREVIEW_CURRENT_USER,
  PREVIEW_DONATIONS,
  PREVIEW_REQUESTS,
  PREVIEW_REVIEWS,
  PREVIEW_USERS,
} from './previewData';

// ---------------------------------------------------------------------------
// UI Preview Mode — dev-only visual inspection bypass.
//
// Activated when running the Vite dev server AND ANY of:
//   - env var VITE_UI_PREVIEW=true  (set before `pnpm dev`)
//   - URL query   ?preview=1
//   - URL query   ?uiPreview=1     (legacy, kept for backwards compat)
//
// Never active in production builds: `import.meta.env.DEV` is false after
// `vite build`, so preview mode is impossible to ship by accident.
//
// In preview mode the app:
//   - Auto-logs in as PREVIEW_CURRENT_USER (no /api/auth/* call)
//   - Loads mock donations / requests / reviews / users from previewData.ts
//   - Short-circuits every api.* mutation with a "[Preview] …" toast
//   - Returns a synthetic GeocodePreview from the location-check step
//   - Neuters logout so the user stays in preview
// ---------------------------------------------------------------------------
const IS_UI_PREVIEW: boolean = (() => {
  if (typeof window === 'undefined') return false;
  const env = (import.meta as any).env ?? {};
  if (!env.DEV) return false; // never in production builds

  const envFlag = String(env.VITE_UI_PREVIEW ?? '').toLowerCase();
  if (envFlag === 'true' || envFlag === '1' || envFlag === 'yes') return true;

  const q = new URLSearchParams(window.location.search);
  if (q.get('preview') === '1' || q.get('uiPreview') === '1') return true;

  return false;
})();

/**
 * Build a high-confidence GeocodePreview without calling /api.
 * Used only when IS_UI_PREVIEW is true so the location-confirm step in
 * Create / Edit Donation can render end-to-end without a backend.
 */
/**
 * Defensive scroll reset that hits every plausible scroll container.
 *
 * Why we need this:
 *   - `index.css` base layer sets `html, body, #root { height: 100% }` and
 *     `body { overflow-x: hidden }`. That makes <body> a scrolling box in
 *     addition to <html>; `document.scrollingElement` can be either depending
 *     on browser, and `window.scrollTo` only reaches the scrollingElement.
 *   - We don't know at runtime which element is actually scrolling, so we
 *     reset all of them. This is cheap (each scrollTo is a no-op when there's
 *     nothing to scroll) and bulletproof.
 *   - `behavior: 'auto'` overrides any inherited `scroll-behavior: smooth`
 *     CSS rule, so the reset is instant.
 */
function resetDocumentScroll(): void {
  if (typeof window === 'undefined') return;

  try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch { /* ignore */ }

  if (document.documentElement) {
    document.documentElement.scrollTop = 0;
    document.documentElement.scrollLeft = 0;
  }
  if (document.body) {
    document.body.scrollTop = 0;
    document.body.scrollLeft = 0;
  }

  const targets: Array<Element | null> = [
    document.getElementById('cc-main'),
    document.getElementById('root'),
    document.querySelector('.cc-app-shell'),
  ];
  for (const el of targets) {
    if (el && el instanceof HTMLElement) {
      try { el.scrollTo({ top: 0, left: 0, behavior: 'auto' }); } catch { /* ignore */ }
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  }
}

function syntheticGeocodePreview(
  street: string,
  houseNumber: string,
  city: string,
): GeocodePreview {
  // Deterministic-ish coords inside greater Tel Aviv based on street name.
  const hash = (street + city).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const lat = 32.07 + ((hash % 60) - 30) / 1000;    // ~±0.030 ≈ ±3.3km
  const lng = 34.78 + ((hash % 80) - 40) / 1000;
  return {
    areaLat: Number(lat.toFixed(5)),
    areaLng: Number(lng.toFixed(5)),
    exactLat: Number(lat.toFixed(5)),
    exactLng: Number(lng.toFixed(5)),
    areaRadiusMeters: 500,
    formattedAddress: `${street}${houseNumber ? ' ' + houseNumber : ''}, ${city}`,
    status: 'ok',
    precision: 'rooftop',
    provider: 'local',
  };
}

const ISRAELI_CITIES = [
  'Tel Aviv', 'Jerusalem', 'Haifa', 'Beer Sheva', 'Rishon LeZion',
  'Petah Tikva', 'Ashdod', 'Netanya', 'Holon', 'Bnei Brak',
  'Ramat Gan', 'Herzliya', 'Bat Yam', 'Kfar Saba', "Ra'anana",
  'Rehovot', "Modi'in", 'Ashkelon', 'Eilat', 'Tiberias',
  'Nazareth', 'Hadera', 'Acre', 'Lod', 'Ramla',
];

// ---------------------------------------------------------------------------
// Google Maps Places Autocomplete — street field enhancement
//
// Uses the modern Places API (New) via AutocompleteSuggestion +
// PlacePrediction.toPlace() + fetchFields(). No legacy Autocomplete class.
//
// Requires VITE_GOOGLE_MAPS_PUBLIC_KEY (browser-safe public key).
// Degrades gracefully to plain text input when key is absent.
// ---------------------------------------------------------------------------
const GMAPS_KEY: string | undefined =
  typeof import.meta !== 'undefined'
    ? (import.meta as any).env?.VITE_GOOGLE_MAPS_PUBLIC_KEY || undefined
    : undefined;

let gmapsLoadPromise: Promise<void> | null = null;

function loadGoogleMaps(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).google?.maps?.places?.AutocompleteSuggestion) return Promise.resolve();
  if (gmapsLoadPromise) return gmapsLoadPromise;
  gmapsLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // v=beta is required to access the Places API (New) classes
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&v=beta&libraries=places&language=en&region=IL`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { gmapsLoadPromise = null; reject(new Error('Failed to load Google Maps')); };
    document.head.appendChild(s);
  });
  return gmapsLoadPromise;
}

interface PlaceSelectData {
  street: string;
  houseNumber?: string;
  city?: string;
}

function StreetAutocompleteInput({ id, value, onChange, onPlaceSelect, className, required }: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onPlaceSelect?: (data: PlaceSelectData) => void;
  className?: string;
  required?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = useRef<any>(null);

  const [gmapsReady, setGmapsReady] = useState(
    typeof window !== 'undefined' &&
      !!(window as any).google?.maps?.places?.AutocompleteSuggestion,
  );
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  // Load the Maps JS API once if a public key is configured
  useEffect(() => {
    if (!GMAPS_KEY || gmapsReady) return;
    loadGoogleMaps().then(() => setGmapsReady(true)).catch(() => {});
  }, []);

  // Create a fresh session token once the API is ready
  useEffect(() => {
    if (!gmapsReady) return;
    const g = (window as any).google;
    sessionTokenRef.current = new g.maps.places.AutocompleteSessionToken();
  }, [gmapsReady]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Debounced suggestion fetch using the new AutocompleteSuggestion API
  const fetchSuggestions = useCallback((input: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!input || input.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const g = (window as any).google;
        const { suggestions: results } =
          await g.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input,
            includedRegionCodes: ['il'],
            includedPrimaryTypes: ['address'],
            sessionToken: sessionTokenRef.current,
          });
        setSuggestions(results ?? []);
        setOpen((results ?? []).length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      }
    }, 200);
  }, []);

  const handleInput = (v: string) => {
    onChange(v);
    if (gmapsReady) fetchSuggestions(v);
  };

  // Resolve the selected suggestion into structured address fields
  const handleSelect = async (suggestion: any) => {
    setOpen(false);
    setSuggestions([]);
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({ fields: ['addressComponents'] });
      // Rotate the session token after a selection (billing best-practice)
      const g = (window as any).google;
      sessionTokenRef.current = new g.maps.places.AutocompleteSessionToken();

      let route = '';
      let streetNumber = '';
      let city = '';
      for (const c of (place.addressComponents ?? []) as any[]) {
        const types: string[] = c.types ?? [];
        if (types.includes('route')) route = c.longText ?? '';
        else if (types.includes('street_number')) streetNumber = c.longText ?? '';
        else if (types.includes('locality')) city = c.longText ?? '';
        else if (!city && types.includes('sublocality_level_1')) city = c.longText ?? '';
      }
      onChange(route);
      onPlaceSelect?.({ street: route, houseNumber: streetNumber || undefined, city: city || undefined });
    } catch {
      // If place detail fetch fails keep whatever the user typed
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        placeholder="e.g., Rothschild Blvd"
        className={className}
        aria-required={required}
        aria-autocomplete="list"
        aria-expanded={open}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg max-h-56 overflow-y-auto"
        >
          {suggestions.map((s, i) => {
            const label: string = s.placePrediction?.text?.toString() ?? '';
            return (
              <li
                key={i}
                role="option"
                aria-selected={false}
                className="px-3 py-2 text-sm text-zinc-800 cursor-pointer hover:bg-emerald-50 hover:text-emerald-700 first:rounded-t-lg last:rounded-b-lg"
                // mousedown fires before blur so we can prevent the input losing focus
                onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
              >
                {label}
              </li>
            );
          })}
        </ul>
      )}
      {GMAPS_KEY && !gmapsReady && (
        <p className="text-[11px] text-zinc-400 mt-1">Loading address suggestions…</p>
      )}
      {!GMAPS_KEY && (
        <p className="text-[11px] text-zinc-400 mt-1">Address suggestions unavailable — type the street name manually.</p>
      )}
    </div>
  );
}

// Shared location confirmation step UI — used by both Create and Edit flows
function LocationConfirmStep({
  street, houseNumber, city, pickupNotes,
  geoPreview, onBack, onConfirm, confirmLabel,
  submitting = false,
}: {
  street: string; houseNumber: string; city: string; pickupNotes: string;
  geoPreview: GeocodePreview;
  onBack: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  /** When true, disable the confirm button + show a pending label.
   *  Prevents duplicate submissions if the parent's async submit is still in flight. */
  submitting?: boolean;
}) {
  // Sprint 3: five distinct geocode outcome states backed by real backend signals.
  // High-confidence: Google confirmed rooftop or interpolated street-level precision.
  // Approximate: Google matched but at neighborhood/city-center level only — lower accuracy.
  // NotFound: Google ran but returned zero results — cannot publish.
  // Error: Google key configured but API call failed — degrade honestly.
  // Fallback: No Google key — demo/local mode.
  const isHighConfidence =
    geoPreview.status === 'ok' &&
    (geoPreview.precision === 'rooftop' || geoPreview.precision === 'interpolated');
  const isApproximate = geoPreview.status === 'ok' && !isHighConfidence;
  const isNotFound = geoPreview.status === 'zero_results';
  const isError = geoPreview.status === 'error';
  const isFallback = geoPreview.status === 'fallback';
  // Any non-found state that still allows publish with confirmation
  const canPublishWithConfirmation = isApproximate || isError || isFallback;

  return (
    <div className="max-w-2xl">
      <div className="card p-6 space-y-5">
        {/* Address summary */}
        <div className="flex items-start gap-3 pb-4 border-b border-zinc-100">
          <span className="text-xl mt-0.5" aria-hidden>📍</span>
          <div>
            <div className="detail-label mb-1">Pickup address</div>
            <div className="font-semibold text-[#1c3520] text-[15px]">
              {[street, houseNumber].filter(Boolean).join(' ')}
            </div>
            <div className="text-sm text-[#4b5d4d]">{city}, Israel</div>
            {pickupNotes && <div className="text-sm text-[#6b7d6e] mt-1">📝 {pickupNotes}</div>}
          </div>
        </div>

        {/* Geocode status banner — one of five states */}
        {isHighConfidence && (
          <div className="rounded-xl px-4 py-3 bg-green-50 border border-green-200 text-green-800 text-sm">
            <div className="font-semibold">✓ Address verified</div>
            {geoPreview.formattedAddress && (
              <div className="mt-1 text-green-700">{geoPreview.formattedAddress}</div>
            )}
            <div className="mt-1 text-green-600 text-[11.5px]">
              Precision: {geoPreview.precision}
            </div>
          </div>
        )}
        {isApproximate && (
          <div className="rounded-xl px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            <div className="font-semibold mb-1">⚠️ Approximate match — lower location accuracy</div>
            {geoPreview.formattedAddress && (
              <div className="mb-1 text-amber-700">{geoPreview.formattedAddress}</div>
            )}
            <div>Google matched this address at neighborhood or area level only. The shown location may be off by several hundred meters. Requesters will see only the general area regardless.</div>
          </div>
        )}
        {isNotFound && (
          <div className="rounded-xl px-4 py-3 bg-red-50 border border-red-200 text-red-800 text-sm">
            <div className="font-semibold mb-1">❌ Address not found</div>
            <div>Google could not locate this address. Please go back and check the street name, house number, and city — then try again.</div>
          </div>
        )}
        {isError && (
          <div className="rounded-xl px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            <div className="font-semibold mb-1">⚠️ Location check failed</div>
            <div>The geocoding service returned an error. An approximate area position will be used. Only the general neighborhood will be shown to requesters. Exact address is revealed only to approved recipients.</div>
          </div>
        )}
        {isFallback && (
          <div className="rounded-xl px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            <div className="font-semibold mb-1">⚠️ Location not verified</div>
            <div>No geocoding service is connected — an approximate position will be used. Only the general neighborhood will be shown to requesters. Exact address is revealed only to approved recipients.</div>
          </div>
        )}

        {/* Area map — what the public sees (always shown when coords available) */}
        {geoPreview.areaLat != null && geoPreview.areaLng != null && (
          <div>
            <div className="detail-label mb-2">
              {isHighConfidence
                ? 'What requesters see — approximate neighborhood only'
                : isApproximate
                  ? 'Approximate area shown to requesters (lower-confidence match)'
                  : 'General area that will be shown publicly'}
            </div>
            <div className="map-frame">
              <iframe
                title="Area map preview"
                className="w-full h-52 block"
                loading="lazy"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${geoPreview.areaLng - 0.04}%2C${geoPreview.areaLat - 0.025}%2C${geoPreview.areaLng + 0.04}%2C${geoPreview.areaLat + 0.025}&layer=mapnik`}
              />
            </div>
            <div className="map-area-label">
              <span aria-hidden>🔵</span>
              {isHighConfidence
                ? 'Approximate neighborhood · Exact address revealed only on approval'
                : isApproximate
                  ? 'Approximate area · Lower-confidence match — only general area will be shown'
                  : 'Approximate area · Location not verified — only general area will be shown'}
            </div>
          </div>
        )}

        {/* Exact map — only when Google returned high-confidence rooftop/interpolated coords */}
        {isHighConfidence && geoPreview.exactLat != null && geoPreview.exactLng != null && (
          <div>
            <div className="detail-label mb-2">Your exact pickup location (shown only to approved recipients)</div>
            <div className="map-frame">
              <iframe
                title="Exact pickup location"
                className="w-full h-48 block"
                loading="lazy"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${geoPreview.exactLng - 0.005}%2C${geoPreview.exactLat - 0.003}%2C${geoPreview.exactLng + 0.005}%2C${geoPreview.exactLat + 0.003}&layer=mapnik&marker=${geoPreview.exactLat}%2C${geoPreview.exactLng}`}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button onClick={onBack} className="btn-secondary flex-1">← Edit address</button>
          {isNotFound ? (
            <button onClick={onBack} className="btn-primary flex-1" disabled={submitting}>Fix address</button>
          ) : (
            <button
              onClick={onConfirm}
              className="btn-primary flex-1"
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting
                ? `${confirmLabel.replace(/^Confirm & /, '')}…`
                : isHighConfidence
                  ? confirmLabel
                  : `${confirmLabel} anyway`}
            </button>
          )}
        </div>
        {canPublishWithConfirmation && (
          <p className="text-[11.5px] text-[#8a9b8c] text-center">
            {isApproximate
              ? 'You can publish with an approximate match. Requesters only see the general neighborhood — exact details are protected until you approve their request.'
              : 'You can publish without a verified location. Requesters will only see the general neighborhood — exact pickup details are protected until you approve their request.'}
          </p>
        )}
      </div>
    </div>
  );
}

function formatDonationAddress(donation: Donation, canSeeAddress: boolean): string {
  if (!canSeeAddress) return donation.city;
  const street = [donation.street, donation.houseNumber].filter(Boolean).join(' ');
  if (street) return `${street}, ${donation.city}`;
  if (donation.address) return `${donation.address}, ${donation.city}`;
  return donation.city;
}

const FOOD_EMOJI_MAP: Array<{ match: RegExp; emoji: string }> = [
  { match: /produce|veg|fruit|salad/i, emoji: '🥬' },
  { match: /bake|bread|pastry|cake/i, emoji: '🥐' },
  { match: /prepared|meal|cooked|soup/i, emoji: '🍲' },
  { match: /non.?perishable|canned|pantry/i, emoji: '🥫' },
  { match: /dairy|cheese|milk|yogurt/i, emoji: '🧀' },
  { match: /meat|seafood|fish|poultry/i, emoji: '🍱' },
];

function pickFoodEmoji(foodType?: string | null): string {
  if (!foodType) return '🥗';
  for (const { match, emoji } of FOOD_EMOJI_MAP) if (match.test(foodType)) return emoji;
  return '🥗';
}

function isPlaceholderUrl(url?: string | null): boolean {
  if (!url) return true;
  // data: URLs are actual uploaded images stored locally — treat as real
  if (url.startsWith('data:')) return false;
  return /picsum\.photos/i.test(url);
}

function DonationImage({ url, foodType, seedId, large = false }: {
  url?: string | null;
  foodType?: string | null;
  seedId?: number;
  large?: boolean;
}) {
  if (url && !isPlaceholderUrl(url)) {
    return <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" />;
  }
  const gradIdx = ((seedId ?? 0) + (foodType ? foodType.length : 0)) % 6;
  const emoji = pickFoodEmoji(foodType);
  return (
    <div className={`absolute inset-0 flex items-center justify-center food-grad-${gradIdx}`}>
      <span className={large ? 'food-emoji-lg' : 'food-emoji'}>{emoji}</span>
    </div>
  );
}


export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'feed' | 'details' | 'create' | 'edit' | 'my-donations' | 'requests' | 'review' | 'profile'>('feed');
  const [selectedDonationId, setSelectedDonationId] = useState<number | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [editDonationId, setEditDonationId] = useState<number | null>(null);
  const [donations, setDonations] = useState<DonationWithDistance[]>([]);
  // Unfiltered donation index (status=any) used by Details/Edit/MyDonations/
  // MyRequests/Review screens so the feed's status filter cannot hide
  // donations that are still referenced by other lifecycle flows.
  const [allDonations, setAllDonations] = useState<DonationWithDistance[]>([]);
  const [requests, setRequests] = useState<PickupRequest[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<'loading' | 'unauthed' | 'authed'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);

  // Feed filter / sort / proximity state — owned at App level so it survives
  // navigation and can be re-applied after mutations.
  const [filterCity, setFilterCity] = useState<string>('');
  const [filterDietary, setFilterDietary] = useState<DietaryTag | ''>('');
  const [filterStatus, setFilterStatus] = useState<DonationStatus | 'any'>('available');
  const [sortMode, setSortMode] = useState<'newest' | 'expiring' | 'nearest'>('newest');
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [originError, setOriginError] = useState<string | null>(null);

  const showToast = (kind: 'success' | 'error', message: string) => {
    setToast({ kind, message });
    window.setTimeout(() => setToast(null), 3000);
  };

  const buildDonationOpts = useCallback((): DonationListOptions => {
    const opts: DonationListOptions = {
      status: filterStatus,
      sort: sortMode,
    };
    if (filterCity) opts.city = filterCity;
    if (filterDietary) opts.dietary = [filterDietary];
    if (origin) {
      opts.lat = origin.lat;
      opts.lng = origin.lng;
    }
    return opts;
  }, [filterCity, filterDietary, filterStatus, sortMode, origin]);

  const loadDonations = useCallback(async () => {
    if (IS_UI_PREVIEW) return;
    try {
      const d = await api.listDonations(buildDonationOpts());
      setDonations(d);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message ?? 'Failed to load donations');
    }
  }, [buildDonationOpts]);

  const refreshAll = async () => {
    if (IS_UI_PREVIEW) return;
    try {
      const [d, mine, r, rv, allUsers, health] = await Promise.all([
        api.listDonations(buildDonationOpts()),
        api.listDonations({ status: 'any' }),
        api.listRequests(),
        api.listReviews(),
        api.listUsers(),
        api.getHealth().catch(() => null),
      ]);
      setDonations(d);
      setAllDonations(mine);
      setRequests(r);
      setReviews(rv);
      setUsers(allUsers);
      if (health) setHealthStatus(health);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message ?? 'Failed to load data');
    }
  };

  useEffect(() => {
    if (IS_UI_PREVIEW) {
      setCurrentUser(PREVIEW_CURRENT_USER);
      setDonations(PREVIEW_DONATIONS);
      setAllDonations(PREVIEW_DONATIONS);
      setRequests(PREVIEW_REQUESTS);
      setReviews(PREVIEW_REVIEWS);
      setUsers(PREVIEW_USERS);
      setAuthState('authed');
      return;
    }
    api.getCurrentUser()
      .then(user => {
        setCurrentUser(user);
        setAuthState('authed');
        refreshAll();
      })
      .catch(() => {
        setAuthState('unauthed');
      });
    /* eslint-disable-next-line */
  }, []);
  useEffect(() => { loadDonations(); }, [loadDonations]);

  // ── Navigation scroll-reset ──────────────────────────────────────────────
  // The previous (simpler) fix called `window.scrollTo` on the navKey change,
  // but it did not actually reset scroll in the running browser. Two reasons:
  //
  //   1. `index.css` base layer sets `html, body, #root { height: 100% }` and
  //      `body { overflow-x: hidden }`. Per CSS spec, when one overflow axis
  //      is non-`visible`, the other becomes `auto` — so `<body>` itself is a
  //      scrolling box. Depending on browser quirks, `document.scrollingElement`
  //      can end up as `<body>` or `<html>`, and `window.scrollTo` doesn't
  //      always reach the correct one. We reset every plausible scroll target.
  //
  //   2. Sprint 3 added `<AnimatePresence mode="wait">` around the screens.
  //      That keeps the OUTGOING screen mounted (and scroll-height tall) for
  //      ~320 ms after the user clicks. A single synchronous `scrollTo` fires
  //      before the new screen mounts, then the outgoing screen unmounts and
  //      the new one's layout may settle the scroll position back. We chain
  //      three resets — sync, rAF, and a 360 ms timeout that lands after the
  //      exit animation completes — so the final scroll position is always 0.
  //
  // We also disable the browser's native scroll-restoration so it doesn't
  // race us on back/forward navigation.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { history.scrollRestoration = 'manual'; } catch { /* ignore */ }
  }, []);

  const navKey = `${currentScreen}|${selectedDonationId ?? ''}|${selectedRequestId ?? ''}|${editDonationId ?? ''}`;
  useLayoutEffect(() => {
    if (authState !== 'authed') return;

    // Mutable refs for the rAF + timeout handles; the cleanup closure captures
    // them so it can cancel whichever phase is in-flight when the user
    // navigates again before the chain completes.
    const handles: { raf1: number; raf2: number | null; t: number | null } = {
      raf1: 0,
      raf2: null,
      t: null,
    };

    // Phase 1 — synchronous reset before paint
    resetDocumentScroll();

    // Phase 2 — next frame, after layout settles for this render
    handles.raf1 = requestAnimationFrame(() => {
      resetDocumentScroll();

      // Phase 3 — frame after that, catches layout in-between with
      // AnimatePresence mode="wait"
      handles.raf2 = requestAnimationFrame(() => {
        resetDocumentScroll();

        // Phase 4 — final safety reset after the exit animation has finished
        // (Sprint 3 screen cross-fade dur.mid = 320 ms; we add a margin).
        handles.t = window.setTimeout(resetDocumentScroll, 380);
      });
    });

    return () => {
      cancelAnimationFrame(handles.raf1);
      if (handles.raf2 != null) cancelAnimationFrame(handles.raf2);
      if (handles.t != null) window.clearTimeout(handles.t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navKey, authState]);

  const useMyLocation = () => {
    setOriginError(null);
    if (!navigator.geolocation) {
      setOriginError('Geolocation not supported in this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setOriginError(err.message || 'Could not get location'),
      { timeout: 8000 },
    );
  };

  const clearOrigin = () => { setOrigin(null); if (sortMode === 'nearest') setSortMode('newest'); };

  const handleAuthSuccess = (user: User) => {
    setCurrentUser(user);
    setAuthState('authed');
    refreshAll();
  };

  const handleLogout = async () => {
    if (IS_UI_PREVIEW) {
      // In preview mode there is no real session; keep the user in the
      // mock-data experience instead of bouncing them to the auth screen.
      showToast('success', '[Preview] Sign-out disabled — refresh to reset');
      return;
    }
    try { await api.logout(); } catch { /* ignore */ }
    setCurrentUser(null);
    setAuthState('unauthed');
    setDonations([]);
    setAllDonations([]);
    setRequests([]);
    setReviews([]);
    setCurrentScreen('feed');
  };

  const viewDonationDetails = (donationId: number) => {
    setSelectedDonationId(donationId);
    setCurrentScreen('details');
  };

  const runMutation = async (label: string, op: () => Promise<unknown>, successMsg?: string) => {
    if (IS_UI_PREVIEW) {
      showToast('success', `[Preview] ${successMsg ?? label} — not persisted`);
      return true;
    }
    setBusy(true);
    try {
      await op();
      await refreshAll();
      if (successMsg) showToast('success', successMsg);
      return true;
    } catch (err: any) {
      showToast('error', `${label}: ${err?.message ?? 'failed'}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createPickupRequest = async (donationId: number, pickupTime: string, notes: string, discreetPickup: boolean) => {
    const ok = await runMutation('Send request', () =>
      api.createPickupRequest(donationId, pickupTime, notes, discreetPickup),
      'Pickup request sent',
    );
    if (ok) setCurrentScreen('requests');
  };

  const createDonation = async (donation: Omit<Donation, 'id' | 'donorId' | 'status' | 'createdAt'> & { image?: { data: string } }) => {
    const ok = await runMutation('Create donation', () =>
      api.createDonation(donation),
      'Donation published',
    );
    if (ok) setCurrentScreen('my-donations');
  };

  const updateDonation = async (donationId: number, patch: Partial<Donation>) => {
    const ok = await runMutation('Update donation', () =>
      api.updateDonation(donationId, patch),
      'Donation updated',
    );
    if (ok) setCurrentScreen('my-donations');
  };

  const updateRequestStatus = async (requestId: number, newStatus: RequestStatus) => {
    const labels: Record<RequestStatus, string> = {
      pending: 'Set to pending',
      approved: 'Approve request',
      cancelled: 'Cancel request',
      completed: 'Complete pickup',
    };
    await runMutation(
      labels[newStatus],
      () => api.setRequestStatus(requestId, newStatus),
      newStatus === 'approved' ? 'Request approved' : newStatus === 'cancelled' ? 'Request cancelled' : newStatus === 'completed' ? 'Pickup marked complete' : undefined,
    );
  };

  const openReviewScreen = (requestId: number) => {
    setSelectedRequestId(requestId);
    setCurrentScreen('review');
  };

  const openEditScreen = (donationId: number) => {
    setEditDonationId(donationId);
    setCurrentScreen('edit');
  };

  const saveProfile = async (patch: Partial<Pick<User, 'displayName' | 'email' | 'phone' | 'dietaryPreferences' | 'discreetPickup'>>) => {
    if (!currentUser) return;
    const ok = await runMutation('Save profile', () =>
      api.updateUser(currentUser.id, patch),
      'Profile saved',
    );
    if (ok) setCurrentScreen('feed');
  };

  const submitReview = async (requestId: number, rating: number, comment: string) => {
    const ok = await runMutation('Submit review', () =>
      api.submitReview(requestId, rating, comment),
      'Review submitted',
    );
    if (ok) setCurrentScreen('requests');
  };

  const deleteDonation = async (donationId: number) => {
    await runMutation('Delete donation', () =>
      api.deleteDonation(donationId),
      'Donation deleted',
    );
  };

  const setDonationStatus = async (donationId: number, next: DonationStatus) => {
    const labels: Partial<Record<DonationStatus, string>> = {
      cancelled: 'Donation cancelled',
      expired: 'Donation marked expired',
      available: 'Donation reopened',
    };
    await runMutation('Update status', () =>
      api.updateDonation(donationId, { status: next }),
      labels[next],
    );
  };

  if (authState === 'loading') {
    return <FullScreenLoader />;
  }

  if (authState === 'unauthed') {
    return <AuthScreen onLogin={handleAuthSuccess} />;
  }

  if (!currentUser) {
    return loadError ? <FullScreenError message={loadError} /> : <FullScreenLoader />;
  }

  return (
    <div className="min-h-screen cc-app-shell">
      <a href="#cc-main" className="cc-skip-link">Skip to content</a>
      {IS_UI_PREVIEW && (
        <div className="ui-preview-banner" role="status">
          UI Preview Mode — mock data only
        </div>
      )}
      <Header
        currentScreen={currentScreen}
        onNavigate={setCurrentScreen}
        currentUser={currentUser}
        onLogout={handleLogout}
      />
      <main id="cc-main" className="max-w-wide mx-auto px-4 md:px-8 py-6 md:py-8">
        {loadError && (
          <div className="cc-inline-alert" role="alert">
            <span className="cc-inline-alert-dot" aria-hidden="true" />
            <span>{loadError}</span>
          </div>
        )}
        <AnimatePresence>
          {toast && (
            <motion.div
              key="cc-toast"
              className={`cc-toast-overlay ${toast.kind === 'success' ? 'is-success' : 'is-error'}`}
              role="status"
              aria-live="polite"
              initial={{ opacity: 0, y: -12, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96, transition: { duration: 0.18, ease: ease.snap } }}
              transition={{ type: 'spring', stiffness: 320, damping: 26, mass: 0.8 }}
            >
              <span className="cc-toast-dot" aria-hidden="true" />
              {toast.message}
            </motion.div>
          )}
        </AnimatePresence>
        {busy && (
          <div className="cc-busy-pip" aria-live="polite">
            <span className="cc-busy-pip-dot" aria-hidden="true" />
            Working…
          </div>
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentScreen}
            className="cc-screen"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: dur.mid, ease: ease.soft }}
          >
            {currentScreen === 'feed' && (
              <DonationFeed
                donations={donations}
                impactDonations={allDonations}
                pickupRequests={requests}
                users={users}
                currentUser={currentUser}
                onCreate={() => setCurrentScreen('create')}
                onViewDetails={viewDonationDetails}
                filterCity={filterCity} setFilterCity={setFilterCity}
                filterDietary={filterDietary} setFilterDietary={setFilterDietary}
                filterStatus={filterStatus} setFilterStatus={setFilterStatus}
                sortMode={sortMode} setSortMode={setSortMode}
                origin={origin}
                useMyLocation={useMyLocation}
                clearOrigin={clearOrigin}
                originError={originError}
                locationFallback={healthStatus ? healthStatus.location === 'local' : true}
              />
            )}
            {currentScreen === 'details' && selectedDonationId && (() => {
              const d = allDonations.find(x => x.id === selectedDonationId);
              const donor = d ? users.find(u => u.id === d.donorId) : undefined;
              if (!d || !donor) return <EmptyState message="Donation not found" />;
              return (
                <DonationDetails
                  donation={d}
                  donor={donor}
                  onBack={() => setCurrentScreen('feed')}
                  onSubmitRequest={createPickupRequest}
                  currentUserId={currentUser.id}
                  requests={requests}
                  reviews={reviews}
                  locationFallback={healthStatus ? healthStatus.location === 'local' : true}
                />
              );
            })()}
            {currentScreen === 'create' && <CreateDonation onBack={() => setCurrentScreen('feed')} onSubmit={createDonation} />}
            {currentScreen === 'edit' && editDonationId && (() => {
              const d = allDonations.find(x => x.id === editDonationId);
              if (!d) return <EmptyState message="Donation not found" />;
              return (
                <EditDonation
                  donation={d}
                  onBack={() => setCurrentScreen('my-donations')}
                  onSubmit={(patch) => updateDonation(editDonationId, patch)}
                />
              );
            })()}
            {currentScreen === 'my-donations' && (
              <MyDonations
                donations={allDonations.filter(d => d.donorId === currentUser.id)}
                requests={requests}
                reviews={reviews}
                users={users}
                onViewDetails={viewDonationDetails}
                onDelete={deleteDonation}
                onEdit={openEditScreen}
                onApprove={(rid: number) => updateRequestStatus(rid, 'approved')}
                onDecline={(rid: number) => updateRequestStatus(rid, 'cancelled')}
                onSetStatus={setDonationStatus}
              />
            )}
            {currentScreen === 'requests' && (
              <MyRequests
                requests={requests.filter(r => r.requesterId === currentUser.id)}
                donations={allDonations}
                users={users}
                onViewDonation={viewDonationDetails}
                onUpdateStatus={updateRequestStatus}
                onLeaveReview={openReviewScreen}
                reviews={reviews}
              />
            )}
            {currentScreen === 'review' && selectedRequestId && (() => {
              const req = requests.find(r => r.id === selectedRequestId);
              const d = req ? allDonations.find(x => x.id === req.donationId) : undefined;
              const donor = d ? users.find(u => u.id === d.donorId) : undefined;
              if (!req || !d || !donor) return <EmptyState message="Pickup not found" />;
              return (
                <ReviewRating
                  request={req}
                  donation={d}
                  donor={donor}
                  onBack={() => setCurrentScreen('requests')}
                  onSubmit={(rating: number, comment: string) => submitReview(selectedRequestId!, rating, comment)}
                />
              );
            })()}
            {currentScreen === 'profile' && (
              <Profile
                user={currentUser}
                donations={allDonations}
                requests={requests}
                reviews={reviews}
                onBack={() => setCurrentScreen('feed')}
                onSave={saveProfile}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}


function FullScreenLoader() {
  return (
    <div className="cc-fullscreen" role="status" aria-live="polite">
      <span className="cc-loader-glyph" aria-hidden="true" />
      <Eyebrow size="sm" tone="var(--ink-faint)">CookCircle</Eyebrow>
      <p className="cc-fullscreen-copy">Setting the table…</p>
    </div>
  );
}

function FullScreenError({ message }: { message: string }) {
  return (
    <div className="cc-fullscreen cc-fullscreen--error" role="alert">
      <div className="cc-empty-glyph cc-empty-glyph--error" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 8v5" />
          <path d="M12 17h.01" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </div>
      <Eyebrow size="sm" tone="var(--ink-faint)">Something went wrong</Eyebrow>
      <h2 className="cc-empty-title">We couldn't load your data.</h2>
      <p className="cc-empty-copy">{message}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: DonationStatus | RequestStatus }) {
  // Editorial cc-status pill: dot + word. Same visual language as donation cards.
  // The dot is meaningful (semantic color) and the label is the redundant text
  // signal — so status is never communicated by color alone (a11y).
  const label = status.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  return (
    <span className={`cc-status cc-status--${status}`} role="status" aria-label={`Status: ${label}`}>
      <span className="cc-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function DietaryTagBadge({ tag }: { tag: DietaryTag }) {
  const labels: Record<DietaryTag, string> = {
    kosher: 'Kosher', gluten_free: 'Gluten-free', vegan: 'Vegan', vegetarian: 'Vegetarian',
  };
  return <span className="cc-tag">{labels[tag]}</span>;
}

function EmptyState({ message, title }: { message: string; title?: string }) {
  return (
    <motion.div
      className="cc-empty"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="cc-empty-glyph" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
        </svg>
      </div>
      {title && <h3 className="cc-empty-title">{title}</h3>}
      <p className="cc-empty-copy">{message}</p>
    </motion.div>
  );
}

function ProductEmptyState({
  title,
  message,
  action,
  onAction,
  icon: _legacyIcon,
}: {
  title: string;
  message: string;
  action?: string;
  onAction?: () => void;
  /** Legacy prop, ignored — the editorial empty state renders its own glyph. */
  icon?: string;
}) {
  return (
    <motion.div
      className="cc-empty"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="cc-empty-glyph" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
        </svg>
      </div>
      <Eyebrow size="sm" tone="var(--ink-faint)">An empty plate</Eyebrow>
      <h3 className="cc-empty-title">{title}</h3>
      <p className="cc-empty-copy">{message}</p>
      {action && (
        onAction ? (
          <button type="button" onClick={onAction} className="cc-empty-action">{action}</button>
        ) : (
          <div className="cc-empty-note">{action}</div>
        )
      )}
    </motion.div>
  );
}

function expiryHint(iso: string): { label: string; soon: boolean } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms < 0) return { label: 'Expired', soon: true };
  const hours = Math.round(ms / (1000 * 60 * 60));
  if (hours < 24) return { label: `${hours}h left`, soon: hours <= 6 };
  const days = Math.round(hours / 24);
  return { label: `${days}d left`, soon: false };
}

const COMPLETED_DONATION_STATUSES = new Set(['completed', 'picked_up', 'collected', 'shared', 'fulfilled']);
const COMPLETED_REQUEST_STATUSES = new Set(['completed', 'picked_up', 'fulfilled', 'collected']);

function normalizeStatus(status: unknown): string {
  return String(status ?? '').trim().toLowerCase();
}

function isCompletedDonationStatus(status: unknown): boolean {
  return COMPLETED_DONATION_STATUSES.has(normalizeStatus(status));
}

function isCompletedRequestStatus(status: unknown): boolean {
  return COMPLETED_REQUEST_STATUSES.has(normalizeStatus(status));
}

function estimateQuantityKg(quantity: unknown): number {
  const text = String(quantity ?? '').trim().toLowerCase();
  if (!text) return 0.5;

  const numberMatch = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!numberMatch) return 0.5;

  const value = Number(numberMatch[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return 0.5;

  if (/\b(kilograms?|kilos?|kgs?|kg)\b/.test(text)) return value;
  if (/\b(portions?|servings?|meals?|people|person|plates?)\b/.test(text)) return value * 0.45;

  return Math.max(0.5, value * 0.45);
}

function calculateImpactStats(
  donations?: DonationWithDistance[],
  pickupRequests?: PickupRequest[],
) {
  const safeDonations = Array.isArray(donations) ? donations : [];
  const safeRequests = Array.isArray(pickupRequests) ? pickupRequests : [];
  const completedDonations = safeDonations.filter(d => isCompletedDonationStatus(d?.status));
  const completedRequests = safeRequests.filter(r => isCompletedRequestStatus(r?.status));
  const mealsShared = completedDonations.length > 0 ? completedDonations.length : completedRequests.length;
  const requestDonationIds = new Set(completedRequests.map(r => r?.donationId).filter(id => id != null));
  const foodSavedDonations = completedDonations.length > 0
    ? completedDonations
    : safeDonations.filter(d => requestDonationIds.has(d?.id));
  const foodSavedKg = foodSavedDonations.reduce((total, donation) => (
    total + estimateQuantityKg(donation?.quantity)
  ), 0);
  const citiesCovered = new Set(
    safeDonations
      .map(d => String(d?.city ?? '').trim())
      .filter(Boolean)
      .map(city => city.toLowerCase()),
  ).size;

  return {
    mealsShared,
    pickupsCompleted: completedRequests.length,
    foodSavedKg,
    citiesCovered,
  };
}

function formatKg(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value < 10 && !Number.isInteger(value)) return value.toFixed(1);
  return String(Math.round(value));
}


function DonationFeed({
  donations, impactDonations, pickupRequests, users, currentUser, onCreate, onViewDetails,
  filterCity, setFilterCity,
  filterDietary, setFilterDietary,
  filterStatus, setFilterStatus,
  sortMode, setSortMode,
  origin, useMyLocation, clearOrigin, originError,
  locationFallback,
}: {
  donations: DonationWithDistance[];
  impactDonations?: DonationWithDistance[];
  pickupRequests?: PickupRequest[];
  users: User[];
  currentUser?: User | null;
  onCreate: () => void;
  onViewDetails: (id: number) => void;
  filterCity: string; setFilterCity: (v: string) => void;
  filterDietary: DietaryTag | ''; setFilterDietary: (v: DietaryTag | '') => void;
  filterStatus: DonationStatus | 'any'; setFilterStatus: (v: DonationStatus | 'any') => void;
  sortMode: 'newest' | 'expiring' | 'nearest'; setSortMode: (v: 'newest' | 'expiring' | 'nearest') => void;
  origin: { lat: number; lng: number } | null;
  useMyLocation: () => void;
  clearOrigin: () => void;
  originError: string | null;
  locationFallback: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const visible = donations.filter((d) =>
    !searchQuery || d.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const hasFeedFilters = Boolean(searchQuery || filterCity || filterDietary || filterStatus !== 'available');
  const resetFeedFilters = () => {
    setSearchQuery('');
    setFilterCity('');
    setFilterDietary('');
    setFilterStatus('available');
  };

  const cities = Array.from(new Set(donations.map(d => d.city)));

  const impactStats = calculateImpactStats(impactDonations ?? donations, pickupRequests);
  const impactItems = [
    { value: impactStats.mealsShared, label: 'Meals shared' },
    { value: impactStats.pickupsCompleted, label: 'Pickups completed' },
    { value: formatKg(impactStats.foodSavedKg), label: 'kg saved est.' },
    { value: impactStats.citiesCovered, label: 'Cities covered' },
  ];

  return (
    <div>
      <FeedHero
        greetingName={currentUser?.displayName}
        impact={impactItems}
        onCreate={onCreate}
      />

      {/* ── Filter / search bar ── */}
      <div className="filter-card mb-8">
        <div className="input-affix mb-4">
          <span className="input-affix-icon">🔍</span>
          <input
            type="text"
            placeholder="Search by name, ingredient, or dish…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="filter-row">
          <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)} className="input-field filter-select">
            <option value="">All cities</option>
            {cities.map(city => <option key={city} value={city}>{city}</option>)}
          </select>
          <select value={filterDietary} onChange={(e) => setFilterDietary(e.target.value as DietaryTag | '')} className="input-field filter-select">
            <option value="">All dietary</option>
            <option value="vegan">Vegan</option>
            <option value="vegetarian">Vegetarian</option>
            <option value="gluten_free">Gluten-Free</option>
            <option value="kosher">Kosher</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as DonationStatus | 'any')} className="input-field filter-select">
            <option value="available">● Available</option>
            <option value="reserved">Reserved</option>
            <option value="picked_up">Picked up</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
            <option value="any">Any status</option>
          </select>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as any)} className="input-field filter-select">
            <option value="newest">↓ Newest first</option>
            <option value="expiring">⏱ Expiring soon</option>
            {!locationFallback && (
              <option value="nearest" disabled={!origin}>📍 Nearest{origin ? '' : ' (needs location)'}</option>
            )}
          </select>
        </div>
        {(!locationFallback || originError) && (
          <div className="mt-3 flex items-center gap-3 text-sm flex-wrap">
            {!locationFallback && (
              origin ? (
                <>
                  <span className="distance-pill">📍 Using your location</span>
                  <button onClick={clearOrigin} className="btn-ghost">Clear</button>
                </>
              ) : (
                <button onClick={useMyLocation} className="btn-ghost">📍 Use my location</button>
              )
            )}
            {originError && <span className="text-red-600 text-xs">{originError}</span>}
          </div>
        )}
      </div>

      {/* ── Donation grid ── */}
      {visible.length === 0 ? (
        <ProductEmptyState
          icon="🔍"
          title={donations.length === 0 ? 'No food shares yet.' : 'No matching food shares yet.'}
          message={donations.length === 0 ? 'Fresh listings will appear here as neighbors post surplus meals and pantry items.' : 'Try changing your filters or check back soon. Fresh listings move quickly.'}
          action={hasFeedFilters ? 'Clear filters' : 'Create a donation from the top navigation'}
          onAction={hasFeedFilters ? resetFeedFilters : undefined}
        />
      ) : (
        <div id="cc-feed-grid" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visible.map((d, idx) => {
            const donor = users.find(u => u.id === d.donorId);
            if (!donor) return null;
            return <DonationCard key={d.id} donation={d} donor={donor} onViewDetails={onViewDetails} index={idx} />;
          })}
        </div>
      )}
    </div>
  );
}

function DonationDetails({ donation, donor, onBack, onSubmitRequest, currentUserId, requests, reviews, locationFallback }: {
  donation: Donation; donor: User; onBack: () => void; onSubmitRequest: any; currentUserId: number; requests: PickupRequest[]; reviews: Review[]; locationFallback?: boolean;
}) {
  const [pickupTime, setPickupTime] = useState('');
  const [notes, setNotes] = useState('');
  const [discreetPickup, setDiscreetPickup] = useState(false);

  const handleSubmit = () => {
    if (!pickupTime) { alert('Please select a pickup time'); return; }
    onSubmitRequest(donation.id, pickupTime, notes, discreetPickup);
  };

  const formatDateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const isOwnDonation = donation.donorId === currentUserId;

  // Find this viewer's request for this specific donation
  const viewerRequest = requests.find(r => r.donationId === donation.id);
  const donationRequests = requests.filter(r => r.donationId === donation.id);
  const donationReviews = reviews.filter(r => r.donationId === donation.id);
  const isApprovedRequester = viewerRequest?.status === 'approved' || viewerRequest?.status === 'completed';
  const isPendingRequester  = viewerRequest?.status === 'pending';

  const canSeeAddress = donation.canSeeAddress ?? false;

  // Sprint 4: pre-computed location state for viewer-aware map rendering.
  // hasExactCoords: true only when viewer is allowed to see AND Google provided real coords.
  // hasAreaCoords: always-available privacy-safe area coords (~500 m offset in Google mode).
  // showAreaMap: area map shown before approval OR when revealed but exact coords unavailable (fallback).
  // isVerifiedArea: areaRadiusMeters=500 means Google-verified 500m offset; null = unverified/local mode.
  // revealedButNoExact: canSeeAddress=true but no exact coords — donor/approved in fallback mode.
  const hasExactCoords = canSeeAddress && donation.latitude != null && donation.longitude != null;
  const hasAreaCoords = donation.areaLatitude != null && donation.areaLongitude != null;
  const showAreaMap = hasAreaCoords && (!canSeeAddress || !hasExactCoords);
  const isVerifiedArea = donation.areaRadiusMeters != null;
  const revealedButNoExact = canSeeAddress && !hasExactCoords;
  const hasRequested = !!viewerRequest || donationRequests.length > 0 || donation.status === 'reserved' || donation.status === 'picked_up';
  const hasApproved = donationRequests.some(r => r.status === 'approved' || r.status === 'completed') || donation.status === 'reserved' || donation.status === 'picked_up';
  const hasPickedUp = donation.status === 'picked_up' || donationRequests.some(r => r.status === 'completed');
  const hasReviewed = donationReviews.length > 0;
  const activeLifecycleIndex = hasReviewed ? 4 : hasPickedUp ? 3 : hasApproved ? 2 : hasRequested ? 1 : 0;
  const lifecycleItems = [
    { label: 'Available', complete: activeLifecycleIndex > 0, active: activeLifecycleIndex === 0 },
    { label: 'Requested', complete: activeLifecycleIndex > 1, active: activeLifecycleIndex === 1 },
    { label: 'Approved', complete: activeLifecycleIndex > 2, active: activeLifecycleIndex === 2 },
    { label: 'Picked up', complete: activeLifecycleIndex > 3, active: activeLifecycleIndex === 3 },
    { label: 'Reviewed', complete: hasReviewed, active: activeLifecycleIndex === 4 },
  ];
  const nextMessage = hasReviewed
    ? 'Thanks for helping the community reduce waste.'
    : hasPickedUp
      ? 'You can leave a review after pickup is complete.'
      : isApprovedRequester
        ? 'Pickup details are unlocked.'
        : isPendingRequester
          ? 'Your request is waiting for approval.'
          : donation.status === 'available'
            ? 'Send a request and wait for donor approval.'
            : 'This donation is no longer open for new pickup requests.';
  const privacyTitle = canSeeAddress
    ? 'Exact pickup details unlocked'
    : 'General area only';
  const privacyCopy = canSeeAddress
    ? 'The exact pickup address is available for this approved pickup. Handle it with care.'
    : 'Exact pickup details are revealed only after the donor approves a request.';
  const primaryReview = donationReviews[0];

  return (
    <div>
      <button onClick={onBack} className="cc-back" aria-label="Back to feed">
        <span aria-hidden="true">←</span>
        <span>Back to the feed</span>
      </button>

      <motion.header
        className="cc-details-header"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="cc-details-meta">
          <span className="cc-details-meta-num">№ {String(donation.id).padStart(2, '0')}</span>
          <span className="cc-details-meta-dot" />
          <span className="cc-details-meta-city">{donation.city}</span>
          {'distanceKm' in donation && typeof (donation as DonationWithDistance).distanceKm === 'number' && (
            <>
              <span className="cc-details-meta-dot" />
              <span className="cc-details-meta-distance">{(donation as DonationWithDistance).distanceKm!.toFixed(1)} km away</span>
            </>
          )}
        </div>
        <h1 className="cc-details-title">{donation.title}</h1>
        {donation.foodType && (
          <p className="cc-details-kicker">{donation.foodType} · from {donor.displayName.split(' ')[0]}'s kitchen</p>
        )}
      </motion.header>

      <motion.ol
        className="cc-lifecycle"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
        aria-label="Donation lifecycle"
      >
        {lifecycleItems.map((item, index) => (
          <li
            key={item.label}
            className={`cc-lifecycle-step ${item.complete ? 'is-complete' : ''} ${item.active ? 'is-active' : ''}`}
            aria-current={item.active ? 'step' : undefined}
          >
            <span className="cc-lifecycle-num" aria-hidden="true">
              {item.complete ? '✓' : String(index + 1).padStart(2, '0')}
            </span>
            <span className="cc-lifecycle-label">{item.label}</span>
            {index < lifecycleItems.length - 1 && <span className="cc-lifecycle-rule" aria-hidden="true" />}
          </li>
        ))}
      </motion.ol>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        <div>
          <motion.div
            layoutId={`donation-photo-${donation.id}`}
            className="cc-details-photo"
            transition={{
              layout: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
              default: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
            }}
          >
            <DonationImage url={donation.imageUrl} foodType={donation.foodType} seedId={donation.id} large />
            <div className="cc-details-photo-status">
              <StatusBadge status={donation.status} />
            </div>
          </motion.div>
          <motion.div
            className="cc-panel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
          >
            <dl className="cc-pillstrip">
              <div className="cc-pill">
                <dt>Quantity</dt>
                <dd>{donation.quantity}</dd>
              </div>
              <div className="cc-pill">
                <dt>City</dt>
                <dd>{donation.city}</dd>
              </div>
              <div className="cc-pill">
                <dt>Expires</dt>
                <dd>{formatDateTime(donation.expiryDate)}</dd>
              </div>
              {'distanceKm' in donation && typeof (donation as DonationWithDistance).distanceKm === 'number' && (
                <div className="cc-pill">
                  <dt>Distance</dt>
                  <dd>{(donation as DonationWithDistance).distanceKm!.toFixed(1)} km</dd>
                </div>
              )}
            </dl>

            <section className="cc-field">
              <Eyebrow size="sm">About this share</Eyebrow>
              <p className="cc-field-value">{donation.description}</p>
            </section>

            {donation.dietaryTags.length > 0 && (
              <section className="cc-field">
                <Eyebrow size="sm">Dietary</Eyebrow>
                <div className="flex gap-2 flex-wrap">
                  {donation.dietaryTags.map((tag) => <DietaryTagBadge key={tag} tag={tag} />)}
                </div>
              </section>
            )}

            <section className="cc-field">
              <Eyebrow size="sm">Pickup location</Eyebrow>
              <div className={`cc-privacy ${canSeeAddress ? 'is-unlocked' : ''}`}>
                <Icon.Lock size={16} />
                <div className="cc-privacy-text">
                  <div className="cc-privacy-title">{privacyTitle}</div>
                  <div className="cc-privacy-copy">{privacyCopy}</div>
                </div>
                <span className="cc-privacy-meta">
                  {canSeeAddress ? 'Exact visible' : 'Exact hidden'}
                </span>
              </div>
              <div className="cc-location-row">
                <Icon.Pin size={18} />
                <div>
                  <div className="cc-field-value">{formatDonationAddress(donation, canSeeAddress)}</div>
                  {canSeeAddress && donation.formattedAddress && (
                    <div className="cc-field-note">{donation.formattedAddress}</div>
                  )}
                  {canSeeAddress && donation.pickupNotes && (
                    <div className="cc-field-note">Note from the donor — {donation.pickupNotes}</div>
                  )}
                  {!canSeeAddress && (
                    <div className="cc-field-note">
                      {isPendingRequester
                        ? 'Exact pickup location confirmed after the donor approves your request.'
                        : 'Exact address shared once your request is approved.'}
                    </div>
                  )}
                </div>
              </div>

                {/* Area map: shown before approval (public/pending) OR as fallback when revealed
                    but exact coords are unavailable (donor/approved in local/demo mode).
                    areaRadiusMeters distinguishes verified-offset (500) from unverified (null). */}
                {showAreaMap && (
                  <div>
                    <div className="map-frame">
                      <iframe
                        title={revealedButNoExact ? 'Approximate area map' : 'General area map'}
                        className="w-full h-48 block"
                        loading="lazy"
                        src={`https://www.openstreetmap.org/export/embed.html?bbox=${donation.areaLongitude! - 0.04}%2C${donation.areaLatitude! - 0.025}%2C${donation.areaLongitude! + 0.04}%2C${donation.areaLatitude! + 0.025}&layer=mapnik`}
                      />
                    </div>
                    <div className="map-area-label">
                      <span aria-hidden="true">{revealedButNoExact ? '⚠️' : '🔵'}</span>
                      {revealedButNoExact
                        ? 'Location not verified — area approximation only · OpenStreetMap'
                        : isVerifiedArea
                          ? 'Approximate area · Exact address shared after approval'
                          : 'Approximate area · Location not verified — exact address shared after approval'}
                    </div>
                  </div>
                )}

                {/* Exact map: only when Google provided verified exact coords for this viewer.
                    Never renders in local/fallback mode (latitude is always null there). */}
                {hasExactCoords && (
                  <div>
                    <div className="map-frame">
                      <iframe
                        title="Exact pickup location map"
                        className="w-full h-52 block"
                        loading="lazy"
                        src={`https://www.openstreetmap.org/export/embed.html?bbox=${donation.longitude! - 0.005}%2C${donation.latitude! - 0.003}%2C${donation.longitude! + 0.005}%2C${donation.latitude! + 0.003}&layer=mapnik&marker=${donation.latitude}%2C${donation.longitude}`}
                      />
                    </div>
                    <div className="map-area-label">
                      <span aria-hidden="true">📍</span>
                      {(donation.geocodePrecision === 'center' || donation.geocodePrecision === 'approximate')
                        ? 'Approximate location · Area-level precision only · OpenStreetMap'
                        : 'Exact pickup location · OpenStreetMap'}
                    </div>
                  </div>
                )}
            </section>

            <section className="cc-field cc-donor">
              <Eyebrow size="sm">Donor</Eyebrow>
              <div className="cc-donor-row">
                <span className="cc-donor-avatar" aria-hidden="true">
                  {donor.displayName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                </span>
                <div className="cc-donor-body">
                  <div className="cc-donor-name">{donor.displayName}</div>
                  <div className="cc-donor-rating" aria-label={`Rating: ${donor.rating.toFixed(1)} of 5 from ${donor.reviewCount} reviews`}>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <Icon.Dot key={i} size={10} filled={i < Math.round(donor.rating)} />
                    ))}
                    <span className="cc-donor-rating-value">{donor.rating.toFixed(1)}</span>
                    <span className="cc-donor-rating-count">· {donor.reviewCount} {donor.reviewCount === 1 ? 'review' : 'reviews'}</span>
                  </div>
                </div>
              </div>
            </section>
          </motion.div>
        </div>
        <div className="cc-side-stack">
          <motion.section
            className="cc-side-card cc-side-card--next"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          >
            <Eyebrow size="sm">What happens next</Eyebrow>
            <p className="cc-side-card-lede">{nextMessage}</p>
          </motion.section>

          {isOwnDonation ? (
            /* ── Donor: viewing their own listing ── */
            <section className="cc-side-card cc-side-card--info">
              <span className="cc-side-card-glyph" aria-hidden="true">
                <Icon.Plate size={20} />
              </span>
              <Eyebrow size="sm">Your listing</Eyebrow>
              <h2 className="cc-side-card-title">This donation is yours.</h2>
              <p className="cc-side-card-copy">Manage it from your My donations dashboard.</p>
            </section>

          ) : isApprovedRequester ? (
            /* ── Viewer has an approved or completed request ── */
            <section className="cc-side-card">
              <Eyebrow size="sm">Your reservation</Eyebrow>
              <h2 className="cc-side-card-title">
                {viewerRequest!.status === 'completed' ? 'Pickup complete.' : 'Approved — ready for pickup.'}
              </h2>
              <div className={`cc-side-stamp cc-side-stamp--${viewerRequest!.status === 'completed' ? 'completed' : 'approved'}`}>
                <Icon.Check size={14} />
                <span>{viewerRequest!.status === 'completed' ? 'You picked this up' : 'Pickup approved'}</span>
              </div>
              <dl className="cc-side-fields">
                <div className="cc-side-field">
                  <dt>Pickup time</dt>
                  <dd>{formatDateTime(viewerRequest!.pickupTime)}</dd>
                </div>
                {viewerRequest!.notes && (
                  <div className="cc-side-field">
                    <dt>Your notes</dt>
                    <dd>{viewerRequest!.notes}</dd>
                  </div>
                )}
                {viewerRequest!.discreetPickup && (
                  <div className="cc-side-field">
                    <dt>Privacy</dt>
                    <dd className="cc-side-field-privacy">
                      <Icon.Lock size={12} /> Discreet pickup arranged
                    </dd>
                  </div>
                )}
              </dl>
              {viewerRequest!.status === 'approved' && (
                <p className="cc-side-card-foot">
                  {hasExactCoords
                    ? 'The exact pickup address and map are shown on the left. Head over at your agreed time.'
                    : 'The pickup address is shown on the left. An exact map is unavailable — this donation uses an approximate location only.'}
                </p>
              )}
            </section>

          ) : isPendingRequester ? (
            /* ── Viewer has a pending request ── */
            <section className="cc-side-card">
              <Eyebrow size="sm">Your request</Eyebrow>
              <h2 className="cc-side-card-title">Awaiting approval.</h2>
              <div className="cc-side-stamp cc-side-stamp--pending">
                <span className="cc-side-stamp-dot" aria-hidden="true" />
                <span>Waiting for the donor</span>
              </div>
              <dl className="cc-side-fields">
                <div className="cc-side-field">
                  <dt>Requested pickup time</dt>
                  <dd>{formatDateTime(viewerRequest!.pickupTime)}</dd>
                </div>
                {viewerRequest!.notes && (
                  <div className="cc-side-field">
                    <dt>Your notes</dt>
                    <dd>{viewerRequest!.notes}</dd>
                  </div>
                )}
                {viewerRequest!.discreetPickup && (
                  <div className="cc-side-field">
                    <dt>Privacy</dt>
                    <dd className="cc-side-field-privacy">
                      <Icon.Lock size={12} /> Discreet pickup requested
                    </dd>
                  </div>
                )}
              </dl>
              <p className="cc-side-card-foot">
                The exact pickup address will appear here once the donor approves.
                {isVerifiedArea
                  ? ' The map on the left shows the approximate neighborhood.'
                  : ' The map on the left shows the approximate area — this donation has not been precisely verified.'}
              </p>
            </section>

          ) : donation.status !== 'available' ? (
            /* ── Donation reserved/closed, viewer has no active request ── */
            <section className="cc-side-card cc-side-card--info">
              <span className="cc-side-card-glyph" aria-hidden="true">
                <Icon.Lock size={20} />
              </span>
              <Eyebrow size="sm">Closed</Eyebrow>
              <h2 className="cc-side-card-title">
                {donation.status === 'reserved' ? 'Already reserved.' : 'No longer available.'}
              </h2>
              <p className="cc-side-card-copy">
                This donation has been claimed. Check the feed for other listings nearby.
              </p>
            </section>

          ) : (
            /* ── Available for pickup request ── */
            <section className="cc-side-card cc-side-card--form">
              <Eyebrow size="sm">Pickup request</Eyebrow>
              <h2 className="cc-side-card-title">
                Reserve this <em className="cc-italic">donation.</em>
              </h2>
              <p className="cc-side-card-lede">
                Pick a time. The donor will approve, decline, or message you back.
              </p>
              <div className="cc-side-form">
                <div className="cc-side-field-input">
                  <label htmlFor="dd-time" className="cc-side-label">
                    Preferred pickup time
                    <span className="cc-side-required" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="dd-time"
                    type="datetime-local"
                    value={pickupTime}
                    onChange={(e) => setPickupTime(e.target.value)}
                    className="cc-side-input"
                    aria-required="true"
                  />
                </div>
                <div className="cc-side-field-input">
                  <label htmlFor="dd-notes" className="cc-side-label">Notes</label>
                  <textarea
                    id="dd-notes"
                    rows={4}
                    placeholder="Add any special requests or notes for the donor…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="cc-side-input cc-side-textarea"
                  />
                </div>
                {donation.allowDiscreet && (
                  <label className="cc-side-privacy">
                    <input
                      type="checkbox"
                      checked={discreetPickup}
                      onChange={(e) => setDiscreetPickup(e.target.checked)}
                      className="cc-side-checkbox"
                    />
                    <span className="cc-side-privacy-body">
                      <span className="cc-side-privacy-title">Request discreet pickup</span>
                      <span className="cc-side-privacy-copy">Donor will share instructions privately after approval.</span>
                    </span>
                  </label>
                )}
                <motion.button
                  onClick={handleSubmit}
                  className="cc-cta-primary cc-cta-primary--lg cc-cta-primary--full"
                  whileHover={{ y: -1 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span>Send pickup request</span>
                  <Icon.ArrowRight size={16} />
                </motion.button>
                <p className="cc-side-card-foot cc-side-card-foot--center">
                  Exact address revealed after the donor approves.
                </p>
              </div>
            </section>
          )}
          {primaryReview && (
            <motion.div
              className="details-review-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.36, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="details-next-kicker">Community trust</div>
              <div className="details-review-rating">{'★'.repeat(primaryReview.rating)}{'☆'.repeat(Math.max(0, 5 - primaryReview.rating))}</div>
              {primaryReview.comment && (
                <div className="details-review-copy">“{primaryReview.comment}”</div>
              )}
              <div className="details-review-meta">Review submitted after pickup</div>
            </motion.div>
          )}
          {!primaryReview && (
            <motion.div
              className="details-review-card details-empty-card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.36, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="details-next-kicker">Community trust</div>
              <div className="details-empty-title">No reviews yet.</div>
              <div className="details-review-copy">Reviews appear after completed pickups and help build community trust.</div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const CREATE_DONATION_STEPS = [
  'Food details',
  'Photo',
  'Pickup & Privacy',
  'Review & Publish',
];

/**
 * Live preview of how this donation will appear to recipients.
 * Pure presentation: reads only the form's current state, no API.
 * Mirrors the look of DonationCard at a smaller scale so the donor can
 * see exactly what they're publishing as they type.
 */
function CreateDonationPreview({
  title,
  description,
  foodType,
  quantity,
  expiryDate,
  dietaryTags,
  city,
  imageData,
}: {
  title: string;
  description: string;
  foodType: string;
  quantity: string;
  expiryDate: string;
  dietaryTags: DietaryTag[];
  city: string;
  imageData: string | null;
}) {
  // Tiny placeholder if nothing has been typed yet
  const hasContent = !!(title || description || foodType || city || imageData);

  // Approximate "expires in" hint for the preview ring
  let expiryLabel: string | null = null;
  let expiryProgress = 1;
  if (expiryDate) {
    const target = new Date(expiryDate).getTime();
    if (!Number.isNaN(target)) {
      const hours = Math.max(0, (target - Date.now()) / 36e5);
      expiryProgress = Math.max(0, Math.min(1, hours / 48));
      expiryLabel = hours < 1 ? '<1h' : hours < 24 ? `${Math.round(hours)}h` : `${Math.round(hours / 24)}d`;
    }
  }

  const dietaryLabels: Record<DietaryTag, string> = {
    kosher: 'Kosher',
    gluten_free: 'Gluten-free',
    vegan: 'Vegan',
    vegetarian: 'Vegetarian',
  };

  return (
    <motion.section
      className="cc-preview"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
      aria-label="Live preview of how your donation will appear"
    >
      <header className="cc-preview-head">
        <Eyebrow size="sm">Live preview</Eyebrow>
        <span className="cc-preview-head-pip" aria-hidden="true" />
        <span className="cc-preview-head-meta">As neighbors will see it</span>
      </header>

      <div className="cc-preview-card">
        <div className="cc-preview-image">
          {imageData ? (
            <img src={imageData} alt="" />
          ) : (
            <div className="cc-preview-plate">
              <svg viewBox="0 0 80 80" width="56" height="56" aria-hidden="true">
                <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(28,53,32,0.18)" strokeWidth="2" />
                <circle cx="40" cy="40" r="18" fill="none" stroke="rgba(28,53,32,0.18)" strokeWidth="2" />
              </svg>
              <span className="cc-preview-plate-text">{foodType || 'Your photo'}</span>
            </div>
          )}
          <span className="cc-preview-status">
            <span className="cc-preview-status-dot" />
            Available
          </span>
          {expiryLabel && (
            <span className="cc-preview-arc" aria-label={`Expires in ${expiryLabel}`}>
              <svg viewBox="0 0 36 36" width={36} height={36}>
                <circle cx="18" cy="18" r="14.5" fill="none" stroke="rgba(28,53,32,0.16)" strokeWidth="3" />
                <circle
                  cx="18"
                  cy="18"
                  r="14.5"
                  fill="none"
                  stroke={expiryProgress > 0.66 ? 'var(--forest-500)' : expiryProgress > 0.33 ? 'var(--ember-400)' : 'var(--ember-pop)'}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${(2 * Math.PI * 14.5) * expiryProgress} ${(2 * Math.PI * 14.5)}`}
                  transform="rotate(-90 18 18)"
                />
              </svg>
              <span className="cc-preview-arc-label">{expiryLabel}</span>
            </span>
          )}
        </div>

        <div className="cc-preview-body">
          <div className="cc-preview-eyebrow">
            <span className="cc-preview-eyebrow-num">№ —</span>
            <span className="cc-preview-eyebrow-dot" />
            <span>{city || 'Your city'}</span>
          </div>
          <h4 className="cc-preview-title">{title || 'Your donation title…'}</h4>
          {foodType && <p className="cc-preview-type">{foodType}</p>}
          <p className="cc-preview-desc">
            {description
              ? (description.length > 110 ? description.slice(0, 110) + '…' : description)
              : <span className="cc-preview-desc-ghost">Your description preview will appear here as you type.</span>}
          </p>
          <div className="cc-preview-meta">
            {quantity && (
              <span className="cc-preview-meta-pill">
                <Icon.Plate size={12} /> {quantity}
              </span>
            )}
            {dietaryTags.map((t) => (
              <span key={t} className="cc-preview-tag">{dietaryLabels[t] ?? t}</span>
            ))}
          </div>
        </div>
      </div>

      <p className="cc-preview-foot">
        {hasContent
          ? 'This updates as you type. Exact address stays private until you approve a request.'
          : 'Start filling the form — this preview will fill in live.'}
      </p>
    </motion.section>
  );
}

function CreateDonationStepper({ currentStep = 1 }: { currentStep?: number }) {
  return (
    <motion.ol
      className="cc-step-rail"
      aria-label="Create donation publishing steps"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      {CREATE_DONATION_STEPS.map((label, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === currentStep;
        const isComplete = stepNumber < currentStep;
        return (
          <li
            key={label}
            className={`cc-step ${isActive ? 'is-active' : ''} ${isComplete ? 'is-complete' : ''}`}
            aria-current={isActive ? 'step' : undefined}
          >
            <span className="cc-step-num" aria-hidden="true">
              {isComplete ? '✓' : String(stepNumber).padStart(2, '0')}
            </span>
            <span className="cc-step-label">{label}</span>
            {index < CREATE_DONATION_STEPS.length - 1 && <span className="cc-step-rule" aria-hidden="true" />}
          </li>
        );
      })}
    </motion.ol>
  );
}

function CreateDonation({ onBack, onSubmit }: { onBack: () => void; onSubmit: any }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [foodType, setFoodType] = useState('');
  const [quantity, setQuantity] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [dietaryTags, setDietaryTags] = useState<DietaryTag[]>([]);
  const [city, setCity] = useState('');
  const [street, setStreet] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [pickupNotes, setPickupNotes] = useState('');
  const [allowDiscreet, setAllowDiscreet] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'preview'>('form');
  const [geoPreview, setGeoPreview] = useState<GeocodePreview | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const handleImage = async (file: File | undefined) => {
    setImageError(null);
    if (!file) { setImageData(null); return; }
    if (!file.type.startsWith('image/')) { setImageError('Please select an image file'); return; }
    if (file.size > 4 * 1024 * 1024) { setImageError('Image must be under 4MB'); return; }
    try { setImageData(await readFileAsDataUrl(file)); }
    catch { setImageError('Could not read image'); }
  };

  const handleCheckLocation = async () => {
    if (!title || !description || !foodType || !quantity || !expiryDate || !city || !street) {
      alert('Please fill in all required fields before checking the location');
      return;
    }
    if (IS_UI_PREVIEW) {
      // Skip the real /api/geocode/preview call — return a synthetic
      // high-confidence preview so the confirm step renders end-to-end.
      setGeoPreview(syntheticGeocodePreview(street, houseNumber, city));
      setStep('preview');
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    try {
      const result = await api.geocodePreview(street, houseNumber, city);
      setGeoPreview(result);
      setStep('preview');
    } catch (err: any) {
      setGeoError(err?.message ?? 'Location check failed');
    } finally {
      setGeoLoading(false);
    }
  };

  const [isPublishing, setIsPublishing] = useState(false);
  const handleConfirm = async () => {
    // Hard guard against double-clicks while the previous submit is in flight.
    // Without this, slow network conditions in production let users click
    // "Confirm & Publish" multiple times and create duplicate donations.
    if (isPublishing) return;
    setIsPublishing(true);
    try {
      const payload: any = { title, description, foodType, quantity, expiryDate, dietaryTags, city, street, houseNumber, pickupNotes, allowDiscreet };
      if (imageData) payload.image = { data: imageData };
      await onSubmit(payload);
    } finally {
      // Re-enable on error so the user can retry. On success the parent
      // navigates to my-donations and this component unmounts; React 18
      // silently no-ops setState on unmounted components.
      setIsPublishing(false);
    }
  };

  const handlePlaceSelect = useCallback((data: PlaceSelectData) => {
    setStreet(data.street);
    if (data.houseNumber) setHouseNumber(data.houseNumber);
    if (data.city) setCity(data.city);
  }, []);

  // ── Step 2: Location confirmation ──
  if (step === 'preview' && geoPreview) {
    return (
      <div>
        <header className="cc-create-header">
          <div className="cc-create-meta">
            <span className="cc-create-meta-num">№ 04</span>
            <span className="cc-create-meta-dot" />
            <span>Final review</span>
          </div>
          <h1 className="cc-create-title">
            Verify the <em className="cc-italic">pickup spot.</em>
          </h1>
          <p className="cc-create-lede">
            Requesters see only the approximate neighborhood. The exact address
            is revealed to approved recipients only — never to passers-by.
          </p>
        </header>
        <CreateDonationStepper currentStep={4} />
        <LocationConfirmStep
          street={street} houseNumber={houseNumber} city={city} pickupNotes={pickupNotes}
          geoPreview={geoPreview}
          onBack={() => setStep('form')}
          onConfirm={handleConfirm}
          confirmLabel="Confirm & Publish"
          submitting={isPublishing}
        />
      </div>
    );
  }

  // ── Step 1: Form ──
  return (
    <div>
      <header className="cc-create-header">
        <div className="cc-create-meta">
          <span className="cc-create-meta-num">№ 01</span>
          <span className="cc-create-meta-dot" />
          <span>A new listing</span>
        </div>
        <h1 className="cc-create-title">
          Share <em className="cc-italic">surplus food</em>
          <br />with your neighborhood.
        </h1>
        <p className="cc-create-lede">
          A few details and your neighbors can reserve it within minutes —
          discreet pickup, privacy by default.
        </p>
      </header>
      <CreateDonationStepper currentStep={1} />
      <div className="create-form-grid">
        <div className="create-form-main">
          <motion.section
            className="create-section-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="form-section-header create-section-header">
              <span className="create-section-kicker">1</span>
              <div>
                <span className="form-section-title">About the food</span>
                <p className="create-section-helper">Give neighbors enough detail to understand what is available and when it should be picked up.</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="cd-title" className="form-label">Donation Title <span className="text-red-600" aria-hidden>*</span></label>
                <input id="cd-title" type="text" placeholder="e.g., Fresh Vegetables" value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" aria-required="true" />
              </div>
              <div>
                <label htmlFor="cd-desc" className="form-label">Description <span className="text-red-600" aria-hidden>*</span></label>
                <textarea id="cd-desc" rows={4} placeholder="Describe the food items, their condition, and any relevant details…" value={description} onChange={(e) => setDescription(e.target.value)} className="input-field resize-none" aria-required="true" />
              </div>
              <div>
                <label htmlFor="cd-type" className="form-label">Food Type <span className="text-red-600" aria-hidden>*</span></label>
                <select id="cd-type" value={foodType} onChange={(e) => setFoodType(e.target.value)} className="input-field" aria-required="true">
                  <option value="">Select food type</option>
                  {['Produce', 'Prepared Food', 'Baked Goods', 'Non-Perishable', 'Dairy', 'Meat & Seafood'].map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div className="cd-qty-expiry-grid">
                <div>
                  <label htmlFor="cd-qty" className="form-label">Quantity <span className="text-red-600" aria-hidden>*</span></label>
                  <input id="cd-qty" type="text" placeholder="e.g., 5 kg" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="input-field" aria-required="true" />
                </div>
                <div>
                  <label htmlFor="cd-expiry" className="form-label">Expiry Date <span className="text-red-600" aria-hidden>*</span></label>
                  <input id="cd-expiry" type="datetime-local" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="input-field" aria-required="true" />
                </div>
              </div>
            </div>
          </motion.section>

          <motion.section
            className="create-section-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="form-section-header create-section-header">
              <span className="create-section-kicker">2</span>
              <div>
                <span className="form-section-title">Dietary information</span>
                <p className="create-section-helper">Optional tags help people quickly find food that fits their household.</p>
              </div>
              <span className="form-section-hint">Optional</span>
            </div>
            <fieldset>
              <legend className="sr-only">Dietary tags</legend>
              <div className="grid grid-cols-2 gap-3">
                {(['vegan', 'vegetarian', 'gluten_free', 'kosher'] as DietaryTag[]).map((tag) => (
                  <label key={tag} className="flex items-center gap-2 cursor-pointer check-row">
                    <input type="checkbox" checked={dietaryTags.includes(tag)} onChange={() => setDietaryTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])} className="w-4 h-4 flex-shrink-0" />
                    <span className="form-checkbox-label">{tag === 'gluten_free' ? 'Gluten-Free' : tag.charAt(0).toUpperCase() + tag.slice(1)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </motion.section>

          <motion.section
            className="create-section-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="form-section-header create-section-header">
              <span className="create-section-kicker">3</span>
              <div>
                <span className="form-section-title">Pickup details</span>
                <p className="create-section-helper">Confirm the pickup area now. Exact address details stay private until you approve a request.</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="cd-city" className="form-label">City <span className="text-red-600" aria-hidden>*</span></label>
                <input
                  id="cd-city"
                  type="text"
                  placeholder="Select or type a city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  list="israeli-cities-cd"
                  className="input-field"
                  aria-required="true"
                />
                <datalist id="israeli-cities-cd">
                  {ISRAELI_CITIES.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label className="form-label text-zinc-400">Country</label>
                <div className="input-field bg-zinc-50 text-zinc-500 cursor-default select-none">🇮🇱 Israel</div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label htmlFor="cd-street" className="form-label">Street <span className="text-red-600" aria-hidden>*</span></label>
                  <StreetAutocompleteInput
                    id="cd-street"
                    value={street}
                    onChange={setStreet}
                    onPlaceSelect={handlePlaceSelect}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="cd-house" className="form-label">No.</label>
                  <input id="cd-house" type="text" placeholder="12" value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} className="input-field" />
                </div>
              </div>
              <div>
                <label htmlFor="cd-pickup-notes" className="form-label">
                  Pickup notes <span className="form-section-hint ml-1">Optional · private</span>
                </label>
                <input id="cd-pickup-notes" type="text" placeholder="e.g., Ring bell 2B, leave at door…" value={pickupNotes} onChange={(e) => setPickupNotes(e.target.value)} className="input-field" />
              </div>
            </div>
          </motion.section>
        </div>
        <div className="create-form-side">
          {/* Live preview — recipients see this exact card in the feed. */}
          <CreateDonationPreview
            title={title}
            description={description}
            foodType={foodType}
            quantity={quantity}
            expiryDate={expiryDate}
            dietaryTags={dietaryTags}
            city={city}
            imageData={imageData}
          />

          <motion.section
            className="create-section-card create-photo-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="form-section-header create-section-header mb-3">
              <span className="create-section-kicker">2</span>
              <div>
                <span className="form-section-title">Photo</span>
                <p className="create-section-helper">Add a clear photo so neighbors can quickly understand what you’re sharing.</p>
              </div>
              <span className="form-section-hint">Optional</span>
            </div>
            <label htmlFor="cd-image" className="upload-area create-upload-area cursor-pointer block" aria-label="Upload food photo">
              {imageData ? (
                <span className="create-upload-preview-frame">
                  <img src={imageData} alt="Preview of selected image" className="create-upload-preview" />
                </span>
              ) : (
                <>
                  <span className="create-upload-icon" aria-hidden>📷</span>
                  <div className="upload-text text-center">Click to upload a photo</div>
                  <div className="upload-hint text-center">PNG or JPG · max 4 MB</div>
                </>
              )}
              <input id="cd-image" type="file" accept="image/*" className="hidden" onChange={(e) => handleImage(e.target.files?.[0])} />
            </label>
            {imageData && (
              <button type="button" onClick={() => setImageData(null)} className="mt-3 text-xs text-red-600 underline">Remove photo</button>
            )}
            {imageError && <div className="mt-2 text-xs text-red-600" role="alert">{imageError}</div>}
          </motion.section>

          <motion.section
            className="create-section-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="form-section-header create-section-header mb-3">
              <span className="create-section-kicker">3</span>
              <div>
                <span className="form-section-title">Privacy & approval</span>
                <p className="create-section-helper">CookCircle keeps the sensitive handoff details behind donor approval.</p>
              </div>
            </div>
            <div className="privacy-option create-privacy-card mb-3">
              <div className="privacy-label">🔒 Your exact pickup address stays private until you approve a request.</div>
              <div className="privacy-desc mt-1">Recipients first see only the general area.</div>
            </div>
            <label className="privacy-option flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={allowDiscreet} onChange={(e) => setAllowDiscreet(e.target.checked)} className="mt-1 w-4 h-4 flex-shrink-0" />
              <div><div className="privacy-label">Allow discreet pickup requests</div><div className="privacy-desc">Recipients can request private pickup instructions, useful for sensitive situations.</div></div>
            </label>
          </motion.section>

          {geoError && (
            <div className="rounded-xl px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
              {geoError}
            </div>
          )}
          <motion.div
            className="create-publish-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="create-publish-copy">
              <span className="create-section-kicker">4</span>
              <div>
                <div className="form-section-title">Review & publish</div>
                <p className="create-section-helper">Review your details, then publish your donation to the community.</p>
              </div>
            </div>
            <div className="create-publish-reassurance">Exact pickup details are shared only after approval.</div>
            <div className="create-publish-actions">
              <button onClick={onBack} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleCheckLocation} disabled={geoLoading} className="btn-primary flex-1">
                {geoLoading ? 'Checking location…' : 'Check Location'}
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function DashboardStatGrid({ items }: { items: Array<{ label: string; value: number | string; tone?: string }> }) {
  return (
    <motion.div
      className="cc-dash-grid"
      initial="hidden"
      animate="visible"
      variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } } }}
    >
      {items.map((item, i) => (
        <motion.div
          key={item.label}
          className={`cc-dash-cell ${item.tone ? `cc-dash-cell--${item.tone}` : ''}`}
          variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } } }}
        >
          <div className="cc-dash-marker" aria-hidden="true">0{i + 1}</div>
          <div className="cc-dash-value"><CountUp value={item.value} duration={720} /></div>
          <div className="cc-dash-label">{item.label}</div>
        </motion.div>
      ))}
    </motion.div>
  );
}

function DashboardEmptyState({ title, message, action }: { title: string; message: string; action?: string }) {
  return (
    <motion.div
      className="cc-empty"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="cc-empty-glyph" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
        </svg>
      </div>
      <Eyebrow size="sm" tone="var(--ink-faint)">No activity yet</Eyebrow>
      <h3 className="cc-empty-title">{title}</h3>
      <p className="cc-empty-copy">{message}</p>
      {action && <div className="cc-empty-note">{action}</div>}
    </motion.div>
  );
}

function RequestLifecycleMini({ status, reviewed = false }: { status: RequestStatus; reviewed?: boolean }) {
  const stage = reviewed ? 3 : status === 'completed' ? 2 : status === 'approved' ? 1 : status === 'pending' ? 0 : -1;
  const steps = ['Requested', 'Approved', 'Picked up', 'Reviewed'];
  return (
    <div className={`mini-lifecycle ${status === 'cancelled' ? 'is-cancelled' : ''}`} aria-label="Request lifecycle">
      {steps.map((step, index) => (
        <span key={step} className={`mini-lifecycle-step ${index < stage ? 'is-complete' : ''} ${index === stage ? 'is-active' : ''}`}>
          <span className="mini-lifecycle-dot">{index < stage ? '✓' : index + 1}</span>
          <span>{step}</span>
        </span>
      ))}
    </div>
  );
}

function requestNextStep(status: RequestStatus, reviewed = false): string {
  if (status === 'pending') return 'Waiting for the donor to approve your request.';
  if (status === 'approved') return 'Pickup details are unlocked. Coordinate pickup respectfully.';
  if (status === 'completed') return reviewed ? 'Pickup completed and review submitted.' : 'Pickup completed. You can leave a review.';
  if (status === 'cancelled') return 'This request was cancelled.';
  return 'Track this request as it moves toward pickup.';
}

function donationNextAction(donation: Donation, pendingCount: number, completedCount: number): string {
  if (pendingCount > 0) return 'Review pending pickup request.';
  if (donation.status === 'reserved') return 'Waiting for pickup.';
  if (donation.status === 'picked_up' || completedCount > 0) return 'Donation completed.';
  if (donation.status === 'available') return 'Listing is live and ready for requests.';
  if (donation.status === 'expired') return 'Donation expired.';
  if (donation.status === 'cancelled') return 'Listing cancelled.';
  return 'Review listing status.';
}

function MyDonations({ donations, requests, reviews = [], users, onViewDetails, onDelete, onEdit, onApprove, onDecline, onSetStatus }: any) {
  const formatDateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const getDonationRequests = (did: number) => requests.filter((r: any) => r.donationId === did);
  const donationIds = new Set(donations.map((d: any) => d.id));
  const relevantRequests = requests.filter((r: any) => donationIds.has(r.donationId));
  const pendingRequests = relevantRequests.filter((r: any) => r.status === 'pending').length;
  const completedDonationIds = new Set(relevantRequests.filter((r: any) => r.status === 'completed').map((r: any) => r.donationId));
  donations.filter((d: any) => d.status === 'picked_up').forEach((d: any) => completedDonationIds.add(d.id));
  const completedPickups = completedDonationIds.size;
  const activeDonations = donations.filter((d: any) => d.status === 'available' || d.status === 'reserved').length;
  const receivedReviews = reviews.filter((review: any) => donationIds.has(review.donationId)).length;
  const donationStats = [
    { label: 'Active donations', value: activeDonations, tone: 'forest' },
    { label: 'Pending requests', value: pendingRequests, tone: 'ember' },
    { label: 'Completed pickups', value: completedPickups, tone: 'forest' },
    { label: 'Reviews received', value: receivedReviews, tone: 'cream' },
  ];

  return (
    <div>
      <header className="cc-page-header">
        <div className="cc-page-meta">
          <span className="cc-page-meta-num">№ 02</span>
          <span className="cc-page-meta-dot" />
          <span>Donor dashboard</span>
        </div>
        <h1 className="cc-page-title">My donations.</h1>
        <p className="cc-page-lede">Track your active listings and respond to incoming pickup requests from neighbors.</p>
      </header>
      <DashboardStatGrid items={donationStats} />

      {/* Contextual action card — single, calm, editorial. Replaces the
          repeated per-row alert-pending strips as the primary "you have work"
          signal. Per-row context still lives inside each donation row. */}
      <AnimatePresence initial={false}>
        {pendingRequests > 0 && (
          <motion.div
            key="action-card"
            className="cc-action-card"
            role="region"
            aria-label="Action needed"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.22, ease: ease.snap } }}
            transition={{ duration: dur.mid, ease: ease.soft }}
          >
            <div className="cc-action-card-meta">
              <span className="cc-action-card-dot" aria-hidden="true" />
              <span>Action needed</span>
            </div>
            <div className="cc-action-card-body">
              <h2 className="cc-action-card-title">
                {pendingRequests === 1 ? 'One neighbor is waiting.' : `${pendingRequests} neighbors are waiting.`}
              </h2>
              <p className="cc-action-card-copy">
                {pendingRequests === 1
                  ? 'A pickup request needs your approval. Scroll to the matching listing below to approve or decline.'
                  : `${pendingRequests} pickup requests are awaiting your approval. Open each listing below to respond.`}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {(pendingRequests === 0 || completedPickups === 0) && donations.length > 0 && (
        <div className="empty-signal-grid">
          {pendingRequests === 0 && (
            <div className="empty-signal-card">
              <div className="empty-signal-title">No pending requests</div>
              <div className="empty-signal-copy">New pickup requests will appear here when neighbors reserve your food.</div>
            </div>
          )}
          {completedPickups === 0 && (
            <div className="empty-signal-card">
              <div className="empty-signal-title">No completed pickups yet</div>
              <div className="empty-signal-copy">Completed handoffs will build your impact and review history over time.</div>
            </div>
          )}
        </div>
      )}
      {donations.length === 0 ? (
        <DashboardEmptyState
          title="You haven’t shared food yet."
          message="Post a surplus meal or pantry item and let neighbors reserve it safely."
          action="Create a donation from the top navigation."
        />
      ) : (
        <div className="space-y-5">
          {donations.map((d: any, idx: number) => {
            const dreqs = getDonationRequests(d.id);
            const pendingCount = dreqs.filter((r: any) => r.status === 'pending').length;
            const completedCount = dreqs.filter((r: any) => r.status === 'completed').length;
            const expiry = expiryHint(d.expiryDate);
            const isAvailable = d.status === 'available';
            const isReserved = d.status === 'reserved';
            const isClosed = d.status === 'cancelled' || d.status === 'expired';
            return (
              <motion.div
                key={d.id}
                className="donation-row dashboard-row"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.34, delay: Math.min(idx * 0.05, 0.25), ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="grid grid-cols-1 md:grid-cols-12">
                  <div className="md:col-span-3 row-thumb">
                    <div className="row-thumb-inner">
                      <DonationImage url={d.imageUrl} foodType={d.foodType} seedId={d.id} />
                    </div>
                    <div className="image-badge"><StatusBadge status={d.status} /></div>
                  </div>
                  <div className="md:col-span-6 row-body">
                    <div className="mb-4">
                      <Eyebrow num={idx + 1} size="sm">{d.foodType || 'Listing'}</Eyebrow>
                      <h3 className="cc-row-title">{d.title}</h3>
                      <div className="cc-row-sub">
                        <Icon.Pin size={12} /> <span>{d.city}</span>
                      </div>
                    </div>
                    <dl className="cc-pillstrip cc-row-pillstrip">
                      <div className="cc-pill"><dt>Quantity</dt><dd>{d.quantity}</dd></div>
                      <div className="cc-pill"><dt>Expires</dt><dd>{formatDateTime(d.expiryDate)}</dd></div>
                      <div className="cc-pill"><dt>Requests</dt><dd>{dreqs.length}</dd></div>
                      {expiry && isAvailable ? (
                        <div className={`cc-pill cc-pill--expiry ${expiry.soon ? 'is-soon' : ''}`}>
                          <dt>Window</dt><dd>{expiry.label}</dd>
                        </div>
                      ) : (
                        <div className="cc-pill"><dt>Status</dt><dd className="capitalize">{String(d.status).replace('_', ' ')}</dd></div>
                      )}
                    </dl>
                    <AnimatePresence initial={false}>
                      {pendingCount > 0 && (
                        <motion.div
                          key="row-pending"
                          className="cc-row-pending"
                          role="status"
                          initial={{ opacity: 0, y: -4, scale: 0.96 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.96, transition: { duration: 0.2, ease: ease.snap } }}
                          transition={{ duration: dur.mid, ease: ease.soft }}
                        >
                          <span className="cc-row-pending-dot" aria-hidden="true" />
                          <span>
                            {pendingCount} pending request{pendingCount > 1 ? 's' : ''} on this listing
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <div className="cc-row-next">{donationNextAction(d, pendingCount, completedCount)}</div>
                    {dreqs.length > 0 && (
                      <div className="cc-row-incoming">
                        <Eyebrow size="sm">Incoming requests</Eyebrow>
                        <div className="cc-row-incoming-list">
                          {dreqs.map((r: any) => {
                            const requester = users.find((u: any) => u.id === r.requesterId);
                            const initials = (requester?.displayName ?? '?')
                              .split(/\s+/).filter(Boolean).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                            return (
                              <div key={r.id} className={`cc-incoming cc-incoming--${r.status}`}>
                                <div className="cc-incoming-row">
                                  <span className="cc-incoming-avatar" aria-hidden="true">{initials}</span>
                                  <div className="cc-incoming-body">
                                    <div className="cc-incoming-head">
                                      <div>
                                        <div className="cc-incoming-name">{requester?.displayName ?? `User #${r.requesterId}`}</div>
                                        <div className="cc-incoming-meta">Pickup · {formatDateTime(r.pickupTime)}</div>
                                      </div>
                                      <StatusBadge status={r.status} />
                                    </div>
                                    {r.notes && <p className="cc-incoming-note">{r.notes}</p>}
                                    {r.discreetPickup && (
                                      <span className="cc-incoming-chip">
                                        <Icon.Lock size={11} /> Discreet pickup requested
                                      </span>
                                    )}
                                    {r.status === 'pending' && (
                                      <div className="cc-incoming-actions">
                                        <button onClick={() => onApprove(r.id)} className="cc-action-btn cc-action-btn--primary">Approve</button>
                                        <button onClick={() => { if (confirm('Decline this request?')) onDecline(r.id); }} className="cc-action-btn cc-action-btn--ghost">Decline</button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="md:col-span-3 row-actions">
                    {isClosed ? (
                      <>
                        <div className="action-stack-label">Listing closed</div>
                        <button onClick={() => onSetStatus(d.id, 'available')} className="btn-primary">Reopen listing</button>
                        <button onClick={() => onEdit(d.id)} className="btn-secondary">Edit details</button>
                        <div className="action-stack-divider" />
                        <button
                          onClick={() => { if (window.confirm('Permanently delete this listing and all its history? This cannot be undone.')) onDelete(d.id); }}
                          className="btn-danger w-full"
                        >
                          Delete permanently
                        </button>
                      </>
                    ) : d.status === 'picked_up' ? (
                      <>
                        <div className="status-completed-badge">✓ Picked up</div>
                        <button onClick={() => onViewDetails(d.id)} className="btn-secondary">View details</button>
                      </>
                    ) : isReserved ? (
                      <>
                        <div className="action-stack-label">Reserved</div>
                        <button onClick={() => onViewDetails(d.id)} className="btn-primary">View details</button>
                        <button onClick={() => onEdit(d.id)} className="btn-secondary">Edit details</button>
                        <div className="action-stack-divider" />
                        <button
                          onClick={() => { if (window.confirm('Cancel this reservation? The recipient\'s pickup request will also be cancelled.')) onSetStatus(d.id, 'cancelled'); }}
                          className="btn-ghost"
                        >
                          Cancel & release
                        </button>
                        <div className="text-[11px] text-zinc-400 text-center px-1">Cannot delete while reserved</div>
                      </>
                    ) : (
                      <>
                        <div className="action-stack-label">Available</div>
                        <button onClick={() => onViewDetails(d.id)} className="btn-primary">View details</button>
                        <button onClick={() => onEdit(d.id)} className="btn-secondary">Edit details</button>
                        <div className="action-stack-divider" />
                        <button onClick={() => { if (window.confirm('Cancel this listing? It will be marked as unavailable.')) onSetStatus(d.id, 'cancelled'); }} className="btn-ghost">Cancel listing</button>
                        <button onClick={() => { if (window.confirm('Mark this donation as expired?')) onSetStatus(d.id, 'expired'); }} className="btn-ghost">Mark expired</button>
                        <div className="action-stack-divider" />
                        <button
                          onClick={() => { if (window.confirm('Permanently delete this listing? This cannot be undone.')) onDelete(d.id); }}
                          className="btn-danger w-full text-sm"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EditDonation({ donation, onBack, onSubmit }: { donation: Donation; onBack: () => void; onSubmit: (patch: Partial<Donation> & { image?: { data: string } }) => void; }) {
  // Original address values — used to detect changes that require re-confirmation
  const origCity = donation.city;
  const origStreet = donation.street ?? donation.address ?? '';
  const origHouseNumber = donation.houseNumber ?? '';

  const [title, setTitle] = useState(donation.title);
  const [description, setDescription] = useState(donation.description);
  const [foodType, setFoodType] = useState(donation.foodType);
  const [quantity, setQuantity] = useState(donation.quantity);
  const [expiryDate, setExpiryDate] = useState(donation.expiryDate);
  const [dietaryTags, setDietaryTags] = useState<DietaryTag[]>(donation.dietaryTags);
  const [city, setCity] = useState(donation.city);
  const [street, setStreet] = useState<string>(origStreet);
  const [houseNumber, setHouseNumber] = useState<string>(origHouseNumber);
  const [pickupNotes, setPickupNotes] = useState<string>(donation.pickupNotes ?? '');
  const [allowDiscreet, setAllowDiscreet] = useState(!!donation.allowDiscreet);
  const [newImageData, setNewImageData] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // Location confirmation — required when address fields change
  const [step, setStep] = useState<'form' | 'preview'>('form');
  const [geoPreview, setGeoPreview] = useState<GeocodePreview | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const addressChanged = city !== origCity || street !== origStreet || houseNumber !== origHouseNumber;

  const handleImage = async (file: File | undefined) => {
    setImageError(null);
    if (!file) { setNewImageData(null); return; }
    if (!file.type.startsWith('image/')) { setImageError('Please select an image file'); return; }
    if (file.size > 4 * 1024 * 1024) { setImageError('Image must be under 4MB'); return; }
    try { setNewImageData(await readFileAsDataUrl(file)); }
    catch { setImageError('Could not read image'); }
  };

  const handlePlaceSelect = useCallback((data: PlaceSelectData) => {
    setStreet(data.street);
    if (data.houseNumber) setHouseNumber(data.houseNumber);
    if (data.city) setCity(data.city);
  }, []);

  const [isSaving, setIsSaving] = useState(false);
  const doSave = async () => {
    // Hard guard — same reasoning as CreateDonation.handleConfirm: slow
    // production requests let users click "Save Changes" multiple times.
    if (isSaving) return;
    setIsSaving(true);
    try {
      const payload: any = { title, description, foodType, quantity, expiryDate, dietaryTags, city, street, houseNumber, pickupNotes, allowDiscreet };
      if (newImageData) payload.image = { data: newImageData };
      await onSubmit(payload);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCheckLocation = async () => {
    if (!title || !description || !foodType || !quantity || !expiryDate || !city || !street) {
      alert('Please fill in all required fields');
      return;
    }
    if (IS_UI_PREVIEW) {
      setGeoPreview(syntheticGeocodePreview(street, houseNumber, city));
      setStep('preview');
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    try {
      const result = await api.geocodePreview(street, houseNumber, city);
      setGeoPreview(result);
      setStep('preview');
    } catch (err: any) {
      setGeoError(err?.message ?? 'Location check failed');
    } finally {
      setGeoLoading(false);
    }
  };

  const handleSubmit = () => {
    if (!title || !description || !foodType || !quantity || !expiryDate || !city || !street) {
      alert('Please fill in all required fields');
      return;
    }
    // Address changed → must go through location confirmation before saving
    if (addressChanged) {
      handleCheckLocation();
    } else {
      doSave();
    }
  };

  const backButton = (
    <button onClick={onBack} className="cc-back" aria-label="Back to my donations">
      <span aria-hidden="true">←</span>
      <span>Back to my donations</span>
    </button>
  );

  // ── Step 2: Location confirmation (only when address changed) ──
  if (step === 'preview' && geoPreview) {
    return (
      <div>
        {backButton}
        <header className="cc-create-header">
          <div className="cc-create-meta">
            <span className="cc-create-meta-num">№ 05</span>
            <span className="cc-create-meta-dot" />
            <span>Confirm new location</span>
          </div>
          <h1 className="cc-create-title">Verify the <em className="cc-italic">updated pickup spot.</em></h1>
          <p className="cc-create-lede">The address changed — confirm the new location before saving. Requesters see only the approximate neighborhood until you approve their request.</p>
        </header>
        <LocationConfirmStep
          street={street} houseNumber={houseNumber} city={city} pickupNotes={pickupNotes}
          geoPreview={geoPreview}
          onBack={() => setStep('form')}
          onConfirm={doSave}
          confirmLabel="Confirm & Save"
          submitting={isSaving}
        />
      </div>
    );
  }

  // ── Step 1: Form ──
  return (
    <div>
      {backButton}
      <header className="cc-create-header">
        <div className="cc-create-meta">
          <span className="cc-create-meta-num">№ 02</span>
          <span className="cc-create-meta-dot" />
          <span>Edit listing</span>
        </div>
        <h1 className="cc-create-title">Update your <em className="cc-italic">donation.</em></h1>
        <p className="cc-create-lede">Refresh the details so neighbors see the latest information.</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        <div className="card p-6 space-y-5">
          <div>
            <div className="form-section-header"><span className="form-section-title">About the food</span></div>
            <div className="space-y-4">
              <div><label htmlFor="ed-title" className="form-label">Donation Title <span className="text-red-600">*</span></label><input id="ed-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" /></div>
              <div><label htmlFor="ed-desc" className="form-label">Description <span className="text-red-600">*</span></label><textarea id="ed-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} className="input-field resize-none" /></div>
              <div>
                <label htmlFor="ed-type" className="form-label">Food Type <span className="text-red-600">*</span></label>
                <select id="ed-type" value={foodType} onChange={(e) => setFoodType(e.target.value)} className="input-field">
                  <option value="">Select food type</option>
                  {['Produce', 'Prepared Food', 'Baked Goods', 'Non-Perishable', 'Dairy', 'Meat & Seafood'].map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label htmlFor="ed-qty" className="form-label">Quantity <span className="text-red-600">*</span></label><input id="ed-qty" type="text" value={quantity} onChange={(e) => setQuantity(e.target.value)} className="input-field" /></div>
                <div><label htmlFor="ed-expiry" className="form-label">Expiry Date <span className="text-red-600">*</span></label><input id="ed-expiry" type="datetime-local" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="input-field" /></div>
              </div>
            </div>
          </div>
          <div className="border-t border-zinc-100 pt-4">
            <div className="form-section-header"><span className="form-section-title">Dietary information</span><span className="form-section-hint">Optional</span></div>
            <fieldset>
              <legend className="sr-only">Dietary tags</legend>
              <div className="grid grid-cols-2 gap-3">
                {(['vegan', 'vegetarian', 'gluten_free', 'kosher'] as DietaryTag[]).map((tag) => (
                  <label key={tag} className="flex items-center gap-2 cursor-pointer check-row">
                    <input type="checkbox" checked={dietaryTags.includes(tag)} onChange={() => setDietaryTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])} className="w-4 h-4 flex-shrink-0" />
                    <span className="form-checkbox-label">{tag === 'gluten_free' ? 'Gluten-Free' : tag.charAt(0).toUpperCase() + tag.slice(1)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="border-t border-zinc-100 pt-4">
            <div className="form-section-header">
              <span className="form-section-title">Pickup location</span>
              {addressChanged && <span className="text-[11px] text-amber-600 font-medium ml-2">● Address changed — confirmation required</span>}
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="ed-city" className="form-label">City <span className="text-red-600">*</span></label>
                <input
                  id="ed-city"
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  list="israeli-cities-ed"
                  className="input-field"
                  aria-required="true"
                />
                <datalist id="israeli-cities-ed">
                  {ISRAELI_CITIES.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label className="form-label text-zinc-400">Country</label>
                <div className="input-field bg-zinc-50 text-zinc-500 cursor-default select-none">🇮🇱 Israel</div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label htmlFor="ed-street" className="form-label">Street <span className="text-red-600">*</span></label>
                  <StreetAutocompleteInput
                    id="ed-street"
                    value={street}
                    onChange={setStreet}
                    onPlaceSelect={handlePlaceSelect}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="ed-house" className="form-label">No.</label>
                  <input id="ed-house" type="text" value={houseNumber} onChange={(e) => setHouseNumber(e.target.value)} className="input-field" />
                </div>
              </div>
              <div>
                <label htmlFor="ed-pickup-notes" className="form-label">Pickup notes <span className="form-section-hint ml-1">Optional · private</span></label>
                <input id="ed-pickup-notes" type="text" placeholder="e.g., Ring bell 2B, leave at door…" value={pickupNotes} onChange={(e) => setPickupNotes(e.target.value)} className="input-field" />
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-6">
          <div className="card p-6">
            <div className="form-section-header mb-3"><span className="form-section-title">Photo</span><span className="form-section-hint">Optional</span></div>
            {donation.imageUrl && !newImageData && (
              <div className="mb-3">
                <div className="text-xs text-zinc-500 mb-1">Current image</div>
                <img src={donation.imageUrl} alt="Current" className="max-h-32 rounded" />
              </div>
            )}
            <label className="upload-area cursor-pointer block">
              {newImageData ? (
                <img src={newImageData} alt="New preview" className="max-h-48 mx-auto rounded" />
              ) : (
                <>
                  <span className="text-6xl mb-3 block text-center">📷</span>
                  <div className="upload-text text-center">Click to upload new image</div>
                  <div className="upload-hint text-center">PNG, JPG up to 4MB</div>
                </>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImage(e.target.files?.[0])} />
            </label>
            {newImageData && (
              <button type="button" onClick={() => setNewImageData(null)} className="mt-2 text-xs text-red-600 underline">Discard new image</button>
            )}
            {imageError && <div className="mt-2 text-xs text-red-600">{imageError}</div>}
          </div>
          {donation.status === 'reserved' && addressChanged && (
            <div className="card p-4 border-amber-200 bg-amber-50">
              <div className="text-sm font-semibold text-amber-800 mb-1">⚠️ Donation is currently reserved</div>
              <p className="text-xs text-amber-700">
                If the requester's pickup has been approved, address changes cannot be saved — you must cancel the reservation first.
                If only a request is pending (not yet approved), address changes are allowed.
              </p>
            </div>
          )}
          <div className="card p-6">
            <div className="form-section-header mb-3"><span className="form-section-title">Privacy</span></div>
            <div className="privacy-option mb-3">
              <div className="privacy-label">🔒 Address always protected</div>
              <div className="privacy-desc mt-1">Only the approximate neighborhood is shown publicly. Exact address is revealed only to recipients you approve.</div>
            </div>
            <label className="privacy-option flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={allowDiscreet} onChange={(e) => setAllowDiscreet(e.target.checked)} className="mt-1 w-4 h-4 flex-shrink-0" />
              <div><div className="privacy-label">Allow discreet pickup requests</div><div className="privacy-desc">Recipients can request private pickup instructions</div></div>
            </label>
          </div>
          {geoError && (
            <div className="rounded-xl px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">{geoError}</div>
          )}
          <div className="flex gap-4">
            <button onClick={onBack} className="btn-secondary flex-1">Cancel</button>
            <button
              onClick={handleSubmit}
              disabled={geoLoading || isSaving}
              aria-busy={geoLoading || isSaving}
              className="btn-primary flex-1"
            >
              {geoLoading
                ? 'Checking location…'
                : isSaving
                  ? 'Saving…'
                  : addressChanged
                    ? 'Check Location →'
                    : 'Save Changes'}
            </button>
          </div>
          {addressChanged && (
            <p className="text-[11.5px] text-[#8a9b8c] text-center">
              Address changed — you'll confirm the new location before saving.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MyRequests({ requests, donations, users, onViewDonation, onUpdateStatus, onLeaveReview, reviews }: any) {
  const [activeTab, setActiveTab] = useState<'all' | RequestStatus>('all');
  const formatDateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const filteredRequests = activeTab === 'all' ? requests : requests.filter((r: any) => r.status === activeTab);
  const hasReview = (rid: number) => reviews.some((r: any) => r.requestId === rid);
  const tabCount = (tab: 'all' | RequestStatus) => tab === 'all' ? requests.length : requests.filter((r: any) => r.status === tab).length;
  const requestStats = [
    { label: 'Total requests', value: requests.length, tone: 'cream' },
    { label: 'Pending', value: tabCount('pending'), tone: 'ember' },
    { label: 'Approved', value: tabCount('approved'), tone: 'forest' },
    { label: 'Completed', value: tabCount('completed'), tone: 'forest' },
  ];

  return (
    <div>
      <header className="cc-page-header">
        <div className="cc-page-meta">
          <span className="cc-page-meta-num">№ 03</span>
          <span className="cc-page-meta-dot" />
          <span>Recipient dashboard</span>
        </div>
        <h1 className="cc-page-title">My requests.</h1>
        <p className="cc-page-lede">Follow your reservations from request to pickup — and leave a review once the food is collected.</p>
      </header>
      <DashboardStatGrid items={requestStats} />
      {(tabCount('approved') === 0 || tabCount('completed') === 0) && requests.length > 0 && (
        <div className="empty-signal-grid">
          {tabCount('approved') === 0 && (
            <div className="empty-signal-card">
              <div className="empty-signal-title">No approved pickups yet</div>
              <div className="empty-signal-copy">Approved requests will unlock pickup details from the donor.</div>
            </div>
          )}
          {tabCount('completed') === 0 && (
            <div className="empty-signal-card">
              <div className="empty-signal-title">No completed pickups yet</div>
              <div className="empty-signal-copy">Completed pickups will appear here once food has been collected.</div>
            </div>
          )}
        </div>
      )}
      <div className="dashboard-tab-card">
      <div className="tab-bar dashboard-tab-bar overflow-x-auto max-w-full" role="tablist" aria-label="Filter requests by status">
        {(['all', 'pending', 'approved', 'completed', 'cancelled'] as const).map((tab) => {
          const label = tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1);
          return (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`tab-button ${activeTab === tab ? 'tab-active' : ''} whitespace-nowrap`}
            >
              {label} <span className="opacity-60 font-normal text-[11px]">{tabCount(tab)}</span>
            </button>
          );
        })}
      </div>
      </div>
      {filteredRequests.length === 0 ? (
        <DashboardEmptyState
          title={activeTab === 'all' ? 'No pickup requests yet.' : `No ${activeTab} requests yet.`}
          message={activeTab === 'all' ? 'Browse available food and send your first respectful pickup request.' : `Requests with ${activeTab} status will appear here when your pickup journey reaches that step.`}
          action="Browse the Home feed to find food nearby."
        />
      ) : (
        <div className="space-y-5">
          {filteredRequests.map((req: any, idx: number) => {
            const donation = donations.find((d: any) => d.id === req.donationId);
            const donor = donation ? users.find((u: any) => u.id === donation.donorId) : null;
            if (!donation || !donor) return null;
            // Use backend canSeeAddress as source of truth (backend applies shapeDonation per viewer).
            // Fall back to request status inference if the field is absent (legacy path).
            const canSeeAddress = donation.canSeeAddress ?? (req.status === 'approved' || req.status === 'completed');
            const reviewed = hasReview(req.id);
            return (
              <motion.div
                key={req.id}
                className={`request-row dashboard-row state-${req.status}`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.34, delay: Math.min(idx * 0.05, 0.25), ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="grid grid-cols-1 md:grid-cols-12">
                  <div className="md:col-span-3 row-thumb">
                    <div className="row-thumb-inner">
                      <DonationImage url={donation.imageUrl} foodType={donation.foodType} seedId={donation.id} />
                    </div>
                    <div className="image-badge"><StatusBadge status={req.status} /></div>
                  </div>
                  <div className="md:col-span-6 row-body">
                    <div className="mb-4">
                      <Eyebrow num={idx + 1} size="sm">{donation.foodType || 'Pickup request'}</Eyebrow>
                      <h3 className="cc-row-title">{donation.title}</h3>
                      <div className="cc-row-sub">
                        From <span className="cc-row-sub-strong">{donor.displayName}</span>
                      </div>
                    </div>
                    <dl className="cc-pillstrip cc-row-pillstrip">
                      <div className="cc-pill"><dt>Pickup</dt><dd>{formatDateTime(req.pickupTime)}</dd></div>
                      <div className="cc-pill cc-pill--address"><dt>Location</dt><dd>{formatDonationAddress(donation, canSeeAddress)}</dd></div>
                      {req.discreetPickup && (
                        <div className="cc-pill cc-pill--privacy"><dt>Privacy</dt><dd>Discreet pickup</dd></div>
                      )}
                    </dl>
                    <RequestLifecycleMini status={req.status} reviewed={reviewed} />
                    <div className="cc-row-next">{requestNextStep(req.status, reviewed)}</div>
                    {!canSeeAddress && req.status === 'pending' && (
                      <div className="cc-row-privacy-hint">
                        <Icon.Lock size={11} />
                        <span>Full address shared after the donor approves your request.</span>
                      </div>
                    )}
                    {req.notes && (
                      <div className="cc-row-notes">
                        <Eyebrow size="sm">Your notes</Eyebrow>
                        <p>{req.notes}</p>
                      </div>
                    )}
                  </div>
                  <div className="md:col-span-3 row-actions">
                    {req.status === 'pending' && (
                      <>
                        <div className="status-pending-badge">⏳ Waiting for approval</div>
                        <button onClick={() => onViewDonation(donation.id)} className="btn-secondary">View donation</button>
                        <div className="action-stack-divider" />
                        <button onClick={() => confirm('Cancel this request?') && onUpdateStatus(req.id, 'cancelled')} className="btn-ghost">Cancel request</button>
                      </>
                    )}
                    {req.status === 'approved' && (
                      <>
                        <div className="action-stack-label">Next step</div>
                        <button onClick={() => confirm('Mark this pickup as completed?') && onUpdateStatus(req.id, 'completed')} className="btn-primary">Mark picked up</button>
                        <button onClick={() => onViewDonation(donation.id)} className="btn-secondary">View donation</button>
                        <div className="action-stack-divider" />
                        <button onClick={() => confirm('Cancel this request?') && onUpdateStatus(req.id, 'cancelled')} className="btn-ghost">Cancel</button>
                      </>
                    )}
                    {req.status === 'completed' && (
                      <>
                        {!reviewed ? (
                          <>
                            <div className="action-stack-label">Share feedback</div>
                            <button onClick={() => onLeaveReview(req.id)} className="btn-accent">Leave review</button>
                          </>
                        ) : (
                          <div className="status-completed-badge">✓ Review submitted</div>
                        )}
                        <button onClick={() => onViewDonation(donation.id)} className="btn-secondary">View donation</button>
                      </>
                    )}
                    {req.status === 'cancelled' && (
                      <button onClick={() => onViewDonation(donation.id)} className="btn-secondary">View donation</button>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReviewRating({ request, donation, donor, onBack, onSubmit }: any) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState('');

  return (
    <div>
      <button onClick={onBack} className="cc-back" aria-label="Back to my requests">
        <span aria-hidden="true">←</span>
        <span>Back to my requests</span>
      </button>
      <div className="max-w-2xl mx-auto">
        <header className="cc-page-header" style={{ textAlign: 'center', maxWidth: 'unset' }}>
          <div className="cc-page-meta" style={{ justifyContent: 'center' }}>
            <span>A community review</span>
          </div>
          <h1 className="cc-page-title">How was the <em className="cc-italic">handoff?</em></h1>
          <p className="cc-page-lede">Your honest review helps the next neighbor know what to expect.</p>
        </header>
        <div className="card">
          <h2 className="review-title mb-6" style={{ fontFamily: 'var(--font-display)' }}>{donation.title}</h2>
          <div className="review-donation-info">
            <div className="detail-label mb-1">Donation</div>
            <div className="review-donation-title">{donation.title}</div>
            <div className="card-meta mt-2">Donor: <span className="card-value">{donor.displayName}</span></div>
          </div>
          <div className="space-y-6">
            <div>
              <label className="form-label mb-3">Rating <span className="text-red-600">*</span></label>
              <div className="flex gap-2" role="group" aria-label="Star rating">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHoveredRating(star)}
                    onMouseLeave={() => setHoveredRating(0)}
                    className="star-button"
                    aria-label={`${star} star${star > 1 ? 's' : ''}`}
                    aria-pressed={star <= rating}
                    style={{ fontSize: '2.5rem', color: star <= (hoveredRating || rating) ? '#e07a3c' : '#d4d4d8' }}
                  >
                    ⭐
                  </button>
                ))}
              </div>
            </div>
            <div><label className="form-label mb-2">Comment</label><textarea rows={6} placeholder="Share your experience with this donation and donor..." value={comment} onChange={(e) => setComment(e.target.value)} className="input-field resize-none" /></div>
            <div className="flex gap-4">
              <button onClick={onBack} className="btn-secondary flex-1">Cancel</button>
              <button onClick={() => { if (rating === 0) { alert('Please select a rating'); return; } onSubmit(rating, comment); }} className="btn-primary flex-1">Submit Review</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function profileInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'CC';
}

function estimateProfileFoodSavedKg(donations: Donation[]): number {
  return donations.reduce((total, donation) => {
    const quantity = String(donation.quantity || '').toLowerCase();
    const numeric = Number(quantity.match(/[\d.]+/)?.[0] || 0);
    if (quantity.includes('kg') && numeric) return total + numeric;
    if ((quantity.includes('portion') || quantity.includes('serving')) && numeric) return total + numeric * 0.45;
    if (numeric && (donation.status === 'picked_up' || donation.status === 'reserved')) return total + Math.min(numeric * 0.45, numeric);
    if (donation.status === 'picked_up') return total + 0.5;
    return total;
  }, 0);
}

function Profile({ user, donations = [], requests = [], reviews = [], onBack, onSave }: {
  user: User;
  donations?: Donation[];
  requests?: PickupRequest[];
  reviews?: Review[];
  onBack: () => void;
  onSave: (patch: Partial<Pick<User, 'displayName' | 'email' | 'phone' | 'dietaryPreferences' | 'discreetPickup'>>) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone);
  const [dietaryPreferences, setDietaryPreferences] = useState<DietaryTag[]>(user.dietaryPreferences);
  const [discreetPickup, setDiscreetPickup] = useState(user.discreetPickup);
  const userDonations = donations.filter((donation) => donation.donorId === user.id);
  const userDonationIds = new Set(userDonations.map((donation) => donation.id));
  const completedPickups = requests.filter((request) =>
    request.status === 'completed' && (request.requesterId === user.id || userDonationIds.has(request.donationId))
  ).length;
  const reviewsReceived = reviews.filter((review) =>
    review.revieweeId === user.id || userDonationIds.has(review.donationId)
  ).length || user.reviewCount || 0;
  const citiesReached = new Set(
    userDonations
      .map((donation) => donation.city || donation.areaLabel)
      .filter(Boolean)
  ).size;
  const foodSavedKg = estimateProfileFoodSavedKg(userDonations);
  const averageRating = user.rating || 0;
  const trustLabel = averageRating >= 4.7 && reviewsReceived > 0 ? 'Trusted neighbor' : reviewsReceived > 0 ? 'Community member' : 'Getting started';
  const impactStats = [
    { label: 'Donations shared', value: userDonations.length, tone: 'forest' },
    { label: 'Pickups completed', value: completedPickups, tone: 'ember' },
    { label: 'Reviews received', value: reviewsReceived, tone: 'forest' },
    { label: 'Average rating', value: averageRating ? averageRating.toFixed(1) : 'New', tone: 'cream' },
    { label: 'Cities reached', value: citiesReached, tone: 'forest' },
    { label: 'Kg saved est.', value: foodSavedKg ? foodSavedKg.toFixed(1) : '0', tone: 'ember' },
  ];

  return (
    <div className="profile-page">
      <header className="cc-page-header">
        <div className="cc-page-meta">
          <span className="cc-page-meta-num">№ 04</span>
          <span className="cc-page-meta-dot" />
          <span>{trustLabel}</span>
        </div>
        <h1 className="cc-page-title">{displayName.split(' ')[0]}'s <em className="cc-italic">kitchen</em>.</h1>
        <p className="cc-page-lede">Manage how neighbors see and reach you — and follow the kitchen-table impact you've made together.</p>
      </header>

      <div className="profile-layout">
        <motion.div
          className="profile-main-column"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="profile-form-card">
            <div className="form-section-header">
              <div>
                <h2 className="form-section-title">Personal information</h2>
                <p className="form-section-hint">Keep your contact details current for approved pickup coordination.</p>
              </div>
            </div>
            <div className="profile-field-grid">
              <div><label htmlFor="profile-name" className="form-label mb-2">Display Name</label><input id="profile-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input-field" /></div>
              <div><label htmlFor="profile-email" className="form-label mb-2">Email</label><input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" /></div>
              <div><label htmlFor="profile-phone" className="form-label mb-2">Phone</label><input id="profile-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input-field" /></div>
            </div>
          </div>

          <div className="profile-form-card">
            <div className="form-section-header">
              <div>
                <h2 className="form-section-title">Dietary preferences</h2>
                <p className="form-section-hint">These help highlight food that fits your household.</p>
              </div>
            </div>
            <fieldset>
              <legend className="sr-only">Dietary preferences</legend>
              <div className="profile-check-grid">
                {(['vegan', 'vegetarian', 'gluten_free', 'kosher'] as DietaryTag[]).map((tag) => (
                  <label key={tag} className="check-row">
                    <input type="checkbox" checked={dietaryPreferences.includes(tag)} onChange={() => setDietaryPreferences(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])} className="w-4 h-4" />
                    <span className="form-checkbox-label">{tag === 'gluten_free' ? 'Gluten-Free' : tag.charAt(0).toUpperCase() + tag.slice(1)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {dietaryPreferences.length === 0 && (
              <div className="empty-signal-card mt-4">
                <div className="empty-signal-title">No dietary preferences selected</div>
                <div className="empty-signal-copy">Add preferences anytime to make matching food easier to scan.</div>
              </div>
            )}
          </div>

          <div className="profile-form-card">
            <div className="form-section-header">
              <div>
                <h2 className="form-section-title">Privacy settings</h2>
                <p className="form-section-hint">Choose the pickup style you prefer when requesting food.</p>
              </div>
            </div>
            <label className="profile-privacy-toggle"><input type="checkbox" checked={discreetPickup} onChange={(e) => setDiscreetPickup(e.target.checked)} className="mt-1 w-4 h-4" /><div><div className="privacy-label">Prefer discreet pickups</div><div className="privacy-desc mt-1">When enabled, your pickup requests will default to discreet mode.</div></div></label>
          </div>

          <div className="profile-save-bar">
            <div>
              <div className="profile-save-title">Ready to update?</div>
              <div className="profile-save-copy">Your profile changes apply to future community interactions.</div>
            </div>
            <div className="profile-save-actions"><button onClick={onBack} className="btn-secondary">Cancel</button><button onClick={() => onSave({ displayName, email, phone, dietaryPreferences, discreetPickup })} className="btn-primary">Save changes</button></div>
          </div>
        </motion.div>

        <motion.aside
          className="profile-side-column"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.34, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        >
          <TrustPortrait
            displayName={user.displayName}
            email={user.email}
            rating={averageRating}
            reviewsReceived={reviewsReceived}
            completedPickups={completedPickups}
            trustLabel={trustLabel}
          />

          <div className="profile-impact-card">
            <div className="form-section-header">
              <div>
                <h2 className="form-section-title">Community impact</h2>
                <p className="form-section-hint">A snapshot of what your CookCircle activity has helped move.</p>
              </div>
            </div>
            <div className="profile-impact-grid">
              {impactStats.map((item, index) => (
                <motion.div
                  key={item.label}
                  className={`profile-impact-stat tone-${item.tone}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: 0.12 + index * 0.04, ease: [0.16, 1, 0.3, 1] }}
                >
                  <div className="dashboard-stat-value">{item.value}</div>
                  <div className="dashboard-stat-label">{item.label}</div>
                </motion.div>
              ))}
            </div>
            {userDonations.length === 0 && completedPickups === 0 && (
              <div className="empty-signal-card mt-4">
                <div className="empty-signal-title">Impact starts with your first share</div>
                <div className="empty-signal-copy">Your community impact will grow as you share and complete pickups.</div>
              </div>
            )}
          </div>

          <div className="profile-safety-card">
            <div className="profile-safety-icon" aria-hidden="true">i</div>
            <div>
              <h2 className="form-section-title">Privacy & safety</h2>
              <p className="profile-safety-copy">Exact address stays private until approval. Pickup coordination is request-based, reviews build trust after completed pickups, and discreet pickup is supported.</p>
            </div>
          </div>
        </motion.aside>
      </div>
    </div>
  );

}
