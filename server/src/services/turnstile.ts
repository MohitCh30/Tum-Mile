import { config } from "../config.js";

/**
 * Cloudflare Turnstile.
 *
 * Cloudflare's free tier gives DDoS mitigation automatically, but nothing
 * that stops a script working through the sign-in form — Bot Fight Mode is
 * off by default and blunt enough to break API calls, and the managed
 * rulesets are paid. Turnstile is the free, targeted piece, and it is the
 * only third party this product talks to.
 *
 * What it is worth being clear about: this raises the cost of AUTOMATED
 * signups. It does nothing about a determined person with a new inbox, and
 * it is not identity verification. Nothing here is.
 *
 * Unconfigured, it is skipped entirely — the app must run locally and for
 * anyone who does not want a Cloudflare dependency.
 */

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function turnstileEnabled(): boolean {
  return config.TURNSTILE_SECRET !== "";
}

/**
 * True when the token is good, or when the feature is off.
 *
 * Deliberately fails OPEN on a network error rather than closed: if
 * Cloudflare is unreachable, the alternative is that nobody can sign in
 * at all. A signup form that stops working when a third party has a bad
 * day is worse than one that briefly loses a bot check.
 */
export async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string
): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  if (!token || token.length > 4096) return false;

  const body = new URLSearchParams({
    secret: config.TURNSTILE_SECRET,
    response: token,
    // Cloudflare cross-checks this against where the token was solved.
    remoteip: remoteIp,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return true;

    const result = (await res.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return true;
  }
}
