import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { buildApp } from "../../src/index.js";
import { db, authUsers, sessions, closeDb } from "../../src/storage/db.js";
import { resetRateLimits } from "../../src/middleware/rate-limit.js";

let app: FastifyInstance;

const EMAIL = "meher@test.local";
const API = "/api/v1";

/** Pull the one-shot token out of the dev-only URL. */
function tokenFrom(body: string): string {
  const { devUrl } = JSON.parse(body) as { devUrl?: string };
  if (!devUrl) throw new Error("no devUrl — is NODE_ENV production?");
  return new URL(devUrl).searchParams.get("token")!;
}

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw[0] : String(raw);
  return header.split(";")[0];
}

async function signIn(email = EMAIL): Promise<string> {
  const asked = await app.inject({
    method: "POST",
    url: `${API}/auth/request`,
    payload: { email },
  });
  const verified = await app.inject({
    method: "POST",
    url: `${API}/auth/verify`,
    payload: { token: tokenFrom(asked.body) },
  });
  return cookieFrom(verified);
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
  // Cascades to sessions and profiles.
  await db.delete(authUsers);
  resetRateLimits();
});

describe("POST /auth/request", () => {
  it("accepts a valid address", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${API}/auth/request`,
      payload: { email: EMAIL },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it("cannot be used to tell a known address from an unknown one", async () => {
    await app.inject({ method: "POST", url: `${API}/auth/request`, payload: { email: EMAIL } });
    resetRateLimits();

    const known = await app.inject({
      method: "POST",
      url: `${API}/auth/request`,
      payload: { email: EMAIL },
    });
    const unknown = await app.inject({
      method: "POST",
      url: `${API}/auth/request`,
      payload: { email: "never-seen@test.local" },
    });

    expect(known.statusCode).toBe(unknown.statusCode);
    expect(Object.keys(JSON.parse(known.body)).sort()).toEqual(
      Object.keys(JSON.parse(unknown.body)).sort()
    );
  });

  // Regression: the August implementation deleted the user row before
  // reissuing, so asking for a second link destroyed the account and
  // everything cascading from it.
  it("keeps the account when a second link is asked for", async () => {
    await signIn();

    const before = await db.select().from(authUsers).where(eq(authUsers.email, EMAIL));
    expect(before).toHaveLength(1);
    expect(before[0].emailVerified).toBe(true);

    resetRateLimits();
    await app.inject({ method: "POST", url: `${API}/auth/request`, payload: { email: EMAIL } });

    const after = await db.select().from(authUsers).where(eq(authUsers.email, EMAIL));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].emailVerified).toBe(true);
  });

  it("rejects a malformed address", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${API}/auth/request`,
      payload: { email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("VALIDATION_ERROR");
  });

  // Two tiers, doing different jobs. Rotating ALIASES of one inbox buys
  // nothing, because the strict tier is keyed on the canonical address.
  it("counts aliases of one inbox against one allowance", async () => {
    const codes: number[] = [];
    for (const alias of [
      "rotate@gmail.com",
      "r.otate@gmail.com",
      "rotate+1@gmail.com",
      "ro.tate+2@gmail.com",
      "r.o.t.a.t.e+3@gmail.com",
    ]) {
      const res = await app.inject({
        method: "POST",
        url: `${API}/auth/request`,
        payload: { email: alias },
      });
      codes.push(res.statusCode);
    }
    expect(codes).toContain(429);
  });

  // Rotating to genuinely DIFFERENT inboxes is allowed up to the per-IP
  // tier, deliberately: a lab full of classmates shares one address, and
  // a per-inbox-sized cap on the IP would lock most of them out.
  //
  // The trade is real and stated: one address may now probe up to
  // RATE_LIMIT_MAGIC_LINK_PER_IP inboxes an hour rather than three. It
  // learns nothing by doing so — the response is identical whether or not
  // an account exists — so the cost is mail volume, not disclosure.
  it("does not lock out everyone sharing one address", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await app.inject({
        method: "POST",
        url: `${API}/auth/request`,
        payload: { email: `classmate-${i}@msit.edu.in` },
      });
      codes.push(res.statusCode);
    }
    expect(codes.every((c) => c === 200)).toBe(true);
  });
});

