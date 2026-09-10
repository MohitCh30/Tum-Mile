import type { FastifyRequest } from "fastify";
import { config } from "../config.js";

/**
 * The caller's real address, behind a Cloudflare tunnel.
 *
 * `cloudflared` runs on this machine and connects to the server over
 * loopback, so without this EVERY visitor on earth arrives as 127.0.0.1
 * and every per-IP limit becomes one shared global bucket. Three sign-in
 * links an hour would mean three for the whole internet — the app would
 * simply stop working for everyone after the third person tried it.
 *
 * Cloudflare sets `CF-Connecting-IP` to the true client address, and the
 * header is only believed when the connection actually came from the
 * tunnel. Trusting it unconditionally would let anyone send a fake one
 * and mint themselves a private rate-limit bucket — the "spoof forwarded
 * headers" row of the threat model.
 *
 * The server binds to 127.0.0.1, so the only route in is the tunnel; a
 * spoofer would already need to be on the machine.
 */
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function clientIp(request: FastifyRequest): string {
  const direct = request.socket.remoteAddress ?? request.ip;

  if (!config.TRUST_PROXY || !LOOPBACK.has(direct)) {
    // Straight to the server: what the socket says is the truth.
    return request.ip;
  }

  const cf = request.headers["cf-connecting-ip"];
  const value = Array.isArray(cf) ? cf[0] : cf;
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  // Behind the tunnel with no Cloudflare header: fall back to the last
  // hop in X-Forwarded-For, which is the one the proxy itself appended.
  const forwarded = request.headers["x-forwarded-for"];
  const chain = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof chain === "string" && chain.trim() !== "") {
    const hops = chain.split(",").map((h) => h.trim()).filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
  }

  return request.ip;
}
