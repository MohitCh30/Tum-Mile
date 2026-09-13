import { randomInt } from "node:crypto";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db, authUsers } from "../storage/db.js";
import { hashToken } from "../lib/tokens.js";
import { sendEmail } from "../services/email.js";
import { invalidateAllSessions } from "./session.js";
import { config } from "../config.js";
import { normaliseEmail } from "../lib/email.js";

/**
 * Changing the address on an account.
 *
 * This is the most dangerous write in the product, because the address IS
 * the identity: whoever receives mail at it can sign in. Changing it is
 * therefore a transfer of ownership, and it is treated like one.
 *
 * Three things hold it together:
 *
 *  - Nothing switches on request. The new address must prove itself with
 *    a code, and until it does the account still answers to the old one.
 *  - The OLD address is always told, with no link and no code in the mail.
 *    That warning is the only thing that reaches the real owner if someone
 *    walks off with an unlocked session, and it arrives BEFORE the change.
 *  - A collision is never disclosed. Asking to move to an address that is
 *    already an account looks exactly like asking to move to a free one.
 *
 * A code rather than a link, deliberately: the person is already sitting
 * on the settings screen where they started, so there is nowhere to
 * redirect them to, nothing to break when their mail app opens links in a
 * different browser, and no URL for anyone to imitate.
 */

/** Wrong guesses allowed against one issued code before it is retired. */
export const MAX_CHANGE_ATTEMPTS = 5;

function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// Prefixed so this can never be confused with a sign-in code: a code
// issued for one purpose must not be spendable on the other.
const hashChangeCode = (code: string) => hashToken(`email-change:${code}`);

export interface ChangeRequestResult {
  ok: true;
  /** Development only, when SMTP has no credentials. Never set in production. */
  devCode?: string;
}

export async function requestEmailChange(
  authUserId: string,
  rawEmail: string
): Promise<ChangeRequestResult> {
  const normalised = normaliseEmail(rawEmail);

  // Malformed and throwaway addresses get the same answer as good ones,
  // for the same reason sign-in does: saying which domains work is itself
  // information.
  if (!normalised || normalised.disposable) return { ok: true };

  const [me] = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, authUserId))
    .limit(1);
  if (!me || me.isDeleted) return { ok: true };

  // Their own address. Nothing is happening, so nobody is warned about it.
  if (me.emailCanonical === normalised.canonical) return { ok: true };

  // The warning goes out BEFORE the collision check, and regardless of it.
  //
  // If it were sent only when the move could proceed, its arrival would
  // tell the requester whether the target address already has an account
  // here — an enumeration oracle reachable from inside any account, and a
  // particularly bad one on a dating app in a small-world graph.
  await sendEmail({
    to: me.email,
    subject: "Someone asked to move your Tum Mile account",
    text: [
      "Someone signed in to your Tum Mile account asked to move it to a different email address.",
      "",
      "Nothing has changed yet, and this address still controls the account.",
      "",
      "If this was you, the confirmation code went to the new address.",
      "If it was not, someone else is signed in as you: open Tum Mile on this",
      "address now, and step away or delete the account from the account page.",
    ].join("\n"),
  });

  const [clash] = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(
      and(
        eq(authUsers.emailCanonical, normalised.canonical),
        ne(authUsers.id, authUserId)
      )
    )
    .limit(1);

  // Taken. Identical answer, and no code is minted — the address that
  // already has an account is never told that somebody asked for it.
  if (clash) return { ok: true };

  const code = newCode();

  await db
    .update(authUsers)
    .set({
      pendingEmail: normalised.address,
      pendingEmailCanonical: normalised.canonical,
      pendingEmailCodeHash: hashChangeCode(code),
      pendingEmailExpiresAt: new Date(Date.now() + config.MAGIC_LINK_TTL_MS),
      // A new code starts with a clean count; the old one is gone.
      pendingEmailAttempts: 0,
      updatedAt: new Date(),
    })
    .where(eq(authUsers.id, authUserId));

  await sendEmail({
    to: normalised.address,
    subject: "Confirm this address for Tum Mile",
    text: [
      "Someone asked to move a Tum Mile account to this address.",
      "",
      `Type this code on the account page to confirm it: ${code}`,
      "",
      "It works once, and only for the next fifteen minutes.",
      "If this was not you, ignore this. Nothing has been moved, and this",
      "address has not been added to anything.",
    ].join("\n"),
  });

  const smtpConfigured = config.SMTP_USER !== "" && config.SMTP_PASS !== "";
  if (!smtpConfigured && config.NODE_ENV !== "production") {
    return { ok: true, devCode: code };
  }

  return { ok: true };
}

