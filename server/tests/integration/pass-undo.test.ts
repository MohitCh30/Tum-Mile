import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, passes, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { API, makeActor } from "../helpers.js";

/**
 * Taking back a pass that was a finger in the wrong place — and only
 * that. The window is what keeps this from being a second go at a
 * decision, so the test that matters most is the one that proves an old
 * pass stands.
 */

let app: FastifyInstance;

const asMan = { gender: "man", seeking: ["woman"] };
const asWoman = { gender: "woman", seeking: ["man"] };

const call = (method: "GET" | "POST" | "DELETE", url: string, cookie: string, payload?: unknown) => {
  resetRateLimits();
  return app.inject({ method, url: `${API}${url}`, headers: { cookie }, ...(payload ? { payload } : {}) });
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

describe("taking back a pass", () => {
  it("puts somebody back in view who was passed a moment ago", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);

    // She is the only candidate, so discovery is a clean signal here.
    const before = await call("GET", "/discovery", a.cookie);
    expect(JSON.parse(before.body).profile?.id).toBe(b.profileId);

    expect((await call("POST", "/passes", a.cookie, { profileId: b.profileId })).statusCode).toBe(
      204
    );
    expect(JSON.parse((await call("GET", "/discovery", a.cookie)).body).profile).toBeFalsy();

    const undone = await call("DELETE", `/passes/${b.profileId}`, a.cookie);
    expect(undone.statusCode).toBe(204);

    const after = await call("GET", "/discovery", a.cookie);
    expect(JSON.parse(after.body).profile?.id).toBe(b.profileId);
  });

  it("refuses a pass that is old enough to have been meant", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);

    await call("POST", "/passes", a.cookie, { profileId: b.profileId });
    // Older than any plausible window. This is the whole point of the
    // feature: a mistap is correctable, a decision is not.
    await db
      .update(passes)
      .set({ createdAt: new Date(Date.now() - 86_400_000) })
      .where(eq(passes.passerProfileId, a.profileId));

    expect((await call("DELETE", `/passes/${b.profileId}`, a.cookie)).statusCode).toBe(404);
    // And she stays gone.
    expect(JSON.parse((await call("GET", "/discovery", a.cookie)).body).profile).toBeFalsy();
  });

  it("refuses a pass somebody else made", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);
    const c = await makeActor(app, "c@test.local", asMan);

    await call("POST", "/passes", a.cookie, { profileId: b.profileId });

    expect((await call("DELETE", `/passes/${b.profileId}`, c.cookie)).statusCode).toBe(404);
    // A's pass is untouched by C having asked.
    expect(JSON.parse((await call("GET", "/discovery", a.cookie)).body).profile).toBeFalsy();
  });

  it("refuses a pass that was never made", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);

    expect((await call("DELETE", `/passes/${b.profileId}`, a.cookie)).statusCode).toBe(404);
  });
});
