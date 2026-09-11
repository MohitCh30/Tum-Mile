import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import {
  db,
  authUsers,
  reports,
  sceneSessions,
  sceneTurns,
  closeDb,
} from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { API, makeActor, type Actor } from "../helpers.js";

/**
 * Scenes were built after the safety features and were never wired into
 * them. A scene is a second place to say something to someone — so a
 * second place to harass them — and every safety promise made about
 * messages has to hold for it too.
 */

let app: FastifyInstance;

const LINE = "I read too late and apologise for it in the morning.";
const HARASSING = "You will answer me, in this scene or out of it.";
const DECENT = "The candle is nearly out.";

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

/** A scene in progress where `a` has written something `b` should not have to keep. */
async function sceneWithHarassment() {
  const pair = await matchedPair();
  const [scene] = await db
    .insert(sceneSessions)
    .values({
      matchId: pair.matchId,
      premiseId: "candlelight",
      proposedById: pair.a.profileId,
      castAId: pair.a.profileId,
      castBId: pair.b.profileId,
      status: "playing",
    })
    .returning();

  await db.insert(sceneTurns).values([
    { sessionId: scene.id, profileId: pair.b.profileId, ordinal: 0, body: DECENT },
    { sessionId: scene.id, profileId: pair.a.profileId, ordinal: 1, body: HARASSING },
  ]);

  return { ...pair, sceneId: scene.id };
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

describe("scenes and safety", () => {
  it("a block removes the scene, lines and letters, for both people", async () => {
    const { a, b, sceneId } = await sceneWithHarassment();

    const res = await app.inject({
      method: "POST",
      url: `${API}/blocks`,
      headers: { cookie: b.cookie },
      payload: { profileId: a.profileId },
    });
    expect(res.statusCode).toBe(204);

    expect(await db.select().from(sceneSessions).where(eq(sceneSessions.id, sceneId))).toHaveLength(0);
    expect(await db.select().from(sceneTurns).where(eq(sceneTurns.sessionId, sceneId))).toHaveLength(0);

    // And neither of them can reach it any more.
    const read = await app.inject({
      method: "GET",
      url: `${API}/scenes/${sceneId}`,
      headers: { cookie: a.cookie },
    });
    expect(read.statusCode).toBe(404);
  });

  it("a report captures the reported person's scene lines as evidence, and only theirs", async () => {
    const { a, b, matchId } = await sceneWithHarassment();

    const res = await app.inject({
      method: "POST",
      url: `${API}/reports`,
      headers: { cookie: b.cookie },
      payload: { profileId: a.profileId, reason: "harassment", matchId },
    });
    expect(res.statusCode).toBe(201);

    const [report] = await db.select().from(reports);
    const bodies = report.evidence.map((e) => e.body);
    expect(bodies).toContain(HARASSING);
    expect(bodies).not.toContain(DECENT);
    expect(report.evidence.find((e) => e.body === HARASSING)?.source).toBe("scene");
  });

  // The order that matters in practice: report, then block. The evidence
  // must survive the block scrubbing the scene.
  it("the evidence survives the block that follows the report", async () => {
    const { a, b, matchId } = await sceneWithHarassment();

    await app.inject({
      method: "POST",
      url: `${API}/reports`,
      headers: { cookie: b.cookie },
      payload: { profileId: a.profileId, reason: "harassment", matchId },
    });
    await app.inject({
      method: "POST",
      url: `${API}/blocks`,
      headers: { cookie: b.cookie },
      payload: { profileId: a.profileId },
    });

    const [report] = await db.select().from(reports);
    expect(report.evidence.map((e) => e.body)).toContain(HARASSING);
    expect(await db.select().from(sceneTurns)).toHaveLength(0);
  });

  it("deleting an account removes that person's scene writing and nobody else's", async () => {
    const { a, b } = await sceneWithHarassment();

    const res = await app.inject({
      method: "DELETE",
      url: `${API}/account`,
      headers: { cookie: a.cookie },
      payload: { confirm: "delete my account" },
    });
    expect(res.statusCode).toBe(204);

    expect(await db.select().from(sceneTurns).where(eq(sceneTurns.profileId, a.profileId))).toHaveLength(0);
    expect(await db.select().from(sceneTurns).where(eq(sceneTurns.profileId, b.profileId))).toHaveLength(1);
  });

  it("the export includes your own scene writing, and not the other player's", async () => {
    const { a } = await sceneWithHarassment();

    const res = await app.inject({
      method: "GET",
      url: `${API}/account/export`,
      headers: { cookie: a.cookie },
    });
    expect(res.statusCode).toBe(200);

    const bodies = JSON.parse(res.body).scenesWritten.map((s: { body: string }) => s.body);
    expect(bodies).toEqual([HARASSING]);
  });
});
