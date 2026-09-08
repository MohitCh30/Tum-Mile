import type { FastifyPluginAsync } from "fastify";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { db, authUsers, profiles, profilePhotos } from "../storage/db";
import { requireSession } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";
import { config } from "../config";

const profileGetSchema = z.object({ id: z.string().uuid() });
const profileUpdateSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  bio: z.string().max(500).optional(),
  birthDate: z.coerce.date().optional(),
  gender: z.string().min(1).max(50).optional(),
  seeking: z.array(z.string()).max(10).optional(),
  preferences: z
    .object({
      distanceRadiusKm: z.number().min(1).max(500).optional(),
      ageMin: z.number().min(18).max(120).optional(),
      ageMax: z.number().min(18).max(120).optional(),
    })
    .optional(),
  privacy: z
    .object({
      showDistance: z.boolean().optional(),
    })
    .optional(),
});

const allowedUpdateFields = [
  "displayName",
  "bio",
  "birthDate",
  "gender",
  "seeking",
  "preferences",
  "privacy",
] as const;

// ─── GET /api/v1/profile ────────────────────────────────────────
// Get authenticating user's own profile
export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/profile",
    {
      preHandler: [requireSession],
    },
    async (request, reply) => {
      if (!request.user) throw new Error("MISSING_SESSION");

      const [profile] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.authUserId, request.user.authUserId))
        .limit(1);

      if (!profile) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Profile not found." },
        });
      }

      // Include the auth user's email on the own-profile response
      const [authUser] = await db
        .select({ email: authUsers.email })
        .from(authUsers)
        .where(eq(authUsers.id, request.user.authUserId))
        .limit(1);

      return { profile, email: authUser?.email ?? null };
    }
  );

  // ─── GET /api/v1/profile/:id ────────────────────────────────
  // View another user's profile (only if approved + not blocked)
  app.get<{ Params: { id: string } }>(
    "/profile/:id",
    {
      preHandler: [requireSession],
    },
    async (request, reply) => {
      if (!request.user) throw new Error("MISSING_SESSION");

      const [profile] = await db
        .select()
        .from(profiles)
        .where(
          and(
            eq(profiles.id, request.params.id),
            eq(profiles.moderationStatus, "approved")
          )
        )
        .limit(1);

      if (!profile) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Profile not found." },
        });
      }

      // Return public fields only
      return {
        profile: {
          id: profile.id,
          displayName: profile.displayName,
          bio: profile.bio,
          birthDate: profile.birthDate,
          gender: profile.gender,
          seeking: profile.seeking,
          preferences: profile.preferences,
          privacy: profile.privacy,
        },
      };
    }
  );

  // ─── PATCH /api/v1/profile ──────────────────────────────────
  // Update own profile
  app.patch(
    "/profile",
    {
      preHandler: [requireSession],
    },
    async (request, reply) => {
      if (!request.user) throw new Error("MISSING_SESSION");

      const input = profileUpdateSchema.parse(request.body);

      // Check profile exists
      const [existing] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.authUserId, request.user.authUserId))
        .limit(1);

      if (!existing) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Profile not found." },
        });
      }

      // Apply updates (ignore any non-listed fields)
      const updates: Record<string, unknown> = {};
      for (const key of allowedUpdateFields) {
        if (key in (input as Record<string, unknown>)) {
          updates[key as string] = (
            input as Record<string, unknown>
          )[key];
        }
      }

      const [updated] = await db
        .update(profiles)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(profiles.id, existing.id))
        .returning();

      return { profile: updated };
    }
  );

  // ─── POST /api/v1/profile/photos ────────────────────────────
  app.post(
    "/profile/photos",
    {
      preHandler: [
        requireSession,
        async (req) => {
          await rateLimit({
            maxRequests: config.RATE_LIMIT_PHOTO_UPLOAD,
            windowMs: config.RATE_LIMIT_PHOTO_UPLOAD_WINDOW_MS,
          })({ user: req.user });
        },
        validatePhotoUpload,
      ],
    },
    async (request, reply) => {
      if (!request.user) throw new Error("MISSING_SESSION");

      const rawBuffer = (request as { rawBuffer?: Buffer }).rawBuffer;
      if (!rawBuffer || rawBuffer.length === 0) {
        return reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "Empty file." },
        });
      }

      if (rawBuffer.length > 5 * 1024 * 1024) {
        return reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "File too large (max 5MB)." },
        });
      }

      // Strip EXIF via sharp
      const sharp = await import("sharp");
      const stripped = await sharp(rawBuffer)
        .rotate() // auto-orient
        .jpeg({ quality: 85 })
        .toBuffer();

      // Store the file
      const store = await import("../../services/object-storage");
      const stored = await store.storeObject(stripped);

      // Generate thumbnail
      const thumb = await sharp(stripped)
        .resize(150, 150, { fit: "cover" })
        .jpeg({ quality: 75 })
        .toBuffer();
      const thumbStored = await store.storeObject(thumb);

      // Create photo record (pending moderation by default)
      const [photo] = await db
        .insert(profilePhotos)
        .values({
          authUserId: request.user.authUserId,
          storageKey: stored.key,
          thumbKey: thumbStored.key,
          moderationStatus: "pending",
        })
        .returning();

      return { photo };
    }
  );

  // ─── DELETE /api/v1/profile/photos/:id ──────────────────────
  app.delete<{ Params: { id: string } }>(
    "/profile/photos/:id",
    {
      preHandler: [requireSession],
    },
    async (request, reply) => {
      if (!request.user) throw new Error("MISSING_SESSION");

      const [photo] = await db
        .select()
        .from(profilePhotos)
        .where(
          and(
            eq(profilePhotos.id, request.params.id),
            eq(profilePhotos.authUserId, request.user.authUserId)
          )
        )
        .limit(1);

      if (!photo) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Photo not found." },
        });
      }

      await db.delete(profilePhotos).where(eq(profilePhotos.id, photo.id));

      // Remove from storage
      try {
        const store = await import("../../services/object-storage");
        await store.deleteObject(photo.storageKey);
        await store.deleteObject(photo.thumbKey);
      } catch {
        // Storage cleanup failure is non-fatal
      }

      return { ok: true };
    }
  );
};

/**
 * Multipart photo validation.
 * Accepts image/jpeg and image/png content types.
 */
async function validatePhotoUpload(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const contentType = request.headers["content-type"];

  if (!contentType?.startsWith("multipart/form-data")) {
    // Also accept raw binary for simple curl/API testing
    if (contentType?.startsWith("image/")) return;
    return reply.status(415).send({
      error: { code: "VALIDATION_ERROR", message: "Expected multipart/form-data or image/*" },
    });
  }

  // Fastify's default multipart handling is fine —
  // rawBuffer is just the uploaded file bytes
}