import { and, eq, gt, lt } from "drizzle-orm";
import { db, sessions } from "../storage/db.js";
import { newToken, hashToken } from "../lib/tokens.js";
import { config } from "../config.js";

export interface ActiveSession {
  id: string;
  authUserId: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Issue a session. Returns the raw token, which is the only time it
 * exists outside the holder's cookie — only its HMAC is stored.
 */
export async function createSession(
  authUserId: string,
  userAgent?: string
): Promise<string> {
  const raw = newToken();
  const expiresAt = new Date(Date.now() + config.SESSION_IDLE_TIMEOUT_MS);

  await db.insert(sessions).values({
    authUserId,
    tokenHash: hashToken(raw),
    userAgentHash: userAgent ? hashToken(userAgent) : null,
    expiresAt,
  });

  return raw;
}

/**
 * Validate and slide. Idle timeout extends on use, but never past the
 * absolute ceiling measured from when the session was created — so a
 * stolen cookie cannot be kept alive indefinitely by using it.
 */
export async function validateSession(raw: string): Promise<ActiveSession | null> {
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(raw)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) return null;

  const ceiling = row.createdAt.getTime() + config.SESSION_ABSOLUTE_TIMEOUT_MS;
  if (Date.now() >= ceiling) {
    await db.delete(sessions).where(eq(sessions.id, row.id));
    return null;
  }

  const nextExpiry = new Date(
    Math.min(Date.now() + config.SESSION_IDLE_TIMEOUT_MS, ceiling)
  );

  // Only write when it actually moves, to keep this off the hot path.
  if (nextExpiry.getTime() !== row.expiresAt.getTime()) {
    await db.update(sessions).set({ expiresAt: nextExpiry }).where(eq(sessions.id, row.id));
  }

  return {
    id: row.id,
    authUserId: row.authUserId,
    expiresAt: nextExpiry,
    createdAt: row.createdAt,
  };
}

export async function invalidateSession(raw: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(raw)));
}

/** Every session for a user — logout everywhere, and on deletion. */
export async function invalidateAllSessions(authUserId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.authUserId, authUserId));
}

export async function pruneExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
