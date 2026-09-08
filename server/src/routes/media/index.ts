import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { db, profilePhotos } from "../storage/db";
import { validateSession } from "../auth/session";

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/media/photos/:key
  // Short-lived signed URL for local dev (always 5 min)
  app.get<{ Params: { key: string } }>(
    "/media/photos/:key",
    async (request, reply) => {
      const token = request.headers.authorization?.startsWith("Bearer ")
        ? request.headers.authorization.slice(7)
        : undefined;

      if (!token) {
        return reply.status(401).send({
          error: { code: "MISSING_SESSION", message: "Authentication required." },
        });
      }

      const session = await validateSession(token);
      if (!session) {
        return reply.status(401).send({
          error: { code: "INVALID_SESSION", message: "Invalid session." },
        });
      }

      // Find the photo
      const [photo] = await db
        .select({
          id: profilePhotos.id,
          authUserId: profilePhotos.authUserId,
          moderationStatus: profilePhotos.moderationStatus,
        })
        .from(profilePhotos)
        .where(eq(profilePhotos.storageKey, request.params.key))
        .limit(1);

      if (!photo) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Photo not found." },
        });
      }

      // Require photo to be approved AND owned by requester (or any approved photo for discovery)
      if (photo.moderationStatus !== "approved") {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Photo not found." },
        });
      }

      // Owner can always view their own photos
      if (photo.authUserId !== session.authUserId) {
        // Future: check if viewing user has a match with the photo owner
        // For now, only allow viewing approved photos of other users
      }

      const { getObjectUrl } = await import("../services/object-storage");
      const url = getObjectUrl(request.params.key);

      return { url, expiresIn: 300 };
    }
  );
};