import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  donationsTable,
  pickupRequestsTable,
  reviewsTable,
  usersTable,
  type Donation,
  type PickupRequest,
  type Review,
  type User,
} from "@workspace/db";
import { geocodeAddress, locationProvider } from "../lib/location";
import { mediaProvider, uploadDonationImage } from "../lib/media";
import { getSessionUserId, requireAuth } from "../lib/session";
import { ensureSeed } from "./cookcircle-seed";

type DietaryTag = "kosher" | "gluten_free" | "vegan" | "vegetarian";
type DonationStatus = Donation["status"];
type RequestStatus = PickupRequest["status"];

const VALID_DIETARY: DietaryTag[] = [
  "kosher",
  "gluten_free",
  "vegan",
  "vegetarian",
];
const VALID_DONATION_STATUS: DonationStatus[] = [
  "available",
  "reserved",
  "picked_up",
  "cancelled",
  "expired",
];
const VALID_REQUEST_STATUS: RequestStatus[] = [
  "pending",
  "approved",
  "cancelled",
  "completed",
];

function bad(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

function sanitizeTags(input: unknown): DietaryTag[] {
  if (!Array.isArray(input)) return [];
  return input.filter((t): t is DietaryTag =>
    VALID_DIETARY.includes(t as DietaryTag),
  );
}

// ---------------------------------------------------------------------------
// Privacy shaping
//
// Airbnb-style model (unconditional — no per-donation override):
//   reveal=false  →  public/pending viewer: area coords + city only
//   reveal=true   →  donor or approved/completed requester: exact coords + full address
//
// In local/fallback mode: exactLat/exactLng are null (never fake precision).
// Area coords are always returned and are safe to expose publicly.
// ---------------------------------------------------------------------------
function shapeDonation(d: Donation, reveal: boolean) {
  // Exact coords and structured address — donor or approved requester only.
  const latitude = reveal ? d.exactLat : null;
  const longitude = reveal ? d.exactLng : null;
  const street = reveal ? d.street : null;
  const houseNumber = reveal ? d.houseNumber : null;
  const pickupNotes = reveal ? d.pickupNotes : null;
  const formattedAddress = reveal ? d.formattedAddress : null;

  // Legacy compat: address string assembled from structured fields (for old frontend).
  const address = reveal
    ? [d.street, d.houseNumber].filter(Boolean).join(" ").trim() ||
      d.address ||
      null
    : null;

  // Area coords — always returned; public-safe (~500 m offset from exact in real mode,
  // pseudo-coords in fallback mode). Use d.areaLat / d.areaLng from the stored value.
  const areaLatitude = d.areaLat;
  const areaLongitude = d.areaLng;

  // Geocode quality — returned in reveal mode for donor advisory display in Sprint 2+.
  const geocodeStatus = reveal ? d.geocodeStatus : null;
  const geocodePrecision = reveal ? d.geocodePrecision : null;
  const geocodeProvider = reveal ? d.geocodeProvider : null;

  return {
    id: d.id,
    title: d.title,
    description: d.description,
    foodType: d.foodType,
    quantity: d.quantity,
    expiryDate: d.expiryDate,
    dietaryTags: d.dietaryTags ?? [],

    // Location — city always public
    city: d.city,
    country: d.country,

    // Structured address (reveal-gated)
    street,
    houseNumber,
    pickupNotes,
    formattedAddress,

    // Legacy compat: flat address string (reveal-gated)
    address,

    // Exact coords (reveal-gated)
    latitude,
    longitude,

    // Area coords (always public — safe to expose to all viewers)
    areaLatitude,
    areaLongitude,
    areaLabel: d.areaLabel ?? d.city,
    areaRadiusMeters: d.areaRadiusMeters,

    // Geocode quality (reveal-gated — only meaningful to donor / approved requester)
    geocodeStatus,
    geocodePrecision,
    geocodeProvider,

    // Media
    imageUrl: d.imageUrl,
    imagePublicId: d.imagePublicId,

    // Donation meta
    donorId: d.donorId,
    status: d.status,
    // locationConfirmed is donor-advisory only — not needed by public viewers
    locationConfirmed: reveal ? d.locationConfirmed : undefined,
    allowDiscreet: d.allowDiscreet,
    createdAt:
      d.createdAt instanceof Date ? d.createdAt.toISOString() : d.createdAt,

    // Privacy flag for frontend
    canSeeAddress: reveal,
  };
}

// Determine which donation IDs the viewer may see exact details for:
// own donations + approved/completed requests.
async function donationsRevealableByViewer(
  viewerId: number,
): Promise<Set<number>> {
  const reveal = new Set<number>();
  const owned = await db
    .select({ id: donationsTable.id })
    .from(donationsTable)
    .where(eq(donationsTable.donorId, viewerId));
  for (const r of owned) reveal.add(r.id);
  const requested = await db
    .select({ id: pickupRequestsTable.donationId })
    .from(pickupRequestsTable)
    .where(
      and(
        eq(pickupRequestsTable.requesterId, viewerId),
        sql`${pickupRequestsTable.status} in ('approved','completed')`,
      ),
    );
  for (const r of requested) reveal.add(r.id);
  return reveal;
}

function shapeRequest(r: PickupRequest) {
  return {
    id: r.id,
    donationId: r.donationId,
    requesterId: r.requesterId,
    pickupTime: r.pickupTime,
    notes: r.notes,
    discreetPickup: r.discreetPickup,
    status: r.status,
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  };
}

function shapeReview(r: Review) {
  return {
    id: r.id,
    donationId: r.donationId,
    requestId: r.requestId,
    reviewerId: r.reviewerId,
    revieweeId: r.revieweeId,
    rating: r.rating,
    comment: r.comment,
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  };
}

function shapeUser(u: User) {
  return {
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    phone: u.phone,
    dietaryPreferences: u.dietaryPreferences ?? [],
    discreetPickup: u.discreetPickup,
    rating: u.rating,
    reviewCount: u.reviewCount,
  };
}

const router: IRouter = Router();

// Lazy-seed on first request to avoid blocking startup if DB is slow.
let seeded = false;
router.use(async (_req, _res, next) => {
  if (!seeded) {
    try {
      await ensureSeed();
      seeded = true;
    } catch (err) {
      console.error("cookcircle: seed failed", err);
    }
  }
  next();
});

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    db: "postgres",
    media: mediaProvider,
    location: locationProvider,
  });
});

