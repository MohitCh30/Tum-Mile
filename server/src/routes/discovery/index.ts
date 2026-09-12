import type { FastifyPluginAsync } from "fastify";
import { and, eq, gte, inArray, isNull, ne, or, sql, desc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  profiles,
  blocks,
  likes,
  passes,
  matches,
  questionAnswers,
} from "../../storage/db.js";
import type { Profile, QuestionAnswer } from "../../storage/schema.js";
import { requireSession, requireProfile } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { logAudit } from "../../services/audit.js";
import { config } from "../../config.js";
import { ageFrom, completeness, isQuotable, toPublicProfile } from "../../lib/profile.js";
import { distanceKm, distanceBand } from "../../lib/geo.js";
import { wants } from "../../lib/gender.js";
import { compatibility, WEIGHTS } from "../../lib/compatibility.js";
import { budget, startOfDay } from "../../lib/budget.js";

const discoveryLimit = {
  name: "discovery",
  max: config.RATE_LIMIT_DISCOVERY,
  windowMs: config.RATE_LIMIT_DISCOVERY_WINDOW_MS,
};
const writeLimit = {
  name: "interaction",
  max: config.RATE_LIMIT_WRITE,
  windowMs: config.RATE_LIMIT_WRITE_WINDOW_MS,
};

const likeSchema = z.object({
  profileId: z.string().min(1).max(40),
  quotedLine: z.string().trim().min(1).max(400),
  message: z.string().trim().min(1).max(600),
});

const passSchema = z.object({ profileId: z.string().min(1).max(40) });

/** Matches are stored with the lower id first, so a pair has one row. */
function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function loadProfile(id: string): Promise<Profile> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
  if (!profile) throw new Error("NOT_FOUND");
  return profile;
}

/** Every profile id this viewer must never be shown, in either direction. */
async function excludedIds(viewerId: string): Promise<Set<string>> {
  const [blockRows, likeRows, passRows] = await Promise.all([
    db
      .select({ a: blocks.blockerId, b: blocks.blockedId })
      .from(blocks)
      .where(or(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, viewerId))),
    db.select({ id: likes.likedProfileId }).from(likes).where(eq(likes.likerProfileId, viewerId)),
    db.select({ id: passes.passedProfileId }).from(passes).where(eq(passes.passerProfileId, viewerId)),
  ]);

  const excluded = new Set<string>([viewerId]);
  for (const row of blockRows) {
    excluded.add(row.a === viewerId ? row.b : row.a);
  }
  for (const row of likeRows) excluded.add(row.id);
  for (const row of passRows) excluded.add(row.id);
  return excluded;
}

/**
 * Hard filters run BEFORE any scoring, and a filtered profile is never
 * ranked low — it is absent. Blocked, deleted, restricted and
 * out-of-preference people cannot appear at any score.
 */
function eligible(viewer: Profile, candidate: Profile, now: Date): boolean {
  if (candidate.moderationStatus !== "active") return false;
  if (!completeness(candidate).complete) return false;

  // Two-sided: each must be seeking the other's stated gender. Compared
  // through the canonical form, so "Female" and "woman" are one thing.
  if (!wants(viewer.seeking, candidate.gender)) return false;
  if (!wants(candidate.seeking, viewer.gender)) return false;

  const viewerAge = ageFrom(viewer.birthDate, now);
  const candidateAge = ageFrom(candidate.birthDate, now);
  if (candidateAge < viewer.preferences.ageMin || candidateAge > viewer.preferences.ageMax) {
    return false;
  }
  if (viewerAge < candidate.preferences.ageMin || viewerAge > candidate.preferences.ageMax) {
    return false;
  }

  // Distance is a preference with an escape hatch, not a wall: either side
  // opting into long distance satisfies their own radius.
  const km = distanceKm(viewer.locationGeohash, candidate.locationGeohash);
  if (km !== null) {
    const viewerOk = viewer.preferences.openToLongDistance || km <= viewer.preferences.distanceRadiusKm;
    const candidateOk =
      candidate.preferences.openToLongDistance || km <= candidate.preferences.distanceRadiusKm;
    if (!viewerOk || !candidateOk) return false;
  }

  return true;
}

