import crypto from "crypto";
import { and, gt } from "drizzle-orm";
import { db, sessions } from "../storage/db";
import { config } from "../config";

const TOKEN_BYTES = 32;

export interface SessionRecord {
  id: string;
  authUserId: string;
  expiresAt: Date;
}

/**
 * Create a new session. Returns the session cookie value to set.
 */
export async function createSession(
  authUserId: string,
  userAgent: string | undefined
): Promise<string> {
  const rawToken = randomBytes(TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + config.SESSION_IDLE_TIMEOUT_MS
  );

  const [session] = await db
    .insert(sessions)
    .values({
      authUserId,
      tokenHash,
      userAgentHash: userAgent ? hashToken(userAgent) : undefined,
      expiresAt,
    })
    .returning();

  return rawToken;
}

/**
 * Validate a session token. Returns the session + auth_user_id, or null.
 * Also refreshes idle timeout if within absolute window.
 */
export async function validateSession(
  rawToken: string
): Promise<(SessionRecord & { authUserId: string }) | null> {
  const tokenHash = hashToken(rawToken);

  const [session] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!session) return null;

  // Session expired while processing — clean up and reject
  if (session.expiresAt <= new Date()) {
    // Session expired — clean up
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }

  // Sliding idle refresh (max: absolute timeout)
  const now = Date.now();
  const absoluteLimit =
    new Date(
      session.createdAt.getTime() + config.SESSION_ABSOLUTE_TIMEOUT_MS
    );
  const newExpiry = new Date(
    Math.min(now + config.SESSION_IDLE_TIMEOUT_MS, absoluteLimit.getTime())
  );

  if (newExpiry.getTime() !== session.expiresAt.getTime()) {
    await db
      .update(sessions)
      .set({ expiresAt: newExpiry })
      .where(eq(sessions.id, session.id));
  }

  return { ...session, authUserId: session.authUserId };
}

/**
 * Invalidate all sessions for a user (logout everywhere).
 */
export async function invalidateAllSessions(authUserId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.authUserId, authUserId));
}

/**
 * Invalidate a single session by its raw token.
 */
export async function invalidateSession(rawToken: string): Promise<void> {
  const tokenHash = hashToken(rawToken);
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

// ─── Token hashing (HMAC-SHA256, server-side only) ────────────────

export function hashToken(token: string): string {
  return randomBytes
    .createHmac("sha256", process.env.SESSION_SECRET!)
    .update(token)
    .digest("hex");
}