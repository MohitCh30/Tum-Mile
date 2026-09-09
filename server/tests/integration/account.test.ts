import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import {
  db,
  authUsers,
  profiles,
  sessions,
  messages,
  likes,
  reports,
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

describe("export", () => {
  it("hands over your own writing and choices", async () => {
    const { a, b, matchId } = await matchedPair();
    await app.inject({
      method: "POST",
      url: `${API}/matches/${matchId}/messages`,
      headers: { cookie: a.cookie },
      payload: { body: "something I said" },
    });

    const res = await app.inject({
      method: "GET",
      url: `${API}/account/export`,
      headers: { cookie: a.cookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("tum-mile-export.json");

    const data = JSON.parse(res.body);
    expect(data.account.email).toBe("a@test.local");
    expect(data.profile.oneLine).toBe(LINE);
    expect(data.messagesSent).toHaveLength(1);
    expect(data.likesSent[0].quotedLine).toBe(LINE);
    expect(data.matches).toHaveLength(1);
  });

  // A data-export right is not a way to obtain a transcript of somebody
  // else, and the stored cell is not handed back as a location either.
  it("does not include the other person's messages, or a location", async () => {
    const { a, b, matchId } = await matchedPair();
    await app.inject({
      method: "POST",
      url: `${API}/matches/${matchId}/messages`,
      headers: { cookie: b.cookie },
      payload: { body: "words that are hers" },
    });

    const res = await app.inject({
      method: "GET",
      url: `${API}/account/export`,
      headers: { cookie: a.cookie },
    });

    expect(res.body).not.toContain("words that are hers");
    const data = JSON.parse(res.body);
    expect(data.profile.locationGeohash).toBeUndefined();
    expect(data.approximateLocationStored).toBe(true);
  });

  it("needs a session", async () => {
    const res = await app.inject({ method: "GET", url: `${API}/account/export` });
    expect(res.statusCode).toBe(401);
  });
});

describe("deleting an account", () => {
  const remove = (actor: Actor, confirm: unknown) =>
    app.inject({
      method: "DELETE",
      url: `${API}/account`,
      headers: { cookie: actor.cookie },
      payload: { confirm },
    });

  it("refuses without the exact confirmation", async () => {
    const a = await makeActor(app, "a@test.local", asMan);

    expect((await remove(a, "yes")).statusCode).toBe(400);
    expect((await remove(a, undefined)).statusCode).toBe(400);

    const [row] = await db.select().from(authUsers);
    expect(row.isDeleted).toBe(false);
  });

  it("erases the writing, the address and every session", async () => {
    const { a } = await matchedPair();

    expect((await remove(a, "delete my account")).statusCode).toBe(204);

    const [account] = await db.select().from(authUsers).where(eq(authUsers.id, (
      await db.select().from(profiles).where(eq(profiles.id, a.profileId))
    )[0].authUserId));

    expect(account.isDeleted).toBe(true);
    expect(account.email).not.toBe("a@test.local");
    expect(account.email).toContain("@deleted.invalid");

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, a.profileId));
    expect(profile.displayName).toBe("Someone who left");
    expect(profile.oneLine).toBeNull();
    expect(profile.formBody).toBeNull();
    expect(profile.currently).toEqual({});
    expect(profile.promptAnswers).toEqual([]);
    expect(profile.locationGeohash).toBeNull();
    expect(profile.moderationStatus).toBe("suspended");

    const theirSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.authUserId, account.id));
    expect(theirSessions).toHaveLength(0);
    expect(await db.select().from(likes)).toHaveLength(0);
  });

  // Their words go with them, including from the other person's screen.
  it("takes their messages out of other people's conversations", async () => {
    const { a, b, matchId } = await matchedPair();
    await app.inject({
      method: "POST",
      url: `${API}/matches/${matchId}/messages`,
      headers: { cookie: a.cookie },
      payload: { body: "his words" },
    });
    await app.inject({
      method: "POST",
      url: `${API}/matches/${matchId}/messages`,
      headers: { cookie: b.cookie },
      payload: { body: "her words" },
    });

    await remove(a, "delete my account");

    const remaining = await db.select().from(messages);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].body).toBe("her words");
  });

  it("ends the session immediately", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    await remove(a, "delete my account");

    const res = await app.inject({ method: "GET", url: `${API}/me`, headers: { cookie: a.cookie } });
    expect(res.statusCode).toBe(401);
  });

  it("takes them out of discovery for everyone else", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const b = await makeActor(app, "b@test.local", asWoman);

    const before = await app.inject({ method: "GET", url: `${API}/discovery`, headers: { cookie: b.cookie } });
    expect(JSON.parse(before.body).profile).not.toBeNull();

    await remove(a, "delete my account");

    const after = await app.inject({ method: "GET", url: `${API}/discovery`, headers: { cookie: b.cookie } });
    expect(JSON.parse(after.body).profile).toBeNull();
  });

  // Otherwise deleting an account is a way to clear a moderation record,
  // which is precisely the ban-evasion route the research warns about.
  it("keeps reports filed about them, and the audit trail", async () => {
    const { a, b } = await matchedPair();
    await app.inject({
      method: "POST",
      url: `${API}/reports`,
      headers: { cookie: b.cookie },
      payload: { profileId: a.profileId, reason: "harassment" },
    });

    await remove(a, "delete my account");

    const filed = await db.select().from(reports);
    expect(filed).toHaveLength(1);
    expect(filed[0].reportedId).toBe(a.profileId);

    const trail = await db.select().from(auditEvents).where(eq(auditEvents.action, "account.deleted"));
    expect(trail).toHaveLength(1);
  });

  // Deletion frees the address rather than burning it, so a person who
  // leaves can come back. The cost is stated rather than hidden: a
  // RESTRICTED account can also delete and sign up again, and the new
  // profile carries none of the old one's strikes. Closing that would
  // need a durable identifier this product deliberately refuses to hold.
  // The old profile row and its reports remain for the record.
  it("frees the address for a fresh start, and keeps the old record", async () => {
    const a = await makeActor(app, "a@test.local", asMan);
    const oldProfileId = a.profileId;
    await remove(a, "delete my account");
    resetRateLimits();

    const asked = await app.inject({
      method: "POST",
      url: `${API}/auth/request`,
      payload: { email: "a@test.local" },
    });
    expect(asked.statusCode).toBe(200);

    const returned = await makeActor(app, "a@test.local", asMan);
    expect(returned.profileId).not.toBe(oldProfileId);

    const [tombstone] = await db.select().from(profiles).where(eq(profiles.id, oldProfileId));
    expect(tombstone.displayName).toBe("Someone who left");
    expect(tombstone.moderationStatus).toBe("suspended");
  });
});
