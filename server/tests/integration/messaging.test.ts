import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, messages, matches, auditEvents, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { API, makeActor, type Actor } from "../helpers.js";

let app: FastifyInstance;

const LINE = "I read too late and apologise for it in the morning.";
const asMan = { gender: "man", seeking: ["woman"] };
const asWoman = { gender: "woman", seeking: ["man"] };

/** Two people who have matched, and the match between them. */
async function matchedPair(): Promise<{ a: Actor; b: Actor; matchId: string }> {
  const a = await makeActor(app, "a@test.local", asMan);
  const b = await makeActor(app, "b@test.local", asWoman);

  resetRateLimits();
  await app.inject({
    method: "POST",
    url: `${API}/likes`,
    headers: { cookie: a.cookie },
    payload: { profileId: b.profileId, quotedLine: LINE, message: "which part annoyed you" },
  });
  resetRateLimits();
  const second = await app.inject({
    method: "POST",
    url: `${API}/likes`,
    headers: { cookie: b.cookie },
    payload: { profileId: a.profileId, quotedLine: LINE, message: "the philosophy" },
  });

  const { matchId } = JSON.parse(second.body);
  return { a, b, matchId };
}

const send = (actor: Actor, matchId: string, body: string) =>
  app.inject({
    method: "POST",
    url: `${API}/matches/${matchId}/messages`,
    headers: { cookie: actor.cookie },
    payload: { body },
  });

