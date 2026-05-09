# CookCircle

Neighborhood food-donation MVP. Donors post surplus food, neighbors reserve and pick it up, and the recipient leaves a review for the donor after a completed pickup. Built as a pnpm monorepo with three artifacts.

## Approved scope

1. Donation lifecycle (`available` → `reserved` → `picked_up` / `cancelled` / `expired`)
2. Pickup-request management (`pending` → `approved` → `completed` / `cancelled`)
3. Reviews & ratings
4. Dietary tags (`kosher`, `gluten_free`, `vegan`, `vegetarian`)
5. Privacy / discreet pickup (no full address before approval)
6. Media + location integration
7. Postgres-backed backend

Out of scope: chat, AI, shared cooking, admin, payments, delivery logistics, advanced notifications, gamification.

## Stack

- **Web** (`artifacts/cookcircle`) — React 18 + Vite + Tailwind 3
- **API** (`artifacts/api-server`) — Express + Drizzle ORM
- **Database** — Postgres (Replit Postgres in this workspace)
- **Mockup sandbox** (`artifacts/mockup-sandbox`) — design preview server

Shared libraries live in `lib/` (Drizzle schema in `lib/db`).

## Run

Replit auto-starts the workflows. To run locally:

```bash
pnpm install
cp .env.example .env       # then fill in DATABASE_URL + SESSION_SECRET
pnpm --filter @workspace/db run push       # apply schema
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/cookcircle run dev
```

The web app proxies `/api/*` to the API server. Open the CookCircle preview from the workspace.

## Database

Schema is defined in `lib/db/src/schema/cookcircle.ts` (users, donations, pickup_requests, reviews) with FK cascades, status enums, and a unique index on `request_id` that enforces one review per completed pickup.

```bash
# Apply / sync schema
pnpm --filter @workspace/db run push

# Reset & reseed (drops all data, then the API auto-seeds on next boot)
psql "$DATABASE_URL" -c "truncate users, donations, pickup_requests, reviews restart identity cascade;"
# Then restart the API workflow.
```

The API runs an idempotent seed on first boot: 5 users, 7 donations, 4 requests, 1 review. The seed detects whether the canonical donation (`id=1`) is present with location data — if missing, it truncates and re-seeds to restore a consistent demo state. It never clobbers data unless the canonical donation is gone.

## Donations API

`GET /api/donations` — list donations. All query params optional; viewer-scoped privacy is always applied.

| Param      | Type / values                                  | Default     | Notes |
| ---------- | ---------------------------------------------- | ----------- | ----- |
| `status`   | `available` \| `reserved` \| `picked_up` \| `cancelled` \| `expired` \| `any` | `available` | `any` returns every status |
| `city`     | string                                         | —           | Exact match |
| `dietary`  | csv of `vegan,vegetarian,gluten_free,kosher`   | —           | All listed tags must be present (jsonb `@>`) |
| `sort`     | `newest` \| `expiring` \| `nearest`            | `newest`    | `nearest` requires `lat`+`lng` |
| `lat`,`lng`| number                                         | —           | Origin for distance calc |
| `radiusKm` | number                                         | —           | When set with `lat`+`lng`, filters out donations beyond radius |

When `lat`+`lng` are provided, each result includes `distanceKm` (Haversine, 2 decimals) or `null` for donations without coords.

`PATCH /api/donations/:id` — donor only. In addition to editing fields, the donor may move `status` between listing-side states. The request flow controls `reserved`/`picked_up`; donors cannot set those manually.

Allowed donor transitions:

- `available` → `cancelled` | `expired`
- `reserved` → `cancelled` (cascades: open `pending`/`approved` requests → `cancelled` in the same transaction)
- `cancelled` | `expired` → `available` (reopen)
- `picked_up` → terminal

Invalid transitions return `409 Conflict`.

## Health & integrations

`GET /api/health` returns `{ status, db, media, location }` — useful to confirm which adapters are live.

| Adapter      | Active when…                                                       | Fallback behavior                                                                                  |
| ------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **media**    | All three `CLOUDINARY_*` vars are set → `cloudinary`               | `local` — every donation gets a stable `imageUrl`; the web client renders a food-themed gradient + emoji placeholder when no real image is uploaded, so the feed never shows broken or random photos. |
| **location** | `GOOGLE_MAPS_API_KEY` set → `google` | `local` — deterministic pseudo-coords derived from the address, so distance calculation and the embedded OpenStreetMap preview still work end-to-end. |

### Current build status (this workspace)

By default the workspace ships with **no third-party keys configured**, so both adapters report `local`. The product is fully usable in this state — uploaded images are stored as data URLs through the same `/api/donations` payload, distances are computed from the deterministic coords, and the OpenStreetMap iframe renders a real map regardless. Hit `GET /api/health` at any time to verify.

See `.env.example` for the full list of env vars.

## Project layout

```
artifacts/
  api-server/        Express API (routes, media + location adapters, seed)
  cookcircle/        React web app
    src/lib/api.ts   Typed client for the API (single fetch entry point)
  mockup-sandbox/    Component preview server
lib/
  db/                Drizzle schema, client, push/migrate scripts
.env.example
```
