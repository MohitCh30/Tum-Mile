/**
 * Email addresses, normalised.
 *
 * The cheapest evasion route in an email-only product is aliasing: Gmail
 * ignores dots and everything after a `+`, so `m.o.h.i.t+3@gmail.com` and
 * `mohit@gmail.com` are the same inbox and were, until now, two accounts.
 * Collapsing them means someone who wants a second account has to make a
 * real one — and the provider makes them do phone verification for that,
 * which borrows their Sybil resistance for free.
 *
 * This does not stop a determined person. Nothing does. It removes the
 * five-second version.
 */

/** Providers that ignore dots in the local part. */
const DOT_INSENSITIVE = new Set(["gmail.com", "googlemail.com"]);

/** Providers where everything after `+` is ignored. Most do this. */
const PLUS_ADDRESSING = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "fastmail.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "zoho.com",
  "zohomail.in",
]);

const ALIAS_DOMAINS: Record<string, string> = {
  "googlemail.com": "gmail.com",
  "protonmail.com": "proton.me",
  "pm.me": "proton.me",
  "hotmail.com": "outlook.com",
  "live.com": "outlook.com",
  "me.com": "icloud.com",
};

/**
 * Throwaway inboxes. A short, shipped list rather than a third-party
 * lookup: this must not become a service that gets told every address
 * anyone types into the product.
 */
const DISPOSABLE = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "sharklasers.com",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "temp-mail.org",
  "throwawaymail.com",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "mailnesia.com",
  "fakeinbox.com",
  "mohmal.com",
  "emailondeck.com",
  "spamgourmet.com",
  "moakt.com",
  "tempr.email",
  "burnermail.io",
  "mailsac.com",
  "inboxkitten.com",
  "harakirimail.com",
]);

export interface NormalisedEmail {
  /** What the person typed, lowercased and trimmed. Used for delivery. */
  address: string;
  /** The identity key. Two addresses reaching one inbox share this. */
  canonical: string;
  disposable: boolean;
}

export function normaliseEmail(input: string): NormalisedEmail | null {
  const address = input.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return null;

  let local = address.slice(0, at);
  const rawDomain = address.slice(at + 1);
  if (local === "" || rawDomain === "" || !rawDomain.includes(".")) return null;

  const domain = ALIAS_DOMAINS[rawDomain] ?? rawDomain;

  if (PLUS_ADDRESSING.has(rawDomain) || PLUS_ADDRESSING.has(domain)) {
    const plus = local.indexOf("+");
    if (plus > 0) local = local.slice(0, plus);
    // A local part that was ONLY a tag is not an address.
    if (plus === 0) return null;
  }

  if (DOT_INSENSITIVE.has(domain)) {
    local = local.replaceAll(".", "");
  }

  if (local === "") return null;

  return {
    address,
    canonical: `${local}@${domain}`,
    disposable: DISPOSABLE.has(rawDomain) || DISPOSABLE.has(domain),
  };
}

/** For tests and for the odd place that only needs the key. */
export function canonicalEmail(input: string): string | null {
  return normaliseEmail(input)?.canonical ?? null;
}