// Geocode preview — used by frontend location confirmation step before publishing.
// Returns geocode result without persisting anything. Safe for unauthenticated callers
// since it only exposes what a real geocoder would return for the given query.
router.post("/geocode/preview", async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const street =
    typeof b.street === "string" ? b.street.trim() : "";
  const houseNumber =
    typeof b.houseNumber === "string" ? b.houseNumber.trim() : "";
  const city = typeof b.city === "string" ? b.city.trim() : "";
  if (!city) return bad(res, 400, "city is required");
  if (!street) return bad(res, 400, "street is required");
  const geo = await geocodeAddress(street, houseNumber, city);
  res.json({
    areaLat: geo.areaLat,
    areaLng: geo.areaLng,
    exactLat: geo.exactLat,
    exactLng: geo.exactLng,
    areaRadiusMeters: geo.areaRadiusMeters,
    formattedAddress: geo.formattedAddress,
    status: geo.status,
    precision: geo.precision,
    provider: geo.provider,
  });
});

// ---------- Users ----------
router.get("/users", async (_req, res) => {
  const rows = await db.select().from(usersTable).orderBy(usersTable.id);
  res.json(rows.map(shapeUser));
});

router.patch("/users/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return bad(res, 400, "Invalid id");
  const viewerId = res.locals.userId as number;
  if (viewerId !== id)
    return bad(res, 403, "You can only edit your own profile");
  const b = req.body ?? {};
  const patch: Partial<User> = {};
  if (typeof b.displayName === "string" && b.displayName)
    patch.displayName = b.displayName;
  if (typeof b.email === "string" && b.email) patch.email = b.email;
  if (typeof b.phone === "string") patch.phone = b.phone;
  if (Array.isArray(b.dietaryPreferences)) {
    const VALID = ["kosher", "gluten_free", "vegan", "vegetarian"];
    patch.dietaryPreferences = b.dietaryPreferences.filter((t: string) =>
      VALID.includes(t),
    );
  }
  if (typeof b.discreetPickup === "boolean")
    patch.discreetPickup = b.discreetPickup;
  if (Object.keys(patch).length === 0) {
    const [u] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));
    if (!u) return bad(res, 404, "User not found");
    return res.json(shapeUser(u));
  }
  const [updated] = await db
    .update(usersTable)
    .set(patch)
    .where(eq(usersTable.id, id))
    .returning();
  if (!updated) return bad(res, 404, "User not found");
  res.json(shapeUser(updated));
});