/**
 * Spend the code and move the account.
 *
 * Every other session is ended on success. That does nothing against an
 * attacker — they would simply sign in at the address they just took —
 * but it is the whole point for the opposite case: somebody recovering an
 * account that was compromised needs a way to remove the other person.
 */
export async function confirmEmailChange(authUserId: string, code: string): Promise<void> {
  const [me] = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, authUserId))
    .limit(1);

  if (!me || !me.pendingEmail || !me.pendingEmailCodeHash || !me.pendingEmailExpiresAt) {
    throw new Error("NOT_FOUND");
  }

  if (me.pendingEmailExpiresAt.getTime() < Date.now()) {
    await clearPending(authUserId);
    throw new Error("NOT_FOUND");
  }

  if (me.pendingEmailAttempts >= MAX_CHANGE_ATTEMPTS) {
    await clearPending(authUserId);
    throw new Error("NOT_FOUND");
  }

  if (hashChangeCode(code) !== me.pendingEmailCodeHash) {
    // Counted, because six digits is a million possibilities — plenty for
    // five tries and nothing like enough for unlimited ones.
    await db
      .update(authUsers)
      .set({ pendingEmailAttempts: me.pendingEmailAttempts + 1, updatedAt: new Date() })
      .where(eq(authUsers.id, authUserId));
    throw new Error("VALIDATION_ERROR");
  }

  const oldAddress = me.email;
  const pendingCanonical = me.pendingEmailCanonical;

  // Re-checked here rather than trusted from the request: the address may
  // have been claimed by somebody else in the fifteen minutes since.
  const [clash] = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(and(eq(authUsers.emailCanonical, pendingCanonical!), ne(authUsers.id, authUserId)))
    .limit(1);

  if (clash) {
    await clearPending(authUserId);
    throw new Error("NOT_FOUND");
  }

  // Conditional on the change still being pending, so two submissions of a
  // right code cannot both move the account.
  const moved = await db
    .update(authUsers)
    .set({
      email: me.pendingEmail,
      emailCanonical: pendingCanonical,
      pendingEmail: null,
      pendingEmailCanonical: null,
      pendingEmailCodeHash: null,
      pendingEmailExpiresAt: null,
      pendingEmailAttempts: 0,
      updatedAt: new Date(),
    })
    .where(and(eq(authUsers.id, authUserId), isNotNull(authUsers.pendingEmailCodeHash)))
    .returning({ id: authUsers.id });

  if (moved.length === 0) throw new Error("NOT_FOUND");

  await invalidateAllSessions(authUserId);

  // Sent last, and to the address that just lost the account — the record
  // matters most precisely to whoever did not do this.
  await sendEmail({
    to: oldAddress,
    subject: "Your Tum Mile account has moved",
    text: [
      "The Tum Mile account that used this address now uses a different one.",
      "",
      "Everyone signed in to it has been signed out.",
      "",
      "If this was not you, this address can no longer reach the account and",
      "you should reply to this mail so it can be looked at.",
    ].join("\n"),
  });
}

async function clearPending(authUserId: string): Promise<void> {
  await db
    .update(authUsers)
    .set({
      pendingEmail: null,
      pendingEmailCanonical: null,
      pendingEmailCodeHash: null,
      pendingEmailExpiresAt: null,
      pendingEmailAttempts: 0,
      updatedAt: new Date(),
    })
    .where(eq(authUsers.id, authUserId));
}
