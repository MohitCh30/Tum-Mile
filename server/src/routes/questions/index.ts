import type { FastifyPluginAsync } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, questions, questionAnswers } from "../../storage/db.js";
import { requireSession, requireProfile } from "../../middleware/auth.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import { config } from "../../config.js";
import {
  QUESTIONS,
  ONBOARDING_QUESTIONS,
  ONBOARDING_COUNT,
  MAX_NON_NEGOTIABLE,
  getQuestion,
  isValidAnswer,
} from "../../content/questions.js";
import { startOfDay } from "../../lib/budget.js";

const writeLimit = {
  name: "question-answer",
  max: config.RATE_LIMIT_WRITE,
  windowMs: config.RATE_LIMIT_WRITE_WINDOW_MS,
};

const answerSchema = z.object({
  answer: z.string().min(1).max(120),
  /**
   * What you would accept from someone else. Empty means no preference,
   * which is what the scoring function treats as "everything satisfies".
   */
  acceptable: z.array(z.string().min(1).max(120)).max(8).optional(),
  isNonNegotiable: z.boolean().optional(),
});

export const questionRoutes: FastifyPluginAsync = async (app) => {
  /**
   * What to ask next.
   *
   * Eight at sign-up, then one a day. Nobody fills in a fifty-question
   * survey to maybe meet someone — and one a day gives a reason to open
   * the app that is not a notification about another person.
   *
   * The daily one is chosen deterministically from the day and the
   * profile id, so it does not change if you reload, and two people are
   * not asked the same thing on the same day by accident of ordering.
   */
  app.get("/questions/next", { preHandler: [requireSession, requireProfile] }, async (request) => {
    const me = request.user!.profileId!;

    const answered = await db
      .select({ questionId: questionAnswers.questionId, at: questionAnswers.createdAt })
      .from(questionAnswers)
      .where(eq(questionAnswers.profileId, me));

    const answeredIds = new Set(answered.map((a) => a.questionId));
    const nonNegotiables = await countNonNegotiable(me);

    const outstandingOnboarding = ONBOARDING_QUESTIONS.filter((q) => !answeredIds.has(q.id));

    if (outstandingOnboarding.length > 0) {
      return {
        stage: "onboarding" as const,
        remaining: outstandingOnboarding.length,
        of: ONBOARDING_COUNT,
        questions: outstandingOnboarding.map(present),
        nonNegotiablesUsed: nonNegotiables,
        maxNonNegotiable: MAX_NON_NEGOTIABLE,
      };
    }

    // One a day: if something was already answered since midnight IST,
    // there is nothing more to ask today.
    const today = startOfDay();
    const answeredToday = answered.some((a) => a.at >= today);

    const unanswered = QUESTIONS.filter((q) => !answeredIds.has(q.id));

    if (answeredToday || unanswered.length === 0) {
      return {
        stage: "done" as const,
        answered: answered.length,
        total: QUESTIONS.length,
        nonNegotiablesUsed: nonNegotiables,
        maxNonNegotiable: MAX_NON_NEGOTIABLE,
      };
    }

    // Stable for the day: same question on a reload, different people get
    // different ones rather than everyone marching through in lockstep.
    const seed = hash(`${me}:${today.toISOString().slice(0, 10)}`);
    const question = unanswered[seed % unanswered.length];

    return {
      stage: "daily" as const,
      questions: [present(question)],
      answered: answered.length,
      total: QUESTIONS.length,
      nonNegotiablesUsed: nonNegotiables,
      maxNonNegotiable: MAX_NON_NEGOTIABLE,
    };
  });

  /** Your own answers, with the questions they answer. */
  app.get("/questions/mine", { preHandler: [requireSession, requireProfile] }, async (request) => {
    const me = request.user!.profileId!;

    const rows = await db
      .select()
      .from(questionAnswers)
      .where(eq(questionAnswers.profileId, me));

    return {
      answers: rows.flatMap((row) => {
        const question = getQuestion(row.questionId);
        if (!question) return [];
        return [
          {
            questionId: row.questionId,
            body: question.body,
            options: question.options,
            answer: row.answer,
            acceptable: row.acceptable,
            isNonNegotiable: row.isNonNegotiable,
          },
        ];
      }),
      nonNegotiablesUsed: await countNonNegotiable(me),
      maxNonNegotiable: MAX_NON_NEGOTIABLE,
    };
  });

  /**
   * Answer one, or change an answer.
   *
   * Marking three as non-negotiable is the whole weighting system: it is
   * what makes the score reflect what each person said mattered rather
   * than what keeps anybody on the site. Three, and no more — weighting
   * everything weights nothing.
   */
  app.put<{ Params: { id: string } }>(
    "/questions/:id/answer",
    { preHandler: [requireSession, requireProfile, rateLimit(writeLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;
      const input = answerSchema.parse(request.body);
      const question = getQuestion(request.params.id);

      if (!question) throw new Error("NOT_FOUND");
      if (!isValidAnswer(question.id, input.answer)) throw new Error("VALIDATION_ERROR");

      const acceptable = input.acceptable ?? [];
      // Every acceptable value must be one of this question's options —
      // otherwise the field is free text wearing a schema.
      if (acceptable.some((value) => !question.options.includes(value))) {
        throw new Error("VALIDATION_ERROR");
      }

      const isNonNegotiable = input.isNonNegotiable === true;

      // A non-negotiable with no acceptable answers would reject
      // everyone, including people who answered the same way.
      if (isNonNegotiable && acceptable.length === 0) throw new Error("VALIDATION_ERROR");

      if (isNonNegotiable) {
        const [existing] = await db
          .select({ isNonNegotiable: questionAnswers.isNonNegotiable })
          .from(questionAnswers)
          .where(
            and(eq(questionAnswers.profileId, me), eq(questionAnswers.questionId, question.id))
          )
          .limit(1);

        const alreadyCounted = existing?.isNonNegotiable === true;
        if (!alreadyCounted && (await countNonNegotiable(me)) >= MAX_NON_NEGOTIABLE) {
          throw new Error("TOO_MANY_NON_NEGOTIABLE");
        }
      }

      await db
        .insert(questionAnswers)
        .values({
          profileId: me,
          questionId: question.id,
          answer: input.answer,
          acceptable,
          isNonNegotiable,
        })
        .onConflictDoUpdate({
          target: [questionAnswers.profileId, questionAnswers.questionId],
          set: { answer: input.answer, acceptable, isNonNegotiable },
        });

      return reply.status(200).send({
        questionId: question.id,
        nonNegotiablesUsed: await countNonNegotiable(me),
        maxNonNegotiable: MAX_NON_NEGOTIABLE,
      });
    }
  );

  /** Change your mind entirely. */
  app.delete<{ Params: { id: string } }>(
    "/questions/:id/answer",
    { preHandler: [requireSession, requireProfile, rateLimit(writeLimit)] },
    async (request, reply) => {
      const me = request.user!.profileId!;
      await db
        .delete(questionAnswers)
        .where(
          and(eq(questionAnswers.profileId, me), eq(questionAnswers.questionId, request.params.id))
        );
      return reply.status(204).send();
    }
  );
};

function present(question: { id: string; body: string; options: readonly string[] }) {
  return { id: question.id, body: question.body, options: [...question.options] };
}

async function countNonNegotiable(profileId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(questionAnswers)
    .where(
      and(eq(questionAnswers.profileId, profileId), eq(questionAnswers.isNonNegotiable, true))
    );
  return row?.n ?? 0;
}

/** Small deterministic hash. Only used to pick a question of the day. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