const read = (actor: Actor, matchId: string, after?: string) =>
  app.inject({
    method: "GET",
    url: `${API}/matches/${matchId}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    headers: { cookie: actor.cookie },
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

describe("messaging", () => {
  it("lets two matched people write to each other", async () => {
    const { a, b, matchId } = await matchedPair();

    expect((await send(a, matchId, "Longer than anyone wants is the right length.")).statusCode).toBe(
      201
    );
    expect((await send(b, matchId, "गुनाहों का देवता is doing the opposite.")).statusCode).toBe(201);

    const res = await read(a, matchId);
    const body = JSON.parse(res.body);

    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].mine).toBe(true);
    expect(body.messages[1].mine).toBe(false);
    expect(body.with.displayName).toBe("b");
  });

  it("returns only what is new when polled with a cursor", async () => {
    const { a, b, matchId } = await matchedPair();
    await send(a, matchId, "first");

    const first = JSON.parse((await read(a, matchId)).body);
    await send(b, matchId, "second");

    const next = JSON.parse((await read(a, matchId, first.latest)).body);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].body).toBe("second");
  });

  // Nothing is written on a read, so nothing can become a read receipt.
  it("records nothing when a conversation is read", async () => {
    const { a, b, matchId } = await matchedPair();
    await send(a, matchId, "hello");

    const before = await db.select().from(messages).where(eq(messages.matchId, matchId));
    await read(b, matchId);
    await read(b, matchId);
    const after = await db.select().from(messages).where(eq(messages.matchId, matchId));

    expect(after).toEqual(before);
  });

  it("refuses a stranger, and does not admit the conversation exists", async () => {
    const { matchId } = await matchedPair();
    const stranger = await makeActor(app, "s@test.local", asMan);

    const reading = await read(stranger, matchId);
    const writing = await send(stranger, matchId, "let me in");
    const missing = await read(stranger, "no-such-match");

    expect(reading.statusCode).toBe(404);
    expect(writing.statusCode).toBe(404);
    expect(reading.body).toBe(missing.body);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("stops the conversation the moment the pair is unmatched", async () => {
    const { a, matchId } = await matchedPair();
    await send(a, matchId, "still here");

    await db.update(matches).set({ unmatchedAt: new Date() }).where(eq(matches.id, matchId));

    expect((await read(a, matchId)).statusCode).toBe(404);
    expect((await send(a, matchId, "hello?")).statusCode).toBe(404);
  });

  it("carries reactions, one per person, replaced on change", async () => {
    const { a, b, matchId } = await matchedPair();
    const sent = JSON.parse((await send(a, matchId, "the sequel to my personality")).body);

    const react = (actor: Actor, reaction: string) =>
      app.inject({
        method: "PUT",
        url: `${API}/messages/${sent.id}/reaction`,
        headers: { cookie: actor.cookie },
        payload: { reaction },
      });

    expect((await react(b, "😄")).statusCode).toBe(204);
    expect((await react(b, "🔥")).statusCode).toBe(204);

    const body = JSON.parse((await read(a, matchId)).body);
    expect(body.messages[0].reactions).toHaveLength(1);
    expect(body.messages[0].reactions[0].reaction).toBe("🔥");

    const removed = await app.inject({
      method: "DELETE",
      url: `${API}/messages/${sent.id}/reaction`,
      headers: { cookie: b.cookie },
    });
    expect(removed.statusCode).toBe(204);
    expect(JSON.parse((await read(a, matchId)).body).messages[0].reactions).toHaveLength(0);
  });

  it("refuses a reaction that is not in the set", async () => {
    const { a, b, matchId } = await matchedPair();
    const sent = JSON.parse((await send(a, matchId, "hello")).body);

    const res = await app.inject({
      method: "PUT",
      url: `${API}/messages/${sent.id}/reaction`,
      headers: { cookie: b.cookie },
      payload: { reaction: "💀" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses a reaction from someone outside the conversation", async () => {
    const { a, matchId } = await matchedPair();
    const sent = JSON.parse((await send(a, matchId, "hello")).body);
    const stranger = await makeActor(app, "s@test.local", asMan);

    const res = await app.inject({
      method: "PUT",
      url: `${API}/messages/${sent.id}/reaction`,
      headers: { cookie: stranger.cookie },
      payload: { reaction: "😄" },
    });
    expect(res.statusCode).toBe(404);
  });

  // The handoff to WhatsApp is the best-documented harm pattern in the
  // research. Note the LINK, never the message it appeared in.
  it("notes an off-platform link without recording the message", async () => {
    const { a, matchId } = await matchedPair();
    await send(a, matchId, "easier on wa.me/919999999999 — my number is there");

    const [event] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "message.offPlatformLink"));

    expect(event).toBeDefined();
    expect(event.meta).toEqual({ hosts: ["wa.me"] });
    expect(JSON.stringify(event)).not.toContain("919999999999");
    expect(JSON.stringify(event)).not.toContain("my number is there");
  });

  // A limit with an ascending order handed back the FIRST two hundred
  // messages, so a pair who passed that saw their own beginning forever
  // while sending kept working — a conversation neither could read.
  it("shows the newest two hundred, not the oldest", async () => {
    const { a, b, matchId } = await matchedPair();

    const base = Date.now() - 300 * 60_000;
    await db.insert(messages).values(
      Array.from({ length: 205 }, (_, i) => ({
        matchId,
        senderProfileId: i % 2 === 0 ? a.profileId : b.profileId,
        body: `line ${i}`,
        createdAt: new Date(base + i * 60_000),
      }))
    );

    resetRateLimits();
    const body = JSON.parse((await read(a, matchId)).body);
    const lines = body.messages.map((m: { body: string }) => m.body);

    expect(lines).toHaveLength(200);
    // Still oldest-first on screen, but the window sits at the end.
    expect(lines[0]).toBe("line 5");
    expect(lines[199]).toBe("line 204");
    expect(lines).not.toContain("line 0");
  });

  // Nothing in this product notifies, so the list itself has to carry the
  // only sign that somebody answered. Saying who spoke last is not a read
  // receipt — a read receipt tells THEM that YOU looked.
  it("orders matches by what happened last, and says who spoke", async () => {
    const { a, b, matchId } = await matchedPair();
    const list = (actor: Actor) =>
      app.inject({ method: "GET", url: `${API}/matches`, headers: { cookie: actor.cookie } });

    resetRateLimits();
    const fresh = JSON.parse((await list(a)).body).matches[0];
    expect(fresh.lastAt).toBeNull();
    expect(fresh.theirTurn).toBe(false);

    await send(b, matchId, "still awake?");

    resetRateLimits();
    const hers = JSON.parse((await list(a)).body).matches[0];
    expect(hers.lastAt).not.toBeNull();
    expect(hers.theirTurn).toBe(true);

    // The same message, from the other side, is your own.
    resetRateLimits();
    expect(JSON.parse((await list(b)).body).matches[0].theirTurn).toBe(false);
  });

  it("has no route that would accept an attachment", async () => {
    const { a, matchId } = await matchedPair();
    const res = await send(a, matchId, "look at this");
    const created = JSON.parse(res.body);
    // Message shape carries text and reactions and nothing else.
    expect(Object.keys(created).sort()).toEqual(["at", "body", "id", "mine", "reactions"]);
  });
});
