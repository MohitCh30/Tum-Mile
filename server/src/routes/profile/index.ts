import type { FastifyPluginAsync } from "fastify";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db, profiles, blocks } from "../../storage/db.js";
import { requireSession, requireVerified, requireProfile } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { logAudit } from "../../services/audit.js";
import { config } from "../../config.js";
import {
  PROMPTS,
  isPromptId,
  MAX_ANSWERS,
  MAX_ANSWER_LENGTH,
  MAX_ONE_LINE_LENGTH,
  MAX_FORM_BODY_LENGTH,
  MAX_CURRENTLY_LENGTH,
  FORM_TYPES,
} from "../../content/prompts.js";
import { ageFrom, MINIMUM_AGE, completeness, toPublicProfile } from "../../lib/profile.js";
import { encodeGeohash, distanceKm, distanceBand } from "../../lib/geo.js";
import { canonicalGender } from "../../lib/gender.js";
import { updateProfileEmbedding } from "../../services/embeddings.js";

const writeLimit = {
  name: "profile-write",
  max: config.RATE_LIMIT_WRITE,
  windowMs: config.RATE_LIMIT_WRITE_WINDOW_MS,
};

/** The narrowest age band anybody may ask for, in years. */
const MIN_AGE_WINDOW = 4;

const STATUSES = [
  "single",
  "newly_single",
  "single_long",
  "not_over_ex",
  "situationship",
  "complicated",
  "not_in_a_hurry",
] as const;

/**
 * Fixed, so that a filter over this field means something. "Not stated"
 * is the absence of a value rather than a member of the list — it is a
 * real answer, and storing it as null keeps it from ever being ranked.
 * There is deliberately no caste field, and none of this is a category
 * anyone is sorted by.
 */
const RELIGIONS = [
  "hindu",
  "muslim",
  "christian",
  "sikh",
  "jain",
  "buddhist",
  "parsi",
  "jewish",
  "spiritual",
  "atheist",
  "agnostic",
  "other",
] as const;

/** Shared by drinking and smoking: how often, not how much. */
const HABIT_LEVELS = ["none", "social", "regular"] as const;
const SLEEP_RHYTHMS = ["early_riser", "night_owl", "depends"] as const;

/**
 * The complete set of fields a person may write on their own profile.
 *
 * Anything absent is unreachable from the API by construction — there is
 * no path that takes a client object and spreads it into an UPDATE. That
 * is what stops `moderationStatus`, `authUserId` and `id` being writable
 * by anyone who reads the response shape and guesses.
 */
/**
 * Gender is written in canonical form, so discovery never has to guess
 * whether "Female" and "woman" are the same answer. What people type is
 * accepted; what is stored is one of three values.
 */
const genderField = z.string().max(40).transform((value, ctx) => {
  const gender = canonicalGender(value);
  if (!gender) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown gender" });
    return z.NEVER;
  }
  return gender;
});

const profileWriteSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    birthDate: z.coerce.date(),
    gender: genderField,
    seeking: z.array(genderField).max(6),

    oneLine: z.string().trim().max(MAX_ONE_LINE_LENGTH).nullable(),
    formType: z.enum(FORM_TYPES).nullable(),
    formBody: z.string().max(MAX_FORM_BODY_LENGTH).nullable(),

    currently: z.object({
      reading: z.string().trim().max(MAX_CURRENTLY_LENGTH).optional(),
      watching: z.string().trim().max(MAX_CURRENTLY_LENGTH).optional(),
      listening: z.string().trim().max(MAX_CURRENTLY_LENGTH).optional(),
      thinking: z.string().trim().max(MAX_CURRENTLY_LENGTH).optional(),
    }),

    promptAnswers: z
      .array(
        z.object({
          promptId: z.string().refine(isPromptId, "unknown prompt"),
          answer: z.string().trim().min(1).max(MAX_ANSWER_LENGTH),
        })
      )
      .max(MAX_ANSWERS),

    interests: z.array(z.string().trim().min(1).max(40)).max(12),

    // Display only. There is deliberately no filter that reads this.
    status: z.enum(STATUSES).nullable(),
    wantsKids: z.enum(["want", "dont", "unsure", "have"]).nullable(),
    diet: z.enum(["veg", "non_veg", "eggetarian", "jain", "vegan"]).nullable(),
    languages: z.array(z.string().trim().min(1).max(40)).max(8),
    // A choice, not a text box. Free text here would produce a hundred
    // spellings of four answers, and this is a field that may be filtered
    // on — a filter over free text silently drops people who wrote the
    // same thing differently. null means "not stated", which is a real
    // answer and not a gap.
    religion: z.enum(RELIGIONS).nullable(),
    drinking: z.enum(HABIT_LEVELS).nullable(),
    smoking: z.enum(HABIT_LEVELS).nullable(),
    sleepRhythm: z.enum(SLEEP_RHYTHMS).nullable(),

    preferences: z.object({
      ageMin: z.number().int().min(MINIMUM_AGE).max(120),
      ageMax: z.number().int().min(MINIMUM_AGE).max(120),
      distanceRadiusKm: z.number().int().min(1).max(500),
      openToLongDistance: z.boolean(),
    }),
    privacy: z.object({ showDistance: z.boolean() }),

    // Coordinates are accepted and immediately discarded — only the
    // 5-character cell is ever written. See lib/geo.ts.
    location: z
      .object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
      .nullable()
      .optional(),
  })
  .partial()
  // A band narrower than this is not a preference, it is a rejection of
  // everybody — and a reversed pair (22 to 21) is not a range at all.
  // Both are refused here rather than quietly re-read into something the
  // person did not ask for.
  .refine(
    (v) => v.preferences === undefined || v.preferences.ageMax - v.preferences.ageMin >= MIN_AGE_WINDOW,
    `an age range needs at least ${MIN_AGE_WINDOW} years in it`
  );

