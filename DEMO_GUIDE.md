# CookCircle — Demo Guide

**Public URL:** https://cook-circle.replit.app

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Express 5 + Node.js 24 |
| Database | PostgreSQL + Drizzle ORM |
| Auth | Email/password (`crypto.scrypt`), httpOnly session cookie |
| Images | Cloudinary (production) / picsum fallback (demo mode) |
| Location | Google Geocoding API (server-side) + Places Autocomplete (browser) |
| Monorepo | pnpm workspaces + TypeScript |

---

## Demo Credentials

All demo users share the password **`CookCircle123!`**

| Email | Name | Role in demo |
|---|---|---|
| maya@example.co.il | Maya Cohen | Donor |
| yael@example.co.il | Yael Ben-David | Requester (approved on donation 1) |
| david@example.co.il | David Mizrahi | Donor |
| noa@example.co.il | Noa Shapiro | Donor (completed pickup) |
| eitan@example.co.il | Eitan Levi | Donor |

---

## Recommended 3–5 Minute Demo Flow

### 1. Auth gate (30 s)
- Open the public URL — the login screen appears immediately; nothing is accessible without an account.
- Click a demo email shortcut (e.g. **maya@example.co.il**) to auto-fill, type `CookCircle123!`, click **Sign In**.
- Point out: Register tab creates a real account with scrypt-hashed password; no session means 401 on all mutations.

### 2. Donor — create a donation (60 s)
- As **Maya Cohen**, click **+ Donate Food**.
- Fill title, food type, quantity, expiry, and an Israeli street address.
- Google Places Autocomplete suggests real addresses as you type.
- Submit: server geocodes the address, stores exact coords privately, computes an ~500 m offset for the public area pin, and attaches a deterministic image.
- Open the new listing: Maya sees her own exact address + map. Sign out.

### 3. Requester — privacy before approval (45 s)
- Log in as **Yael Ben-David** (`yael@example.co.il`).
- Open Maya's new donation — only an **approximate area** is shown on the map; exact address is hidden.
- Send a pickup request (pick a time, optional message). Sign out.

### 4. Donor — approve the request (30 s)
- Log back in as **Maya Cohen** → My Donations → approve Yael's request. Sign out.

### 5. Requester after approval — privacy reveal (45 s)
- Log in again as **Yael** → open the same donation.
- The exact street address and precise map pin are now visible (server-enforced reveal, not computed in browser).
- Complete the pickup.

### 6. Review (30 s)
- Still as Yael, submit a star rating and comment.
- Refresh the page — the review persists and Maya's aggregate rating updates.

### 7. Technical callouts (30 s)
- `GET /api/health` → `{ status, db, media, location }`
- `POST /api/donations` without cookie → `401 Authentication required`
- `GET /api/auth/me` without cookie → `401`; with session → user JSON (no `passwordHash` field ever returned)

---

## Privacy Model

| Viewer | What they see |
|---|---|
| Donor (own listing) | Exact address + coords + geocode metadata |
| Approved / completed requester | Exact address + coords |
| Pending requester | City only, ~500 m area pin |
| Public / unauthenticated | City only, ~500 m area pin |

Address reveal is backend-enforced via `shapeDonation()`. The browser never computes it.

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (Replit-provisioned) |
| `SESSION_SECRET` | Yes | Express session signing key |
| `GOOGLE_MAPS_API_KEY` | Optional | Server-side geocoding |
| `VITE_GOOGLE_MAPS_PUBLIC_KEY` | Optional | Browser Places Autocomplete |
| `CLOUDINARY_CLOUD_NAME` | Optional | Real image uploads |
| `CLOUDINARY_API_KEY` | Optional | Real image uploads |
| `CLOUDINARY_API_SECRET` | Optional | Real image uploads |

Without the optional vars the app runs in **local/demo mode**: deterministic pseudo-coordinates and picsum image URLs. All business flows work end-to-end.

---

## Health Endpoint

```
GET /api/health
→ { "status": "ok", "db": "postgres", "media": "local|cloudinary", "location": "local|google" }
```

---

## Build Commands

```bash
pnpm run typecheck                                  # full typecheck
pnpm --filter @workspace/api-server run build       # backend → dist/index.mjs
pnpm --filter @workspace/cookcircle run build       # frontend → _static/
pnpm --filter @workspace/db run push                # push schema (dev only)
```

---

## Reset Demo Data

```bash
psql "$DATABASE_URL" -c "truncate users, donations, pickup_requests, reviews restart identity cascade;"
# Restart the API Server workflow — seed + password hashes run automatically on boot.
```
