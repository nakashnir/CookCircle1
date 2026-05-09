import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FloatingFoodHero } from './components/FloatingFoodHero';
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
}: {
  street: string; houseNumber: string; city: string; pickupNotes: string;
  geoPreview: GeocodePreview;
  onBack: () => void;
  onConfirm: () => void;
  confirmLabel: string;
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
            <button onClick={onBack} className="btn-primary flex-1">Fix address</button>
          ) : (
            <button onClick={onConfirm} className="btn-primary flex-1">
              {isHighConfidence ? confirmLabel : `${confirmLabel} anyway`}
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

function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api.login(email, password);
      onLogin(user);
    } catch (err: any) {
      setError(err?.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api.register(name, email, password);
      onLogin(user);
    } catch (err: any) {
      setError(err?.message ?? 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-background auth-shell">
      {/* ── Left hero panel (desktop only) — Motion floating food hero ── */}
      <FloatingFoodHero />

      {/* ── Right form panel ── */}
      <div className="auth-form-panel">
        <div className="card p-6 w-full max-w-sm" style={{ boxShadow: '0 2px 4px rgba(28,53,32,0.06), 0 20px 48px -16px rgba(28,53,32,0.18)' }}>
          {/* Mobile-only brand header */}
          <div className="flex items-center gap-3 mb-6 lg:hidden">
            <span className="brand-logo">🌿</span>
            <span className="brand-wordmark">CookCircle</span>
          </div>

          <div className="flex border-b border-zinc-200 mb-6">
            <button
              type="button"
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'login' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
              onClick={() => { setTab('login'); setError(null); }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === 'register' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-zinc-500 hover:text-zinc-700'}`}
              onClick={() => { setTab('register'); setError(null); }}
            >
              Register
            </button>
          </div>

          {tab === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="auth-email" className="form-label">Email</label>
                <input
                  id="auth-email"
                  type="email"
                  className="input-field"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="auth-password" className="form-label">Password</label>
                <input
                  id="auth-password"
                  type="password"
                  className="input-field"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
              <button type="submit" disabled={busy} className="cta-button w-full justify-center">
                {busy ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label htmlFor="auth-name" className="form-label">Name</label>
                <input
                  id="auth-name"
                  type="text"
                  className="input-field"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  minLength={2}
                  autoComplete="name"
                />
              </div>
              <div>
                <label htmlFor="auth-email-r" className="form-label">Email</label>
                <input
                  id="auth-email-r"
                  type="email"
                  className="input-field"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label htmlFor="auth-password-r" className="form-label">Password (min. 8 characters)</label>
                <input
                  id="auth-password-r"
                  type="password"
                  className="input-field"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
              <button type="submit" disabled={busy} className="cta-button w-full justify-center">
                {busy ? 'Creating account…' : 'Create Account'}
              </button>
            </form>
          )}

          {/* Demo credentials — polished quick-access card */}
          <div className="demo-creds-card">
            <div className="demo-creds-title">⚡ Quick demo access</div>
            <div className="demo-creds-row">
              <span className="demo-creds-label">🧑‍🍳 Donor — Yael</span>
              <button type="button" className="demo-creds-btn" onClick={() => { setEmail('yael@example.co.il'); setTab('login'); }}>
                yael@example.co.il
              </button>
            </div>
            <div className="demo-creds-row">
              <span className="demo-creds-label">👩‍🍳 Donor — Maya</span>
              <button type="button" className="demo-creds-btn" onClick={() => { setEmail('maya@example.co.il'); setTab('login'); }}>
                maya@example.co.il
              </button>
            </div>
            <div className="demo-creds-row">
              <span className="demo-creds-label">🙋 User — David</span>
              <button type="button" className="demo-creds-btn" onClick={() => { setEmail('david@example.co.il'); setTab('login'); }}>
                david@example.co.il
              </button>
            </div>
            <p style={{ fontSize: 11, color: '#8a9b8c', textAlign: 'center', marginTop: 10 }}>
              Password for all accounts: <span style={{ fontWeight: 600, color: '#4b5d4d' }}>CookCircle123!</span>
            </p>
          </div>
        </div>
      </div>
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
    try {
      const d = await api.listDonations(buildDonationOpts());
      setDonations(d);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message ?? 'Failed to load donations');
    }
  }, [buildDonationOpts]);

  const refreshAll = async () => {
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
    return (
      <div className="min-h-screen app-background flex items-center justify-center text-zinc-500">
        Loading…
      </div>
    );
  }

  if (authState === 'unauthed') {
    return <AuthScreen onLogin={handleAuthSuccess} />;
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen app-background flex items-center justify-center text-zinc-500">
        {loadError ? `⚠️ ${loadError}` : 'Loading…'}
      </div>
    );
  }

  return (
    <div className="min-h-screen app-background">
      <Header
        currentScreen={currentScreen}
        onNavigate={setCurrentScreen}
        currentUser={currentUser}
        onLogout={handleLogout}
      />
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-8">
        {loadError && (
          <div className="alert-pending mb-6">⚠️ {loadError}</div>
        )}
        {toast && (
          <div className={`toast-overlay ${toast.kind === 'success' ? 'toast-success' : 'toast-error'}`} role="status" aria-live="polite">
            <span aria-hidden="true">{toast.kind === 'success' ? '✓' : '⚠'}</span>
            {toast.message}
          </div>
        )}
        {busy && (
          <div className="mb-4 text-xs text-zinc-500">Working…</div>
        )}
        {currentScreen === 'feed' && (
          <DonationFeed
            donations={donations}
            users={users}
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
        {currentScreen === 'profile' && <Profile user={currentUser} onBack={() => setCurrentScreen('feed')} onSave={saveProfile} />}
      </main>
    </div>
  );
}

function Header({ currentScreen, onNavigate, currentUser, onLogout }: {
  currentScreen: string;
  onNavigate: (screen: any) => void;
  currentUser: User;
  onLogout: () => void;
}) {
  return (
    <header className="header-gradient sticky top-0 z-30">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between px-4 md:px-8 py-3 md:py-4 gap-3">
        <button onClick={() => onNavigate('feed')} className="flex items-center gap-3">
          <span className="brand-logo">🌿</span>
          <span className="brand-wordmark">CookCircle</span>
        </button>
        <nav className="flex gap-1 order-3 md:order-2 w-full md:w-auto overflow-x-auto">
          {[['feed', 'Home'], ['my-donations', 'My Donations'], ['requests', 'My Requests'], ['profile', 'Profile']].map(([screen, label]) => (
            <button
              key={screen}
              onClick={() => onNavigate(screen)}
              className={`nav-link ${currentScreen === screen ? 'nav-active' : ''}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2 md:gap-3 order-2 md:order-3 ml-auto md:ml-0">
          <span className="text-sm text-zinc-600 hidden sm:inline truncate max-w-[140px]" title={currentUser.displayName}>
            👤 {currentUser.displayName}
          </span>
          <button
            onClick={onLogout}
            className="px-3 py-1.5 text-sm border border-zinc-300 rounded-lg text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Sign out
          </button>
          <button onClick={() => onNavigate('create')} className="cta-button" aria-label="Create donation">
            <span aria-hidden="true">＋</span><span className="hidden sm:inline" aria-hidden="true">Create Donation</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function StatusBadge({ status }: { status: DonationStatus | RequestStatus }) {
  const getClass = () => {
    switch (status) {
      case 'available': return 'status-available';
      case 'reserved': return 'status-reserved';
      case 'picked_up':
      case 'completed': return 'status-completed';
      case 'approved': return 'status-approved';
      case 'pending': return 'status-pending';
      case 'cancelled': return 'status-cancelled';
      case 'expired': return 'status-expired';
      default: return 'status-cancelled';
    }
  };
  const label = status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  return (
    <span className={`status-badge ${getClass()}`}>
      <span className="status-dot"></span>
      {label}
    </span>
  );
}

function DietaryTagBadge({ tag }: { tag: DietaryTag }) {
  const labels: Record<DietaryTag, string> = {
    kosher: 'Kosher', gluten_free: 'Gluten-Free', vegan: 'Vegan', vegetarian: 'Vegetarian',
  };
  return <span className="dietary-tag">{labels[tag]}</span>;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <div className="max-w-md mx-auto">
        <div className="empty-icon">📦</div>
        <p className="empty-text">{message}</p>
      </div>
    </div>
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

function DonationCard({ donation, donor, onViewDetails }: { donation: DonationWithDistance; donor: User; onViewDetails: (id: number) => void; }) {
  const expiry = expiryHint(donation.expiryDate);
  return (
    <div className="card flex flex-col">
      <div className="card-image">
        <DonationImage url={donation.imageUrl} foodType={donation.foodType} seedId={donation.id} />
        <div className="image-badge">
          <StatusBadge status={donation.status} />
        </div>
        {donation.distanceKm != null && (
          <div className="image-badge-right">
            <span className="distance-pill">📍 {donation.distanceKm.toFixed(1)} km</span>
          </div>
        )}
      </div>
      <div className="card-body flex-1 flex flex-col">
        <h3 className="card-title">{donation.title}</h3>
        <div className="card-meta">
          <span>{donor.displayName}</span>
          <span className="text-zinc-300">·</span>
          <span className="card-rating">⭐ {donor.rating.toFixed(1)}</span>
        </div>
        <div className="mt-4 space-y-2 text-[13.5px]">
          <div className="card-info"><span className="card-label">{donation.foodType}</span><span className="card-value">{donation.quantity}</span></div>
          <div className="card-location"><span>📍</span><span>{donation.city}</span></div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {expiry && donation.status === 'available' && (
            <span className={`expiry-pill ${expiry.soon ? 'is-soon' : ''}`}>⏱ {expiry.label}</span>
          )}
          {donation.dietaryTags.map((tag) => <DietaryTagBadge key={tag} tag={tag} />)}
        </div>
        <button onClick={() => onViewDetails(donation.id)} className="btn-primary w-full mt-5">
          View details <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

function DonationFeed({
  donations, users, onViewDetails,
  filterCity, setFilterCity,
  filterDietary, setFilterDietary,
  filterStatus, setFilterStatus,
  sortMode, setSortMode,
  origin, useMyLocation, clearOrigin, originError,
  locationFallback,
}: {
  donations: DonationWithDistance[];
  users: User[];
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

  const cities = Array.from(new Set(donations.map(d => d.city)));

  return (
    <div>
      {/* ── Feed hero panel ── */}
      <div className="hero-panel mb-8">
        {/* Decorative blobs — CSS only */}
        <div className="hero-panel-bg-blob" style={{ width: 280, height: 280, background: 'radial-gradient(circle, rgba(238,156,90,0.18) 0%, transparent 70%)', top: '-60px', right: '5%' }} />
        <div className="hero-panel-bg-blob" style={{ width: 200, height: 200, background: 'radial-gradient(circle, rgba(143,176,145,0.20) 0%, transparent 70%)', bottom: '-40px', left: '3%' }} />

        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          {/* Text side */}
          <div className="flex-1 min-w-0">
            <span className="hero-pill">🌿 Community food sharing</span>
            <h1 className="page-title mb-3" style={{ fontSize: 'clamp(28px, 4vw, 46px)' }}>
              Fresh food,<br className="hidden sm:block" /> shared nearby.
            </h1>
            <p className="page-subtitle mb-6" style={{ maxWidth: 440 }}>
              Discover surplus meals and ingredients your neighbors are sharing today — free, local, and community-powered.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="trust-chip">🔒 Privacy-first location</span>
              <span className="trust-chip">📍 Israel-wide</span>
              <span className="trust-chip">♻️ Reduce food waste</span>
            </div>
          </div>

          {/* Stats side */}
          <div className="flex gap-3 flex-shrink-0 flex-wrap">
            <div className="hero-stat">
              <span className="hero-stat-value">{donations.length > 0 ? donations.length : '—'}</span>
              <span className="hero-stat-label">Available</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-value">{Array.from(new Set(donations.map(d => d.city))).length || '—'}</span>
              <span className="hero-stat-label">Cities</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-value">{donations.filter(d => d.dietaryTags?.includes('vegan') || d.dietaryTags?.includes('vegetarian')).length || '—'}</span>
              <span className="hero-stat-label">Plant-based</span>
            </div>
          </div>
        </div>
      </div>
      <div className="filter-card mb-8">
        <div className="input-affix mb-3">
          <span className="input-affix-icon">🔍</span>
          <input
            type="text"
            placeholder="Search donations by name, ingredient, or dish…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)} className="input-field">
            <option value="">📍 All cities</option>
            {cities.map(city => <option key={city} value={city}>{city}</option>)}
          </select>
          <select value={filterDietary} onChange={(e) => setFilterDietary(e.target.value as DietaryTag | '')} className="input-field">
            <option value="">🥗 All dietary tags</option>
            <option value="vegan">Vegan</option>
            <option value="vegetarian">Vegetarian</option>
            <option value="gluten_free">Gluten-Free</option>
            <option value="kosher">Kosher</option>
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as DonationStatus | 'any')} className="input-field">
            <option value="available">● Available only</option>
            <option value="reserved">Reserved</option>
            <option value="picked_up">Picked up</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
            <option value="any">Any status</option>
          </select>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as any)} className="input-field">
            <option value="newest">↓ Newest first</option>
            <option value="expiring">⏱ Expiring soonest</option>
            {!locationFallback && (
              <option value="nearest" disabled={!origin}>📍 Nearest{origin ? '' : ' (set location)'}</option>
            )}
          </select>
        </div>
        <div className="mt-3 flex items-center gap-3 text-sm flex-wrap">
          {!locationFallback && (
            origin ? (
              <>
                <span className="distance-pill">📍 Using your location</span>
                <button onClick={clearOrigin} className="btn-ghost">Clear location</button>
              </>
            ) : (
              <button onClick={useMyLocation} className="btn-ghost">📍 Use my location</button>
            )
          )}
          {originError && <span className="text-red-600 text-xs">{originError}</span>}
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState message="No donations match your filters yet. Try widening your search." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visible.map((d) => {
            const donor = users.find(u => u.id === d.donorId);
            if (!donor) return null;
            return <DonationCard key={d.id} donation={d} donor={donor} onViewDetails={onViewDetails} />;
          })}
        </div>
      )}
    </div>
  );
}

function DonationDetails({ donation, donor, onBack, onSubmitRequest, currentUserId, requests, locationFallback }: {
  donation: Donation; donor: User; onBack: () => void; onSubmitRequest: any; currentUserId: number; requests: PickupRequest[]; locationFallback?: boolean;
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

  return (
    <div>
      <div className="breadcrumb">
        <button onClick={onBack} className="breadcrumb-link">Home</button>
        <span>/</span>
        <span className="breadcrumb-current">Donation Details</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        <div>
          <div className="card-image-large mb-6">
            <DonationImage url={donation.imageUrl} foodType={donation.foodType} seedId={donation.id} large />
            <div className="image-badge">
              <StatusBadge status={donation.status} />
            </div>
          </div>
          <div className="card p-6">
            <div className="mb-4">
              <div className="eyebrow mb-1">{donation.foodType}</div>
              <h1 className="details-title">{donation.title}</h1>
            </div>
            <div className="space-y-4 mb-6">
              <div><div className="detail-label">Description</div><div className="detail-value">{donation.description}</div></div>
              <div className="grid grid-cols-2 gap-4">
                <div><div className="detail-label">Food Type</div><div className="detail-value">{donation.foodType}</div></div>
                <div><div className="detail-label">Quantity</div><div className="detail-value">{donation.quantity}</div></div>
              </div>
              <div><div className="detail-label">Expiry Date</div><div className="detail-value">{formatDateTime(donation.expiryDate)}</div></div>
              {donation.dietaryTags.length > 0 && (
                <div><div className="detail-label">Dietary Tags</div><div className="flex gap-2 flex-wrap">{donation.dietaryTags.map(tag => <DietaryTagBadge key={tag} tag={tag} />)}</div></div>
              )}
              <div>
                <div className="detail-label">Pickup Location</div>
                <div className="flex items-start gap-2 mb-3">
                  <span className="text-lg" aria-hidden="true">📍</span>
                  <div>
                    <div className="detail-value">
                      {formatDonationAddress(donation, canSeeAddress)}
                    </div>
                    {canSeeAddress && donation.formattedAddress && (
                      <div className="text-[12px] text-[#8a9b8c] mt-0.5">{donation.formattedAddress}</div>
                    )}
                    {canSeeAddress && donation.pickupNotes && (
                      <div className="detail-privacy mt-1">📝 {donation.pickupNotes}</div>
                    )}
                    {!canSeeAddress && (
                      <div className="detail-privacy">
                        {isPendingRequester
                          ? 'Exact pickup location confirmed after the donor approves your request'
                          : 'Exact address shared after your request is approved'}
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
              </div>
            </div>
            <div className="donor-section">
              <div className="detail-label mb-3">Donor</div>
              <div className="flex items-center gap-4">
                <div className="donor-avatar">👤</div>
                <div className="flex-1">
                  <div className="donor-name">{donor.displayName}</div>
                  <div className="flex items-center gap-1 text-sm">
                    {[...Array(5)].map((_, i) => <span key={i} className={i < Math.floor(donor.rating) ? 'star-filled' : 'star-empty'}>⭐</span>)}
                    <span className="rating-value ml-1">{donor.rating.toFixed(1)}</span>
                    <span className="rating-count">({donor.reviewCount} reviews)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div>
          {isOwnDonation ? (
            /* ── Donor: viewing their own listing ── */
            <div className="card p-8 text-center">
              <div className="empty-icon">🏠</div>
              <div className="font-semibold text-[#1c3520] mb-2">This is your listing</div>
              <div className="empty-text">Manage it from your My Donations dashboard.</div>
            </div>

          ) : isApprovedRequester ? (
            /* ── Viewer has an approved or completed request ── */
            <div className="card p-6">
              <div className="eyebrow mb-1">Your reservation</div>
              <h2 className="section-title mb-4">
                {viewerRequest!.status === 'completed' ? 'Pickup complete' : 'Approved — ready for pickup'}
              </h2>
              <div className={`mb-5 text-center font-semibold text-[14px] rounded-xl px-4 py-3 ${viewerRequest!.status === 'completed' ? 'status-completed-badge' : 'status-approved-badge'}`}>
                {viewerRequest!.status === 'completed' ? '✓ You picked this up' : '✓ Pickup approved'}
              </div>
              <div className="space-y-4">
                <div>
                  <div className="detail-label">Pickup time</div>
                  <div className="detail-value">{formatDateTime(viewerRequest!.pickupTime)}</div>
                </div>
                {viewerRequest!.notes && (
                  <div>
                    <div className="detail-label">Your notes</div>
                    <div className="detail-value">{viewerRequest!.notes}</div>
                  </div>
                )}
                {viewerRequest!.discreetPickup && (
                  <span className="privacy-badge mt-1">🔒 Discreet pickup arranged</span>
                )}
              </div>
              {viewerRequest!.status === 'approved' && (
                <div className="mt-5 pt-5 border-t border-zinc-100">
                  <div className="text-[13px] text-[#4b5d4d] leading-relaxed">
                    {hasExactCoords
                      ? 'The exact pickup address and map are shown on the left. Head over at your agreed time.'
                      : 'The pickup address is shown on the left. Note: an exact map is unavailable — this donation uses an approximate location only.'}
                  </div>
                </div>
              )}
            </div>

          ) : isPendingRequester ? (
            /* ── Viewer has a pending request ── */
            <div className="card p-6">
              <div className="eyebrow mb-1">Your request</div>
              <h2 className="section-title mb-4">Awaiting approval</h2>
              <div className="alert-pending w-full justify-center mb-5">
                ⏳ Waiting for the donor to approve
              </div>
              <div className="space-y-4">
                <div>
                  <div className="detail-label">Requested pickup time</div>
                  <div className="detail-value">{formatDateTime(viewerRequest!.pickupTime)}</div>
                </div>
                {viewerRequest!.notes && (
                  <div>
                    <div className="detail-label">Your notes</div>
                    <div className="detail-value">{viewerRequest!.notes}</div>
                  </div>
                )}
                {viewerRequest!.discreetPickup && (
                  <span className="privacy-badge mt-1">🔒 Discreet pickup requested</span>
                )}
              </div>
              <div className="mt-5 pt-5 border-t border-zinc-100 text-[13px] text-[#6b7d6e] leading-relaxed">
                The exact pickup address will be shown here once the donor approves your request.
                {isVerifiedArea
                  ? ' The map on the left shows the approximate neighborhood.'
                  : ' The map on the left shows the approximate area — this donation\'s location has not been precisely verified.'}
              </div>
            </div>

          ) : donation.status !== 'available' ? (
            /* ── Donation reserved/closed, viewer has no active request ── */
            <div className="card p-8 text-center">
              <div className="empty-icon">🔒</div>
              <div className="font-semibold text-[#1c3520] mb-2">
                {donation.status === 'reserved' ? 'Already reserved' : 'No longer available'}
              </div>
              <div className="empty-text">This donation has already been claimed. Check the feed for other listings nearby.</div>
            </div>

          ) : (
            /* ── Available for pickup request ── */
            <div className="card p-6">
              <div className="eyebrow mb-1">Pickup request</div>
              <h2 className="section-title mb-5">Reserve this donation</h2>
              <div className="space-y-5">
                <div>
                  <label htmlFor="dd-time" className="form-label">Preferred Pickup Time <span className="text-red-600" aria-hidden>*</span></label>
                  <input id="dd-time" type="datetime-local" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} className="input-field" aria-required="true" />
                </div>
                <div>
                  <label htmlFor="dd-notes" className="form-label">Notes</label>
                  <textarea id="dd-notes" rows={4} placeholder="Add any special requests or notes for the donor…" value={notes} onChange={(e) => setNotes(e.target.value)} className="input-field resize-none" />
                </div>
                {donation.allowDiscreet && (
                  <div className="privacy-option">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input type="checkbox" checked={discreetPickup} onChange={(e) => setDiscreetPickup(e.target.checked)} className="mt-1 w-4 h-4" />
                      <div>
                        <div className="privacy-label">Request discreet pickup</div>
                        <div className="privacy-desc">Donor will share pickup instructions privately after approval</div>
                      </div>
                    </label>
                  </div>
                )}
                <button onClick={handleSubmit} className="btn-primary w-full">Send Pickup Request</button>
                <div className="text-[12px] text-[#8a9b8c] text-center">
                  Exact address revealed after the donor approves
                </div>
              </div>
            </div>
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

  const handleConfirm = () => {
    const payload: any = { title, description, foodType, quantity, expiryDate, dietaryTags, city, street, houseNumber, pickupNotes, allowDiscreet };
    if (imageData) payload.image = { data: imageData };
    onSubmit(payload);
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
        <div className="mb-8">
          <div className="eyebrow mb-2">Confirm location</div>
          <h1 className="page-title">Verify pickup spot.</h1>
          <p className="page-subtitle">Requesters see only the approximate neighborhood. Exact address is revealed to approved recipients only.</p>
        </div>
        <LocationConfirmStep
          street={street} houseNumber={houseNumber} city={city} pickupNotes={pickupNotes}
          geoPreview={geoPreview}
          onBack={() => setStep('form')}
          onConfirm={handleConfirm}
          confirmLabel="Confirm & Publish"
        />
      </div>
    );
  }

  // ── Step 1: Form ──
  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-2">New listing</div>
        <h1 className="page-title">Share surplus food.</h1>
        <p className="page-subtitle">A few details and your neighbors can reserve it within minutes.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        <div className="card p-6 space-y-6">
          <div>
            <div className="form-section-header"><span className="form-section-title">About the food</span></div>
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
              <div className="grid grid-cols-2 gap-4">
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
          </div>
          <div className="border-t border-zinc-100 pt-5">
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
          <div className="border-t border-zinc-100 pt-5">
            <div className="form-section-header"><span className="form-section-title">Pickup location</span></div>
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
          </div>
        </div>
        <div className="space-y-6">
          <div className="card p-6">
            <div className="form-section-header mb-3"><span className="form-section-title">Photo</span><span className="form-section-hint">Optional</span></div>
            <label htmlFor="cd-image" className="upload-area cursor-pointer block" aria-label="Upload food photo">
              {imageData ? (
                <img src={imageData} alt="Preview of selected image" className="max-h-48 mx-auto rounded" />
              ) : (
                <>
                  <span className="text-6xl mb-3 block text-center" aria-hidden>📷</span>
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
          </div>
          <div className="card p-6">
            <div className="form-section-header mb-3"><span className="form-section-title">Privacy</span></div>
            <div className="privacy-option mb-3">
              <div className="privacy-label">🔒 Address always protected</div>
              <div className="privacy-desc mt-1">Only the approximate neighborhood is shown publicly. Exact address and pickup notes are revealed only to recipients you approve.</div>
            </div>
            <label className="privacy-option flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={allowDiscreet} onChange={(e) => setAllowDiscreet(e.target.checked)} className="mt-1 w-4 h-4 flex-shrink-0" />
              <div><div className="privacy-label">Allow discreet pickup requests</div><div className="privacy-desc">Recipients can request private pickup instructions, useful for sensitive situations.</div></div>
            </label>
          </div>
          {geoError && (
            <div className="rounded-xl px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
              {geoError}
            </div>
          )}
          <div className="flex gap-4">
            <button onClick={onBack} className="btn-secondary flex-1">Cancel</button>
            <button onClick={handleCheckLocation} disabled={geoLoading} className="btn-primary flex-1">
              {geoLoading ? 'Checking location…' : 'Check Location'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MyDonations({ donations, requests, users, onViewDetails, onDelete, onEdit, onApprove, onDecline, onSetStatus }: any) {
  const formatDateTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const getDonationRequests = (did: number) => requests.filter((r: any) => r.donationId === did);

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-2">Donor dashboard</div>
        <h1 className="page-title">My donations.</h1>
        <p className="page-subtitle">Track your active listings and respond to incoming pickup requests.</p>
      </div>
      {donations.length === 0 ? <EmptyState message="You haven't created any donations yet. Share something delicious!" /> : (
        <div className="space-y-5">
          {donations.map((d: any) => {
            const dreqs = getDonationRequests(d.id);
            const pendingCount = dreqs.filter((r: any) => r.status === 'pending').length;
            const expiry = expiryHint(d.expiryDate);
            const isAvailable = d.status === 'available';
            const isReserved = d.status === 'reserved';
            const isClosed = d.status === 'cancelled' || d.status === 'expired';
            return (
              <div key={d.id} className="donation-row">
                <div className="grid grid-cols-1 md:grid-cols-12">
                  <div className="md:col-span-3 row-thumb">
                    <div className="row-thumb-inner">
                      <DonationImage url={d.imageUrl} foodType={d.foodType} seedId={d.id} />
                    </div>
                    <div className="image-badge"><StatusBadge status={d.status} /></div>
                  </div>
                  <div className="md:col-span-6 row-body">
                    <div className="mb-4">
                      <div className="eyebrow mb-1">{d.foodType}</div>
                      <h3 className="row-title">{d.title}</h3>
                      <div className="row-meta">{d.city}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <span className="info-pill"><span className="info-pill-label">Quantity</span><span className="info-pill-value">{d.quantity}</span></span>
                      <span className="info-pill"><span className="info-pill-label">Expires</span><span className="info-pill-value">{formatDateTime(d.expiryDate)}</span></span>
                      <span className="info-pill"><span className="info-pill-label">Requests</span><span className="info-pill-value">{dreqs.length}</span></span>
                      {expiry && isAvailable && (
                        <span className={`expiry-pill ${expiry.soon ? 'is-soon' : ''}`}>⏱ {expiry.label}</span>
                      )}
                    </div>
                    {pendingCount > 0 && <div className="alert-pending mb-4">⚠️ {pendingCount} pending request{pendingCount > 1 ? 's' : ''} awaiting your response</div>}
                    {dreqs.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-zinc-100">
                        <div className="detail-label mb-3">Incoming requests</div>
                        <div className="space-y-3">
                          {dreqs.map((r: any) => {
                            const requester = users.find((u: any) => u.id === r.requesterId);
                            return (
                              <div key={r.id} className="incoming-request">
                                <div className="flex items-start gap-3">
                                  <div className="requester-avatar">👤</div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-3 flex-wrap">
                                      <div>
                                        <div className="font-semibold text-[14px] text-[#1c3520]">{requester?.displayName ?? `User #${r.requesterId}`}</div>
                                        <div className="text-[13px] text-[#4b5d4d] mt-0.5">Pickup · {formatDateTime(r.pickupTime)}</div>
                                      </div>
                                      <StatusBadge status={r.status} />
                                    </div>
                                    {r.notes && <div className="text-[13px] text-[#4b5d4d] mt-2 leading-relaxed">{r.notes}</div>}
                                    {r.discreetPickup && <span className="privacy-badge mt-2">🔒 Discreet pickup requested</span>}
                                    {r.status === 'pending' && (
                                      <div className="flex gap-2 mt-3">
                                        <button onClick={() => onApprove(r.id)} className="btn-primary text-[13px] py-1.5 px-3">Approve</button>
                                        <button onClick={() => { if (confirm('Decline this request?')) onDecline(r.id); }} className="btn-danger text-[13px] py-1.5 px-3">Decline</button>
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
              </div>
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

  const doSave = () => {
    const payload: any = { title, description, foodType, quantity, expiryDate, dietaryTags, city, street, houseNumber, pickupNotes, allowDiscreet };
    if (newImageData) payload.image = { data: newImageData };
    onSubmit(payload);
  };

  const handleCheckLocation = async () => {
    if (!title || !description || !foodType || !quantity || !expiryDate || !city || !street) {
      alert('Please fill in all required fields');
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

  const breadcrumb = (
    <div className="breadcrumb">
      <button onClick={onBack} className="breadcrumb-link">My Donations</button>
      <span>/</span>
      <span className="breadcrumb-current">Edit Donation</span>
    </div>
  );

  // ── Step 2: Location confirmation (only when address changed) ──
  if (step === 'preview' && geoPreview) {
    return (
      <div>
        {breadcrumb}
        <div className="mb-8">
          <div className="eyebrow mb-2">Confirm new location</div>
          <h1 className="page-title">Verify updated pickup spot.</h1>
          <p className="page-subtitle">Address changed — confirm the new location before saving. Requesters see only the approximate neighborhood until you approve their request.</p>
        </div>
        <LocationConfirmStep
          street={street} houseNumber={houseNumber} city={city} pickupNotes={pickupNotes}
          geoPreview={geoPreview}
          onBack={() => setStep('form')}
          onConfirm={doSave}
          confirmLabel="Confirm & Save"
        />
      </div>
    );
  }

  // ── Step 1: Form ──
  return (
    <div>
      {breadcrumb}
      <div className="mb-8">
        <div className="eyebrow mb-2">Edit listing</div>
        <h1 className="page-title">Update your donation.</h1>
        <p className="page-subtitle">Refresh the details so neighbors see the latest information.</p>
      </div>
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
            <button onClick={handleSubmit} disabled={geoLoading} className="btn-primary flex-1">
              {geoLoading ? 'Checking location…' : addressChanged ? 'Check Location →' : 'Save Changes'}
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

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-2">Recipient dashboard</div>
        <h1 className="page-title">My requests.</h1>
        <p className="page-subtitle">Follow your reservations from request to pickup.</p>
      </div>
      <div className="tab-bar overflow-x-auto max-w-full" role="tablist" aria-label="Filter requests by status">
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
      {filteredRequests.length === 0 ? <EmptyState message={activeTab === 'all' ? 'No requests yet' : `No ${activeTab} requests`} /> : (
        <div className="space-y-5">
          {filteredRequests.map((req: any) => {
            const donation = donations.find((d: any) => d.id === req.donationId);
            const donor = donation ? users.find((u: any) => u.id === donation.donorId) : null;
            if (!donation || !donor) return null;
            // Use backend canSeeAddress as source of truth (backend applies shapeDonation per viewer).
            // Fall back to request status inference if the field is absent (legacy path).
            const canSeeAddress = donation.canSeeAddress ?? (req.status === 'approved' || req.status === 'completed');
            const reviewed = hasReview(req.id);
            return (
              <div key={req.id} className={`request-row state-${req.status}`}>
                <div className="grid grid-cols-1 md:grid-cols-12">
                  <div className="md:col-span-3 row-thumb">
                    <div className="row-thumb-inner">
                      <DonationImage url={donation.imageUrl} foodType={donation.foodType} seedId={donation.id} />
                    </div>
                    <div className="image-badge"><StatusBadge status={req.status} /></div>
                  </div>
                  <div className="md:col-span-6 row-body">
                    <div className="mb-4">
                      <div className="eyebrow mb-1">{donation.foodType}</div>
                      <h3 className="row-title">{donation.title}</h3>
                      <div className="row-meta">From <span className="font-semibold text-[#1c3520]">{donor.displayName}</span></div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className="info-pill"><span className="info-pill-label">Pickup</span><span className="info-pill-value">{formatDateTime(req.pickupTime)}</span></span>
                      <span className="info-pill"><span className="info-pill-label">📍</span><span className="info-pill-value">{formatDonationAddress(donation, canSeeAddress)}</span></span>
                      {req.discreetPickup && <span className="privacy-badge">🔒 Discreet</span>}
                    </div>
                    {!canSeeAddress && req.status === 'pending' && (
                      <div className="text-[12.5px] text-[#8a9b8c] mb-2">Full address shared after the donor approves your request.</div>
                    )}
                    {req.notes && (
                      <div className="mt-3 pt-3 border-t border-zinc-100">
                        <div className="detail-label mb-1">Your notes</div>
                        <div className="text-[14px] text-[#1c3520] leading-relaxed">{req.notes}</div>
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
              </div>
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
      <div className="breadcrumb"><button onClick={onBack} className="breadcrumb-link">My Requests</button><span>/</span><span className="breadcrumb-current">Leave Review</span></div>
      <div className="max-w-2xl mx-auto">
        <div className="card">
          <h1 className="review-title mb-6">Leave a Review</h1>
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

function Profile({ user, onBack, onSave }: { user: User; onBack: () => void; onSave: (patch: Partial<Pick<User, 'displayName' | 'email' | 'phone' | 'dietaryPreferences' | 'discreetPickup'>>) => void }) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone);
  const [dietaryPreferences, setDietaryPreferences] = useState<DietaryTag[]>(user.dietaryPreferences);
  const [discreetPickup, setDiscreetPickup] = useState(user.discreetPickup);

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-2">Your account</div>
        <h1 className="page-title">Profile & preferences</h1>
        <p className="page-subtitle">Manage how the community sees and reaches you.</p>
      </div>
      <div className="max-w-2xl">
        <div className="profile-reputation">
          <div className="flex items-center gap-5">
            <div className="donor-avatar-large">👤</div>
            <div className="flex-1">
              <div className="eyebrow mb-1">Community reputation</div>
              <div className="donor-name text-xl">{user.displayName}</div>
              <div className="flex items-center gap-1 text-sm mt-1">
                {[...Array(5)].map((_, i) => <span key={i} className={i < Math.floor(user.rating) ? 'star-filled' : 'star-empty'}>⭐</span>)}
                <span className="rating-value ml-2">{user.rating.toFixed(1)}</span>
                <span className="rating-count">({user.reviewCount} reviews)</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="stat-tile"><div className="stat-value">{user.rating.toFixed(1)}</div><div className="stat-label">Rating</div></div>
            <div className="stat-tile"><div className="stat-value">{user.reviewCount}</div><div className="stat-label">Reviews</div></div>
            <div className="stat-tile"><div className="stat-value">{user.dietaryPreferences.length || '—'}</div><div className="stat-label">Dietary Tags</div></div>
          </div>
        </div>
        <div className="card p-6 mb-6">
          <h2 className="section-title mb-4">Personal information</h2>
          <div className="space-y-4">
            <div><label htmlFor="profile-name" className="form-label mb-2">Display Name</label><input id="profile-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input-field" /></div>
            <div><label htmlFor="profile-email" className="form-label mb-2">Email</label><input id="profile-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-field" /></div>
            <div><label htmlFor="profile-phone" className="form-label mb-2">Phone</label><input id="profile-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="input-field" /></div>
          </div>
        </div>
        <div className="card p-6 mb-6">
          <h2 className="section-title mb-4">Dietary preferences</h2>
          <fieldset>
            <legend className="sr-only">Dietary preferences</legend>
            <div className="grid grid-cols-2 gap-3">{(['vegan', 'vegetarian', 'gluten_free', 'kosher'] as DietaryTag[]).map((tag) => (<label key={tag} className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={dietaryPreferences.includes(tag)} onChange={() => setDietaryPreferences(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])} className="w-4 h-4" /><span className="form-checkbox-label">{tag === 'gluten_free' ? 'Gluten-Free' : tag.charAt(0).toUpperCase() + tag.slice(1)}</span></label>))}</div>
          </fieldset>
        </div>
        <div className="card p-6 mb-6"><h2 className="section-title mb-4">Privacy settings</h2><label className="flex items-start gap-3 cursor-pointer"><input type="checkbox" checked={discreetPickup} onChange={(e) => setDiscreetPickup(e.target.checked)} className="mt-1 w-4 h-4" /><div><div className="privacy-label">Prefer discreet pickups</div><div className="privacy-desc mt-1">When enabled, your pickup requests will default to discreet mode</div></div></label></div>
        <div className="flex gap-4"><button onClick={onBack} className="btn-secondary flex-1">Cancel</button><button onClick={() => onSave({ displayName, email, phone, dietaryPreferences, discreetPickup })} className="btn-primary flex-1">Save changes</button></div>
      </div>
    </div>
  );
}