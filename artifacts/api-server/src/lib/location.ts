// Location service for CookCircle donations.
//
// Modes:
//   "google"  — GOOGLE_MAPS_API_KEY is set; real geocoding returns exact + area coords.
//   "local"   — No key; pseudo-geocoder for demo/dev. exactLat/exactLng are ALWAYS null
//               in this mode. Pseudo-coords go into areaLat/areaLng only.
//               The UI must label area maps as "Location not verified".
//
// Sprint 1: Google Geocoding API integration is wired; requires GOOGLE_MAPS_API_KEY.
// Sprint 2: Google Places Autocomplete UI will be added to the frontend.

const googleKey = process.env.GOOGLE_MAPS_API_KEY ?? "";

export const locationProvider: "google" | "local" = googleKey ? "google" : "local";

// Full geocoding result. Both exact and area coords are always present unless the
// geocode failed entirely. In local/fallback mode, exactLat/exactLng are null.
export interface GeocodeResult {
  // Verified exact location — null in fallback/local mode (never fake precision).
  exactLat: number | null;
  exactLng: number | null;
  // Area location — ~500 m offset from exact in real mode; pseudo-coords in fallback.
  areaLat: number | null;
  areaLng: number | null;
  // null when geocodeProvider="local" (unverified)
  areaRadiusMeters: number | null;
  formattedAddress: string | null;
  placeId: string | null;
  provider: "google" | "local";
  // ok | zero_results | error | fallback | city_unrecognized
  status: string;
  // rooftop | interpolated | center | approximate | null
  precision: string | null;
}

// Compute a privacy-safe area point by displacing the exact location by a fixed
// 500 m radius in a deterministic but non-reversible direction derived from placeId.
// The direction is derived from a hash of placeId so it is stable across re-geocodes
// of the same address but unpredictable to an outside observer.
export function computeAreaPoint(
  exactLat: number,
  exactLng: number,
  placeId: string | null,
): { areaLat: number; areaLng: number; areaRadiusMeters: number } {
  const seed = placeId ?? `${exactLat.toFixed(6)},${exactLng.toFixed(6)}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const angleDeg = Math.abs(h % 360);
  const angleRad = (angleDeg * Math.PI) / 180;
  const RADIUS_M = 500;
  // 1° latitude ≈ 111 111 m; 1° longitude ≈ 111 111 * cos(lat) m
  const dLat = (RADIUS_M * Math.cos(angleRad)) / 111_111;
  const dLng =
    (RADIUS_M * Math.sin(angleRad)) /
    (111_111 * Math.cos((exactLat * Math.PI) / 180));
  return {
    areaLat: Number((exactLat + dLat).toFixed(6)),
    areaLng: Number((exactLng + dLng).toFixed(6)),
    areaRadiusMeters: RADIUS_M,
  };
}

// Deterministic pseudo-geocoder for dev/demo mode.
// Output goes to areaLat/areaLng ONLY — never to exactLat/exactLng.
function pseudoGeocode(query: string): { areaLat: number; areaLng: number } {
  if (!query) return { areaLat: 32.07, areaLng: 34.78 };
  let h = 0;
  for (let i = 0; i < query.length; i++) {
    h = (h * 31 + query.charCodeAt(i)) | 0;
  }
  // Spread roughly around Tel Aviv centre within ~0.1 deg (~11 km)
  const areaLat = 32.07 + ((h & 0xff) / 255 - 0.5) * 0.1;
  const areaLng = 34.78 + (((h >> 8) & 0xff) / 255 - 0.5) * 0.1;
  return {
    areaLat: Number(areaLat.toFixed(6)),
    areaLng: Number(areaLng.toFixed(6)),
  };
}

function mapGooglePrecision(locationType: string): string {
  switch (locationType) {
    case "ROOFTOP":
      return "rooftop";
    case "RANGE_INTERPOLATED":
      return "interpolated";
    case "GEOMETRIC_CENTER":
      return "center";
    case "APPROXIMATE":
      return "approximate";
    default:
      return "approximate";
  }
}

// Geocode a structured address server-side.
//
// Call signatures:
//   geocodeAddress(street, houseNumber, city)  — structured (Sprint 1+)
//   geocodeAddress(address, city)              — legacy two-arg form (backward compat)
export async function geocodeAddress(
  street: string,
  houseNumberOrCity: string,
  cityArg?: string,
): Promise<GeocodeResult> {
  let houseNumber: string;
  let city: string;
  if (cityArg !== undefined) {
    // Three-arg structured form
    houseNumber = houseNumberOrCity;
    city = cityArg;
  } else {
    // Legacy two-arg form: geocodeAddress(address, city)
    houseNumber = "";
    city = houseNumberOrCity;
  }

  const parts = [street, houseNumber, city, "Israel"].filter((s) => s.trim());
  const query = parts.join(", ");

  if (googleKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${googleKey}`;
      const res = await fetch(url);
      if (res.ok) {
        const j = (await res.json()) as {
          status: string;
          results: {
            geometry: {
              location: { lat: number; lng: number };
              location_type: string;
            };
            formatted_address: string;
            place_id: string;
          }[];
        };
        if (j.status === "ZERO_RESULTS") {
          // Google ran but found no match. Provider is "google" — the geocoder
          // processed the request; it just produced no results. exactLat/Lng
          // remain null; pseudo-coords go to area for map centering only.
          const { areaLat, areaLng } = pseudoGeocode(query);
          return {
            exactLat: null,
            exactLng: null,
            areaLat,
            areaLng,
            areaRadiusMeters: null,
            formattedAddress: null,
            placeId: null,
            provider: "google",
            status: "zero_results",
            precision: null,
          };
        }
        if (j.status === "OK" && j.results?.[0]) {
          const r = j.results[0];
          const exactLat = r.geometry.location.lat;
          const exactLng = r.geometry.location.lng;
          const placeId = r.place_id;
          const area = computeAreaPoint(exactLat, exactLng, placeId);
          return {
            exactLat,
            exactLng,
            ...area,
            formattedAddress: r.formatted_address,
            placeId,
            provider: "google",
            status: "ok",
            precision: mapGooglePrecision(r.geometry.location_type),
          };
        }
      }
    } catch {
      // Fall through to pseudo-geocoder below
    }
    // Google key set but call failed
    const { areaLat, areaLng } = pseudoGeocode(query);
    return {
      exactLat: null,
      exactLng: null,
      areaLat,
      areaLng,
      areaRadiusMeters: null,
      formattedAddress: null,
      placeId: null,
      provider: "local",
      status: "error",
      precision: null,
    };
  }

  // No Google key — local/demo mode.
  // Exact coords are never produced; pseudo-coords go to area only.
  const { areaLat, areaLng } = pseudoGeocode(query);
  return {
    exactLat: null,
    exactLng: null,
    areaLat,
    areaLng,
    areaRadiusMeters: null,
    formattedAddress: null,
    placeId: null,
    provider: "local",
    status: "fallback",
    precision: null,
  };
}
