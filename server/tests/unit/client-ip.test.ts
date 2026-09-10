import { describe, it, expect } from "vitest";
import type { FastifyRequest } from "fastify";
import { clientIp } from "../../src/lib/client-ip.js";
import { config } from "../../src/config.js";

/** Just enough of a request for the resolver. */
function requestFrom(
  remoteAddress: string,
  headers: Record<string, string> = {}
): FastifyRequest {
  return {
    ip: remoteAddress,
    socket: { remoteAddress },
    headers,
  } as unknown as FastifyRequest;
}

describe("resolving the caller's address", () => {
  // TRUST_PROXY is off in tests, which is the correct default: a server
  // that is directly reachable must never believe a forwarded header, or
  // anyone can mint themselves a private rate-limit bucket. This is the
  // "spoof forwarded headers" row of the threat model.
  it("ignores forwarded headers when the proxy is not trusted", () => {
    expect(config.TRUST_PROXY).toBe(false);

    const spoofed = requestFrom("198.51.100.7", {
      "cf-connecting-ip": "203.0.113.1",
      "x-forwarded-for": "203.0.113.2",
    });

    expect(clientIp(spoofed)).toBe("198.51.100.7");
  });

  it("ignores them for a non-loopback peer even so", () => {
    const direct = requestFrom("198.51.100.7", { "cf-connecting-ip": "203.0.113.1" });
    expect(clientIp(direct)).toBe("198.51.100.7");
  });

  it("falls back to the socket when there is no header at all", () => {
    expect(clientIp(requestFrom("127.0.0.1"))).toBe("127.0.0.1");
  });
});
