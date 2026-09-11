import { describe, it, expect, vi, afterEach } from "vitest";
import { config } from "../../src/config.js";
import { turnstileEnabled, verifyTurnstile } from "../../src/services/turnstile.js";

const setSecret = (value: string) => {
  (config as { TURNSTILE_SECRET: string }).TURNSTILE_SECRET = value;
};

afterEach(() => {
  setSecret("");
  vi.restoreAllMocks();
});

describe("Turnstile", () => {
  it("is skipped entirely when no secret is configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(turnstileEnabled()).toBe(false);
    expect(await verifyTurnstile(undefined, "203.0.113.5")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a missing or absurd token without asking Cloudflare", async () => {
    setSecret("test-secret");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await verifyTurnstile(undefined, "203.0.113.5")).toBe(false);
    expect(await verifyTurnstile("x".repeat(5000), "203.0.113.5")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("believes Cloudflare's verdict", async () => {
    setSecret("test-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false }), { status: 200 })
    );
    expect(await verifyTurnstile("token", "203.0.113.5")).toBe(false);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    expect(await verifyTurnstile("token", "203.0.113.5")).toBe(true);
  });

  // Fails open: a sign-in form that dies when a third party has a bad
  // day is worse than one that briefly loses a bot check.
  it("lets people in when Cloudflare cannot be reached", async () => {
    setSecret("test-secret");
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNRESET"));
    expect(await verifyTurnstile("token", "203.0.113.5")).toBe(true);
  });
});
