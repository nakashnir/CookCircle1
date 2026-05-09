import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
  doublePrecision,
} from "drizzle-orm/pg-core";

export const donationStatusEnum = pgEnum("donation_status", [
  "available",
  "reserved",
  "picked_up",
  "cancelled",
  "expired",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "approved",
  "cancelled",
  "completed",
]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  email: varchar("email", { length: 160 }).notNull().unique(),
  phone: varchar("phone", { length: 40 }).notNull().default(""),
  passwordHash: text("password_hash"),
  dietaryPreferences: jsonb("dietary_preferences")
    .$type<string[]>()
    .notNull()
    .default([]),
  discreetPickup: boolean("discreet_pickup").notNull().default(false),
  rating: doublePrecision("rating").notNull().default(0),
  reviewCount: integer("review_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const donationsTable = pgTable("donations", {
  id: serial("id").primaryKey(),
  donorId: integer("donor_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description").notNull(),
  foodType: varchar("food_type", { length: 80 }).notNull(),
  quantity: varchar("quantity", { length: 80 }).notNull(),
  expiryDate: varchar("expiry_date", { length: 40 }).notNull(),
  dietaryTags: jsonb("dietary_tags").$type<string[]>().notNull().default([]),

  // Location — structured fields (Sprint 1+)
  country: varchar("country", { length: 80 }).notNull().default("Israel"),
  city: varchar("city", { length: 120 }).notNull(),
  street: varchar("street", { length: 200 }),
  houseNumber: varchar("house_number", { length: 20 }),
  pickupNotes: varchar("pickup_notes", { length: 400 }),

  // Legacy compat: free-text address (used by old frontend; nullable from Sprint 1)
  address: varchar("address", { length: 240 }),

  // Geocoding metadata
  formattedAddress: varchar("formatted_address", { length: 400 }),
  placeId: varchar("place_id", { length: 300 }),
  geocodeProvider: varchar("geocode_provider", { length: 20 }),
  geocodeStatus: varchar("geocode_status", { length: 30 }),
  geocodePrecision: varchar("geocode_precision", { length: 20 }),

  // Exact coordinates — only returned to approved requester / donor
  // null in fallback/local mode (never expose pseudo-geocoder output as "exact")
  exactLat: doublePrecision("exact_lat"),
  exactLng: doublePrecision("exact_lng"),

  // Area coordinates — always returned; ~500 m offset from exact (or pseudo-coords in fallback)
  areaLat: doublePrecision("area_lat"),
  areaLng: doublePrecision("area_lng"),
  areaLabel: varchar("area_label", { length: 120 }),
  // null when geocodeProvider="local" (unverified), 500 when real geocode
  areaRadiusMeters: integer("area_radius_meters"),

  // Privacy enforcement: donation cannot become "available" until true
  // Defaults to true for Sprint 1 backward compat; Sprint 3 will require explicit UI confirmation
  locationConfirmed: boolean("location_confirmed").notNull().default(true),

  // Media
  imageUrl: text("image_url"),
  imagePublicId: text("image_public_id"),

  status: donationStatusEnum("status").notNull().default("available"),
  allowDiscreet: boolean("allow_discreet").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const pickupRequestsTable = pgTable("pickup_requests", {
  id: serial("id").primaryKey(),
  donationId: integer("donation_id")
    .notNull()
    .references(() => donationsTable.id, { onDelete: "cascade" }),
  requesterId: integer("requester_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  pickupTime: varchar("pickup_time", { length: 40 }).notNull(),
  notes: text("notes").notNull().default(""),
  discreetPickup: boolean("discreet_pickup").notNull().default(false),
  status: requestStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reviewsTable = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    donationId: integer("donation_id")
      .notNull()
      .references(() => donationsTable.id, { onDelete: "cascade" }),
    requestId: integer("request_id")
      .notNull()
      .references(() => pickupRequestsTable.id, { onDelete: "cascade" }),
    reviewerId: integer("reviewer_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    revieweeId: integer("reviewee_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    comment: text("comment").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueReviewPerRequest: uniqueIndex("reviews_request_unique").on(
      t.requestId,
    ),
  }),
);

export type User = typeof usersTable.$inferSelect;
export type Donation = typeof donationsTable.$inferSelect;
export type PickupRequest = typeof pickupRequestsTable.$inferSelect;
export type Review = typeof reviewsTable.$inferSelect;