// ---------- Donations ----------
function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

router.get("/donations", async (req, res) => {
  const viewerId = getSessionUserId(req) ?? 0;
  const q = req.query;
  const filterCity =
    typeof q.city === "string" && q.city ? q.city : null;
  const filterDietary =
    typeof q.dietary === "string" && q.dietary
      ? q.dietary
          .split(",")
          .map((s) => s.trim())
          .filter((s): s is DietaryTag =>
            VALID_DIETARY.includes(s as DietaryTag),
          )
      : [];
  const statusParam =
    typeof q.status === "string" ? q.status : "available";
  const filterStatus =
    statusParam === "any"
      ? null
      : VALID_DONATION_STATUS.includes(statusParam as DonationStatus)
        ? (statusParam as DonationStatus)
        : "available";
  const sort =
    q.sort === "expiring" || q.sort === "nearest" || q.sort === "newest"
      ? (q.sort as "expiring" | "nearest" | "newest")
      : "newest";
  const lat = typeof q.lat === "string" ? Number(q.lat) : NaN;
  const lng = typeof q.lng === "string" ? Number(q.lng) : NaN;
  const radiusKm =
    typeof q.radiusKm === "string" ? Number(q.radiusKm) : NaN;
  const haveOrigin = Number.isFinite(lat) && Number.isFinite(lng);

  const conds = [];
  if (filterStatus) conds.push(eq(donationsTable.status, filterStatus));
  if (filterCity) conds.push(eq(donationsTable.city, filterCity));
  for (const tag of filterDietary) {
    conds.push(
      sql`${donationsTable.dietaryTags} @> ${JSON.stringify([tag])}::jsonb`,
    );
  }

  const baseQuery = db.select().from(donationsTable);
  const rows = await (conds.length
    ? baseQuery.where(and(...conds))
    : baseQuery
  ).orderBy(desc(donationsTable.createdAt));

  // Distance uses area coords (privacy-safe: area is ~500 m from exact in real mode)
  let enriched = rows.map((d) => {
    const distanceKm =
      haveOrigin && d.areaLat != null && d.areaLng != null
        ? haversineKm({ lat, lng }, { lat: d.areaLat, lng: d.areaLng })
        : null;
    return { d, distanceKm };
  });

  if (haveOrigin && Number.isFinite(radiusKm) && radiusKm > 0) {
    enriched = enriched.filter(
      (r) => r.distanceKm != null && r.distanceKm <= radiusKm,
    );
  }

  if (sort === "nearest" && haveOrigin) {
    enriched.sort(
      (a, b) =>
        (a.distanceKm ?? Number.POSITIVE_INFINITY) -
        (b.distanceKm ?? Number.POSITIVE_INFINITY),
    );
  } else if (sort === "expiring") {
    enriched.sort(
      (a, b) =>
        new Date(a.d.expiryDate).getTime() - new Date(b.d.expiryDate).getTime(),
    );
  }

  const revealable = await donationsRevealableByViewer(viewerId);
  res.json(
    enriched.map(({ d, distanceKm }) => ({
      ...shapeDonation(d, revealable.has(d.id)),
      distanceKm: distanceKm == null ? null : Number(distanceKm.toFixed(2)),
    })),
  );
});

