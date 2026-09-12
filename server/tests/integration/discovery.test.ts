import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, profiles, blocks, likes, matches, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { API, makeActor, signUp, type Actor } from "../helpers.js";

let app: FastifyInstance;

const LINE = "I read too late and apologise for it in the morning.";

/** A man seeking women, and a woman seeking men — mutually eligible. */
const asMan = { gender: "man", seeking: ["woman"] };
const asWoman = { gender: "woman", seeking: ["man"] };

async function discover(actor: Actor) {
  const res = await app.inject({ method: "GET", url: `${API}/discovery`, headers: { cookie: actor.cookie } });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

async function like(actor: Actor, profileId: string, line = LINE, message = "Which part annoyed you?") {
  const res = await app.inject({
    method: "POST",
    url: `${API}/likes`,
    headers: { cookie: actor.cookie },
    payload: { profileId, quotedLine: line, message },
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
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

describe("discovery", () => {
  it("shows one eligible person, with the budget stated as a fact", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    await makeActor(app, "c@test.local", asWoman);

    const { status, body } = await discover(viewer);
    expect(status).toBe(200);
    expect(body.profile.displayName).toBe("c");
    expect(body.budget).toEqual({ limit: 6, used: 0, remaining: 6 });
  });

  // Regression: gender was free text compared as an exact string, so a
  // profile saying "Female" was invisible to everyone seeking "woman" —
  // and the pair was told "nobody new", which is what the app says when it
  // is working. Both sides are stored canonically now.
  it("treats Female, F and woman as one answer", async () => {
    const viewer = await makeActor(app, "v@test.local", { gender: "Male", seeking: ["Female"] });
    await makeActor(app, "c@test.local", { gender: "F", seeking: ["M"] });

    const { body } = await discover(viewer);
    expect(body.profile.displayName).toBe("c");

    const [stored] = await db.select().from(profiles).where(eq(profiles.displayName, "c"));
    expect(stored.gender).toBe("woman");
    expect(stored.seeking).toEqual(["man"]);
  });

  it("refuses a gender it cannot place, rather than storing a word nothing matches", async () => {
    const cookie = await signUp(app, "odd@test.local");
    const res = await app.inject({
      method: "PUT",
      url: `${API}/profile`,
      headers: { cookie },
      payload: {
        displayName: "Odd",
        birthDate: new Date(Date.UTC(1996, 0, 1)).toISOString(),
        gender: "whatever",
        seeking: ["woman"],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // Symmetric: an empty profile is this product's blank photo. It neither
  // sees nor is seen.
  it("shows nobody to someone with an empty profile, and hides them from others", async () => {
    const empty = await signUp(app, "empty@test.local");
    await app.inject({
      method: "PUT",
      url: `${API}/profile`,
      headers: { cookie: empty },
      payload: {
        displayName: "Blank",
        birthDate: new Date(Date.UTC(1996, 0, 1)).toISOString(),
        gender: "woman",
        seeking: ["man"],
      },
    });

    const res = await app.inject({ method: "GET", url: `${API}/discovery`, headers: { cookie: empty } });
    expect(JSON.parse(res.body).reason).toBe("incomplete_profile");

    const viewer = await makeActor(app, "v@test.local", asMan);
    const seen = await discover(viewer);
    expect(seen.body.profile).toBeNull();
  });

  it("never shows a blocked person, in either direction", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    const hidden = await makeActor(app, "hidden@test.local", asWoman);

    await db.insert(blocks).values({ blockerId: hidden.profileId, blockedId: viewer.profileId });

    const { body } = await discover(viewer);
    expect(body.profile).toBeNull();
    expect(body.reason).toBe("nobody_new");
  });

  it("does not bring back someone you passed", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    const c = await makeActor(app, "c@test.local", asWoman);

    const passed = await app.inject({
      method: "POST",
      url: `${API}/passes`,
      headers: { cookie: viewer.cookie },
      payload: { profileId: c.profileId },
    });
    expect(passed.statusCode).toBe(204);

    expect((await discover(viewer)).body.profile).toBeNull();
  });

  it("respects the age preference in both directions", async () => {
    const viewer = await makeActor(app, "v@test.local", { ...asMan, age: 40, ageMin: 18, ageMax: 30 });
    await makeActor(app, "older@test.local", { ...asWoman, age: 45 });

    // She is outside his range, and he is outside hers by default.
    expect((await discover(viewer)).body.profile).toBeNull();
  });

  it("respects who each person is seeking", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    await makeActor(app, "notseeking@test.local", { gender: "woman", seeking: ["woman"] });

    expect((await discover(viewer)).body.profile).toBeNull();
  });

  it("publishes its ranking weights", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    const res = await app.inject({
      method: "GET",
      url: `${API}/discovery/ranking`,
      headers: { cookie: viewer.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).weights.interests).toBeGreaterThan(0);
  });
});

describe("liking", () => {
  it("must quote a line the other person actually wrote", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    const c = await makeActor(app, "c@test.local", asWoman);

    const invented = await like(viewer, c.profileId, "You seem nice, hey");
    expect(invented.status).toBe(400);

    const real = await like(viewer, c.profileId, LINE);
    expect(real.status).toBe(201);
  });

  it("can quote a line from the letter, not only the one-line", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    const c = await makeActor(app, "c@test.local", asWoman);

    const res = await like(viewer, c.profileId, "Each time it became a list.");
    expect(res.status).toBe(201);
  });

  it("refuses a like aimed at yourself", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    const res = await like(viewer, viewer.profileId);
    expect(res.status).toBe(400);
  });

  it("refuses a like at someone who blocked you, and looks like a 404", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    const c = await makeActor(app, "c@test.local", asWoman);
    await db.insert(blocks).values({ blockerId: c.profileId, blockedId: viewer.profileId });

    const res = await like(viewer, c.profileId);
    expect(res.status).toBe(404);
    expect(await db.select().from(likes)).toHaveLength(0);
  });

  // The budget is a server rule. Calling the API directly is the attack.
  it("stops at six a day when the API is called directly", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    const targets: Actor[] = [];
    for (let i = 0; i < 8; i++) {
      targets.push(await makeActor(app, `t${i}@test.local`, asWoman));
    }

    const codes: number[] = [];
    for (const target of targets) {
      resetRateLimits(); // isolate the budget from the rate limiter
      codes.push((await like(viewer, target.profileId)).status);
    }

    expect(codes.filter((c) => c === 201)).toHaveLength(6);
    expect(codes.filter((c) => c === 429)).toHaveLength(2);
    expect(await db.select().from(likes)).toHaveLength(6);
  });

  it("cannot be pushed past six by sending them all at once", async () => {
    const viewer = await makeActor(app, "v@test.local", asMan);
    const targets: Actor[] = [];
    for (let i = 0; i < 8; i++) {
      targets.push(await makeActor(app, `t${i}@test.local`, asWoman));
    }
    resetRateLimits();

    await Promise.all(
      targets.map((target) =>
        app.inject({
          method: "POST",
          url: `${API}/likes`,
          headers: { cookie: viewer.cookie },
          payload: { profileId: target.profileId, quotedLine: LINE, message: "hello there" },
        })
      )
    );

    expect(await db.select().from(likes)).toHaveLength(6);
  });
});

