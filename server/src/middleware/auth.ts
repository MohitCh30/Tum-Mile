import type { FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { db, authUsers, profiles } from "../storage/db.js";
import { validateSession } from "../auth/session.js";
import { config } from "../config.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: {
      authUserId: string;
      email: string;
      emailVerified: boolean;
      profileId?: string;
      isAdmin: boolean;
    };
  }
}

/**
 * Establishes WHO is calling. It does not establish what they may do —
 * every route decides that for itself against the actor this attaches.
 *
 * The session token is read from the cookie only. The August version also
 * accepted `Authorization: Bearer <session token>`, which hands the same
 * credential to any script that can make a cross-origin request.
 */
export async function requireSession(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const token = request.cookies[config.SESSION_COOKIE_NAME];
  if (!token) throw new Error("MISSING_SESSION");

  const session = await validateSession(token);
  if (!session) throw new Error("INVALID_SESSION");

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

  // A deleted account keeps neither its sessions nor its right to be told
  // which of the two things went wrong.
  if (!user || user.isDeleted) throw new Error("INVALID_SESSION");

  const [profile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.authUserId, user.id))
    .limit(1);

  request.user = {
    authUserId: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    profileId: profile?.id,
    isAdmin: config.ADMIN_EMAIL !== undefined && user.email === config.ADMIN_EMAIL,
  };
}

/** Chain after requireSession for anything that touches other people. */
export async function requireVerified(request: FastifyRequest): Promise<void> {
  if (!request.user) throw new Error("MISSING_SESSION");
  if (!request.user.emailVerified) throw new Error("NOT_VERIFIED");
}

/** Chain for anything that acts *as* a profile: likes, messages, reports. */
export async function requireProfile(request: FastifyRequest): Promise<void> {
  if (!request.user) throw new Error("MISSING_SESSION");
  if (!request.user.emailVerified) throw new Error("NOT_VERIFIED");
  if (!request.user.profileId) throw new Error("NO_PROFILE");
}

export async function requireAdmin(request: FastifyRequest): Promise<void> {
  if (!request.user) throw new Error("MISSING_SESSION");
  // Deny-by-default: with no ADMIN_EMAIL configured, nobody is an admin.
  if (!request.user.isAdmin) throw new Error("FORBIDDEN");
}

/** The actor's profile id, or a thrown error. Never trust a body field for this. */
export function actingProfileId(request: FastifyRequest): string {
  if (!request.user?.profileId) throw new Error("NO_PROFILE");
  return request.user.profileId;
}
