import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";
import { config } from "../../src/config.js";
import { API } from "../helpers.js";

let app: FastifyInstance;

const ask = (email: string, headers: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: `${API}/auth/request`, payload: { email }, headers });

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

describe("one inbox, one account", () => {
  it("treats an alias as the account it already is", async () => {
    await ask("mohit@gmail.com");
    resetRateLimits();
    await ask("m.o.hit+tummile@gmail.com");

    const rows = await db.select().from(authUsers);
    expect(rows).toHaveLength(1);
    expect(rows[0].emailCanonical).toBe("mohit@gmail.com");
  });

  it("still lets genuinely different people in", async () => {
    await ask("mohit@gmail.com");
    resetRateLimits();
    await ask("ananya@gmail.com");
    resetRateLimits();
    await ask("mohit@outlook.com");

    expect(await db.select().from(authUsers)).toHaveLength(3);
  });

  // Rejecting a throwaway loudly would tell a caller which providers
  // work, so it answers exactly like every other request and sends nothing.
  it("quietly declines a throwaway inbox, indistinguishably", async () => {
    const real = await ask("someone@gmail.com");
    resetRateLimits();
    const throwaway = await ask("someone@mailinator.com");

    expect(throwaway.statusCode).toBe(real.statusCode);
    expect(Object.keys(JSON.parse(throwaway.body))).toEqual(["ok"]);

    const rows = await db.select().from(authUsers);
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("someone@gmail.com");
  });

  it("frees the key again when the account is deleted", async () => {
    await ask("mohit@gmail.com");
    const [row] = await db.select().from(authUsers);
    expect(row.emailCanonical).toBe("mohit@gmail.com");

    // Deletion tombstones the address; the key must go with it or the
    // person could never come back under their own address.
    await db
      .update(authUsers)
      .set({ email: `deleted-${row.id}@deleted.invalid`, emailCanonical: null, isDeleted: true })
      .where(eq(authUsers.id, row.id));

    resetRateLimits();
    await ask("mohit@gmail.com");
    const after = await db.select().from(authUsers);
    expect(after).toHaveLength(2);
  });
});

describe("two-tier throttling", () => {
  // The reason for the strict tier: rotating aliases must not buy more
  // attempts at the same inbox.
  it("counts aliases of one inbox against one allowance", async () => {
    const codes: number[] = [];
    for (const alias of [
      "mohit@gmail.com",
      "m.ohit@gmail.com",
      "mohit+1@gmail.com",
      "mo.hit+2@gmail.com",
      "m.o.h.i.t+3@gmail.com",
    ]) {
      codes.push((await ask(alias)).statusCode);
    }

    expect(codes.filter((c) => c === 200)).toHaveLength(config.RATE_LIMIT_MAGIC_LINK);
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });

  // The per-IP tier is sized for a day-scholar campus: a lab of
  // classmates on one connection gets through, and a script working a
  // list from one address is cut off right after them.
  it("lets a lab of classmates through one address, then stops", async () => {
    const cap = config.RATE_LIMIT_MAGIC_LINK_PER_IP;
    const codes: number[] = [];
    for (let i = 0; i < cap + 3; i++) {
      codes.push((await ask(`student${i}@msit.edu.in`)).statusCode);
    }

    expect(codes.slice(0, cap).every((c) => c === 200)).toBe(true);
    expect(codes.slice(cap).every((c) => c === 429)).toBe(true);
    expect(await db.select().from(authUsers)).toHaveLength(cap);
  });
});
