import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
  vector,
} from "drizzle-orm/pg-core";
import { createId as cuid2Id } from "@paralleldrive/cuid2";

// ─────────────────────────────────────────────────────────────────
// Tum Mile — relational model
//
// There are no photographs in this product. People are represented
// entirely by what they write, so the profile carries a chosen form
// (letter / memoir / poem / list) rather than a "bio" text box.
//
// Invariants live here as DB constraints wherever they can, because
// application code is the thing most likely to be wrong.
// ─────────────────────────────────────────────────────────────────

// ─── Auth ─────────────────────────────────────────────────────────
export const authUsers = pgTable(
  "auth_users",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    // What they typed, used for delivery.
    email: text("email").notNull().unique(),
    // The identity key: aliases of one inbox collapse to the same value,
    // so `mohit+3@gmail.com` cannot become a second account.
    emailCanonical: text("email_canonical"),
    emailVerified: boolean("email_verified").notNull().default(false),
    verificationTokenHash: text("verification_token_hash"),
    verificationTokenExpiresAt: timestamp("verification_token_expires_at", {
      withTimezone: true,
    }),
    // The six-digit code sent alongside the link, for someone whose mail
    // app opens links in a different browser. Shares the link's expiry.
    // Only the HMAC is stored, and wrong guesses are counted: a million
    // possibilities is plenty for five tries, and nothing like enough for
    // unlimited ones.
    verificationCodeHash: text("verification_code_hash"),
    verificationCodeAttempts: integer("verification_code_attempts").notNull().default(0),
    isDeleted: boolean("is_deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_auth_users_email").on(t.email),
    uniqueIndex("idx_auth_users_email_canonical").on(t.emailCanonical),
  ]
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
  (t) => [
    uniqueIndex("idx_sessions_token").on(t.tokenHash),
    index("idx_sessions_expires").on(t.expiresAt),
  ]
);

// ─── Profiles ─────────────────────────────────────────────────────
//
// oneLine is the only thing shown in discovery — structurally where a
// photo would be on any other app, hence the hard length ceiling.
//
// status is DISPLAY ONLY and must never become a filter: the moment it
// can be filtered on, everyone selects "single" and the honesty dies.

export const profiles = pgTable(
  "profiles",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    authUserId: text("auth_user_id")
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: "cascade" }),

    displayName: text("display_name").notNull(),
    birthDate: timestamp("birth_date", { withTimezone: true }).notNull(),
    gender: text("gender").notNull(),
    seeking: jsonb("seeking").$type<string[]>().notNull().default([]),

    // The writing
    oneLine: text("one_line"),
    formType: text("form_type"), // letter | memoir | poem | list
    formBody: text("form_body"),
    currently: jsonb("currently")
      .$type<{
        reading?: string;
        watching?: string;
        listening?: string;
        thinking?: string;
      }>()
      .notNull()
      .default({}),
    currentlyUpdatedAt: timestamp("currently_updated_at", { withTimezone: true }),
    promptAnswers: jsonb("prompt_answers")
      .$type<{ promptId: string; answer: string }[]>()
      .notNull()
      .default([]),
    interests: jsonb("interests").$type<string[]>().notNull().default([]),

    // Stated facts. Filterable ones are columns so they can be queried
    // against; `status` is deliberately not one of them.
    status: text("status"),
    wantsKids: text("wants_kids"), // want | dont | unsure | have
    diet: text("diet"), // veg | non_veg | eggetarian | jain | vegan
    languages: jsonb("languages").$type<string[]>().notNull().default([]),
    religion: text("religion"), // null === "not stated", which is a real answer

    preferences: jsonb("preferences")
      .$type<{
        ageMin: number;
        ageMax: number;
        distanceRadiusKm: number;
        openToLongDistance: boolean;
      }>()
      .notNull()
      .default({
        ageMin: 18,
        ageMax: 45,
        distanceRadiusKm: 40,
        openToLongDistance: false,
      }),
    privacy: jsonb("privacy")
      .$type<{ showDistance: boolean }>()
      .notNull()
      .default({ showDistance: true }),

    moderationStatus: text("moderation_status").notNull().default("active"),

    // What this person's WRITING is about, as a vector.
    //
    // Derived from the one-line, the chosen form and the prompt answers —
    // never from messages, which are private. It is one term in the
    // compatibility score and the app is correct without it: null here
    // simply means that term does not apply.
    embedding: vector("embedding", { dimensions: 384 }),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),

    locationGeohash: text("location_geohash"),
    lastLocationUpdate: timestamp("last_location_update", { withTimezone: true }),

    // Opt-in, off by default: one short note a day at most, saying only
    // that something is waiting. Never who, never what.
    notifyByEmail: boolean("notify_by_email").notNull().default(false),
    // Things after this moment count as new. Set on opt-in, so switching
    // it on does not announce the whole backlog at once.
    notifiedThrough: timestamp("notified_through", { withTimezone: true }),
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_profiles_auth_user").on(t.authUserId),
    index("idx_profiles_geohash").on(t.locationGeohash),
    index("idx_profiles_embedding")
      .using("hnsw", t.embedding.op("vector_cosine_ops")),
    check("one_line_length", sql`char_length(${t.oneLine}) <= 90`),
    check(
      "form_type_valid",
      sql`${t.formType} in ('letter', 'memoir', 'poem', 'list')`
    ),
    check(
      "status_valid",
      sql`${t.status} in ('single', 'newly_single', 'single_long', 'not_over_ex', 'situationship', 'complicated', 'not_in_a_hurry')`
    ),
    check("wants_kids_valid", sql`${t.wantsKids} in ('want', 'dont', 'unsure', 'have')`),
    check(
      "diet_valid",
      sql`${t.diet} in ('veg', 'non_veg', 'eggetarian', 'jain', 'vegan')`
    ),
    check(
      "moderation_status_valid",
      sql`${t.moderationStatus} in ('active', 'restricted', 'suspended')`
    ),
  ]
);