router.get("/donations/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return bad(res, 400, "Invalid id");
  const viewerId = getSessionUserId(req) ?? 0;
  const [d] = await db
    .select()
    .from(donationsTable)
    .where(eq(donationsTable.id, id));
  if (!d) return bad(res, 404, "Donation not found");
  let reveal = d.donorId === viewerId;
  if (!reveal) {
    const r = await db
      .select({ id: pickupRequestsTable.id })
      .from(pickupRequestsTable)
      .where(
        and(
          eq(pickupRequestsTable.donationId, id),
          eq(pickupRequestsTable.requesterId, viewerId),
          sql`${pickupRequestsTable.status} in ('approved','completed')`,
        ),
      );
    reveal = r.length > 0;
  }
  res.json(shapeDonation(d, reveal));
});

router.post("/donations", requireAuth, async (req: Request, res: Response) => {
  const b = req.body ?? {};
  const donorId = res.locals.userId as number;

  // Required base fields
  const requiredBase = [
    "title",
    "description",
    "foodType",
    "quantity",
    "expiryDate",
    "city",
  ] as const;
  for (const k of requiredBase) {
    if (typeof b[k] !== "string" || !b[k]) {
      return bad(res, 400, `Missing or invalid field: ${k}`);
    }
  }

  // Accept structured format (street + optional houseNumber) OR legacy flat address.
  const street: string =
    typeof b.street === "string" && b.street
      ? b.street
      : typeof b.address === "string" && b.address
        ? b.address
        : "";
  if (!street) {
    return bad(
      res,
      400,
      "Missing address: provide street (or address for legacy clients)",
    );
  }
  const houseNumber: string =
    typeof b.houseNumber === "string" ? b.houseNumber : "";
  const city: string = b.city;
  const pickupNotes: string =
    typeof b.pickupNotes === "string" ? b.pickupNotes : "";

  const geo = await geocodeAddress(street, houseNumber, city);

  // Sprint 3: zero_results cannot publish. Addresses that Google cannot find
  // must be fixed before the donor publishes. This is the server-side gate that
  // mirrors the UI confirmation step — defense in depth.
  if (geo.status === "zero_results") {
    return bad(
      res,
      400,
      "Address not found — please verify the street name, house number, and city before publishing.",
    );
  }

  const m = await uploadDonationImage({
    data: b.image?.data ?? b.imageUrl,
    hint: `${b.title}-${Date.now()}`,
  });

  // Legacy compat: populate flat address field from structured parts.
  const legacyAddress =
    [street, houseNumber].filter(Boolean).join(" ").trim() || null;

  const [created] = await db
    .insert(donationsTable)
    .values({
      donorId,
      title: b.title,
      description: b.description,
      foodType: b.foodType,
      quantity: b.quantity,
      expiryDate: b.expiryDate,
      dietaryTags: sanitizeTags(b.dietaryTags),
      // Location — structured
      country: "Israel",
      city,
      street,
      houseNumber,
      pickupNotes,
      address: legacyAddress,
      // Geocoding results
      formattedAddress: geo.formattedAddress,
      placeId: geo.placeId,
      geocodeProvider: geo.provider,
      geocodeStatus: geo.status,
      geocodePrecision: geo.precision,
      exactLat: geo.exactLat,
      exactLng: geo.exactLng,
      areaLat: geo.areaLat,
      areaLng: geo.areaLng,
      areaLabel: city,
      areaRadiusMeters: geo.areaRadiusMeters,
      // Sprint 1: defaults to true so existing flows are not broken.
      // Sprint 3 will enforce explicit UI confirmation before this can be true.
      locationConfirmed: true,
      // Media
      imageUrl: m.imageUrl,
      imagePublicId: m.imagePublicId,
      status: "available",
      allowDiscreet: !!b.allowDiscreet,
    })
    .returning();
  res.status(201).json(shapeDonation(created, true));
});

