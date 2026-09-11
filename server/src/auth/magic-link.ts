import { randomInt } from "node:crypto";
import { and, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { db, authUsers } from "../storage/db.js";
import { newToken, hashToken } from "../lib/tokens.js";
import { sendEmail } from "../services/email.js";
import { config } from "../config.js";
import { normaliseEmail, canonicalEmail } from "../lib/email.js";

export interface LinkRequestResult {
  /** Always true. Never reveals whether the address is known. */
  ok: true;
  /** Development only, when SMTP has no credentials — never set in production. */
  devUrl?: string;
  devCode?: string;
}

/** Wrong guesses allowed against one issued code before it is retired. */
export const MAX_CODE_ATTEMPTS = 5;

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// Prefixed so a code's hash can never collide with a link token's.
const hashCode = (code: string) => hashToken(`code:${code}`);

/**
 * Send a sign-in link. Register and sign-in are the same operation: an
 * address either receives a link or silently does not, and the response
 * is identical either way, so this endpoint cannot enumerate accounts.
 */
export async function requestMagicLink(rawEmail: string): Promise<LinkRequestResult> {
  const normalised = normaliseEmail(rawEmail);

  // A malformed or throwaway address gets the SAME answer as a good one.
  // Saying "that domain is not allowed" would tell a caller which
  // providers work, and telling them anything different from the usual
  // response would re-open the enumeration hole closed in Phase 2.
  if (!normalised || normalised.disposable) return { ok: true };

  const email = normalised.address;
  const token = newToken();
  const code = newCode();
  const expiresAt = new Date(Date.now() + config.MAGIC_LINK_TTL_MS);

  // Looked up by the CANONICAL key, so an alias of an existing inbox
  // finds that account rather than creating a second one.
  const [existing] = await db
    .select({ id: authUsers.id, isDeleted: authUsers.isDeleted })
    .from(authUsers)
    .where(eq(authUsers.emailCanonical, normalised.canonical))
    .limit(1);

  if (existing?.isDeleted) {
    // A deleted account does not come back by asking for a link, and we
    // say nothing that distinguishes it from an address we have never seen.
    return { ok: true };
  }

  if (existing) {
    // Replace the pending token. The August version DELETED the user row
    // here, which destroyed the account (and everything cascading from it)
    // every time someone asked for a second link.
    await db
      .update(authUsers)
      .set({
        verificationTokenHash: hashToken(token),
        verificationTokenExpiresAt: expiresAt,
        // A new code starts with a clean count; the old one is gone.
        verificationCodeHash: hashCode(code),
        verificationCodeAttempts: 0,
        updatedAt: new Date(),
      })
      .where(eq(authUsers.id, existing.id));
  } else {
    await db.insert(authUsers).values({
      email,
      emailCanonical: normalised.canonical,
      verificationTokenHash: hashToken(token),
      verificationTokenExpiresAt: expiresAt,
      verificationCodeHash: hashCode(code),
    });
  }

  const url = new URL("/verify", config.EMAIL_MAGIC_LINK_BASE_URL);
  url.searchParams.set("token", token);

  const smtpConfigured = config.SMTP_USER !== "" && config.SMTP_PASS !== "";

  await sendEmail({
    to: email,
    subject: "Your link to Tum Mile",
    text: [
      "Someone asked to sign in to Tum Mile with this address.",
      "",
      "Open this link on the device you are signing in on:",
      url.toString(),
      "",
      `Or type this code where you asked for it: ${code}`,
      "",
      "Either works once, and only for the next fifteen minutes.",
      "If this was not you, nothing has happened — ignore this and both expire.",
    ].join("\n"),
  });

  // In local development SMTP is Mailpit with no credentials; hand the URL
  // back so the flow is testable without opening the inbox. Guarded twice:
  // unconfigured SMTP *and* not production.
  if (!smtpConfigured && config.NODE_ENV !== "production") {
    return { ok: true, devUrl: url.toString(), devCode: code };
  }

  return { ok: true };
}

export interface VerifyResult {
  ok: boolean;
  authUserId?: string;
}

/**
 * Consume a link, exactly once.
 *
 * This is a single conditional UPDATE ... RETURNING rather than a SELECT
 * followed by an UPDATE, and that matters: Postgres evaluates the WHERE
 * against a locked row, so of two requests racing with the same token
 * exactly one gets a row back and the other gets nothing.
 *
 * The read-then-write version passed a sequential replay test and still
 * minted two sessions from one link when a client fired the request twice
 * at once — which React's StrictMode does on every mount in development.
 */
export async function verifyMagicLink(token: string): Promise<VerifyResult> {
  const [claimed] = await db
    .update(authUsers)
    .set({
      emailVerified: true,
      verificationTokenHash: null,
      verificationTokenExpiresAt: null,
      // The link and the code are one sign-in; spending one spends both.
      verificationCodeHash: null,
      verificationCodeAttempts: 0,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(authUsers.verificationTokenHash, hashToken(token)),
        gt(authUsers.verificationTokenExpiresAt, new Date()),
        eq(authUsers.isDeleted, false)
      )
    )
    .returning({ id: authUsers.id });

  if (!claimed) return { ok: false };

  return { ok: true, authUserId: claimed.id };
}

/**
 * Consume a six-digit code, exactly once, for the inbox it was sent to.
 *
 * For the person whose mail app opens the link somewhere else — Gmail's
 * in-app browser signs in a browser they are not using. They type the code
 * into the tab they asked from instead.
 *
 * Same single conditional UPDATE as the link, so two racing submissions of
 * a right code produce one session. A code is only 20 bits, which is why
 * it is scoped to one inbox and retired after MAX_CODE_ATTEMPTS wrong
 * guesses; with three codes an hour per inbox, that is fifteen guesses at
 * a million.
 */
export async function verifyCode(rawEmail: string, code: string): Promise<VerifyResult> {
  const canonical = canonicalEmail(rawEmail);
  if (!canonical) return { ok: false };

  const [claimed] = await db
    .update(authUsers)
    .set({
      emailVerified: true,
      verificationTokenHash: null,
      verificationTokenExpiresAt: null,
      verificationCodeHash: null,
      verificationCodeAttempts: 0,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(authUsers.emailCanonical, canonical),
        eq(authUsers.verificationCodeHash, hashCode(code)),
        gt(authUsers.verificationTokenExpiresAt, new Date()),
        lt(authUsers.verificationCodeAttempts, MAX_CODE_ATTEMPTS),
        eq(authUsers.isDeleted, false)
      )
    )
    .returning({ id: authUsers.id });

  if (claimed) return { ok: true, authUserId: claimed.id };

  // Count the miss against whatever code this inbox holds. If there is no
  // account or no code, nothing is written, and the answer is the same.
  await db
    .update(authUsers)
    .set({ verificationCodeAttempts: sql`${authUsers.verificationCodeAttempts} + 1` })
    .where(and(eq(authUsers.emailCanonical, canonical), isNotNull(authUsers.verificationCodeHash)));

  return { ok: false };
}
