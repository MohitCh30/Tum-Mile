import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, reports, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { API, makeActor, type Actor } from "../helpers.js";

/**
 * Reporting a letter you have not answered.
 *
 * Before a match there is no conversation to cite, but a stranger has
 * already written to you — that opening message is the only thing they
 * could have said, and so the only evidence a report at this stage can
 * carry. Without it the moderator receives a reason and nothing else.
 *
 * The authorization rule is the same one conversations use: you may only
 * hand over something written TO you, BY the person you are reporting.
 */

let app: FastifyInstance;

const LINE = "I read too late and apologise for it in the morning.";
const asMan = { gender: "man", seeking: ["woman"] };
const asWoman = { gender: "woman", seeking: ["man"] };

/** Sends a letter from one to the other and returns its id as the RECIPIENT sees it. */
async function letter(from: Actor, to: Actor, message: string): Promise<string> {
  resetRateLimits();
  await app.inject({
    method: "POST",
    url: `${API}/likes`,
    headers: { cookie: from.cookie },
    payload: { profileId: to.profileId, quotedLine: LINE, message },
  });
  resetRateLimits();
  const inbound = await app.inject({
    method: "GET",
    url: `${API}/likes/inbound`,
    headers: { cookie: to.cookie },
  });
  return JSON.parse(inbound.body).likes[0].id as string;
}

function report(actor: Actor, body: Record<string, unknown>) {
  resetRateLimits();
  return app.inject({
    method: "POST",
    url: `${API}/reports`,
    headers: { cookie: actor.cookie },
    payload: { reason: "harassment", ...body },
  });
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

beforeEach(async () => {
  await db.delete(authUsers);
  resetRateLimits();
});

describe("reporting an unanswered letter", () => {
  it("keeps what they wrote, so the report is not a bare accusation", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);
    const id = await letter(a, b, "send me money for a flight");

    const res = await report(b, { profileId: a.profileId, likeId: id });
    expect(res.statusCode).toBe(201);

    const [filed] = await db
      .select()
      .from(reports)
      .where(eq(reports.id, JSON.parse(res.body).id));

    expect(filed.evidence).toHaveLength(1);
    expect(filed.evidence[0].body).toBe("send me money for a flight");
    expect(filed.evidence[0].source).toBe("letter");
  });

  it("refuses a letter that was written to somebody else", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);
    const c = await makeActor(app, "c@test.local", asWoman);
    const toB = await letter(a, b, "a thing said to B alone");

    // C reporting A is allowed in itself; citing a letter C never received
    // is not. Otherwise any id would hand over anyone's private writing.
    const res = await report(c, { profileId: a.profileId, likeId: toB });
    expect(res.statusCode).toBe(404);
  });

  it("refuses a letter the reporter wrote themselves", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);
    const mine = await letter(a, b, "something I said");

    // A reporting B while citing A's OWN letter. The words are the
    // reporter's, so they are not evidence about anybody else.
    const res = await report(a, { profileId: b.profileId, likeId: mine });
    expect(res.statusCode).toBe(404);
  });

  it("still refuses a report about yourself", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);
    const id = await letter(a, b, "hello");

    const res = await report(b, { profileId: b.profileId, likeId: id });
    expect(res.statusCode).toBe(400);
  });
});
