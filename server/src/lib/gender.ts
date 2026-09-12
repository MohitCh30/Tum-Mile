/**
 * Gender, as a small closed set.
 *
 * It was free text on both sides — what you are, and who you want to meet —
 * and discovery compared the two as exact strings. So "Female" and "woman"
 * never matched, and the pair saw "nobody new" with nothing to explain it.
 * A silent empty room is the worst possible failure for a dating app, and
 * it looked identical to the app working.
 *
 * Three canonical values, written into the profile on save. The synonyms
 * exist for what people actually type, and so profiles written before this
 * still match on read without a migration.
 */

export const GENDERS = ["woman", "man", "non-binary"] as const;
export type Gender = (typeof GENDERS)[number];

const SYNONYMS: Record<string, Gender> = {
  woman: "woman",
  women: "woman",
  female: "woman",
  f: "woman",
  w: "woman",
  girl: "woman",
  girls: "woman",
  ladki: "woman",
  man: "man",
  men: "man",
  male: "man",
  m: "man",
  boy: "man",
  boys: "man",
  guy: "man",
  guys: "man",
  ladka: "man",
  "non-binary": "non-binary",
  nonbinary: "non-binary",
  nb: "non-binary",
  enby: "non-binary",
  genderqueer: "non-binary",
};

/** What someone typed, reduced to one of the three — or null if it is none of them. */
export function canonicalGender(raw: string): Gender | null {
  const key = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return SYNONYMS[key] ?? SYNONYMS[key.replace(/-/g, "")] ?? null;
}

/**
 * Does this list of what someone is looking for include this person?
 *
 * An empty list is not a filter — someone who never said stays open to
 * everyone rather than being hidden from everyone.
 */
export function wants(seeking: readonly string[], gender: string): boolean {
  if (seeking.length === 0) return true;
  const theirs = canonicalGender(gender);
  if (!theirs) return false;
  return seeking.some((s) => canonicalGender(s) === theirs);
}
