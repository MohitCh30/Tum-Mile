import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, profilePhotos, reports } from "../storage/db";
import { requireSession } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { config } from "../config";

const photoModerationSchema = z.object({
  moderationStatus: z.enum(["approved", "rejected"]),
});

// ─── Simple admin auth check ────────────────────────────────────
// Phase 1: one pre-provisioned admin using a config email address.
// When a user with ADMIN_EMAIL exists and is verified, they get admin access.
const ADMIN_EMAIL = config.ADMIN_EMAIL;

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // PATCH /api/v1/admin/photos/:id - approve/reject photo
  app.patch<{ Params: { id: string } }>(
    "/admin/photos/:id",
    {
      preHandler: [requireSession, requireAdmin],
    },
    async (request, reply) => {
      if (!request.user) throw new Error("MISSING_SESSION");

      const input = photoModerationSchema.parse(request.body);
      const [photo] = await db
        .select()
        .from(profilePhotos)
        .where(eq(profilePhotos.id, request.params.id))
        .limit(1);

      if (!photo) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Photo not found." },
        });
      }

      const [updated] = await db
        .update(profilePhotos)
        .set({
          moderationStatus: input.moderationStatus,
        })
        .where(eq(profilePhotos.id, photo.id))
        .returning();

      await logAudit({
        actorType: "admin",
        actorId: request.user.authUserId,
        action: `photo:${input.moderationStatus}`,
        resourceType: "profile_photo",
        resourceId: photo.id,
      });

      return { photo: updated };
    }
  );

  // GET /api/v1/admin/reports - list pending reports (Phase 2 stub)
  app.get(
    "/admin/reports",
    {
      preHandler: [requireSession, requireAdmin],
    },
    async (_request, reply) => {
      const [recent] = await db
        .select()
        .from(reports)
        .where(eq(reports.status, "submitted"))
        .orderBy((reports) => reports.createdAt)
        .limit(20);

      return { reports: recent };
    }
  );
};

async function requireAdmin(
  request: { user?: { email: string } },
  _reply: FastifyReply
): Promise<void> {
  if (!request.user || request.user.email !== ADMIN_EMAIL) {
    throw new Error("FORBIDDEN");
  }
}