type ProfileWrite = z.infer<typeof profileWriteSchema>;

/** Duplicate prompt ids would silently overwrite each other on read. */
function assertDistinctPrompts(answers: ProfileWrite["promptAnswers"]): void {
  if (!answers) return;
  const ids = new Set(answers.map((a) => a.promptId));
  if (ids.size !== answers.length) throw new Error("VALIDATION_ERROR");
}

export const profileRoutes: FastifyPluginAsync = async (app) => {
  /** The bank, so the client never hardcodes prompt text. */
  app.get("/prompts", { preHandler: [requireSession] }, async () => ({
    prompts: PROMPTS.map((p) => ({ id: p.id, body: p.body, group: p.group })),
    maxAnswers: MAX_ANSWERS,
    maxAnswerLength: MAX_ANSWER_LENGTH,
    maxOneLineLength: MAX_ONE_LINE_LENGTH,
    forms: FORM_TYPES,
  }));

  /** Your own profile, in full — including what nobody else may see. */
  app.get("/profile", { preHandler: [requireSession, requireVerified] }, async (request) => {
    const user = request.user!;
    if (!user.profileId) return { profile: null, complete: false, missing: ["profile"] };

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.profileId));
    if (!profile) return { profile: null, complete: false, missing: ["profile"] };

    const state = completeness(profile);
    return {
      profile: {
        ...profile,
        age: ageFrom(profile.birthDate),
        // Own view still never sees a coordinate; there isn't one.
        hasLocation: profile.locationGeohash !== null,
        locationGeohash: undefined,
        embedding: undefined,
      },
      complete: state.complete,
      missing: state.missing,
    };
  });

  /**
   * Your own profile as everybody else reads it.
   *
   * Built by the SAME function discovery and the inbound queue use, rather
   * than assembled on the client from the edit form. The edit form holds a
   * draft; this holds what is stored. In a product where the writing is
   * the whole of you, the gap between those two is the one thing a person
   * most needs to be able to check — and a preview that could drift from
   * what people actually see would be worse than none.
   *
   * `GET /profiles/:id` deliberately refuses your own id, so this is a
   * separate route rather than an exception carved into that rule.
   */
  app.get("/profile/preview", { preHandler: [requireSession, requireProfile] }, async (request) => {
    const [me] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, request.user!.profileId!))
      .limit(1);
    if (!me) throw new Error("NOT_FOUND");

    // No distance: you are not a distance from yourself, and showing one
    // would be inventing a reading nobody ever gets.
    return { profile: toPublicProfile(me, null) };
  });

  app.put(
    "/profile",
    { preHandler: [requireSession, requireVerified, rateLimit(writeLimit)] },
    async (request, reply) => {
      const user = request.user!;
      const input = profileWriteSchema.parse(request.body);
      assertDistinctPrompts(input.promptAnswers);

      const now = new Date();

      if (input.birthDate && ageFrom(input.birthDate, now) < MINIMUM_AGE) {
        // Enforced here, not in the form. The form is not a boundary.
        throw new Error("VALIDATION_ERROR");
      }

      // Built field by field from the allowlist above. The client's object
      // is never spread into the write.
      const patch: Record<string, unknown> = { updatedAt: now };
      const set = <K extends keyof ProfileWrite>(key: K, column: string) => {
        if (input[key] !== undefined) patch[column] = input[key];
      };

      set("displayName", "displayName");
      set("birthDate", "birthDate");
      set("gender", "gender");
      set("seeking", "seeking");
      set("oneLine", "oneLine");
      set("formType", "formType");
      set("formBody", "formBody");
      set("promptAnswers", "promptAnswers");
      set("interests", "interests");
      set("status", "status");
      set("wantsKids", "wantsKids");
      set("diet", "diet");
      set("languages", "languages");
      set("religion", "religion");
      set("drinking", "drinking");
      set("smoking", "smoking");
      set("sleepRhythm", "sleepRhythm");
      set("preferences", "preferences");
      set("privacy", "privacy");

      if (input.currently !== undefined) {
        patch.currently = input.currently;
        patch.currentlyUpdatedAt = now;
      }

      if (input.location !== undefined) {
        patch.locationGeohash =
          input.location === null ? null : encodeGeohash(input.location.lat, input.location.lon);
        patch.lastLocationUpdate = input.location === null ? null : now;
      }

      let profileId = user.profileId;

      if (profileId) {
        await db.update(profiles).set(patch).where(eq(profiles.id, profileId));
      } else {
        // Creation needs the columns the schema declares NOT NULL.
        if (!input.displayName || !input.birthDate || !input.gender) {
          throw new Error("VALIDATION_ERROR");
        }
        const [created] = await db
          .insert(profiles)
          .values({
            authUserId: user.authUserId,
            displayName: input.displayName,
            birthDate: input.birthDate,
            gender: input.gender,
            ...patch,
          })
          .returning({ id: profiles.id });
        profileId = created.id;
      }

      await logAudit({
        actorType: "user",
        actorId: user.authUserId,
        action: user.profileId ? "profile.updated" : "profile.created",
        resourceType: "profile",
        resourceId: profileId,
        meta: { fields: Object.keys(patch).filter((k) => k !== "updatedAt") },
      });

      // Recomputed from the writing. Never fatal: a profile save must not
      // fail because an optional scoring term could not be produced.
      await updateProfileEmbedding(profileId);

      const [saved] = await db.select().from(profiles).where(eq(profiles.id, profileId));
      const state = completeness(saved);

      return reply.status(200).send({
        profile: {
          ...saved,
          age: ageFrom(saved.birthDate),
          // The same shape GET answers with, so a save can be read back
          // without a second round trip to learn whether it took.
          hasLocation: saved.locationGeohash !== null,
          locationGeohash: undefined,
          // 384 numbers nobody needs in a browser.
          embedding: undefined,
        },
        complete: state.complete,
        missing: state.missing,
      });
    }
  );

  /**
   * Someone else's profile.
   *
   * Requires a profile of your own — you cannot read the room without
   * being in it — and is refused in both directions of a block. A blocked
   * pair gets the same 404 as a profile that does not exist, so the
   * response cannot be used to confirm someone is still on the platform.
   */
  app.get<{ Params: { id: string } }>(
    "/profiles/:id",
    { preHandler: [requireSession, requireProfile] },
    async (request) => {
      const viewerProfileId = request.user!.profileId!;
      const targetId = request.params.id;

      if (targetId === viewerProfileId) throw new Error("NOT_FOUND");

      const [target] = await db.select().from(profiles).where(eq(profiles.id, targetId)).limit(1);
      if (!target || target.moderationStatus !== "active") throw new Error("NOT_FOUND");

      const [blocked] = await db
        .select({ id: blocks.id })
        .from(blocks)
        .where(
          or(
            and(eq(blocks.blockerId, viewerProfileId), eq(blocks.blockedId, targetId)),
            and(eq(blocks.blockerId, targetId), eq(blocks.blockedId, viewerProfileId))
          )
        )
        .limit(1);

      if (blocked) throw new Error("NOT_FOUND");

      const [viewer] = await db.select().from(profiles).where(eq(profiles.id, viewerProfileId));

      const km = distanceKm(viewer.locationGeohash, target.locationGeohash);
      const distance = target.privacy.showDistance ? distanceBand(km) : null;

      return { profile: toPublicProfile(target, distance) };
    }
  );
};
