import { sql } from "drizzle-orm";
import {
  db,
  donationsTable,
  pickupRequestsTable,
  reviewsTable,
  usersTable,
} from "@workspace/db";
import { hashPassword } from "../lib/auth";

// Seed the database with canonical Israeli demo data on first boot.
// Re-seeds if existing data pre-dates the Sprint 1 schema (detected by
// checking whether area_lat is populated on donations).
export async function ensureSeed(): Promise<void> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable);

  if (count > 0) {
    // Verify the canonical seed donation (id=1 "Fresh Vegetables") is present with
    // Sprint 1 location fields. If it was deleted (e.g. during QA testing), or if
    // area_lat is missing (pre-Sprint 1 data), truncate and re-seed for consistency.
    const [{ seedOk }] = await db
      .select({ seedOk: sql<number>`count(*)::int` })
      .from(donationsTable)
      .where(sql`id = 1 AND area_lat IS NOT NULL`);
    if (seedOk > 0) return; // Canonical seed data is intact

    // Pre-Sprint 1 data or empty area_lat — truncate and re-seed
    await db.execute(
      sql`TRUNCATE reviews, pickup_requests, donations, users RESTART IDENTITY CASCADE`,
    );
  }

  await db.transaction(async (tx) => {
    // Israeli demo users
    await tx.insert(usersTable).values([
      {
        id: 1,
        displayName: "Yael Ben-David",
        email: "yael@example.co.il",
        phone: "050-111-0001",
        dietaryPreferences: ["vegetarian"],
        discreetPickup: false,
        rating: 4.8,
        reviewCount: 23,
      },
      {
        id: 2,
        displayName: "Maya Cohen",
        email: "maya@example.co.il",
        phone: "050-111-0002",
        dietaryPreferences: ["vegan"],
        discreetPickup: true,
        rating: 4.9,
        reviewCount: 47,
      },
      {
        id: 3,
        displayName: "David Mizrahi",
        email: "david@example.co.il",
        phone: "050-111-0003",
        dietaryPreferences: [],
        discreetPickup: false,
        rating: 4.6,
        reviewCount: 18,
      },
      {
        id: 4,
        displayName: "Noa Shapiro",
        email: "noa@example.co.il",
        phone: "050-111-0004",
        dietaryPreferences: ["gluten_free"],
        discreetPickup: false,
        rating: 5.0,
        reviewCount: 31,
      },
      {
        id: 5,
        displayName: "Eitan Levi",
        email: "eitan@example.co.il",
        phone: "050-111-0005",
        dietaryPreferences: [],
        discreetPickup: false,
        rating: 4.7,
        reviewCount: 15,
      },
    ]);
    await tx.execute(
      sql`select setval(pg_get_serial_sequence('users', 'id'), 5, true)`,
    );

    // Israeli donations — structured address fields + new location model.
    //
    // IMPORTANT: geocodeProvider="local" means these are demo/unverified coords.
    // exactLat/exactLng are null (per fallback mode rules — never fake precision).
    // areaLat/areaLng carry the known Israeli coords and act as the neighborhood point.
    // areaRadiusMeters is null (unverified — not a real 500 m offset).
    // locationConfirmed=true so demo donations are visible without UI confirmation flow.
    await tx.insert(donationsTable).values([
      {
        // Donor: Maya Cohen (user 2); reserved by Yael Ben-David (user 1, request 1, approved)
        id: 1,
        donorId: 2,
        title: "Fresh Vegetables",
        description:
          "Mixed fresh vegetables including tomatoes, cucumbers, lettuce, and carrots. All organic, from the Carmel Market vendors.",
        foodType: "Produce",
        quantity: "5 kg",
        expiryDate: "2026-05-30T18:00",
        dietaryTags: ["vegan"],
        // Location — structured
        country: "Israel",
        city: "Tel Aviv",
        street: "HaYarkon St",
        houseNumber: "23",
        address: "HaYarkon St 23",
        pickupNotes: "Ring the doorbell, 2nd floor",
        formattedAddress: "23 HaYarkon St, Tel Aviv-Yafo, Israel",
        // Geocode meta — local/demo
        geocodeProvider: "local",
        geocodeStatus: "fallback",
        geocodePrecision: null,
        placeId: null,
        // Exact: null in fallback mode (never fake precision)
        exactLat: null,
        exactLng: null,
        // Area: Israeli coords (known approx location)
        areaLat: 32.081333,
        areaLng: 34.770667,
        areaLabel: "Tel Aviv",
        areaRadiusMeters: null,
        locationConfirmed: true,
        status: "reserved",
        allowDiscreet: false,
      },
      {
        // Donor: David Mizrahi (user 3); reserved by pending request from Yael Ben-David (user 1, request 2)
        id: 2,
        donorId: 3,
        title: "Homemade Pasta",
        description:
          "Fresh homemade pasta with tomato sauce. Made this morning, perfect for a quick meal.",
        foodType: "Prepared Food",
        quantity: "10 portions",
        expiryDate: "2026-05-28T20:00",
        dietaryTags: ["vegetarian"],
        country: "Israel",
        city: "Haifa",
        street: "Herzl St",
        houseNumber: "45",
        address: "Herzl St 45, Hadar",
        pickupNotes: "Hadar neighborhood, ask for David",
        formattedAddress: "45 Herzl St, Hadar, Haifa, Israel",
        geocodeProvider: "local",
        geocodeStatus: "fallback",
        geocodePrecision: null,
        placeId: null,
        exactLat: null,
        exactLng: null,
        areaLat: 32.817900,
        areaLng: 34.994900,
        areaLabel: "Haifa",
        areaRadiusMeters: null,
        locationConfirmed: true,
        // Must be "reserved" — donation 2 has a pending request (id=2) so it
        // cannot be "available". Keeping it available was a seed data bug that
        // allowed duplicate requests to be created.
        status: "reserved",
        allowDiscreet: true,
      },
      {
        // Donor: Noa Shapiro (user 4); picked_up, completed request from Yael (user 1, request 3)
        id: 3,
        donorId: 4,
        title: "Bread & Pastries",
        description:
          "Assorted bread and pastries from my bakery near Mahane Yehuda market. All baked fresh this morning.",
        foodType: "Baked Goods",
        quantity: "20 items",
        expiryDate: "2026-04-27T22:00",
        dietaryTags: ["vegetarian"],
        country: "Israel",
        city: "Jerusalem",
        street: "Jaffa Rd",
        houseNumber: "12",
        address: "Jaffa Rd 12, Mahane Yehuda",
        pickupNotes: "Side entrance near the shuk",
        formattedAddress: "12 Jaffa Rd, Mahane Yehuda, Jerusalem, Israel",
        geocodeProvider: "local",
        geocodeStatus: "fallback",
        geocodePrecision: null,
        placeId: null,
        exactLat: null,
        exactLng: null,
        areaLat: 31.784200,
        areaLng: 35.204100,
        areaLabel: "Jerusalem",
        areaRadiusMeters: null,
        locationConfirmed: true,
        status: "picked_up",
        allowDiscreet: false,
      },
      {
        // Donor: Eitan Levi (user 5); available, no active request
        id: 4,
        donorId: 5,
        title: "Canned Goods",
        description:
          "Various canned vegetables and beans. Non-perishable, great for stocking up.",
        foodType: "Non-Perishable",
        quantity: "15 cans",
        expiryDate: "2027-04-30T23:59",
        dietaryTags: ["vegan", "gluten_free"],
        country: "Israel",
        city: "Beer Sheva",
        street: "HaNassi Blvd",
        houseNumber: "34",
        address: "HaNassi Blvd 34",
        pickupNotes: null,
        formattedAddress: "34 HaNassi Blvd, Beer Sheva, Israel",
        geocodeProvider: "local",
        geocodeStatus: "fallback",
        geocodePrecision: null,
        placeId: null,
        exactLat: null,
        exactLng: null,
        areaLat: 31.253000,
        areaLng: 34.791300,
        areaLabel: "Beer Sheva",
        areaRadiusMeters: null,
        locationConfirmed: true,
        status: "available",
        allowDiscreet: false,
      },
      {
        // Donor: Maya Cohen (user 2); available
        id: 5,
        donorId: 2,
        title: "Fresh Fruit",
        description:
          "Apples, bananas, and oranges. Slightly overripe but perfect for smoothies or baking.",
        foodType: "Produce",
        quantity: "3 kg",
        expiryDate: "2026-05-29T18:00",
        dietaryTags: ["vegan"],
        country: "Israel",
        city: "Herzliya",
        street: "Ben-Gurion Blvd",
        houseNumber: "7",
        address: "Ben-Gurion Blvd 7",
        pickupNotes: "Ground floor, left side",
        formattedAddress: "7 Ben-Gurion Blvd, Herzliya, Israel",
        geocodeProvider: "local",
        geocodeStatus: "fallback",
        geocodePrecision: null,
        placeId: null,
        exactLat: null,
        exactLng: null,
        areaLat: 32.163700,
        areaLng: 34.842100,
        areaLabel: "Herzliya",
        areaRadiusMeters: null,
        locationConfirmed: true,
        status: "available",
        allowDiscreet: false,
      },
      {
        // Donor: Yael Ben-David (user 1); reserved, pending request from David Mizrahi (user 3, request 4)
        id: 6,
        donorId: 1,
        title: "Garden Herbs",
        description:
          "Fresh basil, mint, parsley, and rosemary from my home garden. Pick what you need.",
        foodType: "Produce",
        quantity: "Several bunches",
        expiryDate: "2026-06-01T18:00",
        dietaryTags: ["vegan", "gluten_free"],
        country: "Israel",
        city: "Tel Aviv",
        street: "Rothschild Blvd",
        houseNumber: "88",
        address: "Rothschild Blvd 88",
        pickupNotes: "Apartment 4, buzz intercom",
        formattedAddress: "88 Rothschild Blvd, Tel Aviv-Yafo, Israel",
        geocodeProvider: "local",
        geocodeStatus: "fallback",
        geocodePrecision: null,
        placeId: null,
        exactLat: null,
        exactLng: null,
        areaLat: 32.062000,
        areaLng: 34.776400,
        areaLabel: "Tel Aviv",
        areaRadiusMeters: null,
        locationConfirmed: true,
        status: "reserved",
        allowDiscreet: true,
      },
      {
        // Donor: Yael Ben-David (user 1); available
        id: 7,
        donorId: 1,
        title: "Lentil Soup (Family Batch)",
        description:
          "Big pot of lentil soup with carrots and celery. Already cooled, easy to reheat.",
        foodType: "Prepared Food",
        quantity: "8 portions",
        expiryDate: "2026-05-29T20:00",
        dietaryTags: ["vegan", "vegetarian"],
        country: "Israel",
        city: "Tel Aviv",
        street: "Rothschild Blvd",
        houseNumber: "88",
        address: "Rothschild Blvd 88",
        pickupNotes: "Apartment 4, buzz intercom",
        formattedAddress: "88 Rothschild Blvd, Tel Aviv-Yafo, Israel",
        geocodeProvider: "local",
        geocodeStatus: "fallback",
        geocodePrecision: null,
        placeId: null,
        exactLat: null,
        exactLng: null,
        areaLat: 32.062000,
        areaLng: 34.776400,
        areaLabel: "Tel Aviv",
        areaRadiusMeters: null,
        locationConfirmed: true,
        status: "available",
        allowDiscreet: false,
      },
    ]);
    await tx.execute(
      sql`select setval(pg_get_serial_sequence('donations', 'id'), 7, true)`,
    );

    // Backfill stable placeholder image URLs
    await tx.execute(sql`
      update donations
      set
        image_url = 'https://picsum.photos/seed/' || replace(replace(left(title,60),' ','%20'),'&','%26') || '/640/480',
        image_public_id = 'local/' || replace(left(title,60),' ','%20')
      where image_url is null
    `);

    await tx.insert(pickupRequestsTable).values([
      {
        // Yael (user 1) reserved Fresh Vegetables (donation 1) from Maya (user 2) → approved
        id: 1,
        donationId: 1,
        requesterId: 1,
        pickupTime: "2026-05-30T14:00",
        notes: "Please ring the doorbell",
        discreetPickup: false,
        status: "approved",
      },
      {
        // Yael (user 1) requested Homemade Pasta (donation 2) from David → pending
        id: 2,
        donationId: 2,
        requesterId: 1,
        pickupTime: "2026-05-28T16:30",
        notes: "",
        discreetPickup: false,
        status: "pending",
      },
      {
        // Yael (user 1) picked up Bread & Pastries (donation 3) from Noa → completed
        id: 3,
        donationId: 3,
        requesterId: 1,
        pickupTime: "2026-04-27T10:00",
        notes: "Back entrance pickup",
        discreetPickup: true,
        status: "completed",
      },
      {
        // David Mizrahi (user 3) requested Garden Herbs (donation 6) from Yael → pending
        id: 4,
        donationId: 6,
        requesterId: 3,
        pickupTime: "2026-06-01T17:00",
        notes: "Would love to grab the basil if possible!",
        discreetPickup: false,
        status: "pending",
      },
    ]);
    await tx.execute(
      sql`select setval(pg_get_serial_sequence('pickup_requests', 'id'), 4, true)`,
    );

    await tx.insert(reviewsTable).values([
      {
        id: 1,
        donationId: 3,
        requestId: 3,
        reviewerId: 1,
        revieweeId: 4,
        rating: 5,
        comment:
          "Great quality pastries! Noa was very kind and the location was easy to find.",
      },
    ]);
    await tx.execute(
      sql`select setval(pg_get_serial_sequence('reviews', 'id'), 1, true)`,
    );
  });
}

// Ensure all seed users have a password hash set.
// Safe to call every startup — only updates rows where password_hash IS NULL.
export async function ensurePasswords(): Promise<void> {
  const hash = await hashPassword("CookCircle123!");
  await db.execute(
    sql`UPDATE users SET password_hash = ${hash} WHERE password_hash IS NULL`,
  );
}
