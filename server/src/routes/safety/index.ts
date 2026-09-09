import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  profiles,
  blocks,
  likes,
  matches,
  messages,
  reports,
  moderationCases,
} from "../../storage/db.js";
import { requireSession, requireProfile } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { logAudit } from "../../services/audit.js";
import { config } from "../../config.js";

const writeLimit = {
  name: "safety-write",
  max: config.RATE_LIMIT_WRITE,
  windowMs: config.RATE_LIMIT_WRITE_WINDOW_MS,
};
const reportLimit = {
  name: "report",
  max: config.RATE_LIMIT_REPORT,
  windowMs: config.RATE_LIMIT_REPORT_WINDOW_MS,
};

const blockSchema = z.object({ profileId: z.string().min(1).max(40) });

const reportSchema = z.object({
  profileId: z.string().min(1).max(40),
  reason: z.enum(["spam", "harassment", "scam", "deception", "other"]),
  details: z.string().trim().max(1000).optional(),
  /** Optional: the conversation the report is about, for evidence. */
  matchId: z.string().min(1).max(40).optional(),
});

export const safetyRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Block.
   *
   * Authoritative and immediate: the block row alone already removes this
   * person from discovery, from every profile read, from likes and from
   * the conversation, because every one of those paths checks it in both
   * directions.
   *
   * On top of that the conversation is ENDED and its messages DELETED.
   * The study's requirement is that a blocked person's words leave your
   * view — and leaving them in theirs would keep a copy of yours in front
   * of the person you just blocked. So the whole exchange goes.
   *
   * A report made afterwards would find no evidence, which is exactly why
   * reporting captures its evidence at the moment it is filed.
   */
  app.post(
    "/blocks",
    { preHandler: [requireSession, requireProfile, rateLimit(writeLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;
      const { profileId } = blockSchema.parse(request.body);
      if (profileId === me) throw new Error("VALIDATION_ERROR");

      const [target] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, profileId))
        .limit(1);
      if (!target) throw new Error("NOT_FOUND");

      await db.transaction(async (tx) => {
        await tx
          .insert(blocks)
          .values({ blockerId: me, blockedId: profileId })
          .onConflictDoNothing();

        const pair = await tx
          .select({ id: matches.id })
          .from(matches)
          .where(
            or(
              and(eq(matches.profileAId, me), eq(matches.profileBId, profileId)),
              and(eq(matches.profileAId, profileId), eq(matches.profileBId, me))
            )
          );

        for (const match of pair) {
          await tx.delete(messages).where(eq(messages.matchId, match.id));
          await tx
            .update(matches)
            .set({ unmatchedAt: new Date(), unmatchedBy: me })
            .where(eq(matches.id, match.id));
        }

        // Any pending like either way stops waiting to be surfaced.
        await tx
          .update(likes)
          .set({ status: "declined" })
          .where(
            or(
              and(eq(likes.likerProfileId, profileId), eq(likes.likedProfileId, me)),
              and(eq(likes.likerProfileId, me), eq(likes.likedProfileId, profileId))
            )
          );
      });

      await logAudit({
        actorType: "user",
        actorId: request.user!.authUserId,
        action: "block.created",
        resourceType: "profile",
        resourceId: profileId,
      });

      return reply.status(204).send();
    }
  );

  /** Unblocking restores nothing — the conversation is gone for good. */
  app.delete<{ Params: { id: string } }>(
    "/blocks/:id",
    { preHandler: [requireSession, requireProfile, rateLimit(writeLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;
      await db
        .delete(blocks)
        .where(and(eq(blocks.blockerId, me), eq(blocks.blockedId, request.params.id)));

      await logAudit({
        actorType: "user",
        actorId: request.user!.authUserId,
        action: "block.removed",
        resourceType: "profile",
        resourceId: request.params.id,
      });

      return reply.status(204).send();
    }
  );

  app.get(
    "/blocks",
    { preHandler: [requireSession, requireProfile] },
    async (request) => {
      const me = request.user!.profileId!;
      const rows = await db
        .select({ id: blocks.blockedId, since: blocks.createdAt, name: profiles.displayName })
        .from(blocks)
        .innerJoin(profiles, eq(profiles.id, blocks.blockedId))
        .where(eq(blocks.blockerId, me))
        .orderBy(desc(blocks.createdAt));

      // Only the blocks you placed. Whether anyone has blocked YOU is not
      // something this API will ever answer.
      return { blocks: rows };
    }
  );

  /**
   * Report.
   *
   * Evidence is copied into the report as it is filed, because the very
   * next thing a person usually does is block — which scrubs the
   * conversation. This is the single place message bodies are stored
   * outside a conversation, and the constitution permits it for exactly
   * this purpose.
   *
   * Only the reported party's own messages are captured. A report is not
   * a way to hand a moderator someone else's half of a conversation.
   */
  app.post(
    "/reports",
    { preHandler: [requireSession, requireProfile, rateLimit(reportLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;
      const input = reportSchema.parse(request.body);
      if (input.profileId === me) throw new Error("VALIDATION_ERROR");

      const [reported] = await db
        .select({ id: profiles.id, authUserId: profiles.authUserId })
        .from(profiles)
        .where(eq(profiles.id, input.profileId))
        .limit(1);
      if (!reported) throw new Error("NOT_FOUND");

      let evidence: { messageId: string; body: string; at: string }[] = [];

      if (input.matchId) {
        const [match] = await db
          .select()
          .from(matches)
          .where(eq(matches.id, input.matchId))
          .limit(1);

        // You may only submit a conversation you were in, about the person
        // who was in it with you.
        const participant =
          match && (match.profileAId === me || match.profileBId === me);
        const involvesReported =
          match && (match.profileAId === reported.id || match.profileBId === reported.id);

        if (!participant || !involvesReported) throw new Error("NOT_FOUND");

        const theirs = await db
          .select()
          .from(messages)
          .where(
            and(eq(messages.matchId, match.id), eq(messages.senderProfileId, reported.id))
          )
          .orderBy(desc(messages.createdAt))
          .limit(20);

        evidence = theirs.map((m) => ({
          messageId: m.id,
          body: m.body,
          at: m.createdAt.toISOString(),
        }));
      }

      const [report] = await db
        .insert(reports)
        .values({
          reporterId: me,
          reportedId: reported.id,
          matchId: input.matchId ?? null,
          reason: input.reason,
          details: input.details ?? "",
          evidence,
        })
        .returning({ id: reports.id });

      // One open case per reported profile; further reports attach to it.
      const [existing] = await db
        .select()
        .from(moderationCases)
        .where(
          and(
            eq(moderationCases.reportedProfileId, reported.id),
            eq(moderationCases.status, "open")
          )
        )
        .limit(1);

      if (!existing) {
        await db.insert(moderationCases).values({ reportedProfileId: reported.id });
      } else {
        await db
          .update(moderationCases)
          .set({ updatedAt: new Date() })
          .where(eq(moderationCases.id, existing.id));
      }

      await logAudit({
        actorType: "user",
        actorId: request.user!.authUserId,
        action: "report.filed",
        resourceType: "profile",
        resourceId: reported.id,
        // Reason and evidence count only — never the reporter's account of
        // it, and never a line of what was said.
        meta: { reason: input.reason, evidenceCount: evidence.length },
      });

      return reply.status(201).send({ id: report.id });
    }
  );

  /** What you have reported. Never who has reported you. */
  app.get("/reports", { preHandler: [requireSession, requireProfile] }, async (request) => {
    const me = request.user!.profileId!;
    const rows = await db
      .select({
        id: reports.id,
        reason: reports.reason,
        status: reports.status,
        at: reports.createdAt,
      })
      .from(reports)
      .where(eq(reports.reporterId, me))
      .orderBy(desc(reports.createdAt));
    return { reports: rows };
  });
};
