import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import {
  db,
  authUsers,
  profiles,
  messages,
  matches,
  reports,
  moderationCases,
  auditEvents,
  closeDb,
} from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { API, makeActor, type Actor } from "../helpers.js";

let app: FastifyInstance;

const LINE = "I read too late and apologise for it in the morning.";
const asMan = { gender: "man", seeking: ["woman"] };
const asWoman = { gender: "woman", seeking: ["man"] };

async function matchedPair(): Promise<{ a: Actor; b: Actor; matchId: string }> {
  const a = await makeActor(app, "a@test.local", asMan);
  const b = await makeActor(app, "b@test.local", asWoman);
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

const block = (actor: Actor, profileId: string) =>
  app.inject({
    method: "POST",
    url: `${API}/blocks`,
    headers: { cookie: actor.cookie },
    payload: { profileId },
  });

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
  // Audit rows carry no foreign key to auth_users — by design, so they
  // outlive a deleted account — so cascade does not reach them.
  await db.delete(auditEvents);
  resetRateLimits();
});

describe("blocking", () => {
  it("closes every surface at once, in both directions", async () => {
    const { a, b, matchId } = await matchedPair();
    expect((await block(a, b.profileId)).statusCode).toBe(204);

    const surfaces = await Promise.all([
      app.inject({ method: "GET", url: `${API}/profiles/${b.profileId}`, headers: { cookie: a.cookie } }),
      app.inject({ method: "GET", url: `${API}/profiles/${a.profileId}`, headers: { cookie: b.cookie } }),
      app.inject({ method: "GET", url: `${API}/matches/${matchId}/messages`, headers: { cookie: a.cookie } }),
      app.inject({ method: "GET", url: `${API}/matches/${matchId}/messages`, headers: { cookie: b.cookie } }),
      app.inject({
        method: "POST",
        url: `${API}/matches/${matchId}/messages`,
        headers: { cookie: b.cookie },
        payload: { body: "let me back in" },
      }),
      app.inject({
        method: "POST",
        url: `${API}/likes`,
        headers: { cookie: b.cookie },
        payload: { profileId: a.profileId, quotedLine: LINE, message: "again" },
      }),
    ]);

    for (const res of surfaces) expect(res.statusCode).toBe(404);

    for (const actor of [a, b]) {
      const seen = await app.inject({ method: "GET", url: `${API}/discovery`, headers: { cookie: actor.cookie } });
      expect(JSON.parse(seen.body).profile).toBeNull();

      const list = await app.inject({ method: "GET", url: `${API}/matches`, headers: { cookie: actor.cookie } });
      expect(JSON.parse(list.body).matches).toHaveLength(0);
    }
  });

  // The blocked person's words leave your view — and yours leave theirs,
  // because leaving them would keep a copy in front of the person you
  // just blocked.
  it("deletes the conversation for both people", async () => {
    const { a, b, matchId } = await matchedPair();

    for (const [actor, body] of [
      [a, "something he said"],
      [b, "something she said"],
    ] as const) {
      await app.inject({
        method: "POST",
        url: `${API}/matches/${matchId}/messages`,
        headers: { cookie: actor.cookie },
        payload: { body },
      });
    }
    expect(await db.select().from(messages)).toHaveLength(2);

    await block(a, b.profileId);

    expect(await db.select().from(messages)).toHaveLength(0);
    const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(match.unmatchedAt).not.toBeNull();
  });

  it("will not block yourself", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    expect((await block(a, a.profileId)).statusCode).toBe(400);
  });

  it("lists who you blocked, and never who blocked you", async () => {
    const { a, b } = await matchedPair();
    await block(a, b.profileId);

    const mine = JSON.parse(
      (await app.inject({ method: "GET", url: `${API}/blocks`, headers: { cookie: a.cookie } })).body
    );
    expect(mine.blocks).toHaveLength(1);
    expect(mine.blocks[0].name).toBe("b");

    const theirs = JSON.parse(
      (await app.inject({ method: "GET", url: `${API}/blocks`, headers: { cookie: b.cookie } })).body
    );
    expect(theirs.blocks).toHaveLength(0);
  });

  it("unblocking does not bring the conversation back", async () => {
    const { a, b, matchId } = await matchedPair();
    await app.inject({
      method: "POST",
      url: `${API}/matches/${matchId}/messages`,
      headers: { cookie: a.cookie },
      payload: { body: "said once" },
    });
    await block(a, b.profileId);

    const removed = await app.inject({
      method: "DELETE",
      url: `${API}/blocks/${b.profileId}`,
      headers: { cookie: a.cookie },
    });
    expect(removed.statusCode).toBe(204);

    expect(await db.select().from(messages)).toHaveLength(0);
    const res = await app.inject({
      method: "GET",
      url: `${API}/matches/${matchId}/messages`,
      headers: { cookie: a.cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("reporting", () => {
  const report = (actor: Actor, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `${API}/reports`, headers: { cookie: actor.cookie }, payload });

  it("captures the reported person's messages as evidence", async () => {
    const { a, b, matchId } = await matchedPair();

    await app.inject({
      method: "POST",
      url: `${API}/matches/${matchId}/messages`,
      headers: { cookie: b.cookie },
      payload: { body: "send me five thousand rupees on this UPI" },
    });
    await app.inject({
      method: "POST",
      url: `${API}/matches/${matchId}/messages`,
      headers: { cookie: a.cookie },
      payload: { body: "no" },
    });

    const res = await report(a, { profileId: b.profileId, reason: "scam", matchId });
    expect(res.statusCode).toBe(201);

    const [row] = await db.select().from(reports);
    expect(row.evidence).toHaveLength(1);
    expect(row.evidence[0].body).toContain("five thousand rupees");
    // Only theirs. A report is not a way to hand over your own half.
    expect(JSON.stringify(row.evidence)).not.toContain('"no"');
  });

  // The order that matters: report, then block. Blocking scrubs the
  // conversation, so evidence has to be taken at filing time.
  it("keeps its evidence after a block destroys the conversation", async () => {
    const { a, b, matchId } = await matchedPair();
    await app.inject({
      method: "POST",
      url: `${API}/matches/${matchId}/messages`,
      headers: { cookie: b.cookie },
      payload: { body: "the thing that was said" },
    });

    await report(a, { profileId: b.profileId, reason: "harassment", matchId });
    await block(a, b.profileId);

    expect(await db.select().from(messages)).toHaveLength(0);
    const [row] = await db.select().from(reports);
    expect(row.evidence[0].body).toBe("the thing that was said");
  });

  it("refuses a conversation you were not in", async () => {
    const { b, matchId } = await matchedPair();
    const outsider = await makeActor(app, "o@test.local", asMan);

    const res = await report(outsider, { profileId: b.profileId, reason: "spam", matchId });
    expect(res.statusCode).toBe(404);
    expect(await db.select().from(reports)).toHaveLength(0);
  });

  it("opens one case per reported person however many reports arrive", async () => {
    const { a, b } = await matchedPair();
    const other = await makeActor(app, "c@test.local", asMan);

    await report(a, { profileId: b.profileId, reason: "spam" });
    resetRateLimits();
    await report(other, { profileId: b.profileId, reason: "harassment" });

    expect(await db.select().from(reports)).toHaveLength(2);
    expect(await db.select().from(moderationCases)).toHaveLength(1);
  });

  it("never tells the reported person, and never names the reporter", async () => {
    const { a, b } = await matchedPair();
    await report(a, { profileId: b.profileId, reason: "harassment", details: "it was unpleasant" });

    const theirs = JSON.parse(
      (await app.inject({ method: "GET", url: `${API}/reports`, headers: { cookie: b.cookie } })).body
    );
    expect(theirs.reports).toHaveLength(0);

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "report.filed"));
    expect(event.meta).toEqual({ reason: "harassment", evidenceCount: 0 });
    expect(JSON.stringify(event)).not.toContain("unpleasant");
  });

  it("refuses a report aimed at yourself", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    expect((await report(a, { profileId: a.profileId, reason: "spam" })).statusCode).toBe(400);
  });

  // Reporting must stay usable while mass-reporting does not: five an
  // hour is enough for a real person and not enough to bury someone.
  it("throttles reporting", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);

    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      codes.push((await report(a, { profileId: b.profileId, reason: "spam" })).statusCode);
    }

    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect(codes.slice(0, 3).every((c) => c === 201 || c === 400)).toBe(true);
  });
});