// Donor-driven donation status transitions.
const DONOR_TRANSITIONS: Record<DonationStatus, DonationStatus[]> = {
  available: ["cancelled", "expired"],
  reserved: ["cancelled"],
  cancelled: ["available"],
  expired: ["available"],
  picked_up: [],
};

router.patch("/donations/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return bad(res, 400, "Invalid id");
  const viewerId = res.locals.userId as number;
  try {
    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(donationsTable)
        .where(eq(donationsTable.id, id))
        .for("update");
      if (!existing)
        throw Object.assign(new Error("Donation not found"), { http: 404 });
      if (existing.donorId !== viewerId)
        throw Object.assign(
          new Error("Only the donor can edit this donation"),
          { http: 403 },
        );

      const b = req.body ?? {};
      const patch: Partial<Donation> = {};

      // Patchable text fields
      for (const k of [
        "title",
        "description",
        "foodType",
        "quantity",
        "expiryDate",
        "city",
        "street",
        "houseNumber",
        "pickupNotes",
      ] as const) {
        if (typeof b[k] === "string") patch[k] = b[k];
      }

      // Legacy compat: flat address field → street
      if (
        typeof b.address === "string" &&
        b.address &&
        typeof b.street !== "string"
      ) {
        patch.street = b.address;
        patch.address = b.address;
      }

      if ("dietaryTags" in b) patch.dietaryTags = sanitizeTags(b.dietaryTags);
      if ("allowDiscreet" in b) patch.allowDiscreet = !!b.allowDiscreet;

      if ("status" in b) {
        const next = b.status as DonationStatus;
        if (!VALID_DONATION_STATUS.includes(next))
          throw Object.assign(new Error("Invalid status"), { http: 400 });
        if (next !== existing.status) {
          const allowed = DONOR_TRANSITIONS[existing.status] ?? [];
          if (!allowed.includes(next)) {
            throw Object.assign(
              new Error(
                `Cannot transition donation from ${existing.status} to ${next}`,
              ),
              { http: 409 },
            );
          }
          // ENFORCEMENT: donation cannot become available without confirmed location.
          // Sprint 3 will require UI-level confirmation; Sprint 1 defaults to true
          // so existing data is not blocked.
          if (next === "available" && !existing.locationConfirmed) {
            throw Object.assign(
              new Error(
                "Cannot publish donation: location not confirmed. Please verify the pickup address first.",
              ),
              { http: 409 },
            );
          }
          patch.status = next;
          // Cancel any open requests when donor cancels a reserved donation.
          if (existing.status === "reserved" && next === "cancelled") {
            await tx
              .update(pickupRequestsTable)
              .set({ status: "cancelled" })
              .where(
                and(
                  eq(pickupRequestsTable.donationId, id),
                  sql`${pickupRequestsTable.status} in ('pending','approved')`,
                ),
              );
          }
        }
      }

      // Re-geocode if any address field changed.
      if (patch.city || patch.street || patch.houseNumber) {
        // Block address changes while a pickup request is already approved.
        // The approved requester has been told where to go — silently changing
        // the address is a trust violation. Donor must cancel the reservation first.
        const approvedReqs = await tx
          .select({ id: pickupRequestsTable.id })
          .from(pickupRequestsTable)
          .where(
            and(
              eq(pickupRequestsTable.donationId, id),
              sql`${pickupRequestsTable.status} = 'approved'`,
            ),
          );
        if (approvedReqs.length > 0) {
          throw Object.assign(
            new Error(
              "Address cannot be changed while a pickup is already approved. " +
                "Cancel the reservation first, then update the address.",
            ),
            { http: 409 },
          );
        }
        const newStreet = patch.street ?? existing.street ?? "";
        const newHouseNumber = patch.houseNumber ?? existing.houseNumber ?? "";
        const newCity = patch.city ?? existing.city;
        const geo = await geocodeAddress(newStreet, newHouseNumber, newCity);
        patch.exactLat = geo.exactLat;
        patch.exactLng = geo.exactLng;
        patch.areaLat = geo.areaLat;
        patch.areaLng = geo.areaLng;
        patch.areaRadiusMeters = geo.areaRadiusMeters;
        patch.formattedAddress = geo.formattedAddress;
        patch.placeId = geo.placeId;
        patch.geocodeProvider = geo.provider;
        patch.geocodeStatus = geo.status;
        patch.geocodePrecision = geo.precision;
        patch.areaLabel = newCity;
        // Sprint 3: if re-geocode finds no match, block re-publish until
        // the donor corrects the address through the confirmation flow.
        if (geo.status === "zero_results") {
          patch.locationConfirmed = false;
        }
        // Keep legacy address in sync
        const legacyAddress =
          [newStreet, newHouseNumber].filter(Boolean).join(" ").trim() || null;
        patch.address = legacyAddress;
      }

      if (b.image?.data) {
        const m = await uploadDonationImage({
          data: b.image.data,
          hint: patch.title ?? existing.title,
        });
        patch.imageUrl = m.imageUrl;
        patch.imagePublicId = m.imagePublicId;
      }

      if (Object.keys(patch).length === 0) return existing;
      const [u] = await tx
        .update(donationsTable)
        .set(patch)
        .where(eq(donationsTable.id, id))
        .returning();
      return u;
    });
    res.json(shapeDonation(updated, true));
  } catch (err: any) {
    if (err?.http) return res.status(err.http).json({ error: err.message });
    throw err;
  }
});

