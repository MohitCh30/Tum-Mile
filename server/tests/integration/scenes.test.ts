import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, sceneSessions, sceneTurns, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { getPremise } from "../../src/content/scenes.js";
import { API, makeActor, type Actor } from "../helpers.js";

let app: FastifyInstance;

const LINE = "I read too late and apologise for it in the morning.";
const asMan = { gender: "man", seeking: ["woman"] };
const asWoman = { gender: "woman", seeking: ["man"] };
const CANDLELIGHT = getPremise("candlelight")!;

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

const propose = (actor: Actor, matchId: string, premiseId = "candlelight") =>
  app.inject({
    method: "POST",
    url: `${API}/scenes`,
    headers: { cookie: actor.cookie },
    payload: { matchId, premiseId },
  });

const answerProposal = (actor: Actor, id: string, accept: boolean) =>
  app.inject({
    method: "POST",
    url: `${API}/scenes/${id}/answer`,
    headers: { cookie: actor.cookie },
    payload: { accept },
  });

const say = (actor: Actor, id: string, body: string) =>
  app.inject({
    method: "POST",
    url: `${API}/scenes/${id}/turns`,
    headers: { cookie: actor.cookie },
    payload: { body },
  });

const read = (actor: Actor, id: string) =>
  app.inject({ method: "GET", url: `${API}/scenes/${id}`, headers: { cookie: actor.cookie } });