describe("moderation", () => {
  async function admin(): Promise<Actor> {
    // ADMIN_EMAIL is set to this address in vitest.config.ts.
    return makeActor(app, "admin@tummile.local", asMan);
  }

  it("is refused to everyone else, and does not confirm the route exists", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const res = await app.inject({
      method: "GET",
      url: `${API}/admin/cases`,
      headers: { cookie: a.cookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("shows the queue with evidence but never the reporter", async () => {
    const { a, b, matchId } = await matchedPair();
    await app.inject({
      method: "POST",
      url: `${API}/matches/${matchId}/messages`,
      headers: { cookie: b.cookie },
      payload: { body: "pay me first" },
    });
    await app.inject({
      method: "POST",
      url: `${API}/reports`,
      headers: { cookie: a.cookie },
      payload: { profileId: b.profileId, reason: "scam", matchId },
    });

    const mod = await admin();
    const cases = JSON.parse(
      (await app.inject({ method: "GET", url: `${API}/admin/cases`, headers: { cookie: mod.cookie } })).body
    );
    expect(cases.cases).toHaveLength(1);

    const detail = JSON.parse(
      (
        await app.inject({
          method: "GET",
          url: `${API}/admin/cases/${cases.cases[0].id}/reports`,
          headers: { cookie: mod.cookie },
        })
      ).body
    );
    expect(detail.reports[0].evidence[0].body).toBe("pay me first");
    expect(JSON.stringify(detail)).not.toContain(a.profileId);
  });

  it("restricts an account on the second actioned report", async () => {
    const { a, b } = await matchedPair();
    const other = await makeActor(app, "c@test.local", asMan);
    const mod = await admin();

    for (const reporter of [a, other]) {
      resetRateLimits();
      await app.inject({
        method: "POST",
        url: `${API}/reports`,
        headers: { cookie: reporter.cookie },
        payload: { profileId: b.profileId, reason: "harassment" },
      });
    }

    const filed = await db.select().from(reports).where(eq(reports.reportedId, b.profileId));
    const outcomes: { strikes: number; restricted: boolean }[] = [];

    for (const row of filed) {
      const res = await app.inject({
        method: "PATCH",
        url: `${API}/admin/reports/${row.id}`,
        headers: { cookie: mod.cookie },
        payload: { decision: "actioned" },
      });
      outcomes.push(JSON.parse(res.body));
    }

    expect(outcomes[0].restricted).toBe(false);
    expect(outcomes[1].restricted).toBe(true);

    const [reported] = await db.select().from(profiles).where(eq(profiles.id, b.profileId));
    expect(reported.moderationStatus).toBe("restricted");

    // Restricted means gone from discovery, immediately.
    const seen = await app.inject({ method: "GET", url: `${API}/discovery`, headers: { cookie: other.cookie } });
    expect(JSON.parse(seen.body).profile).toBeNull();
  });

  it("will not let the same report be actioned twice", async () => {
    const { a, b } = await matchedPair();
    const mod = await admin();

    await app.inject({
      method: "POST",
      url: `${API}/reports`,
      headers: { cookie: a.cookie },
      payload: { profileId: b.profileId, reason: "spam" },
    });
    const [row] = await db.select().from(reports);

    const decide = () =>
      app.inject({
        method: "PATCH",
        url: `${API}/admin/reports/${row.id}`,
        headers: { cookie: mod.cookie },
        payload: { decision: "actioned" },
      });

    expect((await decide()).statusCode).toBe(200);
    expect((await decide()).statusCode).toBe(400);
  });
});
