import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, profiles, reports, moderationCases } from "../../storage/db.js";
import { requireSession, requireAdmin } from "../../middleware/auth.js";
import { logAudit } from "../../services/audit.js";

/**
 * Moderation, as endpoints rather than a console.
 *
 * One pre-provisioned identity, set by ADMIN_EMAIL. With that unset
 * nobody is an admin — deny by default, so a misconfiguration closes the
 * door rather than opening it.
 *
 * Deliberately no interface: a queue a single person drives from curl is
 * the honest size of this, and a built console would imply a moderation
 * team that does not exist.
 */

const decisionSchema = z.object({
  decision: z.enum(["actioned", "dismissed"]),
  note: z.string().trim().max(500).optional(),
});

const statusSchema = z.object({
  moderationStatus: z.enum(["active", "restricted", "suspended"]),
  note: z.string().trim().max(500).optional(),
});

/** Two actioned reports and an account stops being discoverable. */
export const STRIKES_TO_RESTRICT = 2;

export const adminRoutes: FastifyPluginAsync = async (app) => {
  /** The queue: open cases, newest first, with their reports. */
  app.get("/admin/cases", { preHandler: [requireSession, requireAdmin] }, async () => {
    const cases = await db
      .select({
        id: moderationCases.id,
        profileId: moderationCases.reportedProfileId,
        displayName: profiles.displayName,
        moderationStatus: profiles.moderationStatus,
        status: moderationCases.status,
        strikes: moderationCases.strikeCount,
        opened: moderationCases.createdAt,
      })
      .from(moderationCases)
      .innerJoin(profiles, eq(profiles.id, moderationCases.reportedProfileId))
      .where(eq(moderationCases.status, "open"))
      .orderBy(desc(moderationCases.updatedAt));

    return { cases };
  });

  /**
   * The reports on one case, with their evidence.
   *
   * Reporter identity is NOT returned. A moderator decides on what was
   * said, not on who objected to it — and the research is explicit that
   * exposing a reporter turns reporting into a way to attract retaliation.
   */
  app.get<{ Params: { id: string } }>(
    "/admin/cases/:id/reports",
    { preHandler: [requireSession, requireAdmin] },
    async (request) => {
      const [openCase] = await db
        .select()
        .from(moderationCases)
        .where(eq(moderationCases.id, request.params.id))
        .limit(1);
      if (!openCase) throw new Error("NOT_FOUND");

      const rows = await db
        .select({
          id: reports.id,
          reason: reports.reason,
          details: reports.details,
          evidence: reports.evidence,
          status: reports.status,
          at: reports.createdAt,
        })
        .from(reports)
        .where(eq(reports.reportedId, openCase.reportedProfileId))
        .orderBy(desc(reports.createdAt));

      return { case: openCase, reports: rows };
    }
  );

  /**
   * Decide a report. An actioned report is a strike; the second one
   * restricts the account automatically, so escalation does not depend on
   * anybody remembering to apply it.
   */
  app.patch<{ Params: { id: string } }>(
    "/admin/reports/:id",
    { preHandler: [requireSession, requireAdmin] },
    async (request, reply) => {
      const input = decisionSchema.parse(request.body);

      const [report] = await db
        .select()
        .from(reports)
        .where(eq(reports.id, request.params.id))
        .limit(1);
      if (!report) throw new Error("NOT_FOUND");
      if (report.status !== "submitted" && report.status !== "reviewing") {
        // Already decided; deciding twice would double-count the strike.
        throw new Error("VALIDATION_ERROR");
      }

      let restricted = false;
      let strikes = 0;

      await db.transaction(async (tx) => {
        await tx
          .update(reports)
          .set({
            status: input.decision,
            resolution: { note: input.note ?? null, at: new Date().toISOString() },
          })
          .where(eq(reports.id, report.id));

        const [openCase] = await tx
          .select()
          .from(moderationCases)
          .where(
            and(
              eq(moderationCases.reportedProfileId, report.reportedId),
              eq(moderationCases.status, "open")
            )
          )
          .limit(1);

        if (!openCase) return;

        if (input.decision === "actioned") {
          const [updated] = await tx
            .update(moderationCases)
            .set({
              strikeCount: sql`${moderationCases.strikeCount} + 1`,
              notes: input.note ?? openCase.notes,
              updatedAt: new Date(),
            })
            .where(eq(moderationCases.id, openCase.id))
            .returning({ strikes: moderationCases.strikeCount });

          strikes = updated?.strikes ?? 0;

          if (strikes >= STRIKES_TO_RESTRICT) {
            await tx
              .update(profiles)
              .set({ moderationStatus: "restricted", updatedAt: new Date() })
              .where(eq(profiles.id, report.reportedId));
            restricted = true;
          }
        } else {
          await tx
            .update(moderationCases)
            .set({ status: "closed", updatedAt: new Date() })
            .where(eq(moderationCases.id, openCase.id));
        }
      });

      await logAudit({
        actorType: "admin",
        actorId: request.user!.authUserId,
        action: `report.${input.decision}`,
        resourceType: "profile",
        resourceId: report.reportedId,
        meta: { strikes, restricted },
      });

      return reply.status(200).send({ decision: input.decision, strikes, restricted });
    }
  );

  /** Direct enforcement, for the cases a strike count should not decide. */
  app.patch<{ Params: { id: string } }>(
    "/admin/profiles/:id",
    { preHandler: [requireSession, requireAdmin] },
    async (request, reply) => {
      const input = statusSchema.parse(request.body);

      const [profile] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, request.params.id))
        .limit(1);
      if (!profile) throw new Error("NOT_FOUND");

      await db
        .update(profiles)
        .set({ moderationStatus: input.moderationStatus, updatedAt: new Date() })
        .where(eq(profiles.id, profile.id));

      await logAudit({
        actorType: "admin",
        actorId: request.user!.authUserId,
        action: "profile.moderated",
        resourceType: "profile",
        resourceId: profile.id,
        meta: { moderationStatus: input.moderationStatus },
      });

      return reply.status(200).send({ moderationStatus: input.moderationStatus });
    }
  );
};
