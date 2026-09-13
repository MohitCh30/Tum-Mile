import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { API, signUp } from "../helpers.js";

/**
 * Moving an account to a different address.
 *
 * The address IS the identity here, so this is a transfer of ownership
 * and the tests are written against that rather than against a settings
 * form. The two things that must hold: nothing moves until the NEW
 * address proves itself, and asking about an address that is already an
 * account is indistinguishable from asking about a free one.
 */

let app: FastifyInstance;

function ask(cookie: string, email: string) {
  resetRateLimits();
  return app.inject({
    method: "POST",
    url: `${API}/account/email`,
    headers: { cookie },
    payload: { email },
  });
}

function confirm(cookie: string, code: string) {
  resetRateLimits();
  return app.inject({
    method: "POST",
    url: `${API}/account/email/confirm`,
    headers: { cookie },
    payload: { code },
  });
}

function rowFor(id: string) {
  return db.select().from(authUsers).where(eq(authUsers.id, id)).limit(1);
}

async function idOf(email: string): Promise<string> {
  const [row] = await db.select().from(authUsers).where(eq(authUsers.email, email)).limit(1);
  return row.id;
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

describe("moving an account to another address", () => {
  it("changes nothing until the code comes back", async () => {
    const cookie = await signUp(app, "old@test.local");
    const id = await idOf("old@test.local");

    const res = await ask(cookie, "new@test.local");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).devCode).toHaveLength(6);

    // The account still answers to the old address for the whole time the
    // change is in flight, so a half-finished move locks nobody out.
    const [row] = await rowFor(id);
    expect(row.email).toBe("old@test.local");
    expect(row.pendingEmail).toBe("new@test.local");
  });

  it("moves it on the right code, and signs every session out", async () => {
    const cookie = await signUp(app, "old@test.local");
    const id = await idOf("old@test.local");
    const code = JSON.parse((await ask(cookie, "new@test.local")).body).devCode as string;

    expect((await confirm(cookie, code)).statusCode).toBe(204);

    const [row] = await rowFor(id);
    expect(row.email).toBe("new@test.local");
    expect(row.pendingEmail).toBeNull();
    expect(row.pendingEmailCodeHash).toBeNull();

    // Including the session that did it. Someone taking an account back
    // needs the other person gone, and that has to include this browser.
    resetRateLimits();
    const after = await app.inject({ method: "GET", url: `${API}/me`, headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it("says exactly the same thing about an address that is already an account", async () => {
    await signUp(app, "taken@test.local");
    const cookie = await signUp(app, "mine@test.local");
    const id = await idOf("mine@test.local");

    const res = await ask(cookie, "taken@test.local");

    // Same status, same shape. The only difference is invisible from here:
    // no code was minted, so the move cannot be completed.
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(JSON.parse(res.body).devCode).toBeUndefined();

    const [row] = await rowFor(id);
    expect(row.pendingEmail).toBeNull();
    expect(row.email).toBe("mine@test.local");
  });

  it("counts wrong guesses and retires the change after five", async () => {
    const cookie = await signUp(app, "old@test.local");
    const id = await idOf("old@test.local");
    const code = JSON.parse((await ask(cookie, "new@test.local")).body).devCode as string;
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++) {
      expect((await confirm(cookie, wrong)).statusCode).toBe(400);
    }

    // Six digits is a million possibilities: plenty for five tries, and
    // nothing like enough for unlimited ones. The right code is dead now.
    expect((await confirm(cookie, code)).statusCode).toBe(404);

    const [row] = await rowFor(id);
    expect(row.email).toBe("old@test.local");
    expect(row.pendingEmail).toBeNull();
  });

  it("refuses a code when no move was asked for", async () => {
    const cookie = await signUp(app, "old@test.local");
    expect((await confirm(cookie, "123456")).statusCode).toBe(404);
  });

  it("does nothing when the address given is the one already in use", async () => {
    const cookie = await signUp(app, "old@test.local");
    const id = await idOf("old@test.local");

    const res = await ask(cookie, "old@test.local");
    expect(res.statusCode).toBe(200);
    // No code, and no warning mail either: nothing is happening, so there
    // is nothing to warn anybody about.
    expect(JSON.parse(res.body).devCode).toBeUndefined();

    const [row] = await rowFor(id);
    expect(row.pendingEmail).toBeNull();
  });

  it("is refused without a session", async () => {
    resetRateLimits();
    const res = await app.inject({
      method: "POST",
      url: `${API}/account/email`,
      payload: { email: "new@test.local" },
    });
    expect(res.statusCode).toBe(401);
  });
});
