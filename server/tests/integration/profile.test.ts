import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, profiles, blocks, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { API, makeActor, signUp } from "../helpers.js";

let app: FastifyInstance;

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

describe("writing your own profile", () => {
  it("creates one and reports what is still missing", async () => {
    const cookie = await signUp(app, "new@test.local");

    const res = await app.inject({
      method: "PUT",
      url: `${API}/profile`,
      headers: { cookie },
      payload: {
        displayName: "Meher",
        birthDate: new Date(Date.UTC(1998, 3, 2)).toISOString(),
        gender: "woman",
        seeking: ["man"],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.complete).toBe(false);
    expect(body.missing).toContain("oneLine");
    expect(body.missing).toContain("form");
  });

  it("refuses anyone under 18, whatever the form says", async () => {
    const cookie = await signUp(app, "young@test.local");
    const res = await app.inject({
      method: "PUT",
      url: `${API}/profile`,
      headers: { cookie },
      payload: {
        displayName: "Too young",
        birthDate: new Date(Date.UTC(new Date().getUTCFullYear() - 16, 0, 1)).toISOString(),
        gender: "man",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a one-line over 90 characters", async () => {
    const cookie = await signUp(app, "verbose@test.local");
    const res = await app.inject({
      method: "PUT",
      url: `${API}/profile`,
      headers: { cookie },
      payload: { oneLine: "x".repeat(91) },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses an answer to a prompt that does not exist", async () => {
    const cookie = await signUp(app, "inventive@test.local");
    const res = await app.inject({
      method: "PUT",
      url: `${API}/profile`,
      headers: { cookie },
      payload: { promptAnswers: [{ promptId: "made-up-prompt", answer: "hello" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses more than three answers, and refuses duplicates", async () => {
    const cookie = await signUp(app, "chatty@test.local");

    const tooMany = await app.inject({
      method: "PUT",
      url: `${API}/profile`,
      headers: { cookie },
      payload: {
        promptAnswers: [
          { promptId: "tabs", answer: "a" },
          { promptId: "tuesday", answer: "b" },
          { promptId: "reread", answer: "c" },
          { promptId: "cannot-sleep", answer: "d" },
        ],
      },
    });
    expect(tooMany.statusCode).toBe(400);

    const duplicated = await app.inject({
      method: "PUT",
      url: `${API}/profile`,
      headers: { cookie },
      payload: {
        promptAnswers: [
          { promptId: "tabs", answer: "a" },
          { promptId: "tabs", answer: "b" },
        ],
      },
    });
    expect(duplicated.statusCode).toBe(400);
  });

  // Mass assignment: the write is built field by field from an allowlist,
  // so these are unreachable rather than merely unmentioned.
  it("ignores fields the client is not allowed to set", async () => {
    const actor = await makeActor(app, "sneaky@test.local");
    const other = await makeActor(app, "victim@test.local");

    const res = await app.inject({
      method: "PUT",
      url: `${API}/profile`,
      headers: { cookie: actor.cookie },
      payload: {
        displayName: "Still me",
        id: other.profileId,
        authUserId: "someone-else",
        moderationStatus: "suspended",
        createdAt: new Date(2000, 0, 1).toISOString(),
      },
    });

    expect(res.statusCode).toBe(200);

    const [row] = await db.select().from(profiles).where(eq(profiles.id, actor.profileId));
    expect(row.id).toBe(actor.profileId);
    expect(row.moderationStatus).toBe("active");
    expect(row.displayName).toBe("Still me");

    const [victim] = await db.select().from(profiles).where(eq(profiles.id, other.profileId));
    expect(victim.moderationStatus).toBe("active");
  });

  // Data minimisation: the coordinate is used to compute a cell and then
  // dropped. There is no column it could have survived in.
  it("keeps a coarse cell and never the coordinates it came from", async () => {
    const actor = await makeActor(app, "located@test.local", {
      location: { lat: 19.0759837, lon: 72.8776559 },
    });

    const [row] = await db.select().from(profiles).where(eq(profiles.id, actor.profileId));
    expect(row.locationGeohash).toHaveLength(5);
    expect(JSON.stringify(row)).not.toContain("19.0759837");
    expect(JSON.stringify(row)).not.toContain("72.8776559");
  });
});

describe("reading someone else's profile", () => {
  it("needs a profile of your own", async () => {
    const target = await makeActor(app, "target@test.local");
    const lurker = await signUp(app, "lurker@test.local");

    const res = await app.inject({
      method: "GET",
      url: `${API}/profiles/${target.profileId}`,
      headers: { cookie: lurker },
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("NO_PROFILE");
  });

  it("returns only what a stranger has earned", async () => {
    const viewer = await makeActor(app, "viewer@test.local", { gender: "man", seeking: ["woman"] });
    const target = await makeActor(app, "seen@test.local");

    const res = await app.inject({
      method: "GET",
      url: `${API}/profiles/${target.profileId}`,
      headers: { cookie: viewer.cookie },
    });

    expect(res.statusCode).toBe(200);
    const { profile } = JSON.parse(res.body);
    expect(profile.displayName).toBeDefined();
    expect(profile.distance).toBe("close by");

    const serialised = JSON.stringify(profile);
    expect(serialised).not.toContain("seen@test.local");
    expect(serialised).not.toContain("authUserId");
    expect(serialised).not.toContain("locationGeohash");
    expect(profile.email).toBeUndefined();
  });

  it("hides distance when that person turned it off", async () => {
    const viewer = await makeActor(app, "v2@test.local", { gender: "man", seeking: ["woman"] });
    const target = await makeActor(app, "private@test.local");

    await app.inject({
      method: "PUT",
      url: `${API}/profile`,
      headers: { cookie: target.cookie },
      payload: { privacy: { showDistance: false } },
    });

    const res = await app.inject({
      method: "GET",
      url: `${API}/profiles/${target.profileId}`,
      headers: { cookie: viewer.cookie },
    });
    expect(JSON.parse(res.body).profile.distance).toBeNull();
  });

  // A block answers the same 404 as a profile that does not exist, so the
  // response cannot confirm someone is still on the platform.
  it("is refused in both directions of a block, and looks like a 404", async () => {
    const a = await makeActor(app, "blocker@test.local", { gender: "man", seeking: ["woman"] });
    const b = await makeActor(app, "blocked@test.local");

    await db.insert(blocks).values({ blockerId: a.profileId, blockedId: b.profileId });

    const forward = await app.inject({
      method: "GET",
      url: `${API}/profiles/${b.profileId}`,
      headers: { cookie: a.cookie },
    });
    const backward = await app.inject({
      method: "GET",
      url: `${API}/profiles/${a.profileId}`,
      headers: { cookie: b.cookie },
    });
    const missing = await app.inject({
      method: "GET",
      url: `${API}/profiles/does-not-exist`,
      headers: { cookie: a.cookie },
    });

    expect(forward.statusCode).toBe(404);
    expect(backward.statusCode).toBe(404);
    expect(forward.body).toBe(missing.body);
    expect(backward.body).toBe(missing.body);
  });

  it("will not serve you your own profile through the stranger route", async () => {
    const actor = await makeActor(app, "self@test.local");
    const res = await app.inject({
      method: "GET",
      url: `${API}/profiles/${actor.profileId}`,
      headers: { cookie: actor.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
