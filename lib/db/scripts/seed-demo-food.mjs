// CookCircle — idempotent demo food seed.
//
// Reads the curated food pack metadata and inserts realistic, Hebrew, active
// donations into the local Postgres DB. Safe to run repeatedly: rows are keyed
// on a HIDDEN internal token stored in donations.place_id (never returned by the
// API's shapeDonation, never rendered in the UI). Existing/canonical data is
// never deleted or truncated. Synthetic donor users are keyed by email.
//
// Run:  node lib/db/scripts/seed-demo-food.mjs
// (DATABASE_URL is read from the repo .env; no secrets are printed.)

import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", ".."); // lib/db/scripts -> repo root
const PACK = path.join(
  REPO_ROOT,
  "demo-assets",
  "food-pack",
  "cookcircle_demo_food_pack",
);
const META = path.join(PACK, "metadata", "cookcircle_demo_donations.json");

// Internal source marker — lives only in place_id (hidden from API + UI).
const SOURCE_PREFIX = "cookcircle-foodpack:";

// ---- load DATABASE_URL from .env without printing it -----------------------
function loadEnv() {
  const txt = readFileSync(path.join(REPO_ROOT, ".env"), "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv();
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (checked repo .env). Aborting.");
  process.exit(1);
}

// ---- mapping helpers -------------------------------------------------------

// Romanized handles for the synthetic donors → safe example.com emails.
// Emails are internal keys (example.com is reserved per RFC 2606) and are not
// shown on donation cards.
const DONOR_HANDLE = {
  "מאיה לוי": "maya.levi",
  "עידו כהן": "ido.cohen",
  "נועה ישראלי": "noa.israeli",
  "דניאל פרץ": "daniel.peretz",
  "שירה בן דוד": "shira.bendavid",
  "רועי מזרחי": "roi.mizrahi",
  "תמר אברהם": "tamar.avraham",
  "אורי גולן": "uri.golan",
  "יעל ביטון": "yael.biton",
  "איתי צור": "itai.tzur",
  "רוני שפירא": "roni.shapira",
  "ליאור חדד": "lior.hadad",
};

function donorEmail(nameHe) {
  const handle = DONOR_HANDLE[nameHe];
  if (handle) return `${handle}@example.com`;
  // Deterministic fallback for any unmapped donor.
  let h = 0;
  for (const c of nameHe) h = (h * 131 + c.charCodeAt(0)) >>> 0;
  return `donor-${h.toString(36)}@example.com`;
}

function hashOf(str, base) {
  let h = 0;
  for (const c of str) h = (h * base + c.charCodeAt(0)) >>> 0;
  return h;
}
function donorRating(email) {
  return Number((4.6 + (hashOf(email, 31) % 5) * 0.1).toFixed(1)); // 4.6 .. 5.0
}
function donorReviews(email) {
  return 8 + (hashOf(email, 137) % 45); // 8 .. 52
}

// Natural Hebrew food-type label (shown on the card + used as image alt text).
const FOODTYPE_HE = {
  wrap: "כריך",
  main: "מנה עיקרית",
  snack: "חטיף",
  noodles: "אטריות",
  salad: "סלט",
  pasta: "פסטה",
  dessert: "קינוח",
  soup: "מרק",
  breakfast: "ארוחת בוקר",
  burger: "בורגר",
};
function foodTypeHe(category) {
  return FOODTYPE_HE[category] || "מנה";
}

function quantityHe(servings) {
  const n = Number(servings) || 1;
  if (n === 1) return "מנה אחת";
  if (n === 2) return "2 מנות";
  return `${n} מנות`;
}

// Map the Hebrew descriptive tags to the app's structured dietary enum so the
// dietary filter works. Non-dietary descriptive tags are intentionally dropped
// (they have no column and aren't part of the filter model).
const DIETARY_FROM_HE = {
  טבעוני: "vegan",
  צמחוני: "vegetarian",
};
function dietaryTags(tagsHe) {
  const out = [];
  for (const t of tagsHe || []) {
    const e = DIETARY_FROM_HE[t];
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

// Split "רחוב 50, עיר" → { street, houseNumber } using the part before the comma.
function parseAddress(addressHe) {
  const head = String(addressHe).split(",")[0].trim();
  const m = head.match(/^(.+?)\s+(\d+[א-ת]?)$/);
  if (m) return { street: m[1].trim(), houseNumber: m[2] };
  return { street: head, houseNumber: null };
}

function expiryIso(hoursFromNow) {
  return new Date(Date.now() + Number(hoursFromNow) * 3600 * 1000).toISOString();
}

// ---- main ------------------------------------------------------------------
const { Client } = pg;

async function main() {
  const data = JSON.parse(readFileSync(META, "utf8"));
  const entries = data.entries || [];

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let usersCreated = 0;
  let usersReused = 0;
  let donationsInserted = 0;
  let donationsReused = 0;

  try {
    await client.query("BEGIN");

    // 1) Upsert synthetic donor users (keyed by email).
    const userIdByEmail = new Map();
    const distinctDonors = [...new Set(entries.map((e) => e.donor_name_he))];
    for (const nameHe of distinctDonors) {
      const email = donorEmail(nameHe);
      const before = await client.query(
        "select id from users where email = $1",
        [email],
      );
      const res = await client.query(
        `insert into users
           (display_name, email, phone, dietary_preferences, discreet_pickup, rating, review_count)
         values ($1, $2, '', '[]'::jsonb, false, $3, $4)
         on conflict (email) do update set display_name = excluded.display_name
         returning id`,
        [nameHe, email, donorRating(email), donorReviews(email)],
      );
      const id = res.rows[0].id;
      userIdByEmail.set(email, id);
      if (before.rowCount > 0) usersReused++;
      else usersCreated++;
    }

    // 2) Insert donations (idempotent on hidden place_id token).
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const loc = e.demo_location || {};
      const placeId = SOURCE_PREFIX + e.new_filename;
      const donorId = userIdByEmail.get(donorEmail(e.donor_name_he));
      const { street, houseNumber } = parseAddress(loc.address_he || "");
      const imageUrl = `/donation-images/${e.new_filename}`;
      const imagePublicId = `local/${e.new_filename.replace(/\.[^.]+$/, "")}`;
      const expiry = expiryIso(e.expires_in_hours);
      const formattedAddress = [loc.place_he, loc.address_he]
        .filter(Boolean)
        .join(", ");
      // Stagger created_at over recent hours so the feed's "newest" sort looks
      // like real, recently-posted activity.
      const createdAt = new Date(Date.now() - i * 11 * 60 * 1000);

      const existing = await client.query(
        "select id from donations where place_id = $1",
        [placeId],
      );

      if (existing.rowCount > 0) {
        // Refresh only the liveness fields on our own rows; never duplicate.
        await client.query(
          `update donations
             set expiry_date = $2,
                 image_url = $3,
                 image_public_id = $4,
                 status = 'available'
           where id = $1`,
          [existing.rows[0].id, expiry, imageUrl, imagePublicId],
        );
        donationsReused++;
        continue;
      }

      await client.query(
        `insert into donations (
           donor_id, title, description, food_type, quantity, expiry_date,
           dietary_tags, country, city, street, house_number, pickup_notes,
           address, formatted_address, place_id, geocode_provider, geocode_status,
           geocode_precision, exact_lat, exact_lng, area_lat, area_lng,
           area_label, area_radius_meters, location_confirmed, image_url,
           image_public_id, status, allow_discreet, created_at
         ) values (
           $1, $2, $3, $4, $5, $6,
           $7::jsonb, 'Israel', $8, $9, $10, $11,
           $12, $13, $14, 'local', 'fallback',
           null, null, null, $15, $16,
           $17, null, true, $18,
           $19, 'available', false, $20
         )`,
        [
          donorId,
          e.title_he,
          e.description_he,
          foodTypeHe(e.category),
          quantityHe(e.servings),
          expiry,
          JSON.stringify(dietaryTags(e.tags_he)),
          loc.city_he,
          street,
          houseNumber,
          e.pickup_window_he || null,
          loc.address_he || null,
          formattedAddress || null,
          placeId,
          loc.lat ?? null,
          loc.lng ?? null,
          loc.place_he || loc.city_he || null,
          imageUrl,
          imagePublicId,
          createdAt,
        ],
      );
      donationsInserted++;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }

  const summary = {
    usersCreated,
    usersReused,
    donationsInserted,
    donationsReused,
    totalEntries: entries.length,
  };
  console.log("SEED_RESULT " + JSON.stringify(summary));
}

main().catch((err) => {
  console.error("SEED_FAILED", err);
  process.exit(1);
});
