import type { FastifyRequest, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import { db, authUsers, profiles } from "../storage/db";
import { validateSession } from "../auth/session";
import { logAuth } from "../services/audit";
import { config } from "../config";

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      authUserId: string;
      profileId?: string;
      email: string;
      isEmailVerified: boolean;
    };
  }
}

export async function requireSession(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  // Support both cookie and Authorization: Bearer header
  const token = request.cookies[config.SESSION_COOKIE_NAME]
    || (request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice(7)
      : undefined);

  if (!token) {
    throw new Error("MISSING_SESSION");
  }

  const session = await validateSession(token);

  if (!session) {
    throw new Error("INVALID_SESSION");
  }

  const [user] = await db
    .select({
      id: authUsers.id,
      email: authUsers.email,
      emailVerified: authUsers.emailVerified,
      isDeleted: authUsers.isDeleted,
    })
    .from(authUsers)
    .where(eq(authUsers.id, session.authUserId))
    .limit(1);

  if (!user || user.isDeleted) {
    throw new Error("INVALID_SESSION");
  }

  // Attach profile ID if it exists
  const [profile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.authUserId, user.id))
    .limit(1);

  request.user = {
    authUserId: user.id,
    profileId: profile?.id,
    email: user.email,
    isEmailVerified: user.emailVerified,
  };
}