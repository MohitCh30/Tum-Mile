import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, profiles, reports, moderationCases } from "../../storage/db.js";
import { requireSession, requireAdmin } from "../../middleware/auth.js";
import { logAudit } from "../../services/audit.js";

/**
 * Moderation.
 *
 * One pre-provisioned identity, set by ADMIN_EMAIL. With that unset
 * nobody is an admin — deny by default, so a misconfiguration closes the
 * door rather than opening it. The /moderate screen is only a way of
 * calling these; every route here checks the caller for itself.
 */

const PENDING = ["submitted", "reviewing"];

/** Strikes are counted from the record, never kept as a tally that can drift. */
const actionedCount = (profileId: unknown) =>
  sql<number>`(select count(*)::int from ${reports} where ${reports.reportedId} = ${profileId} and ${reports.status} = 'actioned')`;
const pendingCount = (profileId: unknown) =>
  sql<number>`(select count(*)::int from ${reports} where ${reports.reportedId} = ${profileId} and ${reports.status} in ('submitted', 'reviewing'))`;

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
        strikes: actionedCount(moderationCases.reportedProfileId),
        pending: pendingCount(moderationCases.reportedProfileId),
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
        .orderBy(
          // Waiting ones first, then the history.
          desc(inArray(reports.status, PENDING)),
          desc(reports.createdAt)
        );

      return { case: openCase, reports: rows };
    }
  );

  /**
   * Decide a report. An actioned report is a strike; the second one
   * restricts the account automatically, so escalation does not depend on
   * anybody remembering to apply it.
   *
   * Strikes are counted from actioned reports, ever, rather than stored on
   * the case: the case closes once nothing on it is waiting, and a tally
   * kept there reset whenever it did. Dismissing one report also used to
   * close the whole case, hiding any other report still waiting on it.
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
      if (!PENDING.includes(report.status)) {
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

        const [counts] = await tx
          .select({
            actioned: actionedCount(report.reportedId),
            pending: pendingCount(report.reportedId),
          })
          .from(sql`(select 1) as one`);
        strikes = counts?.actioned ?? 0;
        const stillWaiting = counts?.pending ?? 0;

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

        if (openCase) {
          await tx
            .update(moderationCases)
            .set({
              strikeCount: strikes,
              notes: input.note ?? openCase.notes,
              status: stillWaiting === 0 ? "closed" : "open",
              updatedAt: new Date(),
            })
            .where(eq(moderationCases.id, openCase.id));
        }

        if (input.decision === "actioned" && strikes >= STRIKES_TO_RESTRICT) {
          // Only from active: a second strike must never soften a suspension.
          const changed = await tx
            .update(profiles)
            .set({ moderationStatus: "restricted", updatedAt: new Date() })
            .where(and(eq(profiles.id, report.reportedId), eq(profiles.moderationStatus, "active")))
            .returning({ id: profiles.id });
          restricted = changed.length > 0;
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
