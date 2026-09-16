import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The 404 handler doubles as the app shell: `/`, `/matches` and every
 * other route exist only in the browser's router, and `fastifyStatic` is
 * registered with `index: false`, so even the homepage arrives here.
 *
 * It used to require `Accept: text/html`, which is what a browser sends
 * and what almost nothing else does — so the people who were served a
 * JSON 404 for the homepage were `facebookexternalhit` (every WhatsApp,
 * Facebook and Instagram link preview), `Twitterbot`, and any uptime
 * monitor using HEAD. This pins both the widening and the limits on it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../../frontend/dist");

let app: FastifyInstance;

beforeAll(async () => {
  // `config` is read once at import, so the shell-serving branch can only
  // be exercised by building the module graph again with it set.
  vi.resetModules();
  process.env.FRONTEND_DIST = dist;
  const { buildApp } = await import("../../src/index.js");
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  delete process.env.FRONTEND_DIST;
  vi.resetModules();
});

const req = (url: string, headers: Record<string, string> = {}, method = "GET") =>
  app.inject({ method: method as "GET", url, headers });

describe("the app shell reaches the things that ask for it", () => {
  it("serves the homepage to a browser", async () => {
    const res = await req("/", { accept: "text/html,application/xhtml+xml" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<div id=\"root\">");
  });

  it("serves a deep link the browser router owns", async () => {
    const res = await req("/matches", { accept: "text/html" });
    expect(res.statusCode).toBe(200);
  });

  it.each([
    ["facebookexternalhit — WhatsApp, Facebook, Instagram", "*/*"],
    ["Twitterbot", "*/*"],
    ["a client that sends no Accept at all", ""],
  ])("serves the shell to %s", async (_who, accept) => {
    const res = await req("/", accept === "" ? {} : { accept });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("og:title");
  });

  it("answers HEAD, which is how a monitor asks whether the site is up", async () => {
    const res = await req("/", { accept: "*/*" }, "HEAD");
    expect(res.statusCode).toBe(200);
  });
});

describe("and still refuses the things it always refused", () => {
  it("gives a mistyped API path the same JSON 404 as a resource that is not yours", async () => {
    const res = await req("/api/v1/nope", { accept: "text/html" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Not found." } });
  });

  it("does not answer a POST with a page", async () => {
    const res = await app.inject({ method: "POST", url: "/anything", headers: { accept: "*/*" } });
    expect(res.statusCode).toBe(404);
  });

  it("404s a missing asset rather than handing back HTML", async () => {
    // Serving the shell here would turn a broken deploy into a blank
    // screen and "unexpected token '<'" instead of an honest 404.
    const res = await req("/assets/index-gone.js", { accept: "*/*" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });
});
