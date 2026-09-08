import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db, authUsers } from "../storage/db";
import { sendEmail } from "../services/email";

/**
 * Generate a cryptographically random verification token,
 * store its hash in the DB, and send the plaintext token via email.
 *
 * In dev mode (no SMTP configured), the verification URL is returned
 * in the response and logged to the console instead of being emailed.
 */
export async function requestMagicLink(email: string): Promise<{ ok: boolean; devUrl?: string }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 15 * 60_000); // 15 min

  const [existing] = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.email, email.toLowerCase()))
    .limit(1);

  if (existing && existing.emailVerified) {
    return { ok: true }; // silently succeed — don't reveal existence
  }

  // Delete any unused tokens for this email
  await db.delete(authUsers).where(eq(authUsers.email, email.toLowerCase()));

  // Upsert the user + token
  if (existing) {
    await db
      .update(authUsers)
      .set({
        verificationTokenHash: tokenHash,
        verificationTokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(authUsers.email, email.toLowerCase()));
  } else {
    await db.insert(authUsers).values({
      email: email.toLowerCase(),
      verificationTokenHash: tokenHash,
      verificationTokenExpiresAt: expiresAt,
    });
  }

  const verifyUrl = new URL(
    "/verify",
    process.env.EMAIL_MAGIC_LINK_BASE_URL
  );
  verifyUrl.searchParams.set("token", token);

  const smtpConfigured = process.env.SMTP_USER && process.env.SMTP_PASS;

  if (!smtpConfigured) {
    // Dev mode: log the URL instead of sending email
    console.log(
      `[DEV] Magic link for ${email}: ${verifyUrl.toString()}`
    );
    return { ok: true, devUrl: verifyUrl.toString() };
  }

  await sendEmail({
    to: email.toLowerCase(),
    subject: "Your Tum Mile verification link",
    text: `Open this link to verify your email:\n\n${verifyUrl.toString()}\n\nThis link expires in 15 minutes.`,
  });

  return { ok: true };
}

export async function verifyMagicLink(
  token: string
): Promise<{ ok: boolean; userId?: string; emailVerified?: boolean }> {
  const tokenHash = hashToken(token);

  const [user] = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.verificationTokenHash, tokenHash))
    .limit(1);

  if (!user) return { ok: false };
  if (user.verificationTokenExpiresAt < new Date())
    return { ok: false };

  await db
    .update(authUsers)
    .set({
      emailVerified: true,
      verificationTokenHash: null,
      verificationTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(authUsers.id, user.id));

  return { ok: true, userId: user.id, emailVerified: true };
}

// ─── Internal helpers ─────────────────────────────────────────────

function hashToken(token: string): string {
  return require("crypto")
    .createHmac("sha256", process.env.SESSION_SECRET!)
    .update(token)
    .digest("hex");
}