# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## CookCircle (artifacts/cookcircle + artifacts/api-server)

Food-donation MVP. Approved scope: donation lifecycle, pickup requests, reviews/ratings, dietary tags, privacy/discreet pickup, media + location integration, Postgres-backed backend.

**Out of scope**: chat, AI, shared cooking, admin, payments, delivery logistics, advanced notifications, gamification.

### Sprints

- **Sprints 1–5**: Complete and verified. See git history for details.
- **Sprint 6**: Final polish — UI a11y, docs cleanup, OpenAPI accuracy, .env.example, demo guide.
- **Sprint 1 Auth** (Real Minimal Auth): Complete. Email/password register + login + logout using Node.js built-in `crypto.scrypt` (no new deps). All mutations protected with `requireAuth` middleware. Public reads (donations, users, health) remain open. Login screen gates the app. `GET /api/auth/me` is the session check; `POST /api/auth/login|register|logout` are the auth endpoints.

### Architecture

- **DB schema**: `lib/db/src/schema/cookcircle.ts` — users, donations, pickup_requests, reviews; FK cascades; status enums; unique `(request_id, reviewer_id)` index.
- **API**: `artifacts/api-server/src/routes/cookcircle.ts` — Drizzle, transactions + `FOR UPDATE` locking, status guards, donor rating aggregation on review, privacy shaping via `shapeDonation()`.
- **Seed**: `artifacts/api-server/src/routes/cookcircle-seed.ts` — idempotent; checks `id=1 AND area_lat IS NOT NULL`. Re-seeds when canonical donation is missing. 5 users, 7 donations, 4 requests, 1 review.
- **Media adapter**: `artifacts/api-server/src/lib/media.ts` — Cloudinary when `CLOUDINARY_*` set, else deterministic picsum. Always assigns `imageUrl` on create.
- **Location adapter**: `artifacts/api-server/src/lib/location.ts` — Google Geocoding when `GOOGLE_MAPS_API_KEY` set, else deterministic pseudo-geocoder (local/demo mode). Provider is `"google" | "local"` only.
- **Web client**: `artifacts/cookcircle/src/App.tsx` (single screen-router component) calls into `artifacts/cookcircle/src/lib/api.ts` (typed fetch client; the only place that touches `/api`).
- `GET /api/health` returns `{ status, db, media, location }`.

### Privacy Model

Address reveal is backend-enforced. `shapeDonation()` gates by `reveal` bool:

| Viewer | `reveal` | Gets |
|---|---|---|
| Donor (own listing) | `true` | Full exact address + coords + geocode metadata |
| Approved/completed requester | `true` | Full exact address + coords + geocode metadata |
| Pending requester / public | `false` | City only; area coords only |

`canSeeAddress` is the frontend source of truth (set by backend, never computed in browser).

**Compat aliases in API response (must stay):**
- `address` — assembled from `street + houseNumber`; reveal-gated. Used by `formatDonationAddress()` fallback in frontend.
- `latitude` / `longitude` — mirror `exactLat` / `exactLng`; reveal-gated. Used by DonationDetails exact map.

### Location Fields

| Field | Public | Notes |
|---|---|---|
| `areaLatitude` / `areaLongitude` | Always | ~500 m offset from exact in Google mode; pseudo-coords in local mode |
| `areaRadiusMeters` | Always | 500 = Google-verified; null = local/unverified |
| `latitude` / `longitude` | Reveal-gated | Exact coords; null in fallback/local mode |
| `geocodeStatus` | Reveal-gated | `ok`, `fallback`, `zero_results`, `error` |
| `geocodePrecision` | Reveal-gated | `rooftop`, `interpolated`, `center`, `approximate` |
| `locationConfirmed` | Reveal-gated | Donor-advisory; blocks re-publish if false |

### Key Backend Guards (Sprint 5)

- `DELETE /donations/:id` — 409 for `reserved` or `picked_up` status.
- `PATCH /donations/:id` address change — 409 if an approved pickup request exists.
- `PATCH /donations/:id` status → `available` — 409 if `locationConfirmed = false`.
- `POST /donations` — 400 if geocoding returns `zero_results`.
- Cannot request own donation, cannot duplicate requests, cannot review pending requests, cannot cancel completed requests.

### Demo Users (seed)

All seed users share password **`CookCircle123!`**

| ID | Email | Name | Role in seed |
|---|---|---|---|
| 1 | yael@example.co.il | Yael Ben-David | Has an approved request on donation 1 (Maya's) |
| 2 | maya@example.co.il | Maya Cohen | Donor of donations 1 & 5 |
| 3 | david@example.co.il | David Mizrahi | Donor of donation 2 |
| 4 | noa@example.co.il | Noa Shapiro | Donor of donation 3 (picked up) |
| 5 | eitan@example.co.il | Eitan Levi | Donor of donation 4 |

Switch users by logging out and back in via the auth screen.

### Environment Variables

- `DATABASE_URL` — required
- `SESSION_SECRET` — required (set in Replit secrets)
- `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` — optional; enables real image upload
- `GOOGLE_MAPS_API_KEY` — optional (server-side); enables real geocoding
- `VITE_GOOGLE_MAPS_PUBLIC_KEY` — optional (browser-side); enables Google Places Autocomplete

### Trust-Preserving Language (Mandatory)

- "Location not verified" — when geocode status is fallback/local mode
- "Approximate area" — for public/pending viewers
- Never label fallback area maps as "Exact pickup location"

## User Preferences

- Keep commits focused and descriptive.
- Prefer targeted edits over rewrites.
- Never introduce silent fallbacks; be explicit when something fails.