describe("matching", () => {
  it("creates a match when the second person reaches back", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);

    const first = await like(a, b.profileId);
    expect(first.body.matched).toBe(false);

    resetRateLimits();
    const second = await like(b, a.profileId);
    expect(second.body.matched).toBe(true);
    expect(second.body.matchId).toBeTruthy();

    expect(await db.select().from(matches)).toHaveLength(1);
  });

  // Both directions at once: without the pair lock both sides miss the
  // other's row and two people who chose each other get no match at all.
  it("produces exactly one match when both like at the same moment", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);
    resetRateLimits();

    await Promise.all([
      app.inject({
        method: "POST",
        url: `${API}/likes`,
        headers: { cookie: a.cookie },
        payload: { profileId: b.profileId, quotedLine: LINE, message: "at the same time" },
      }),
      app.inject({
        method: "POST",
        url: `${API}/likes`,
        headers: { cookie: b.cookie },
        payload: { profileId: a.profileId, quotedLine: LINE, message: "at the same time" },
      }),
    ]);

    const rows = await db.select().from(matches);
    expect(rows).toHaveLength(1);
    // Canonical ordering is what the unique pair index relies on.
    expect(rows[0].profileAId < rows[0].profileBId).toBe(true);
  });

  it("stores the match once and shows it to both people", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);
    await like(a, b.profileId);
    resetRateLimits();
    await like(b, a.profileId);

    for (const [actor, expected] of [
      [a, "b"],
      [b, "a"],
    ] as const) {
      const res = await app.inject({
        method: "GET",
        url: `${API}/matches`,
        headers: { cookie: actor.cookie },
      });
      const { matches: list } = JSON.parse(res.body);
      expect(list).toHaveLength(1);
      expect(list[0].with.displayName).toBe(expected);
    }
  });

  it("does not let a stranger read your matches", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);
    await like(a, b.profileId);
    resetRateLimits();
    await like(b, a.profileId);

    const stranger = await makeActor(app, "s@test.local", asMan);
    const res = await app.inject({
      method: "GET",
      url: `${API}/matches`,
      headers: { cookie: stranger.cookie },
    });
    expect(JSON.parse(res.body).matches).toHaveLength(0);
  });
});

