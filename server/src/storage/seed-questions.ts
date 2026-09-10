import { inArray, notInArray, eq } from "drizzle-orm";
import { db, questions } from "./db.js";
import { QUESTIONS } from "../content/questions.js";

/**
 * Push the question bank into the table.
 *
 * The bank lives in code, so editing a question is a commit rather than a
 * migration. The row id IS the bank's slug — a stable, human-readable key
 * — so an answer keeps pointing at the question it answered across
 * redeploys. Renaming a slug orphans every answer to it; that is the cost
 * of the readability, and the reason ids are treated as permanent.
 *
 * Idempotent: safe to run at every boot and in every test.
 */
export async function seedQuestions(): Promise<{ upserted: number; retired: number }> {
  const ids = QUESTIONS.map((q) => q.id);

  for (const question of QUESTIONS) {
    await db
      .insert(questions)
      .values({
        id: question.id,
        body: question.body,
        options: [...question.options],
        isOnboarding: question.onboarding === true,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: questions.id,
        set: {
          body: question.body,
          options: [...question.options],
          isOnboarding: question.onboarding === true,
          isActive: true,
        },
      });
  }

  // A question removed from the bank is retired, never deleted: deleting
  // it would cascade away every answer anyone gave it, and those answers
  // are still true things people said.
  const retired = await db
    .update(questions)
    .set({ isActive: false })
    .where(notInArray(questions.id, ids))
    .returning({ id: questions.id });

  return { upserted: QUESTIONS.length, retired: retired.length };
}

/** Present in the bank and not retired. */
export async function activeQuestionIds(): Promise<string[]> {
  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.isActive, true));
  return rows.map((r) => r.id);
}

export { inArray };
