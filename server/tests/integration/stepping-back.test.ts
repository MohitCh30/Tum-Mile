import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, likes, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { API, makeActor, type Actor } from "../helpers.js";

/**
 * Three ways to step back that did not exist: pausing instead of deleting
 * the account, taking a sent like back, and seeing where the six went.
 *
 * The recurring risk in all three is a surveillance signal smuggled in —
 * a paused person being distinguishable from an absent one, or a sender
 * learning that their like has been READ. These say that does not happen.
 */

let app: FastifyInstance;

const LINE = "I read too late and apologise for it in the morning.";

async function pair(): Promise<{ a: Actor; b: Actor }> {
  const a = await makeActor(app, "a@test.local", { gender: "man", seeking: ["woman"] });
  const b = await makeActor(app, "b@test.local", { gender: "woman", seeking: ["man"] });
  return { a, b };
}

function like(cookie: string, profileId: string, message = "which part") {
  resetRateLimits();
  return app.inject({
    method: "POST",
    url: `${API}/likes`,
    headers: { cookie },
    payload: { profileId, quotedLine: LINE, message },
  });
}

function discovery(cookie: string) {
  resetRateLimits();
  return app.inject({ method: "GET", url: `${API}/discovery`, headers: { cookie } });
}

function pause(cookie: string, paused: boolean) {
  resetRateLimits();
  return app.inject({
    method: "PUT",
    url: `${API}/account/pause`,
    headers: { cookie },
    payload: { paused },
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

describe("stepping away", () => {
  it("takes you out of other people's discovery, and puts you back", async () => {
    const { a, b } = await pair();

    const before = await discovery(a.cookie);
    expect(JSON.parse(before.body).profile?.id).toBe(b.profileId);

    expect((await pause(b.cookie, true)).statusCode).toBe(200);

    const during = await discovery(a.cookie);
    expect(JSON.parse(during.body).profile).toBeNull();
    expect(JSON.parse(during.body).reason).toBe("nobody_new");

    await pause(b.cookie, false);
    const after = await discovery(a.cookie);
    expect(JSON.parse(after.body).profile?.id).toBe(b.profileId);
  });

  it("is symmetric — you cannot browse while nobody can see you", async () => {
    const { a, b } = await pair();
    await pause(b.cookie, true);

    const res = await discovery(b.cookie);
    expect(JSON.parse(res.body).profile).toBeNull();
    // Told plainly, because the reason is a switch they can undo. Saying
    // "nobody new" to a paused person would be a lie of omission.
    expect(JSON.parse(res.body).reason).toBe("paused");
    expect(a).toBeDefined();
  });

  it("refuses a like aimed at somebody who has stepped away", async () => {
    const { a, b } = await pair();
    await pause(b.cookie, true);

    const res = await like(a.cookie, b.profileId);
    expect(res.statusCode).toBe(404);
  });

  it("stops you sending one while you are away", async () => {
    const { a, b } = await pair();
    await pause(a.cookie, true);

    // The inbound queue is still reachable while paused, so without a
    // guard here someone who had stepped away could answer a letter and
    // be pulled into a conversation they had opted out of.
    const res = await like(a.cookie, b.profileId);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("PAUSED");
  });

  it("leaves an existing conversation alone", async () => {
    const { a, b } = await pair();
    await like(a.cookie, b.profileId);
    const second = await like(b.cookie, a.profileId, "the philosophy");
    const matchId = JSON.parse(second.body).matchId as string;

    await pause(b.cookie, true);

    // Pausing is not leaving: both of them can still reach what they had.
    for (const who of [a, b]) {
      resetRateLimits();
      const read = await app.inject({
        method: "GET",
        url: `${API}/matches/${matchId}/messages`,
        headers: { cookie: who.cookie },
      });
      expect(read.statusCode).toBe(200);
    }

    resetRateLimits();
    const said = await app.inject({
      method: "POST",
      url: `${API}/matches/${matchId}/messages`,
      headers: { cookie: b.cookie },
      payload: { body: "Still here, just not looking." },
    });
    expect(said.statusCode).toBe(201);
  });
});

describe("taking a like back", () => {
  it("removes the words but keeps the day's like spent", async () => {
    const a = await makeActor(app, "a@test.local", { gender: "man", seeking: ["woman"] });
    const b = await makeActor(app, "b@test.local", { gender: "woman", seeking: ["man"] });
    const c = await makeActor(app, "c@test.local", { gender: "woman", seeking: ["man"] });

    const first = await like(a.cookie, b.profileId, "Something I regret saying.");
    expect(JSON.parse(first.body).budget.used).toBe(1);

    resetRateLimits();
    const took = await app.inject({
      method: "DELETE",
      url: `${API}/likes/${b.profileId}`,
      headers: { cookie: a.cookie },
    });
    expect(took.statusCode).toBe(204);

    const [row] = await db
      .select()
      .from(likes)
      .where(and(eq(likes.likerProfileId, a.profileId), eq(likes.likedProfileId, b.profileId)));
    expect(row.status).toBe("withdrawn");
    expect(row.openingMessage).toBe("");
    expect(row.quotedLine).toBe("");

    // The row survives, so the next like is the SECOND of six rather than
    // the first again — otherwise withdrawing would buy unlimited tries.
    const next = await like(a.cookie, c.profileId);
    expect(JSON.parse(next.body).budget.used).toBe(2);
  });

  it("cannot complete a match afterwards", async () => {
    const { a, b } = await pair();
    await like(a.cookie, b.profileId);

    resetRateLimits();
    await app.inject({
      method: "DELETE",
      url: `${API}/likes/${b.profileId}`,
      headers: { cookie: a.cookie },
    });

    // B answers a message that no longer exists; that must not be a match.
    const back = await like(b.cookie, a.profileId, "the philosophy");
    expect(JSON.parse(back.body).matched).toBe(false);
    expect(JSON.parse(back.body).matchId).toBeNull();
  });

  it("is refused once it has become a match, and to everyone else", async () => {
    const { a, b } = await pair();
    const stranger = await makeActor(app, "c@test.local", { gender: "man", seeking: ["woman"] });

    await like(a.cookie, b.profileId);
    await like(b.cookie, a.profileId, "the philosophy");

    // Now matched: the way out is leaving the match, not un-saying the like.
    resetRateLimits();
    const late = await app.inject({
      method: "DELETE",
      url: `${API}/likes/${b.profileId}`,
      headers: { cookie: a.cookie },
    });
    expect(late.statusCode).toBe(404);

    resetRateLimits();
    const notYours = await app.inject({
      method: "DELETE",
      url: `${API}/likes/${b.profileId}`,
      headers: { cookie: stranger.cookie },
    });
    expect(notYours.statusCode).toBe(404);
  });
});

describe("what you sent", () => {
  it("lists what is still waiting, and says nothing about being read", async () => {
    const { a, b } = await pair();
    await like(a.cookie, b.profileId, "The ending annoyed me.");

    resetRateLimits();
    const res = await app.inject({
      method: "GET",
      url: `${API}/likes/sent`,
      headers: { cookie: a.cookie },
    });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body) as { likes: Record<string, unknown>[] };
    expect(body.likes).toHaveLength(1);
    expect(body.likes[0].message).toBe("The ending annoyed me.");

    // The pending/surfaced distinction is real in the database and must
    // never reach the sender: that is a read receipt by another name.
    expect(Object.keys(body.likes[0])).not.toContain("status");
    expect(Object.keys(body.likes[0])).not.toContain("surfacedAt");
    expect(JSON.stringify(body)).not.toContain("surfaced");
  });

  it("drops the ones that were taken back", async () => {
    const { a, b } = await pair();
    await like(a.cookie, b.profileId);

    resetRateLimits();
    await app.inject({
      method: "DELETE",
      url: `${API}/likes/${b.profileId}`,
      headers: { cookie: a.cookie },
    });

    resetRateLimits();
    const res = await app.inject({
      method: "GET",
      url: `${API}/likes/sent`,
      headers: { cookie: a.cookie },
    });
    expect(JSON.parse(res.body).likes).toHaveLength(0);
  });
});