/** Play a whole scene out, returning the final state as seen by `a`. */
async function playThrough(a: Actor, b: Actor, id: string) {
  for (let i = 0; i < CANDLELIGHT.turnsEach * 2; i++) {
    const state = JSON.parse((await read(a, id)).body);
    const speaker = state.yourTurn ? a : b;
    const res = await say(speaker, id, `line number ${i + 1}`);
    expect(res.statusCode).toBe(201);
  }
  return JSON.parse((await read(a, id)).body);
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

describe("the library", () => {
  it("is fixed and authored — there is no custom premise", async () => {
    const { a, matchId } = await matchedPair();

    const list = JSON.parse(
      (await app.inject({ method: "GET", url: `${API}/scenes/premises`, headers: { cookie: a.cookie } }))
        .body
    );
    expect(list.premises.length).toBeGreaterThan(0);
    expect(list.premises.map((p: { id: string }) => p.id)).toContain("incompetence-and-despair");

    const invented = await propose(a, matchId, "two-strangers-at-a-bar");
    expect(invented.statusCode).toBe(404);
  });
});

describe("proposing", () => {
  it("hands the proposer the second part, not the flattering one", async () => {
    const { a, b, matchId } = await matchedPair();
    const proposed = JSON.parse((await propose(a, matchId)).body);

    expect(proposed.status).toBe("proposed");
    expect(proposed.proposedByYou).toBe(true);
    // The proposer plays role B; role A is the one the premise opens with.
    expect(proposed.you.isRoleA).toBe(false);
    expect(proposed.you.name).toBe(CANDLELIGHT.roleB.name);

    const theirs = JSON.parse((await read(b, proposed.id)).body);
    expect(theirs.you.isRoleA).toBe(true);
    expect(theirs.you.name).toBe(CANDLELIGHT.roleA.name);
  });

  it("waits to be accepted, and nobody can speak before that", async () => {
    const { a, b, matchId } = await matchedPair();
    const { id } = JSON.parse((await propose(a, matchId)).body);

    expect((await say(b, id, "too early")).statusCode).toBe(400);

    expect((await answerProposal(b, id, true)).statusCode).toBe(200);
    expect(JSON.parse((await read(a, id)).body).status).toBe("playing");
  });

  it("cannot be accepted by the person who proposed it", async () => {
    const { a, matchId } = await matchedPair();
    const { id } = JSON.parse((await propose(a, matchId)).body);
    expect((await answerProposal(a, id, true)).statusCode).toBe(400);
  });

  it("can be declined", async () => {
    const { a, b, matchId } = await matchedPair();
    const { id } = JSON.parse((await propose(a, matchId)).body);

    await answerProposal(b, id, false);
    expect(JSON.parse((await read(a, id)).body).status).toBe("declined");
  });

  it("allows only one open scene per conversation", async () => {
    const { a, b, matchId } = await matchedPair();
    const { id } = JSON.parse((await propose(a, matchId)).body);
    await answerProposal(b, id, true);

    const second = await propose(b, matchId, "the-statement");
    expect(second.statusCode).toBe(409);

    // A declined one is not an open one.
    await app.inject({
      method: "POST",
      url: `${API}/scenes/${id}/abandon`,
      headers: { cookie: a.cookie },
    });
    expect((await propose(b, matchId, "the-statement")).statusCode).toBe(201);
  });

  it("is refused to somebody outside the match", async () => {
    const { matchId } = await matchedPair();
    const stranger = await makeActor(app, "s@test.local", asMan);
    expect((await propose(stranger, matchId)).statusCode).toBe(404);
  });
});

describe("playing", () => {
  async function started() {
    const pair = await matchedPair();
    const { id } = JSON.parse((await propose(pair.a, pair.matchId)).body);
    await answerProposal(pair.b, id, true);
    return { ...pair, id };
  }

  // The premise speaks first as role A, so the first thing written is a
  // reply — which means role B goes first.
  it("gives the first word to whoever is answering the opening line", async () => {
    const { a, b, id } = await started();

    const mine = JSON.parse((await read(a, id)).body);
    const theirs = JSON.parse((await read(b, id)).body);

    expect(mine.premise.opensWith).toBe(CANDLELIGHT.opensWith);
    expect(mine.yourTurn).toBe(true); // a proposed, so a is role B
    expect(theirs.yourTurn).toBe(false);
  });

  it("refuses a turn taken out of order", async () => {
    const { a, b, id } = await started();

    const wrong = await say(b, id, "not mine to say");
    expect(wrong.statusCode).toBe(409);
    expect(JSON.parse(wrong.body).error.code).toBe("NOT_YOUR_TURN");

    expect((await say(a, id, "mine")).statusCode).toBe(201);
    expect((await say(a, id, "mine again")).statusCode).toBe(409);
    expect((await say(b, id, "now mine")).statusCode).toBe(201);
  });

  it("names the character, not the person", async () => {
    const { a, b, id } = await started();
    await say(a, id, "I have seen yours too, actually.");

    const state = JSON.parse((await read(b, id)).body);
    expect(state.lines[0].speaker).toBe(CANDLELIGHT.roleB.name);
    expect(state.lines[0].mine).toBe(false);
    expect(JSON.stringify(state)).not.toContain("a@test.local");
  });

  // Finiteness is the whole safety argument: a scene has somewhere to go
  // other than further.
  it("stops at the turn budget and moves to the letters", async () => {
    const { a, b, id } = await started();
    const finished = await playThrough(a, b, id);

    expect(finished.status).toBe("letters");
    expect(finished.turnsRemaining).toBe(0);
    expect(finished.lines).toHaveLength(CANDLELIGHT.turnsEach * 2);

    const extra = await say(a, id, "one more");
    expect(extra.statusCode).toBe(400);
  });

  it("can be walked away from by either person", async () => {
    const { a, b, id } = await started();
    await say(a, id, "actually, no");

    const res = await app.inject({
      method: "POST",
      url: `${API}/scenes/${id}/abandon`,
      headers: { cookie: b.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status).toBe("abandoned");
    expect((await say(a, id, "hello?")).statusCode).toBe(400);
  });
});

describe("the last letter", () => {
  async function atLetters() {
    const pair = await matchedPair();
    const { id } = JSON.parse((await propose(pair.a, pair.matchId)).body);
    await answerProposal(pair.b, id, true);
    await playThrough(pair.a, pair.b, id);
    return { ...pair, id };
  }

  const write = (actor: Actor, id: string, body: string) =>
    app.inject({
      method: "POST",
      url: `${API}/scenes/${id}/letter`,
      headers: { cookie: actor.cookie },
      payload: { body },
    });

  it("finishes when both have written one", async () => {
    const { a, b, id } = await atLetters();

    const first = JSON.parse((await write(a, id, "What I would have said on the landing.")).body);
    expect(first.status).toBe("letters");
    expect(first.youHaveWritten).toBe(true);

    const second = JSON.parse((await write(b, id, "What I could not say either.")).body);
    expect(second.status).toBe("finished");
    expect(second.letters).toHaveLength(2);
    expect(second.letters.map((l: { from: string }) => l.from).sort()).toEqual(
      [CANDLELIGHT.roleA.name, CANDLELIGHT.roleB.name].sort()
    );
  });

  it("takes one letter each and no more", async () => {
    const { a, id } = await atLetters();
    expect((await write(a, id, "first")).statusCode).toBe(201);
    expect((await write(a, id, "second")).statusCode).toBe(400);
  });

  it("cannot be written before the scene has played out", async () => {
    const pair = await matchedPair();
    const { id } = JSON.parse((await propose(pair.a, pair.matchId)).body);
    await answerProposal(pair.b, id, true);

    expect((await write(pair.a, id, "skipping ahead")).statusCode).toBe(400);
  });

  it("is kept as the artifact both of them hold", async () => {
    const { a, b, id } = await atLetters();
    await write(a, id, "Mine.");
    await write(b, id, "Theirs.");

    for (const actor of [a, b]) {
      const state = JSON.parse((await read(actor, id)).body);
      expect(state.status).toBe("finished");
      expect(state.letters).toHaveLength(2);
      expect(state.letters.filter((l: { mine: boolean }) => l.mine)).toHaveLength(1);
    }
  });
});

describe("playing it again", () => {
  it("swaps the parts the second time round", async () => {
    const { a, b, matchId } = await matchedPair();

    const first = JSON.parse((await propose(a, matchId)).body);
    await answerProposal(b, first.id, true);
    await playThrough(a, b, first.id);
    for (const actor of [a, b]) {
      await app.inject({
        method: "POST",
        url: `${API}/scenes/${first.id}/letter`,
        headers: { cookie: actor.cookie },
        payload: { body: "done" },
      });
    }

    const again = JSON.parse((await propose(a, matchId)).body);
    // a played role B first time; the swap gives them role A.
    expect(first.you.isRoleA).toBe(false);
    expect(again.you.isRoleA).toBe(true);
  });
});

describe("a scene is not a second way in", () => {
  it("closes with the conversation when someone blocks", async () => {
    const { a, b, matchId } = await matchedPair();
    const { id } = JSON.parse((await propose(a, matchId)).body);
    await answerProposal(b, id, true);
    await say(a, id, "something said");

    await app.inject({
      method: "POST",
      url: `${API}/blocks`,
      headers: { cookie: b.cookie },
      payload: { profileId: a.profileId },
    });

    expect((await read(a, id)).statusCode).toBe(404);
    expect((await read(b, id)).statusCode).toBe(404);
    expect((await say(a, id, "still here?")).statusCode).toBe(404);
  });

  it("does not let a stranger read a scene by knowing its id", async () => {
    const { a, b, matchId } = await matchedPair();
    const { id } = JSON.parse((await propose(a, matchId)).body);
    await answerProposal(b, id, true);
    await say(a, id, "private to the two of us");

    const stranger = await makeActor(app, "s@test.local", asMan);
    const res = await read(stranger, id);

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("private to the two of us");
  });

  it("keeps the cast distinct at the database level", async () => {
    const { a, b, matchId } = await matchedPair();
    const { id } = JSON.parse((await propose(a, matchId)).body);

    const [row] = await db.select().from(sceneSessions).where(eq(sceneSessions.id, id));
    expect(row.castAId).not.toBe(row.castBId);
    expect([row.castAId, row.castBId].sort()).toEqual([a.profileId, b.profileId].sort());

    await expect(
      db.insert(sceneSessions).values({
        matchId,
        premiseId: "candlelight",
        castAId: a.profileId,
        castBId: a.profileId,
        proposedById: a.profileId,
      })
    ).rejects.toThrow();
  });

  it("records the premise but never a line of the scene", async () => {
    const { a, b, matchId } = await matchedPair();
    const { id } = JSON.parse((await propose(a, matchId)).body);
    await answerProposal(b, id, true);
    await say(a, id, "a line nobody else should ever read");

    const turns = await db.select().from(sceneTurns).where(eq(sceneTurns.sessionId, id));
    expect(turns).toHaveLength(1);

    const { auditEvents } = await import("../../src/storage/db.js");
    const events = await db.select().from(auditEvents);
    expect(JSON.stringify(events)).not.toContain("a line nobody else should ever read");
    expect(JSON.stringify(events)).toContain("candlelight");
  });
});