// ─── Questions (dripped: 8 at signup, one a day thereafter) ───────
export const questions = pgTable(
  "questions",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    body: text("body").notNull(),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    isOnboarding: boolean("is_onboarding").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_questions_active").on(t.isActive)]
);

// answer     — what you picked
// acceptable — what you'd accept from someone else
// weight     — 0 normally, higher for the three you marked non-negotiable
export const questionAnswers = pgTable(
  "question_answers",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    answer: text("answer").notNull(),
    acceptable: jsonb("acceptable").$type<string[]>().notNull().default([]),
    isNonNegotiable: boolean("is_non_negotiable").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_answers_profile_question").on(t.profileId, t.questionId),
    index("idx_answers_profile").on(t.profileId),
  ]
);

// ─── Interactions ────────────────────────────────────────────────
//
// A like is never bare: it quotes a specific line of the recipient's
// writing and carries the opening message. This is what makes "hey"
// structurally impossible.
//
// Inbound likes are surfaced 9/day, triaged by score rather than by
// arrival order, so `status` tracks where each one is in that queue.

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
    quotedLine: text("quoted_line").notNull(),
    openingMessage: text("opening_message").notNull(),
    status: text("status").notNull().default("pending"),
    surfacedAt: timestamp("surfaced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_likes_pair").on(t.likerProfileId, t.likedProfileId),
    index("idx_likes_liked_status").on(t.likedProfileId, t.status),
    index("idx_likes_liker_created").on(t.likerProfileId, t.createdAt),
    check("no_self_like", sql`${t.likerProfileId} <> ${t.likedProfileId}`),
    check(
      "like_status_valid",
      sql`${t.status} in ('pending', 'surfaced', 'expired', 'matched', 'declined')`
    ),
  ]
);

export const passes = pgTable(
  "passes",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    passerProfileId: text("passer_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    passedProfileId: text("passed_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_passes_pair").on(t.passerProfileId, t.passedProfileId),
    check("no_self_pass", sql`${t.passerProfileId} <> ${t.passedProfileId}`),
  ]
);

// Canonical ordering (a < b) is what makes the unique pair index
// actually prevent duplicate matches — without it (A,B) and (B,A) are
// two different rows and a race produces both.
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
    unmatchedAt: timestamp("unmatched_at", { withTimezone: true }),
    unmatchedBy: text("unmatched_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_matches_pair").on(t.profileAId, t.profileBId),
    check("match_canonical_order", sql`${t.profileAId} < ${t.profileBId}`),
  ]
);

// ─── Messaging ───────────────────────────────────────────────────
// Text only. No media column exists, deliberately.
export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    senderProfileId: text("sender_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_messages_match_created").on(t.matchId, t.createdAt)]
);

// Deliberate signals are expression; automatic ones are surveillance.
// Hence reactions exist and read receipts do not.
export const messageReactions = pgTable(
  "message_reactions",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    reaction: text("reaction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idx_reaction_message_profile").on(t.messageId, t.profileId)]
);

