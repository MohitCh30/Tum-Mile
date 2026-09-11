import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, auditEvents, profiles, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { API, makeActor, signUp, type Actor } from "../helpers.js";

// vitest.config.ts sets ADMIN_EMAIL to this address.
const ADMIN = "admin@tummile.local";

let app: FastifyInstance;
let admin: string;

const report = (by: Actor, about: Actor) =>
  app.inject({
    method: "POST",
    url: `${API}/reports`,
    headers: { cookie: by.cookie },
    payload: { profileId: about.profileId, reason: "harassment" },
  });

const queue = async (cookie = admin) => {
  const res = await app.inject({ method: "GET", url: `${API}/admin/cases`, headers: { cookie } });
  return { status: res.statusCode, cases: res.statusCode === 200 ? JSON.parse(res.body).cases : [] };
};

const reportsOn = async (caseId: string) => {
  const res = await app.inject({
    method: "GET",
    url: `${API}/admin/cases/${caseId}/reports`,
    headers: { cookie: admin },
  });
  return JSON.parse(res.body).reports as { id: string; status: string }[];
};

const decide = (reportId: string, decision: "actioned" | "dismissed") =>
  app.inject({
    method: "PATCH",
    url: `${API}/admin/reports/${reportId}`,
    headers: { cookie: admin },
    payload: { decision },
  });

const statusOf = async (actor: Actor) =>
  (await db.select().from(profiles).where(eq(profiles.id, actor.profileId)))[0].moderationStatus;

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
  await db.delete(auditEvents);
  resetRateLimits();
  admin = await signUp(app, ADMIN);
});

async function cast() {
  const target = await makeActor(app, "target@test.local", { gender: "man", seeking: ["woman"] });
  const b = await makeActor(app, "b@test.local");
  const c = await makeActor(app, "c@test.local");
  resetRateLimits();
  return { target, b, c };
}

describe("who is the moderator", () => {
  it("GET /me says so to the moderator, and to nobody else", async () => {
    const { b } = await cast();
    const me = async (cookie: string) =>
      JSON.parse((await app.inject({ method: "GET", url: `${API}/me`, headers: { cookie } })).body);

    expect((await me(admin)).isAdmin).toBe(true);
    expect((await me(b.cookie)).isAdmin).toBe(false);
  });

  // The screen is only offered; the server is the lock.
  it("refuses the queue and every decision to anyone else", async () => {
    const { target, b } = await cast();
    await report(b, target);

    expect((await queue(b.cookie)).status).toBe(404);
    const [c] = (await queue()).cases;
    const [r] = await reportsOn(c.id);

    for (const res of [
      await app.inject({ method: "GET", url: `${API}/admin/cases/${c.id}/reports`, headers: { cookie: b.cookie } }),
      await app.inject({
        method: "PATCH",
        url: `${API}/admin/reports/${r.id}`,
        headers: { cookie: b.cookie },
        payload: { decision: "dismissed" },
      }),
      await app.inject({
        method: "PATCH",
        url: `${API}/admin/profiles/${target.profileId}`,
        headers: { cookie: target.cookie },
        payload: { moderationStatus: "active" },
      }),
    ]) {
      expect(res.statusCode).toBe(404);
    }
  });
});

describe("the queue", () => {
  // Regression: dismissing one report closed the whole case, and a second
  // report still waiting on the same person vanished from the queue.
  it("keeps a case open while anything on it is still waiting", async () => {
    const { target, b, c } = await cast();
    await report(b, target);
    resetRateLimits();
    await report(c, target);

    let [open] = (await queue()).cases;
    expect(open.pending).toBe(2);

    const [first] = await reportsOn(open.id);
    await decide(first.id, "dismissed");

    [open] = (await queue()).cases;
    expect(open).toBeDefined();
    expect(open.pending).toBe(1);
  });

  // Regression: strikes lived on the case, so a case that closed took its
  // count with it and "two strikes" could never arrive.
  it("counts strikes across cases, and restricts on the second", async () => {
    const { target, b } = await cast();

    await report(b, target);
    let [open] = (await queue()).cases;
    const first = JSON.parse((await decide((await reportsOn(open.id))[0].id, "actioned")).body);
    expect(first).toMatchObject({ strikes: 1, restricted: false });
    // Nothing waiting any more, so the case closed.
    expect((await queue()).cases).toHaveLength(0);

    resetRateLimits();
    await report(b, target);
    [open] = (await queue()).cases;
    expect(open.strikes).toBe(1);

    const pending = (await reportsOn(open.id)).find((r) => r.status === "submitted")!;
    const second = JSON.parse((await decide(pending.id, "actioned")).body);
    expect(second).toMatchObject({ strikes: 2, restricted: true });
    expect(await statusOf(target)).toBe("restricted");
  });

  it("never softens a suspension into a restriction", async () => {
    const { target, b } = await cast();
    await app.inject({
      method: "PATCH",
      url: `${API}/admin/profiles/${target.profileId}`,
      headers: { cookie: admin },
      payload: { moderationStatus: "suspended" },
    });

    for (let i = 0; i < 2; i++) {
      resetRateLimits();
      await report(b, target);
      const [open] = (await queue()).cases;
      const pending = (await reportsOn(open.id)).find((r) => r.status === "submitted")!;
      await decide(pending.id, "actioned");
    }

    expect(await statusOf(target)).toBe("suspended");
  });

  it("will not decide the same report twice", async () => {
    const { target, b } = await cast();
    await report(b, target);
    const [open] = (await queue()).cases;
    const [r] = await reportsOn(open.id);

    expect((await decide(r.id, "actioned")).statusCode).toBe(200);
    expect((await decide(r.id, "actioned")).statusCode).toBe(400);
  });
});