describe("the inbound queue", () => {
  it("surfaces at most nine a day and keeps the rest pending", async () => {
    const receiver = await makeActor(app, "r@test.local", asWoman);

    for (let i = 0; i < 12; i++) {
      const sender = await makeActor(app, `s${i}@test.local`, asMan);
      resetRateLimits();
      const res = await like(sender, receiver.profileId);
      expect(res.status).toBe(201);
    }

    resetRateLimits();
    const res = await app.inject({
      method: "GET",
      url: `${API}/likes/inbound`,
      headers: { cookie: receiver.cookie },
    });

    const body = JSON.parse(res.body);
    expect(body.likes).toHaveLength(9);
    expect(body.budget.limit).toBe(9);

    const stillPending = (await db.select().from(likes)).filter((l) => l.status === "pending");
    expect(stillPending).toHaveLength(3);
  });

  it("carries the quoted line and the message with each one", async () => {
    const receiver = await makeActor(app, "r@test.local", asWoman);
    const sender = await makeActor(app, "s@test.local", asMan);
    resetRateLimits();
    await like(sender, receiver.profileId, LINE, "Which part annoyed you exactly?");

    resetRateLimits();
    const res = await app.inject({
      method: "GET",
      url: `${API}/likes/inbound`,
      headers: { cookie: receiver.cookie },
    });

    const [first] = JSON.parse(res.body).likes;
    expect(first.quotedLine).toBe(LINE);
    expect(first.message).toBe("Which part annoyed you exactly?");
    expect(first.from.displayName).toBe("s");
    expect(JSON.stringify(first)).not.toContain("s@test.local");
  });

  it("expires anything left waiting too long, silently", async () => {
    const receiver = await makeActor(app, "r@test.local", asWoman);
    const sender = await makeActor(app, "s@test.local", asMan);
    resetRateLimits();
    await like(sender, receiver.profileId);

    const old = new Date(Date.now() - 30 * 86_400_000);
    await db.update(likes).set({ createdAt: old }).where(eq(likes.likerProfileId, sender.profileId));

    resetRateLimits();
    const res = await app.inject({
      method: "GET",
      url: `${API}/likes/inbound`,
      headers: { cookie: receiver.cookie },
    });

    expect(JSON.parse(res.body).likes).toHaveLength(0);
    const [row] = await db.select().from(likes);
    expect(row.status).toBe("expired");
  });

  it("is refused to someone with no profile", async () => {
    const cookie = await signUp(app, "nobody@test.local");
    const res = await app.inject({
      method: "GET",
      url: `${API}/likes/inbound`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  });
});