// ─── Two-handers ─────────────────────────────────────────────────
//
// A scene belongs to a match: it is something two matched people do
// together, and every authorization check runs through the match, so a
// scene can never be a second way to reach somebody.

export const sceneSessions = pgTable(
  "scene_sessions",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    matchId: text("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    // The premise lives in code; this is its slug.
    premiseId: text("premise_id").notNull(),

    // Who plays whom. Assigned, never chosen — otherwise everyone takes
    // the sympathetic part and nobody learns anything.
    castAId: text("cast_a_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    castBId: text("cast_b_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    proposedById: text("proposed_by_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    status: text("status").notNull().default("proposed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_scenes_match").on(t.matchId),
    check("scene_cast_differs", sql`${t.castAId} <> ${t.castBId}`),
    check(
      "scene_status_valid",
      sql`${t.status} in ('proposed', 'declined', 'playing', 'letters', 'finished', 'abandoned')`
    ),
  ]
);

export const sceneTurns = pgTable(
  "scene_turns",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    sessionId: text("session_id")
      .notNull()
      .references(() => sceneSessions.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // Position in the scene. Strict alternation is enforced against this.
    ordinal: integer("ordinal").notNull(),
    body: text("body").notNull(),
    // 'line' during the scene, 'letter' for the thing each keeps after.
    kind: text("kind").notNull().default("line"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_scene_turns_session").on(t.sessionId, t.ordinal),
    uniqueIndex("idx_scene_turn_position").on(t.sessionId, t.kind, t.ordinal),
    check("scene_turn_kind_valid", sql`${t.kind} in ('line', 'letter')`),
    check("scene_turn_ordinal_positive", sql`${t.ordinal} >= 0`),
  ]
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
  (t) => [
    uniqueIndex("idx_blocks_pair").on(t.blockerId, t.blockedId),
    index("idx_blocks_blocked").on(t.blockedId),
    check("no_self_block", sql`${t.blockerId} <> ${t.blockedId}`),
  ]
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
    matchId: text("match_id").references(() => matches.id, { onDelete: "set null" }),
    reason: text("reason").notNull(),
    details: text("details").default(""),
    // The one place message bodies are permitted to be stored outside a
    // conversation. A report is useless without what was said, and a
    // block scrubs the conversation — so evidence is captured at the
    // moment of reporting or it is gone. Nothing else may read this.
    evidence: jsonb("evidence")
      // `source` is absent on reports filed before scenes were captured.
      .$type<{ messageId: string; body: string; at: string; source?: "message" | "scene" }[]>()
      .notNull()
      .default([]),
    status: text("status").notNull().default("submitted"),
    // When the moderator was told this report exists. Stored rather than
    // remembered, so a restart never re-announces or loses one.
    adminNotifiedAt: timestamp("admin_notified_at", { withTimezone: true }),
    resolution: jsonb("resolution").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_reports_reported").on(t.reportedId),
    index("idx_reports_status").on(t.status),
    check("no_self_report", sql`${t.reporterId} <> ${t.reportedId}`),
    check(
      "report_reason_valid",
      sql`${t.reason} in ('spam', 'harassment', 'scam', 'deception', 'other')`
    ),
    check(
      "report_status_valid",
      sql`${t.status} in ('submitted', 'reviewing', 'actioned', 'dismissed')`
    ),
  ]
);

export const moderationCases = pgTable(
  "moderation_cases",
  {
    id: text("id").primaryKey().$defaultFn(cuid2Id),
    reportedProfileId: text("reported_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("open"),
    strikeCount: integer("strike_count").notNull().default(0),
    notes: text("notes").default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_mod_profile").on(t.reportedProfileId),
    check("strike_count_non_negative", sql`${t.strikeCount} >= 0`),
    check(
      "case_status_valid",
      sql`${t.status} in ('open', 'reviewing', 'closed')`
    ),
  ]
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
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_audit_actor_created").on(t.actorType, t.createdAt),
    index("idx_audit_resource").on(t.resourceType, t.resourceId),
  ]
);

// ─── Types ────────────────────────────────────────────────────────
export type AuthUser = typeof authUsers.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type QuestionAnswer = typeof questionAnswers.$inferSelect;
export type Like = typeof likes.$inferSelect;
export type Pass = typeof passes.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageReaction = typeof messageReactions.$inferSelect;
export type SceneSession = typeof sceneSessions.$inferSelect;
export type SceneTurn = typeof sceneTurns.$inferSelect;
export type Block = typeof blocks.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type ModerationCase = typeof moderationCases.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