router.delete("/donations/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return bad(res, 400, "Invalid id");
  const viewerId = res.locals.userId as number;
  const [existing] = await db
    .select({ donorId: donationsTable.donorId, status: donationsTable.status })
    .from(donationsTable)
    .where(eq(donationsTable.id, id));
  if (!existing) return bad(res, 404, "Donation not found");
  if (existing.donorId !== viewerId)
    return bad(res, 403, "Only the donor can delete this donation");
  // Cannot delete a donation that has an active reservation or has already been picked up.
  // The requester must be protected — silently deleting their approved pickup is a trust violation.
  if (existing.status === "reserved") {
    return bad(
      res,
      409,
      "Cannot delete a reserved donation. Cancel the reservation first, then delete.",
    );
  }
  if (existing.status === "picked_up") {
    return bad(
      res,
      409,
      "Cannot delete a donation that has already been picked up.",
    );
  }
  await db.delete(donationsTable).where(eq(donationsTable.id, id));
  res.status(204).end();
});

// ---------- Requests ----------
router.get("/requests", requireAuth, async (req, res) => {
  const viewerId = res.locals.userId as number;
  const rows = await db
    .select({
      r: pickupRequestsTable,
      donorId: donationsTable.donorId,
    })
    .from(pickupRequestsTable)
    .innerJoin(
      donationsTable,
      eq(pickupRequestsTable.donationId, donationsTable.id),
    )
    .orderBy(desc(pickupRequestsTable.createdAt));
  const visible = rows
    .filter(
      (row) => row.r.requesterId === viewerId || row.donorId === viewerId,
    )
    .map((row) => shapeRequest(row.r));
  res.json(visible);
});

