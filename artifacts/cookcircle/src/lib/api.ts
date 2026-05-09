export type DietaryTag = 'kosher' | 'gluten_free' | 'vegan' | 'vegetarian';
export type DonationStatus = 'available' | 'reserved' | 'picked_up' | 'cancelled' | 'expired';
export type RequestStatus = 'pending' | 'approved' | 'cancelled' | 'completed';

export interface User {
  id: number;
  displayName: string;
  email: string;
  phone: string;
  dietaryPreferences: DietaryTag[];
  discreetPickup: boolean;
  rating: number;
  reviewCount: number;
}

export interface Donation {
  id: number;
  title: string;
  description: string;
  foodType: string;
  quantity: string;
  expiryDate: string;
  dietaryTags: DietaryTag[];
  city: string;
  // Legacy compat flat address (assembled from street + houseNumber server-side)
  address: string | null;
  // Structured address fields (Sprint 1+) — reveal-gated
  street?: string | null;
  houseNumber?: string | null;
  pickupNotes?: string | null;
  formattedAddress?: string | null;
  donorId: number;
  status: DonationStatus;
  createdAt: string;
  allowDiscreet?: boolean;
  imageUrl?: string | null;
  imagePublicId?: string | null;
  // Exact coords — reveal-gated (null in fallback/local mode)
  latitude?: number | null;
  longitude?: number | null;
  // Area coords — always public (~500m offset in Google mode, pseudo in fallback)
  areaLatitude?: number | null;
  areaLongitude?: number | null;
  areaLabel?: string | null;
  areaRadiusMeters?: number | null;
  // Geocode quality — reveal-gated
  geocodeStatus?: string | null;
  geocodePrecision?: string | null;
  geocodeProvider?: string | null;
  locationConfirmed?: boolean;
  canSeeAddress?: boolean;
}

export interface PickupRequest {
  id: number;
  donationId: number;
  requesterId: number;
  pickupTime: string;
  notes: string;
  discreetPickup: boolean;
  status: RequestStatus;
  createdAt: string;
}

export interface Review {
  id: number;
  donationId: number;
  requestId: number;
  reviewerId: number;
  revieweeId: number;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface HealthStatus {
  status: string;
  db: string;
  media: 'cloudinary' | 'local';
  location: 'google' | 'local';
}

export interface GeocodePreview {
  areaLat: number | null;
  areaLng: number | null;
  exactLat: number | null;
  exactLng: number | null;
  areaRadiusMeters: number | null;
  formattedAddress: string | null;
  // ok: Google matched; check precision for confidence level.
  // zero_results: Google ran but found nothing — cannot publish.
  // error: Google key configured but call failed — degrade honestly.
  // fallback: no Google key — local/demo mode.
  status: 'ok' | 'zero_results' | 'error' | 'fallback';
  // rooftop/interpolated = high confidence; center/approximate = lower confidence.
  precision: 'rooftop' | 'interpolated' | 'center' | 'approximate' | null;
  provider: 'google' | 'local';
}

const API_BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export type DonationDraft = Omit<
  Donation,
  'id' | 'donorId' | 'status' | 'createdAt'
>;

export interface DonationListOptions {
  city?: string;
  dietary?: DietaryTag[];
  status?: DonationStatus | 'any';
  sort?: 'newest' | 'expiring' | 'nearest';
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

export interface DonationWithDistance extends Donation {
  distanceKm?: number | null;
}

function buildDonationQuery(opts?: DonationListOptions): string {
  if (!opts) return '';
  const p = new URLSearchParams();
  if (opts.city) p.set('city', opts.city);
  if (opts.dietary && opts.dietary.length) p.set('dietary', opts.dietary.join(','));
  if (opts.status) p.set('status', opts.status);
  if (opts.sort) p.set('sort', opts.sort);
  if (opts.lat != null) p.set('lat', String(opts.lat));
  if (opts.lng != null) p.set('lng', String(opts.lng));
  if (opts.radiusKm != null) p.set('radiusKm', String(opts.radiusKm));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  listDonations: (opts?: DonationListOptions) =>
    request<DonationWithDistance[]>(`/donations${buildDonationQuery(opts)}`),
  listRequests: () => request<PickupRequest[]>('/requests'),
  listReviews: () => request<Review[]>('/reviews'),

  getCurrentUser: () => request<User>('/auth/me'),

  login: (email: string, password: string) =>
    request<User>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (name: string, email: string, password: string) =>
    request<User>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),

  logout: () =>
    request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  listUsers: () => request<User[]>('/users'),

  createDonation: (draft: DonationDraft & { image?: { data: string } }) =>
    request<Donation>('/donations', {
      method: 'POST',
      body: JSON.stringify(draft),
    }),

  updateDonation: (donationId: number, patch: Partial<Donation>) =>
    request<Donation>(`/donations/${donationId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteDonation: (donationId: number) =>
    request<void>(`/donations/${donationId}`, { method: 'DELETE' }),

  createPickupRequest: (
    donationId: number,
    pickupTime: string,
    notes: string,
    discreetPickup: boolean,
  ) =>
    request<PickupRequest>(`/donations/${donationId}/requests`, {
      method: 'POST',
      body: JSON.stringify({ pickupTime, notes, discreetPickup }),
    }),

  setRequestStatus: (requestId: number, status: RequestStatus) => {
    if (status === 'completed') {
      return request<PickupRequest>(`/requests/${requestId}/complete`, {
        method: 'POST',
      });
    }
    if (status === 'cancelled') {
      return request<PickupRequest>(`/requests/${requestId}/cancel`, {
        method: 'POST',
      });
    }
    return request<PickupRequest>(`/requests/${requestId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  submitReview: (requestId: number, rating: number, comment: string) =>
    request<Review>(`/requests/${requestId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment }),
    }),

  getHealth: () => request<HealthStatus>('/health'),

  geocodePreview: (street: string, houseNumber: string, city: string) =>
    request<GeocodePreview>('/geocode/preview', {
      method: 'POST',
      body: JSON.stringify({ street, houseNumber, city }),
    }),

  updateUser: (
    userId: number,
    patch: Partial<Pick<User, 'displayName' | 'email' | 'phone' | 'dietaryPreferences' | 'discreetPickup'>>,
  ) =>
    request<User>(`/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
};
