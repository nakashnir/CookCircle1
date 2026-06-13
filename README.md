# CookCircle

Neighborhood food-donation MVP. Donors post surplus food, neighbors reserve and pick it up, and the recipient leaves a review for the donor after a completed pickup. Built as a pnpm monorepo with three artifacts.

**Live demo (college server):** http://vmedu470.mtacloud.co.il:8080

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
- **Database** — Postgres. Local Postgres on the college-server deployment (`127.0.0.1:5432`); Replit Postgres in the original workspace.
- **Mockup sandbox** (`artifacts/mockup-sandbox`) — design preview server

Shared libraries live in `lib/` (Drizzle schema in `lib/db`).

In production the API server serves both `/api/*` **and** the compiled web bundle (`artifacts/cookcircle/_static`) from a single origin, so the whole app is reachable on one port (8080).

## Project layout

```
artifacts/
  api-server/        Express API (routes, media + location adapters, seed)
  cookcircle/        React web app
    src/lib/api.ts   Typed client for the API (single fetch entry point)
    public/
      donation-images/   31 demo donation photos (served at /donation-images/*)
    _static/         Vite production bundle (gitignored; rebuilt on deploy)
  mockup-sandbox/    Component preview server
lib/
  db/                Drizzle schema, client, push/migrate scripts
    scripts/
      seed-demo-food.mjs   Idempotent Israeli demo-food seed (see below)
demo-assets/
  food-pack/         Curated demo food pack (images + metadata JSON/CSV/docs)
deploy/
  start-cookcircle.sh   One-command start (installed at ~/start-cookcircle.sh)
  stop-cookcircle.sh    One-command stop  (installed at ~/stop-cookcircle.sh)
.env.example         Documented env vars (no secrets; real .env is gitignored)
```

## Local development

```bash
pnpm install
cp .env.example .env       # then fill in DATABASE_URL + SESSION_SECRET
pnpm --filter @workspace/db run push       # apply schema
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/cookcircle run dev
```

The web app proxies `/api/*` to the API server during local dev.

## Running on the college server (live demo)

The app is deployed on the college server. Two helper scripts make it a **single command** to start or stop — they are installed in the home directory (`~/start-cookcircle.sh`, `~/stop-cookcircle.sh`); their source is tracked in `deploy/`.

### 1. Log in to the server

```bash
ssh nakashni@vmedu470.mtacloud.co.il
```

Enter the password (sent separately — it is **not** stored in this repo).

### 2. Start the web

```bash
bash ~/start-cookcircle.sh
```

On success it prints `CookCircle started. Open: http://vmedu470.mtacloud.co.il:8080`.
Safe to run twice — if it's already up it just says so.

### 3. Open the app in your browser

```
http://vmedu470.mtacloud.co.il:8080
```

If your network blocks port 8080, use an SSH tunnel instead — in a **new** terminal on your own machine:

```bash
ssh -L 18080:127.0.0.1:8080 nakashni@vmedu470.mtacloud.co.il
```

then open `http://127.0.0.1:18080`.

### 4. Stop the web (free the port)

```bash
bash ~/stop-cookcircle.sh
```

### 5. Check status anytime

```bash
curl -s http://127.0.0.1:8080/api/healthz      # -> {"status":"ok"} when running
```

> **What the scripts do / manual alternative.** The app is a single backgrounded Node process serving both `/api/*` and the web bundle on port 8080. `.env` must include `PORT=8080`. To run it by hand:
> ```bash
> set -a; source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' ~/apps/cookcircle/.env); set +a
> nohup node --enable-source-maps ~/apps/cookcircle/artifacts/api-server/dist/index.mjs > ~/cookcircle-server.log 2>&1 &
> ```
> Stop with `pkill -f 'api-server/dist/index.mjs'`. If you pulled new frontend code, rebuild first: `pnpm install && pnpm --filter @workspace/cookcircle run build`.

### Quick reference (תקציר — גישה לשרת)

```bash
ssh nakashni@vmedu470.mtacloud.co.il   # התחברות לשרת
bash ~/start-cookcircle.sh             # הפעלת האתר
bash ~/stop-cookcircle.sh              # עצירת האתר (כיבוי הפורט)
# בדפדפן:  http://vmedu470.mtacloud.co.il:8080
```

> **Note:** the app does not auto-restart on reboot (no pm2/systemd yet) — run `~/start-cookcircle.sh` after a reboot. `pm2` is **not** installed, so `pm2 ...` commands will not work.

## Database