router.post(
  "/donations/:id/requests",
  requireAuth,
  async (req: Request, res: Response) => {
    const donationId = Number(req.params.id);
    if (!Number.isFinite(donationId)) return bad(res, 400, "Invalid id");
    const b = req.body ?? {};
    if (typeof b.pickupTime !== "string" || !b.pickupTime) {
      return bad(res, 400, "Missing or invalid field: pickupTime");
    }
    const requesterId = res.locals.userId as number;

    const created = await db
      .transaction(async (tx) => {
        const [donation] = await tx
          .select()
          .from(donationsTable)
          .where(eq(donationsTable.id, donationId))
          .for("update");
        if (!donation)
          throw Object.assign(new Error("Donation not found"), { http: 404 });
        if (donation.status !== "available") {
          throw Object.assign(new Error("Donation is not available"), {
            http: 409,
          });
        }
        if (donation.donorId === requesterId) {
          throw Object.assign(
            new Error("Cannot request your own donation"),
            { http: 409 },
          );
        }
        const [r] = await tx
          .insert(pickupRequestsTable)
          .values({
            donationId,
            requesterId,
            pickupTime: b.pickupTime,
            notes: typeof b.notes === "string" ? b.notes : "",
            discreetPickup: !!b.discreetPickup,
            status: "pending",
          })
          .returning();
        await tx
          .update(donationsTable)
          .set({ status: "reserved" })
          .where(eq(donationsTable.id, donationId));
        return r;
      })
      .catch((err: any) => {
        if (err?.http) return res.status(err.http).json({ error: err.message });
        throw err;
      });
    if (!created || res.headersSent) return;
    res.status(201).json(shapeRequest(created as PickupRequest));
  },
);

async function transitionRequest(
  requestId: number,
  newStatus: RequestStatus,
  actorId: number,
  res: Response,
): Promise<void> {
  try {
    const result = await db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(pickupRequestsTable)
        .where(eq(pickupRequestsTable.id, requestId))
        .for("update");
      if (!r)
        throw Object.assign(new Error("Request not found"), { http: 404 });

      const [donation] = await tx
        .select({ donorId: donationsTable.donorId })
        .from(donationsTable)
        .where(eq(donationsTable.id, r.donationId));
      const isDonor = donation?.donorId === actorId;
      const isRequester = r.requesterId === actorId;

      if (newStatus === "approved" && !isDonor) {
        throw Object.assign(
          new Error("Only the donor can approve a request"),
          { http: 403 },
        );
      }
      if (newStatus === "completed" && !isRequester) {
        throw Object.assign(
          new Error("Only the requester can mark pickup complete"),
          { http: 403 },
        );
      }
      if (newStatus === "cancelled" && !isDonor && !isRequester) {
        throw Object.assign(
          new Error("Not allowed to cancel this request"),
          { http: 403 },
        );
      }

      if (newStatus === "completed") {
        if (r.status !== "approved") {
          throw Object.assign(
            new Error("Only approved requests can be completed"),
            { http: 409 },
          );
        }
      }
      if (newStatus === "approved") {
        if (r.status !== "pending") {
          throw Object.assign(
            new Error("Only pending requests can be approved"),
            { http: 409 },
          );
        }
      }
      if (newStatus === "cancelled") {
        if (r.status === "completed")
          throw Object.assign(
            new Error("Cannot cancel a completed request"),
            { http: 409 },
          );
      }

      const [updated] = await tx
        .update(pickupRequestsTable)
        .set({ status: newStatus })
        .where(eq(pickupRequestsTable.id, requestId))
        .returning();

      if (newStatus === "completed") {
        await tx
          .update(donationsTable)
          .set({ status: "picked_up" })
          .where(eq(donationsTable.id, r.donationId));
      } else if (newStatus === "cancelled") {
        const [don] = await tx
          .select()
          .from(donationsTable)
          .where(eq(donationsTable.id, r.donationId));
        if (don && don.status === "reserved") {
          const others = await tx
            .select({ id: pickupRequestsTable.id })
            .from(pickupRequestsTable)
            .where(
              and(
                eq(pickupRequestsTable.donationId, r.donationId),
                sql`${pickupRequestsTable.status} in ('pending','approved')`,
              ),
            );
          if (others.length === 0) {
            await tx
              .update(donationsTable)
              .set({ status: "available" })
              .where(eq(donationsTable.id, r.donationId));
          }
        }
      }
      return updated;
    });
    res.json(shapeRequest(result));
  } catch (err: any) {
    if (err?.http) {
      res.status(err.http).json({ error: err.message });
      return;
    }
    throw err;
  }
}

