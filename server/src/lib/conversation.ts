import { and, eq, isNull, or } from "drizzle-orm";
import { db, matches, blocks } from "../storage/db.js";
import type { Match } from "../storage/schema.js";

/**
 * The six reactions. A deliberate signal is expression; an automatic one
 * is surveillance — which is why these exist and read receipts do not.
 * Small and fixed so the set stays a vocabulary rather than a keyboard.
 */
export const REACTIONS = ["😄", "😐", "😢", "🔥", "👏", "🤔"] as const;
export type Reaction = (typeof REACTIONS)[number];

export function isReaction(value: string): value is Reaction {
  return (REACTIONS as readonly string[]).includes(value);
}

/**
 * Establishes, for ONE call, that this actor may speak in this match.
 *
 * Re-run on every read and every write rather than once when a
 * conversation opens: a match can be ended, or a block placed, between
 * two requests, and a check made at open time would keep answering yes
 * for as long as the tab stayed open.
 *
 * Everything it refuses answers NOT_FOUND, so a caller cannot tell an
 * unmatched pair from a blocked one from a match that never existed.
 */
export async function requireParticipant(
  matchId: string,
  actorProfileId: string
): Promise<{ match: Match; otherProfileId: string }> {
  const [match] = await db
    .select()
    .from(matches)
    .where(and(eq(matches.id, matchId), isNull(matches.unmatchedAt)))
    .limit(1);

  if (!match) throw new Error("NOT_FOUND");

  if (match.profileAId !== actorProfileId && match.profileBId !== actorProfileId) {
    throw new Error("NOT_FOUND");
  }

  const otherProfileId =
    match.profileAId === actorProfileId ? match.profileBId : match.profileAId;

  const [blocked] = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, actorProfileId), eq(blocks.blockedId, otherProfileId)),
        and(eq(blocks.blockerId, otherProfileId), eq(blocks.blockedId, actorProfileId))
      )
    )
    .limit(1);

  if (blocked) throw new Error("NOT_FOUND");

  return { match, otherProfileId };
}

/**
 * Off-platform handoff, recorded as a fact and nothing more.
 *
 * The best-documented harm pattern in the research is a conversation
 * being moved to WhatsApp or Telegram and turning into fraud there. This
 * notices the shape of that move so the signal exists for moderation —
 * and stores only WHICH host was linked, never the message it appeared
 * in. Reading the body to make a judgement about it is a line this
 * product does not cross outside a report.
 */
const OFF_PLATFORM = [
  /\bwa\.me\b/i,
  /\bchat\.whatsapp\.com\b/i,
  /\bt\.me\b/i,
  /\btelegram\.(me|org)\b/i,
  /\binstagram\.com\b/i,
  /\bsnapchat\.com\b/i,
];

export function offPlatformHosts(body: string): string[] {
  const found = new Set<string>();
  for (const pattern of OFF_PLATFORM) {
    const match = pattern.exec(body);
    if (match) found.add(match[0].toLowerCase());
  }
  return [...found];
}
