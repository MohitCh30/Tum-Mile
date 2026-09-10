import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, questions, questionAnswers, closeDb } from "../../src/storage/db.js";
import { seedQuestions } from "../../src/storage/seed-questions.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { QUESTIONS, ONBOARDING_COUNT, MAX_NON_NEGOTIABLE } from "../../src/content/questions.js";
import { API, makeActor, signUp, type Actor } from "../helpers.js";

let app: FastifyInstance;

const asMan = { gender: "man", seeking: ["woman"] };
const asWoman = { gender: "woman", seeking: ["man"] };

const next = (actor: Actor) =>
  app.inject({ method: "GET", url: `${API}/questions/next`, headers: { cookie: actor.cookie } });

const answer = (actor: Actor, id: string, payload: Record<string, unknown>) =>
  app.inject({
    method: "PUT",
    url: `${API}/questions/${id}/answer`,
    headers: { cookie: actor.cookie },
    payload,
  });

beforeAll(async () => {
  app = buildApp();
  await app.ready();
  await seedQuestions();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await db.delete(authUsers);
  resetRateLimits();
});

describe("the bank", () => {
  it("syncs into the table and is idempotent", async () => {
    await seedQuestions();
    await seedQuestions();

    const rows = await db.select().from(questions);
    expect(rows).toHaveLength(QUESTIONS.length);
    expect(rows.filter((r) => r.isOnboarding)).toHaveLength(ONBOARDING_COUNT);
    expect(rows.every((r) => r.isActive)).toBe(true);
  });

  it("keys rows by the bank's own slug, so answers survive a redeploy", async () => {
    const [row] = await db.select().from(questions).where(eq(questions.id, "marriage"));
    expect(row.body).toBe("Marriage is");
    expect(row.options).toContain("I have not decided");
  });
});

describe("what to ask next", () => {
  it("asks the eight together at first, then nothing more that day", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);

    const first = JSON.parse((await next(actor)).body);
    expect(first.stage).toBe("onboarding");
    expect(first.questions).toHaveLength(ONBOARDING_COUNT);
    expect(first.maxNonNegotiable).toBe(MAX_NON_NEGOTIABLE);

    for (const question of first.questions) {
      await answer(actor, question.id, { answer: question.options[0] });
    }

    // The eight are done and one has been answered today, so nothing more.
    const after = JSON.parse((await next(actor)).body);
    expect(after.stage).toBe("done");
    expect(after.answered).toBe(ONBOARDING_COUNT);
  });

  it("offers one a day once the eight are done", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);

    const onboarding = JSON.parse((await next(actor)).body);
    for (const question of onboarding.questions) {
      await answer(actor, question.id, { answer: question.options[0] });
    }

    // Backdate everything so "today" is clear again.
    await db
      .update(questionAnswers)
      .set({ createdAt: new Date(Date.now() - 3 * 86_400_000) })
      .where(eq(questionAnswers.profileId, actor.profileId));

    const daily = JSON.parse((await next(actor)).body);
    expect(daily.stage).toBe("daily");
    expect(daily.questions).toHaveLength(1);
    expect(daily.answered).toBe(ONBOARDING_COUNT);
  });

  it("gives the same question on a reload, not a new one each time", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);
    const onboarding = JSON.parse((await next(actor)).body);
    for (const question of onboarding.questions) {
      await answer(actor, question.id, { answer: question.options[0] });
    }
    await db
      .update(questionAnswers)
      .set({ createdAt: new Date(Date.now() - 3 * 86_400_000) })
      .where(eq(questionAnswers.profileId, actor.profileId));

    const a = JSON.parse((await next(actor)).body).questions[0].id;
    const b = JSON.parse((await next(actor)).body).questions[0].id;
    expect(a).toBe(b);
  });

  it("needs a profile", async () => {
    const cookie = await signUp(app, "nobody@test.local");
    const res = await app.inject({
      method: "GET",
      url: `${API}/questions/next`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("answering", () => {
  it("stores an answer and reads it back with its question", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);
    await answer(actor, "marriage", { answer: "possible" });

    const mine = JSON.parse(
      (await app.inject({ method: "GET", url: `${API}/questions/mine`, headers: { cookie: actor.cookie } }))
        .body
    );
    const stored = mine.answers.find((a: { questionId: string }) => a.questionId === "marriage");
    expect(stored.answer).toBe("possible");
    expect(stored.body).toBe("Marriage is");
    expect(stored.isNonNegotiable).toBe(false);
  });

  it("refuses an answer that is not one of the options", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);
    const res = await answer(actor, "marriage", { answer: "maybe one day, who knows" });
    expect(res.statusCode).toBe(400);
    expect(await db.select().from(questionAnswers)).toHaveLength(0);
  });

  it("refuses a question that does not exist", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);
    expect((await answer(actor, "invented-question", { answer: "yes" })).statusCode).toBe(404);
  });

  it("refuses acceptable values that are not options either", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);
    const res = await answer(actor, "marriage", {
      answer: "possible",
      acceptable: ["possible", "something I made up"],
      isNonNegotiable: true,
    });
    expect(res.statusCode).toBe(400);
  });

  it("replaces an answer rather than adding a second", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);
    await answer(actor, "marriage", { answer: "possible" });
    await answer(actor, "marriage", { answer: "the point" });

    const rows = await db.select().from(questionAnswers);
    expect(rows).toHaveLength(1);
    expect(rows[0].answer).toBe("the point");
  });

  it("can be taken back", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);
    await answer(actor, "marriage", { answer: "possible" });

    const res = await app.inject({
      method: "DELETE",
      url: `${API}/questions/marriage/answer`,
      headers: { cookie: actor.cookie },
    });
    expect(res.statusCode).toBe(204);
    expect(await db.select().from(questionAnswers)).toHaveLength(0);
  });
});