router.patch("/requests/:id", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return bad(res, 400, "Invalid id");
  const newStatus = req.body?.status as RequestStatus | undefined;
  if (!newStatus || !VALID_REQUEST_STATUS.includes(newStatus)) {
    return bad(res, 400, "Invalid or missing status");
  }
  await transitionRequest(id, newStatus, res.locals.userId as number, res);
});

router.post("/requests/:id/cancel", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return bad(res, 400, "Invalid id");
  await transitionRequest(id, "cancelled", res.locals.userId as number, res);
});

router.post("/requests/:id/complete", requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return bad(res, 400, "Invalid id");
  await transitionRequest(id, "completed", res.locals.userId as number, res);
});

// ---------- Reviews ----------
router.get("/reviews", async (_req, res) => {
  const rows = await db
    .select()
    .from(reviewsTable)
    .orderBy(desc(reviewsTable.createdAt));
  res.json(rows.map(shapeReview));
});

router.post(
  "/requests/:id/reviews",
  requireAuth,
  async (req: Request, res: Response) => {
    const requestId = Number(req.params.id);
    if (!Number.isFinite(requestId)) return bad(res, 400, "Invalid id");
    const b = req.body ?? {};
    const rating = Number(b.rating);
    if (!rating || rating < 1 || rating > 5) {
      return bad(res, 400, "rating must be between 1 and 5");
    }
    const reviewerId = res.locals.userId as number;

    try {
      const result = await db.transaction(async (tx) => {
        const [r] = await tx
          .select()
          .from(pickupRequestsTable)
          .where(eq(pickupRequestsTable.id, requestId));
        if (!r)
          throw Object.assign(new Error("Request not found"), { http: 404 });
        if (r.status !== "completed") {
          throw Object.assign(
            new Error("Reviews allowed only on completed requests"),
            { http: 409 },
          );
        }
        if (r.requesterId !== reviewerId) {
          throw Object.assign(
            new Error("Only the requester can review this pickup"),
            { http: 403 },
          );
        }
        const [d] = await tx
          .select()
          .from(donationsTable)
          .where(eq(donationsTable.id, r.donationId));
        if (!d)
          throw Object.assign(new Error("Donation not found"), { http: 404 });

        const existing = await tx
          .select({ id: reviewsTable.id })
          .from(reviewsTable)
          .where(eq(reviewsTable.requestId, requestId));
        if (existing.length > 0) {
          throw Object.assign(
            new Error("Review already submitted for this request"),
            { http: 409 },
          );
        }
        const [review] = await tx
          .insert(reviewsTable)
          .values({
            donationId: d.id,
            requestId,
            reviewerId,
            revieweeId: d.donorId,
            rating,
            comment: typeof b.comment === "string" ? b.comment : "",
          })
          .returning();

        const [{ avg, cnt }] = await tx
          .select({
            avg: sql<number>`coalesce(avg(${reviewsTable.rating})::float8, 0)`,
            cnt: sql<number>`count(*)::int`,
          })
          .from(reviewsTable)
          .where(eq(reviewsTable.revieweeId, d.donorId));
        await tx
          .update(usersTable)
          .set({ rating: avg, reviewCount: cnt })
          .where(eq(usersTable.id, d.donorId));
        return review;
      });
      res.status(201).json(shapeReview(result));
    } catch (err: any) {
      if (err?.http) return res.status(err.http).json({ error: err.message });
      throw err;
    }
  },
);

export default router;