async function answersFor(profileIds: string[]): Promise<Map<string, QuestionAnswer[]>> {
  const byProfile = new Map<string, QuestionAnswer[]>();
  if (profileIds.length === 0) return byProfile;

  const rows = await db
    .select()
    .from(questionAnswers)
    .where(inArray(questionAnswers.profileId, profileIds));

  for (const row of rows) {
    const list = byProfile.get(row.profileId) ?? [];
    list.push(row);
    byProfile.set(row.profileId, list);
  }
  return byProfile;
}

async function outboundUsed(viewerId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(likes)
    .where(and(eq(likes.likerProfileId, viewerId), gte(likes.createdAt, since)));
  return row?.n ?? 0;
}

export const discoveryRoutes: FastifyPluginAsync = async (app) => {
  /**
   * One person at a time. No stack, no grid, nothing to swipe through —
   * and because there is no browsable list, there is also nothing for a
   * scraper to enumerate.
   */
  app.get(
    "/discovery",
    { preHandler: [requireSession, requireProfile, rateLimit(discoveryLimit)] },
    async (request) => {
      const viewerId = request.user!.profileId!;
      const now = new Date();
      const viewer = await loadProfile(viewerId);

      const own = completeness(viewer);
      if (!own.complete) {
        // Nothing to read means nothing to be read by. Symmetric.
        return { profile: null, reason: "incomplete_profile", missing: own.missing };
      }

      const excluded = await excludedIds(viewerId);
      const pool = await db
        .select()
        .from(profiles)
        .where(and(eq(profiles.moderationStatus, "active"), ne(profiles.id, viewerId)))
        .limit(500);

      const candidates = pool.filter((c) => !excluded.has(c.id) && eligible(viewer, c, now));
      if (candidates.length === 0) {
        return { profile: null, reason: "nobody_new" };
      }

      const answers = await answersFor([viewerId, ...candidates.map((c) => c.id)]);
      const viewerAnswers = answers.get(viewerId) ?? [];

      const scored = candidates
        .map((candidate) => ({
          candidate,
          fit: compatibility(viewer, viewerAnswers, candidate, answers.get(candidate.id) ?? [], now),
        }))
        .sort((a, b) => b.fit.score - a.fit.score);

      const best = scored[0];
      const km = distanceKm(viewer.locationGeohash, best.candidate.locationGeohash);
      const used = await outboundUsed(viewerId, startOfDay(now));

      return {
        profile: toPublicProfile(
          best.candidate,
          best.candidate.privacy.showDistance ? distanceBand(km) : null,
          now
        ),
        // Truthful explanation, and only what is already mutual knowledge:
        // shared ground, and the FACT of a non-negotiable clash, never its
        // content — which would leak what the other person answered.
        why: {
          sharedInterests: best.fit.sharedInterests,
          sharedLanguages: best.fit.sharedLanguages,
          nonNegotiableConflict: best.fit.nonNegotiableConflict,
        },
        budget: budget(config.BUDGET_OUTBOUND_PER_DAY, used),
        remainingToday: candidates.length,
      };
    }
  );

  /** The published ranking. Nothing here is a secret. */
  app.get("/discovery/ranking", { preHandler: [requireSession] }, async () => ({
    weights: WEIGHTS,
    note: "Hard filters run before scoring. Blocked, restricted and out-of-preference profiles are removed, never ranked low.",
  }));

  /**
   * A like is never bare: it quotes a line the other person actually wrote
   * and carries the message replying to it. That is what makes "hey"
   * impossible, and the quote is checked against the STORED profile — a
   * client-supplied quote would just be a free-text field.
   */
  app.post(
    "/likes",
    { preHandler: [requireSession, requireProfile, rateLimit(writeLimit)] },
    async (request, reply) => {
      const viewerId = request.user!.profileId!;
      const input = likeSchema.parse(request.body);
      const now = new Date();

      if (input.profileId === viewerId) throw new Error("VALIDATION_ERROR");

      const viewer = await loadProfile(viewerId);
      if (!completeness(viewer).complete) throw new Error("NO_PROFILE");

      const [target] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.id, input.profileId))
        .limit(1);

      // Everything the viewer may not reach answers the same 404: a target
      // that does not exist, is suspended, has blocked them, or that they
      // are not eligible to see are indistinguishable from outside.
      if (!target || target.moderationStatus !== "active") throw new Error("NOT_FOUND");

      const [blocked] = await db
        .select({ id: blocks.id })
        .from(blocks)
        .where(
          or(
            and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, target.id)),
            and(eq(blocks.blockerId, target.id), eq(blocks.blockedId, viewerId))
          )
        )
        .limit(1);
      if (blocked) throw new Error("NOT_FOUND");

      if (!eligible(viewer, target, now)) throw new Error("NOT_FOUND");
      if (!isQuotable(target, input.quotedLine)) throw new Error("VALIDATION_ERROR");

      let matchId: string | null = null;
      let reciprocated = false;
      let used = 0;

      const [a, b] = canonicalPair(viewerId, target.id);

      await db.transaction(async (tx) => {
        // Two advisory locks, always taken in this order so no two
        // transactions can hold them crosswise and deadlock.
        //
        // The PAIR lock makes simultaneous mutual likes deterministic.
        // Without it both sides check for the other's like before either
        // has committed, both find nothing, and two people who chose each
        // other end up with no match at all — a silent miss, which is
        // worse than the duplicate the unique index already prevents.
        //
        // The ACTOR lock makes the budget real. Counted outside a lock,
        // six concurrent requests all read "five used" and all proceed.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`pair:${a}:${b}`}))`);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`actor:${viewerId}`}))`);

        const [spent] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(likes)
          .where(and(eq(likes.likerProfileId, viewerId), gte(likes.createdAt, startOfDay(now))));
        used = spent?.n ?? 0;
        if (used >= config.BUDGET_OUTBOUND_PER_DAY) throw new Error("BUDGET_EXHAUSTED");

        const [reciprocal] = await tx
          .select()
          .from(likes)
          .where(and(eq(likes.likerProfileId, target.id), eq(likes.likedProfileId, viewerId)))
          .limit(1);

        reciprocated =
          reciprocal !== undefined &&
          reciprocal.status !== "expired" &&
          reciprocal.status !== "declined";

        await tx.insert(likes).values({
          likerProfileId: viewerId,
          likedProfileId: target.id,
          quotedLine: input.quotedLine.trim(),
          openingMessage: input.message.trim(),
          status: reciprocated ? "matched" : "pending",
          surfacedAt: reciprocated ? now : null,
        });

        if (reciprocated && reciprocal) {
          const [created] = await tx
            .insert(matches)
            .values({ profileAId: a, profileBId: b })
            .onConflictDoNothing()
            .returning({ id: matches.id });

          matchId = created?.id ?? null;
          if (!matchId) {
            const [existing] = await tx
              .select({ id: matches.id })
              .from(matches)
              .where(and(eq(matches.profileAId, a), eq(matches.profileBId, b)))
              .limit(1);
            matchId = existing?.id ?? null;
          }

          await tx.update(likes).set({ status: "matched" }).where(eq(likes.id, reciprocal.id));
        }
      });

      await logAudit({
        actorType: "user",
        actorId: request.user!.authUserId,
        action: reciprocated ? "match.created" : "like.sent",
        resourceType: "profile",
        resourceId: target.id,
      });

      return reply.status(201).send({
        matched: reciprocated,
        matchId,
        budget: budget(config.BUDGET_OUTBOUND_PER_DAY, used + 1),
      });
    }
  );

  /** Passing costs nothing and is never disclosed to the other person. */
  app.post(
    "/passes",
    { preHandler: [requireSession, requireProfile, rateLimit(writeLimit)] },
    async (request, reply) => {
      const viewerId = request.user!.profileId!;
      const { profileId } = passSchema.parse(request.body);
      if (profileId === viewerId) throw new Error("VALIDATION_ERROR");

      const [target] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, profileId))
        .limit(1);
      if (!target) throw new Error("NOT_FOUND");

      await db
        .insert(passes)
        .values({ passerProfileId: viewerId, passedProfileId: profileId })
        .onConflictDoNothing();

      return reply.status(204).send();
    }
  );

  /**
   * Who reached for you. At most nine surface a day, chosen BY SCORE
   * rather than by arrival order — so a backlog cannot bury the person you
   * would have wanted under whoever happened to arrive first. Anything
   * still unsurfaced after a few days expires quietly; nobody is told.
   */
  app.get(
    "/likes/inbound",
    { preHandler: [requireSession, requireProfile, rateLimit(discoveryLimit)] },
    async (request) => {
      const viewerId = request.user!.profileId!;
      const now = new Date();
      const dayStart = startOfDay(now);
      const viewer = await loadProfile(viewerId);

      const cutoff = new Date(now.getTime() - config.INBOUND_EXPIRY_DAYS * 86_400_000);
      await db
        .update(likes)
        .set({ status: "expired" })
        .where(
          and(
            eq(likes.likedProfileId, viewerId),
            eq(likes.status, "pending"),
            sql`${likes.createdAt} < ${cutoff}`
          )
        );

      const alreadySurfaced = await db
        .select()
        .from(likes)
        .where(
          and(
            eq(likes.likedProfileId, viewerId),
            eq(likes.status, "surfaced"),
            gte(likes.surfacedAt, dayStart)
          )
        );

      const room = config.BUDGET_INBOUND_PER_DAY - alreadySurfaced.length;

      if (room > 0) {
        const pending = await db
          .select()
          .from(likes)
          .where(and(eq(likes.likedProfileId, viewerId), eq(likes.status, "pending")));

        if (pending.length > 0) {
          const senders = await db
            .select()
            .from(profiles)
            .where(inArray(profiles.id, pending.map((p) => p.likerProfileId)));
          const senderById = new Map(senders.map((s) => [s.id, s]));

          const answers = await answersFor([viewerId, ...senders.map((s) => s.id)]);
          const viewerAnswers = answers.get(viewerId) ?? [];

          const ranked = pending
            .map((like) => {
              const sender = senderById.get(like.likerProfileId);
              const score = sender
                ? compatibility(viewer, viewerAnswers, sender, answers.get(sender.id) ?? [], now)
                    .score
                : 0;
              return { like, score };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, room);

          if (ranked.length > 0) {
            await db
              .update(likes)
              .set({ status: "surfaced", surfacedAt: now })
              .where(inArray(likes.id, ranked.map((r) => r.like.id)));
          }
        }
      }

      const surfaced = await db
        .select()
        .from(likes)
        .where(and(eq(likes.likedProfileId, viewerId), eq(likes.status, "surfaced")))
        .orderBy(desc(likes.surfacedAt));

      const senderIds = surfaced.map((l) => l.likerProfileId);
      const senders =
        senderIds.length > 0
          ? await db.select().from(profiles).where(inArray(profiles.id, senderIds))
          : [];
      const senderById = new Map(senders.map((s) => [s.id, s]));

      return {
        likes: surfaced.flatMap((like) => {
          const sender = senderById.get(like.likerProfileId);
          if (!sender) return [];
          const km = distanceKm(viewer.locationGeohash, sender.locationGeohash);
          return [
            {
              id: like.id,
              quotedLine: like.quotedLine,
              message: like.openingMessage,
              from: toPublicProfile(sender, sender.privacy.showDistance ? distanceBand(km) : null, now),
            },
          ];
        }),
        budget: budget(config.BUDGET_INBOUND_PER_DAY, Math.min(
          config.BUDGET_INBOUND_PER_DAY,
          surfaced.filter((l) => l.surfacedAt !== null && l.surfacedAt >= dayStart).length
        )),
      };
    }
  );

  /** Everyone you can now write to. */
  app.get(
    "/matches",
    { preHandler: [requireSession, requireProfile, rateLimit(discoveryLimit)] },
    async (request) => {
      const viewerId = request.user!.profileId!;
      const now = new Date();
      const viewer = await loadProfile(viewerId);

      const rows = await db
        .select()
        .from(matches)
        .where(
          and(
            or(eq(matches.profileAId, viewerId), eq(matches.profileBId, viewerId)),
            isNull(matches.unmatchedAt)
          )
        )
        .orderBy(desc(matches.createdAt));

      const otherIds = rows.map((m) => (m.profileAId === viewerId ? m.profileBId : m.profileAId));
      const others =
        otherIds.length > 0
          ? await db.select().from(profiles).where(inArray(profiles.id, otherIds))
          : [];
      const byId = new Map(others.map((p) => [p.id, p]));

      return {
        matches: rows.flatMap((match) => {
          const otherId = match.profileAId === viewerId ? match.profileBId : match.profileAId;
          const other = byId.get(otherId);
          if (!other) return [];
          const km = distanceKm(viewer.locationGeohash, other.locationGeohash);
          return [
            {
              id: match.id,
              since: match.createdAt,
              with: toPublicProfile(other, other.privacy.showDistance ? distanceBand(km) : null, now),
            },
          ];
        }),
      };
    }
  );
};