Schema is defined in `lib/db/src/schema/cookcircle.ts` (users, donations, pickup_requests, reviews) with FK cascades, status enums, and a unique index on `request_id` that enforces one review per completed pickup.

```bash
# Apply / sync schema
pnpm --filter @workspace/db run push
```

The API runs an idempotent **canonical seed** on first boot (5 users, 7 donations, 4 requests, 1 review). It detects whether the canonical donation (`id=1`) is present with location data — if missing, it truncates and re-seeds to restore a consistent state. It never clobbers data unless the canonical donation is gone.

## Demo data — Israeli food pack

A separate, **idempotent** seed adds realistic Israeli demo donations on top of (not instead of) the canonical data, for presentations. Source: `lib/db/scripts/seed-demo-food.mjs`, reading `demo-assets/food-pack/.../metadata/cookcircle_demo_donations.json`.

```bash
cd ~/apps/cookcircle
pnpm --filter @workspace/db run seed:demo-food
# equivalent: node lib/db/scripts/seed-demo-food.mjs
```

What it does:

- Inserts **31 donations** with natural Hebrew titles/descriptions, Hebrew food types, dietary tags, quantities, and **real Israeli pickup locations** (Tel Aviv, Jerusalem, Haifa, Be'er Sheva, …) with matching coordinates.
- Creates **12 synthetic donor users** with Hebrew display names and safe `@example.com` emails (never real identities).
- Sets `status = available` and generates **now-relative expiry** so the cards look live during a demo.
- Serves each photo from `/donation-images/<file>` (files live in `artifacts/cookcircle/public/donation-images/`).
- **Idempotent & safe:** each demo row is keyed on a hidden internal token stored in `place_id` (never returned by the API or shown in the UI). Re-running updates the live fields instead of duplicating, and existing/real data is never deleted or reset.
- **No user-facing field contains** `demo`/`test`/`seed`/`sample`/`fake`/`placeholder`.

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

- `GET /api/healthz` — liveness probe, returns `{ "status": "ok" }`.
- `GET /api/health` — returns `{ status, db, media, location }` to confirm which adapters are live.

| Adapter      | Active when…                                                       | Fallback behavior                                                                                  |
| ------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **media**    | All three `CLOUDINARY_*` vars are set → `cloudinary`               | `local` — every donation gets a stable `imageUrl`; the web client renders a food-themed gradient + emoji placeholder when no real image is uploaded, so the feed never shows broken or random photos. |
| **location** | `GOOGLE_MAPS_API_KEY` set → `google` | `local` — deterministic pseudo-coords derived from the address, so distance calculation and the embedded OpenStreetMap preview still work end-to-end. |

See `.env.example` for the full list of env vars. Real secrets live only in the server's `.env` (gitignored) — never in this repo.

## Recent changes & current status

### Done

- ✅ Postgres-backed backend with full donation / request / review lifecycle, dietary tags, and privacy (area-only location for the public feed; exact address revealed to donor / approved requester).
- ✅ Canonical boot seed (idempotent).
- ✅ **Israeli demo food pack** — 31 Hebrew donations, 12 synthetic donors, real locations, real photos, live expiry, via the new idempotent `seed:demo-food` script (`lib/db/scripts/`).
- ✅ Demo photos committed under `artifacts/cookcircle/public/donation-images/` and the source pack under `demo-assets/`.
- ✅ Deployed and running on the college server (single-origin Express on port 8080), reachable directly at the live-demo URL above.
- ✅ Local media/location fallback (`local` adapters) so the app is fully usable with no third-party keys.

### Not configured / known gaps

- ⚠️ **Cloudinary** and **Google Maps** keys are not set on the server → both adapters run in `local` fallback (functional, but no real CDN/geocoding).
- ⚠️ **No process manager** — the app runs as a plain backgrounded `node` process (start/stop via `deploy/` scripts) and does **not** auto-restart on server reboot. (pm2 / systemd recommended.)
- ℹ️ `PORT=8080` must be present in the server `.env` (the app requires it at boot).
- ⚠️ `artifacts/mockup-sandbox` has a pre-existing TypeScript error (Vite version drift between `vite@5` and `vite@7` plugin types). It is the design-mockup package only and does **not** affect the running app; the app packages (`api-server`, `cookcircle`, `lib/*`) typecheck clean.
- ⚠️ **No automated tests** are configured.
- ⚠️ Some tracked files carry mixed CRLF/LF line endings; adding a `.gitattributes` (`* text=auto eol=lf`) would normalize this.
