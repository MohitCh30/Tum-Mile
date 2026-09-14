import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/index.js";
import { db, authUsers, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { API, makeActor, signUp } from "../helpers.js";

/**
 * Two things you should be able to do to your own account without
 * dismantling it: read yourself the way everyone else does, and remove
 * everyone who is signed in as you.
 */

let app: FastifyInstance;

const asMan = { gender: "man", seeking: ["woman"] };

const get = (url: string, cookie?: string) => {
  resetRateLimits();
  return app.inject({ method: "GET", url: `${API}${url}`, headers: cookie ? { cookie } : {} });
};

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

describe("reading yourself as others read you", () => {
  it("is the stored profile in the shape everybody else receives", async () => {
    const a = await makeActor(app, "a@test.local", { ...asMan, oneLine: "One true sentence." });

    const res = await get("/profile/preview", a.cookie);
    expect(res.statusCode).toBe(200);

    const { profile } = JSON.parse(res.body);
    expect(profile.id).toBe(a.profileId);
    expect(profile.oneLine).toBe("One true sentence.");
    // The public shape, not the private one: no coarse location and no
    // embedding, the two things the own-profile route also withholds.
    expect(profile.locationGeohash).toBeUndefined();
    expect(profile.embedding).toBeUndefined();
    // You are not a distance from yourself.
    expect(profile.distance).toBeNull();
  });

  it("is refused before there is a profile to read", async () => {
    const cookie = await signUp(app, "nobody@test.local");
    expect((await get("/profile/preview", cookie)).statusCode).not.toBe(200);
  });

  it("is refused without a session", async () => {
    expect((await get("/profile/preview")).statusCode).toBe(401);
  });

  it("still refuses your own id on the route meant for other people", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    // The separate preview route exists precisely so this rule stays whole.
    expect((await get(`/profiles/${a.profileId}`, a.cookie)).statusCode).toBe(404);
  });
});

describe("signing out everywhere", () => {
  it("ends the other browser as well as this one", async () => {
    const first = await signUp(app, "a@test.local");
    const second = await signUp(app, "a@test.local");

    // Both are live to begin with, or the test proves nothing.
    expect((await get("/me", first)).statusCode).toBe(200);
    expect((await get("/me", second)).statusCode).toBe(200);

    resetRateLimits();
    const ended = await app.inject({
      method: "DELETE",
      url: `${API}/account/sessions`,
      headers: { cookie: second },
    });
    expect(ended.statusCode).toBe(204);

    // The point of the feature: the session that did NOT ask is gone too.
    expect((await get("/me", first)).statusCode).toBe(401);
    expect((await get("/me", second)).statusCode).toBe(401);
  });

  it("is refused without a session", async () => {
    resetRateLimits();
    const res = await app.inject({ method: "DELETE", url: `${API}/account/sessions` });
    expect(res.statusCode).toBe(401);
  });
});
