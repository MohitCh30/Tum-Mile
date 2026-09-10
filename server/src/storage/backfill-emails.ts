import { isNull } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db, authUsers } from "./db.js";
import { normaliseEmail } from "../lib/email.js";

/**
 * Give the canonical key to accounts created before it existed.
 *
 * Runs at boot and is idempotent. Done in TypeScript rather than in the
 * migration because the aliasing rules differ per provider and encoding
 * them in SQL would mean two copies of the same logic drifting apart.
 *
 * A collision here is real news: it means two existing accounts share one
 * inbox. They are left alone and reported rather than merged — merging
 * accounts is not a thing a backfill should decide.
 */
export async function backfillCanonicalEmails(): Promise<{
  filled: number;
  collisions: string[];
}> {
  const pending = await db
    .select({ id: authUsers.id, email: authUsers.email })
    .from(authUsers)
    .where(isNull(authUsers.emailCanonical));

  const seen = new Map<string, string>();
  const collisions: string[] = [];
  let filled = 0;

  for (const row of pending) {
    const normalised = normaliseEmail(row.email);
    if (!normalised) continue;

    const owner = seen.get(normalised.canonical);
    if (owner) {
      collisions.push(normalised.canonical);
      continue;
    }

    try {
      await db
        .update(authUsers)
        .set({ emailCanonical: normalised.canonical })
        .where(eq(authUsers.id, row.id));
      seen.set(normalised.canonical, row.id);
      filled += 1;
    } catch {
      // The unique index refused it: another row already holds this key.
      collisions.push(normalised.canonical);
    }
  }

  return { filled, collisions };
}
