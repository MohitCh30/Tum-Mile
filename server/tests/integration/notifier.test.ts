import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/index.js";
import { db, authUsers, auditEvents, reports, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { notifyModerator, sendDigests } from "../../src/services/notifier.js";
import { API, makeActor, type Actor } from "../helpers.js";

let app: FastifyInstance;

const LINE = "I read too late and apologise for it in the morning.";

const optIn = (actor: Actor, on = true) =>
  app.inject({
    method: "PUT",
    url: `${API}/account/notifications`,
    headers: { cookie: actor.cookie },
    payload: { emailWhenWaiting: on },
  });

const like = (from: Actor, to: Actor) =>
  app.inject({
    method: "POST",
    url: `${API}/likes`,
    headers: { cookie: from.cookie },
    payload: { profileId: to.profileId, quotedLine: LINE, message: "which part" },
  });

async function pair() {
  const a = await makeActor(app, "a@test.local", { gender: "man", seeking: ["woman"] });
  const b = await makeActor(app, "b@test.local", { gender: "woman", seeking: ["man"] });
  resetRateLimits();
  return { a, b };
}

const later = (ms: number) => new Date(Date.now() + ms);
const DAY = 24 * 60 * 60_000;

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
});

describe("the opt-in note", () => {
  it("is off unless the person turns it on", async () => {
    const { a, b } = await pair();
    const res = await app.inject({
      method: "GET",
      url: `${API}/account/notifications`,
      headers: { cookie: b.cookie },
    });
    expect(JSON.parse(res.body)).toEqual({ emailWhenWaiting: false });

    await like(a, b);
    expect(await sendDigests(later(1000))).toBe(0);
  });

  it("goes once when something new is waiting, and not again that day", async () => {
    const { a, b } = await pair();
    expect((await optIn(b)).statusCode).toBe(200);
    await like(a, b);

    expect(await sendDigests(later(1000))).toBe(1);
    expect(await sendDigests(later(2000))).toBe(0);
  });

  // Switching it on must not produce a note about last week.
  it("does not announce what was already waiting when it was switched on", async () => {
    const { a, b } = await pair();
    await like(a, b);
    await optIn(b);

    expect(await sendDigests(later(1000))).toBe(0);
  });

  it("does not count your own actions as something waiting", async () => {
    const { a, b } = await pair();
    await optIn(a);
    await like(a, b);

    expect(await sendDigests(later(1000))).toBe(0);
  });

  it("stops when switched off", async () => {
    const { a, b } = await pair();
    await optIn(b);
    await optIn(b, false);
    await like(a, b);

    expect(await sendDigests(later(DAY * 2))).toBe(0);
  });

  // Matching copies neither opening letter into the conversation, so a
  // new match is an empty room none of the other clauses can see.
  it("counts a match that nobody has written in yet", async () => {
    const { a, b } = await pair();
    await optIn(a);
    await like(a, b);
    resetRateLimits();
    await like(b, a);

    expect(await sendDigests(later(1000))).toBe(1);
  });

  it("refuses anything but the one setting", async () => {
    const { b } = await pair();
    const res = await app.inject({
      method: "PUT",
      url: `${API}/account/notifications`,
      headers: { cookie: b.cookie },
      payload: { emailWhenWaiting: true, notifiedThrough: "1970-01-01" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("telling the moderator", () => {
  it("announces a new report once, and never again", async () => {
    const { a, b } = await pair();
    const filed = await app.inject({
      method: "POST",
      url: `${API}/reports`,
      headers: { cookie: b.cookie },
      payload: { profileId: a.profileId, reason: "harassment" },
    });
    expect(filed.statusCode).toBe(201);

    expect(await notifyModerator()).toBe(1);
    expect(await notifyModerator()).toBe(0);

    const [row] = await db.select().from(reports);
    expect(row.adminNotifiedAt).not.toBeNull();
  });
});
