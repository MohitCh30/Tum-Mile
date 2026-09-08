import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  check,
  index,
} from "drizzle-orm/pg-core";
import {
  createId as cuid2Id,
} from "@paralleldrive/cuid2";

// ─── Use cuid2 at the DB layer via drizzle's $defaultFn ─────────────
// drizzle-orm evaluates $defaultFn for every row INSERT, so this
// produces client-side IDs without a DB round-trip.

// ─── Auth ─────────────────────────────────────────────────────────
export const authUsers = pgTable(
  "auth_users",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    verificationTokenHash: text("verification_token_hash"),
    verificationTokenExpiresAt: timestamp("verification_token_expires_at", {
      withTimezone: true,
    }),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("idx_auth_users_email").on(t.email),
  })
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    authUserId: text("auth_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    userAgentHash: text("user_agent_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenIdx: uniqueIndex("idx_sessions_token").on(t.tokenHash),
    expiresIdx: index("idx_sessions_expires").on(t.expiresAt),
  })
);

// ─── Profiles ─────────────────────────────────────────────────────
export const profiles = pgTable(
  "profiles",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    authUserId: text("auth_user_id")
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    bio: text("bio").default(""),
    birthDate: timestamp("birth_date", { withTimezone: true }).notNull(),
    gender: text("gender").notNull(),
    seeking: jsonb("seeking").$type<string[]>().notNull().default([]),
    preferences: jsonb("preferences").$type<{
      distanceRadiusKm: number;
      ageMin: number;
      ageMax: number;
    }>()
      .notNull()
      .default({ distanceRadiusKm: 40, ageMin: 18, ageMax: 45 }),
    privacy: jsonb("privacy")
      .$type<{ showDistance: boolean }>()
      .notNull()
      .default({ showDistance: true }),
    moderationStatus: text("moderation_status").notNull().default("pending"),
    locationGeohash: text("location_geohash"),
    lastLocationUpdate: timestamp("last_location_update", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    authUserIdIdx: uniqueIndex("idx_profiles_auth_user").on(t.authUserId),
  })
);

export const profilePhotos = pgTable(
  "profile_photos",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    authUserId: text("auth_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    thumbKey: text("thumb_key"),
    isPrimary: boolean("is_primary").notNull().default(false),
    moderationStatus: text("moderation_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("idx_photos_user").on(t.authUserId),
  })
);

// ─── Interactions ────────────────────────────────────────────────
export const likes = pgTable(
  "likes",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    likerProfileId: text("liker_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    likedProfileId: text("liked_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueLikerLiked: uniqueIndex("idx_likes_pair").on(
      t.likerProfileId,
      t.likedProfileId
    ),
    noSelfLike: check("no_self_like", `${t.likerProfileId} <> ${t.likedProfileId}`),
  })
);

export const matches = pgTable(
  "matches",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    profileAId: text("profile_a_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    profileBId: text("profile_b_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniquePair: uniqueIndex("idx_matches_pair").on(t.profileAId, t.profileBId),
    noSelfMatch: check("no_self_match", `${t.profileAId} <> ${t.profileBId}`),
  })
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    senderId: text("sender_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    matchIdx: index("idx_messages_match").on(t.matchId),
  })
);

// ─── Safety ──────────────────────────────────────────────────────
export const blocks = pgTable(
  "blocks",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    blockerId: text("blocker_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueBlockerBlocked: uniqueIndex("idx_blocks_pair").on(
      t.blockerId,
      t.blockedId
    ),
    noSelfBlock: check("no_self_block", `${t.blockerId} <> ${t.blockedId}`),
  })
);

export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    reportedId: text("reported_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    matchId: text("match_id").references(() => matches.id, {
      onDelete: "set null",
    }),
    reason: text("reason").notNull(),
    details: text("details").default(""),
    status: text("status").notNull().default("submitted"),
    resolution: jsonb("resolution").default(null),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    reporterIdx: index("idx_reports_reporter").on(t.reporterId),
  })
);

// ─── Moderation ──────────────────────────────────────────────────
export const moderationCases = pgTable(
  "moderation_cases",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    reportedUserId: text("reported_user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("open"),
    priority: text("priority").notNull().default("medium"),
    notes: text("notes").default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("idx_mod_user").on(t.reportedUserId),
  })
);

// ─── Audit ───────────────────────────────────────────────────────
export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    meta: jsonb("meta").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorCreatedIdx: index("idx_audit_actor_created").on(
      t.actorType,
      t.createdAt
    ),
    resourceIdx: index("idx_audit_resource").on(t.resourceType, t.resourceId),
  })
);

// ─── Types ────────────────────────────────────────────────────────
export type AuthUser = typeof authUsers.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type ProfilePhoto = typeof profilePhotos.$inferSelect;
export type Like = typeof likes.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Block = typeof blocks.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type ModerationCase = typeof moderationCases.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;