import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  authUsers,
  profiles,
  reports,
  messages,
  matches,
  likes,
  sceneSessions,
  sceneTurns,
} from "../storage/db.js";
import { sendEmail } from "./email.js";
import { config } from "../config.js";

/**
 * The only two emails this product sends besides a sign-in.
 *
 * Both say THAT something happened and never WHAT: no names, no lines,
 * no counts of who. An email is a copy that leaves this machine, sits in
 * someone's inbox and gets forwarded, read over a shoulder, or synced to
 * a phone that is not theirs. The app is where the details live.
 */

const DAY_MS = 24 * 60 * 60_000;

// A cap per run protects the daily sending quota (300 on Brevo's free
// tier) from ever being spent in one go.
const DIGESTS_PER_RUN = 25;

/** Tell the moderator that new reports exist. Returns how many it announced. */
export async function notifyModerator(): Promise<number> {
  if (!config.ADMIN_EMAIL) return 0;

  const fresh = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.status, "submitted"), isNull(reports.adminNotifiedAt)));

  if (fresh.length === 0) return 0;

  const n = fresh.length;
  const delivered = await sendEmail({
    to: config.ADMIN_EMAIL,
    subject: `Tum Mile: ${n} new report${n === 1 ? "" : "s"}`,
    text: [
      `${n} new report${n === 1 ? " has" : "s have"} been filed on Tum Mile.`,
      "",
      "The details stay on the machine. Read them there:",
      '  cd "Tum Mile/server" && DOTENV_CONFIG_PATH="$PWD/.env.production" ./node_modules/.bin/tsx scripts/reports.ts',
    ].join("\n"),
  });

  // Marked only once the email actually went, so a failure is retried on
  // the next run instead of silently swallowing the report.
  if (!delivered) return 0;

  await db
    .update(reports)
    .set({ adminNotifiedAt: new Date() })
    .where(inArray(reports.id, fresh.map((r) => r.id)));

  return n;
}

/**
 * The opt-in daily note. Returns how many were sent.
 *
 * "Something waiting" means, since the last note: a message from someone
 * you are still matched with, a letter (a like) still pending for you, a
 * scene proposed to you, or a line written to you in a scene. Anything
 * from a block or an ended match does not count — those are already gone.
 */
export async function sendDigests(now = new Date()): Promise<number> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const me = profiles.id;
  const since = sql`coalesce(${profiles.notifiedThrough}, ${profiles.createdAt})`;

  const somethingWaiting = sql`(
    exists (
      select 1 from ${messages}
      join ${matches} on ${matches.id} = ${messages.matchId}
      where (${matches.profileAId} = ${me} or ${matches.profileBId} = ${me})
        and ${matches.unmatchedAt} is null
        and ${messages.senderProfileId} <> ${me}
        and ${messages.createdAt} > ${since}
    )
    or exists (
      select 1 from ${likes}
      where ${likes.likedProfileId} = ${me}
        and ${likes.status} = 'pending'
        and ${likes.createdAt} > ${since}
    )
    or exists (
      select 1 from ${sceneSessions}
      join ${matches} on ${matches.id} = ${sceneSessions.matchId}
      where (${sceneSessions.castAId} = ${me} or ${sceneSessions.castBId} = ${me})
        and ${matches.unmatchedAt} is null
        and ${sceneSessions.proposedById} <> ${me}
        and ${sceneSessions.status} = 'proposed'
        and ${sceneSessions.createdAt} > ${since}
    )
    or exists (
      select 1 from ${sceneTurns}
      join ${sceneSessions} on ${sceneSessions.id} = ${sceneTurns.sessionId}
      join ${matches} on ${matches.id} = ${sceneSessions.matchId}
      where (${sceneSessions.castAId} = ${me} or ${sceneSessions.castBId} = ${me})
        and ${matches.unmatchedAt} is null
        and ${sceneTurns.profileId} <> ${me}
        and ${sceneTurns.createdAt} > ${since}
    )
  )`;

  const due = await db
    .select({ profileId: profiles.id, email: authUsers.email })
    .from(profiles)
    .innerJoin(authUsers, eq(authUsers.id, profiles.authUserId))
    .where(
      and(
        eq(profiles.notifyByEmail, true),
        eq(authUsers.isDeleted, false),
        eq(profiles.moderationStatus, "active"),
        or(isNull(profiles.lastNotifiedAt), lt(profiles.lastNotifiedAt, dayAgo)),
        somethingWaiting
      )
    )
    .limit(DIGESTS_PER_RUN);

  let sent = 0;
  for (const person of due) {
    const delivered = await sendEmail({
      to: person.email,
      subject: "Something is waiting on Tum Mile",
      text: [
        "Something is waiting for you on Tum Mile.",
        "",
        config.EMAIL_MAGIC_LINK_BASE_URL,
        "",
        "You asked for this note, and it comes at most once a day.",
        "Turn it off in Account whenever you like.",
      ].join("\n"),
    });
    if (!delivered) continue;

    await db
      .update(profiles)
      .set({ lastNotifiedAt: now, notifiedThrough: now })
      .where(eq(profiles.id, person.profileId));
    sent++;
  }

  return sent;
}