describe("GET /auth/config", () => {
  // Unconfigured, the check is off and the client must render nothing.
  it("offers no site key when Turnstile is not set up", async () => {
    const res = await app.inject({ method: "GET", url: `${API}/auth/config` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ turnstileSiteKey: null });
  });
});

describe("POST /auth/verify", () => {
  it("issues an httpOnly session cookie", async () => {
    const asked = await app.inject({
      method: "POST",
      url: `${API}/auth/request`,
      payload: { email: EMAIL },
    });
    const res = await app.inject({
      method: "POST",
      url: `${API}/auth/verify`,
      payload: { token: tokenFrom(asked.body) },
    });

    expect(res.statusCode).toBe(200);
    const raw = res.headers["set-cookie"];
    const header = Array.isArray(raw) ? raw[0] : String(raw);
    expect(header).toMatch(/tum_mile_session=/);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
  });

  it("burns the token — a replay fails", async () => {
    const asked = await app.inject({
      method: "POST",
      url: `${API}/auth/request`,
      payload: { email: EMAIL },
    });
    const token = tokenFrom(asked.body);

    const first = await app.inject({ method: "POST", url: `${API}/auth/verify`, payload: { token } });
    const second = await app.inject({ method: "POST", url: `${API}/auth/verify`, payload: { token } });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);
  });

  // Regression: a SELECT-then-UPDATE let two simultaneous requests both
  // pass the validity check and both mint a session from one link. React
  // StrictMode does exactly this on every mount, so it was not theoretical.
  it("survives two requests racing with the same token", async () => {
    const asked = await app.inject({
      method: "POST",
      url: `${API}/auth/request`,
      payload: { email: EMAIL },
    });
    const token = tokenFrom(asked.body);

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.inject({ method: "POST", url: `${API}/auth/verify`, payload: { token } })
      )
    );

    const accepted = results.filter((r) => r.statusCode === 200);
    expect(accepted).toHaveLength(1);
    expect(await db.select().from(sessions)).toHaveLength(1);
  });

  it("rejects a token that was never issued", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${API}/auth/verify`,
      payload: { token: "z".repeat(43) },
    });
    expect(res.statusCode).toBe(401);
  });

  it("stores only the hash of the session token", async () => {
    const cookie = await signIn();
    const raw = cookie.split("=")[1];

    const rows = await db.select().from(sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(raw);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("session lifecycle", () => {
  it("GET /me needs a session", async () => {
    const res = await app.inject({ method: "GET", url: `${API}/me` });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("MISSING_SESSION");
  });

  it("GET /me returns the signed-in actor", async () => {
    const cookie = await signIn();
    const res = await app.inject({ method: "GET", url: `${API}/me`, headers: { cookie } });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.email).toBe(EMAIL);
    expect(body.emailVerified).toBe(true);
    expect(body.hasProfile).toBe(false);
  });

  it("refuses a forged cookie", async () => {
    const res = await app.inject({
      method: "GET",
      url: `${API}/me`,
      headers: { cookie: `tum_mile_session=${"a".repeat(43)}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("will not accept the session token as a bearer header", async () => {
    const cookie = await signIn();
    const token = cookie.split("=")[1];
    const res = await app.inject({
      method: "GET",
      url: `${API}/me`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("logout revokes the cookie server-side, not just in the browser", async () => {
    const cookie = await signIn();

    const out = await app.inject({ method: "POST", url: `${API}/auth/logout`, headers: { cookie } });
    expect(out.statusCode).toBe(200);

    const after = await app.inject({ method: "GET", url: `${API}/me`, headers: { cookie } });
    expect(after.statusCode).toBe(401);
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("a deleted account cannot keep using its session", async () => {
    const cookie = await signIn();
    await db.update(authUsers).set({ isDeleted: true }).where(eq(authUsers.email, EMAIL));

    const res = await app.inject({ method: "GET", url: `${API}/me`, headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });
});

describe("responses", () => {
  it("carries the security headers", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  it("leaks nothing on an unknown route", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({
      error: { code: "NOT_FOUND", message: "Not found." },
    });
  });
});