describe("non-negotiables", () => {
  const insist = (actor: Actor, id: string, answerValue: string, acceptable: string[]) =>
    answer(actor, id, { answer: answerValue, acceptable, isNonNegotiable: true });

  it("allows three and refuses a fourth", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);

    const three = ["marriage", "parents-know", "moving-cities"];
    for (const id of three) {
      const question = QUESTIONS.find((q) => q.id === id)!;
      const res = await insist(actor, id, question.options[0], [question.options[0]]);
      expect(res.statusCode).toBe(200);
    }

    const fourth = QUESTIONS.find((q) => q.id === "faith-daily")!;
    const res = await insist(actor, fourth.id, fourth.options[0], [fourth.options[0]]);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("TOO_MANY_NON_NEGOTIABLE");
  });

  it("lets you change one you already insisted on", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);
    const question = QUESTIONS.find((q) => q.id === "marriage")!;

    await insist(actor, "marriage", question.options[0], [question.options[0]]);
    const again = await insist(actor, "marriage", question.options[1], [question.options[1]]);

    expect(again.statusCode).toBe(200);
    expect(JSON.parse(again.body).nonNegotiablesUsed).toBe(1);
  });

  // Insisting with nothing acceptable would reject everyone, including
  // people who answered exactly the same way.
  it("refuses a non-negotiable with no acceptable answers", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);
    const res = await answer(actor, "marriage", {
      answer: "possible",
      acceptable: [],
      isNonNegotiable: true,
    });
    expect(res.statusCode).toBe(400);
  });

  it("frees a slot when the answer is taken back", async () => {
    const actor = await makeActor(app, "a@test.local", asMan);
    const question = QUESTIONS.find((q) => q.id === "marriage")!;
    await insist(actor, "marriage", question.options[0], [question.options[0]]);

    await app.inject({
      method: "DELETE",
      url: `${API}/questions/marriage/answer`,
      headers: { cookie: actor.cookie },
    });

    const mine = JSON.parse(
      (await app.inject({ method: "GET", url: `${API}/questions/mine`, headers: { cookie: actor.cookie } }))
        .body
    );
    expect(mine.nonNegotiablesUsed).toBe(0);
  });
});

// The point of all of it: answers have to reach the score.
describe("what the answers do", () => {
  it("surfaces a clash on one of their non-negotiables, without saying what", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    const candidate = await makeActor(app, "c@test.local", asWoman);

    // She will only meet someone who has decided marriage is the point.
    await answer(candidate, "marriage", {
      answer: "the point",
      acceptable: ["the point"],
      isNonNegotiable: true,
    });
    // He has not decided.
    await answer(viewer, "marriage", { answer: "I have not decided" });

    resetRateLimits();
    const res = await app.inject({
      method: "GET",
      url: `${API}/discovery`,
      headers: { cookie: viewer.cookie },
    });

    const body = JSON.parse(res.body);
    expect(body.profile.id).toBe(candidate.profileId);
    expect(body.why.nonNegotiableConflict).toBe(true);
    // The FACT of the clash, never its content — that would leak her answer.
    expect(res.body).not.toContain("the point");
    expect(res.body).not.toContain("Marriage is");
  });

  it("reports no clash when the answer is acceptable to them", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    const candidate = await makeActor(app, "c@test.local", asWoman);

    await answer(candidate, "marriage", {
      answer: "the point",
      acceptable: ["the point", "possible"],
      isNonNegotiable: true,
    });
    await answer(viewer, "marriage", { answer: "possible" });

    resetRateLimits();
    const body = JSON.parse(
      (await app.inject({ method: "GET", url: `${API}/discovery`, headers: { cookie: viewer.cookie } }))
        .body
    );

    expect(body.why.nonNegotiableConflict).toBe(false);
  });
});
