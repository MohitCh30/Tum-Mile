import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, blocks, messages, sceneSessions, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { API, makeActor, type Actor } from "../helpers.js";

/**
 * Leaving a match was missing entirely: the only exit from a conversation
 * was to block, which is built for someone who frightens you. These say
 * that the quiet exit is genuinely as thorough as the loud one, and that
 * it is still refused to everyone it should be refused to.
 */

let app: FastifyInstance;

const LINE = "I read too late and apologise for it in the morning.";

async function matchedPair(): Promise<{ a: Actor; b: Actor; matchId: string }> {
  const a = await makeActor(app, "a@test.local", { gender: "man", seeking: ["woman"] });
  const b = await makeActor(app, "b@test.local", { gender: "woman", seeking: ["man"] });
  resetRateLimits();
  await app.inject({
    method: "POST",
    url: `${API}/likes`,
    headers: { cookie: a.cookie },
    payload: { profileId: b.profileId, quotedLine: LINE, message: "which part" },
  });
  resetRateLimits();
  const second = await app.inject({
    method: "POST",
    url: `${API}/likes`,
    headers: { cookie: b.cookie },
    payload: { profileId: a.profileId, quotedLine: LINE, message: "the philosophy" },
  });
  return { a, b, matchId: JSON.parse(second.body).matchId };
}

async function say(cookie: string, matchId: string, body: string) {
  resetRateLimits();
  return app.inject({
    method: "POST",
    url: `${API}/matches/${matchId}/messages`,
    headers: { cookie },
    payload: { body },
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

describe("leaving a match", () => {
  it("ends it for both people and keeps nothing", async () => {
    const { a, b, matchId } = await matchedPair();
    await say(a.cookie, matchId, "What did you make of the ending?");
    await say(b.cookie, matchId, "I am still deciding.");

    resetRateLimits();
    const left = await app.inject({
      method: "DELETE",
      url: `${API}/matches/${matchId}`,
      headers: { cookie: a.cookie },
    });
    expect(left.statusCode).toBe(204);

    expect(await db.select().from(messages).where(eq(messages.matchId, matchId))).toHaveLength(0);

    // Gone from the list for the one who stayed, not only the one who left.
    for (const who of [a, b]) {
      resetRateLimits();
      const list = await app.inject({
        method: "GET",
        url: `${API}/matches`,
        headers: { cookie: who.cookie },
      });
      expect(JSON.parse(list.body).matches).toHaveLength(0);
    }
  });

  it("leaves neither of them able to read or write there afterwards", async () => {
    const { a, b, matchId } = await matchedPair();
    await say(a.cookie, matchId, "A thing I said before leaving.");

    resetRateLimits();
    await app.inject({
      method: "DELETE",
      url: `${API}/matches/${matchId}`,
      headers: { cookie: a.cookie },
    });

    for (const who of [a, b]) {
      resetRateLimits();
      const read = await app.inject({
        method: "GET",
        url: `${API}/matches/${matchId}/messages`,
        headers: { cookie: who.cookie },
      });
      expect(read.statusCode).toBe(404);

      const wrote = await say(who.cookie, matchId, "Are you there?");
      expect(wrote.statusCode).toBe(404);
    }
  });

  it("takes the scene with it", async () => {
    const { a, b, matchId } = await matchedPair();
    resetRateLimits();
    const proposed = await app.inject({
      method: "POST",
      url: `${API}/scenes`,
      headers: { cookie: a.cookie },
      payload: { matchId, premiseId: "candlelight" },
    });
    expect(proposed.statusCode).toBe(201);

    resetRateLimits();
    await app.inject({
      method: "DELETE",
      url: `${API}/matches/${matchId}`,
      headers: { cookie: b.cookie },
    });

    expect(
      await db.select().from(sceneSessions).where(eq(sceneSessions.matchId, matchId))
    ).toHaveLength(0);
  });

  it("is refused to somebody who was never in it", async () => {
    const { matchId } = await matchedPair();
    const stranger = await makeActor(app, "c@test.local", { gender: "man", seeking: ["woman"] });

    resetRateLimits();
    const res = await app.inject({
      method: "DELETE",
      url: `${API}/matches/${matchId}`,
      headers: { cookie: stranger.cookie },
    });
    // The same 404 a match that never existed would answer, so the reply
    // never confirms that these two people are talking.
    expect(res.statusCode).toBe(404);
  });

  it("is refused without a session", async () => {
    const { matchId } = await matchedPair();
    resetRateLimits();
    const res = await app.inject({ method: "DELETE", url: `${API}/matches/${matchId}` });
    expect(res.statusCode).toBe(401);
  });

  it("cannot be done twice, and does not bar the other person", async () => {
    const { a, b, matchId } = await matchedPair();

    resetRateLimits();
    const first = await app.inject({
      method: "DELETE",
      url: `${API}/matches/${matchId}`,
      headers: { cookie: a.cookie },
    });
    expect(first.statusCode).toBe(204);

    resetRateLimits();
    const again = await app.inject({
      method: "DELETE",
      url: `${API}/matches/${matchId}`,
      headers: { cookie: b.cookie },
    });
    expect(again.statusCode).toBe(404);

    // The difference from blocking: no bar is created either way.
    expect(await db.select().from(blocks).where(eq(blocks.blockerId, a.profileId))).toHaveLength(0);
    expect(await db.select().from(blocks).where(eq(blocks.blockerId, b.profileId))).toHaveLength(0);
  });
});
