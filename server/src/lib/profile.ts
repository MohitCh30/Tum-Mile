import type { Profile } from "../storage/schema.js";
import { MAX_ONE_LINE_LENGTH } from "../content/prompts.js";

/** Age from a birth date, in whole years. Computed, never stored. */
export function ageFrom(birthDate: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export const MINIMUM_AGE = 18;

/**
 * Every line of a profile that someone may quote back at its author.
 *
 * A like must attach to one of these, and the server checks membership
 * against the *stored* profile rather than trusting what the client sends.
 * Without that check the quote is just a free-text field, and "hey" walks
 * straight back in wearing a quotation mark.
 */
export function quotableLines(profile: Profile): string[] {
  const lines: string[] = [];

  if (profile.oneLine) lines.push(profile.oneLine);

  for (const value of Object.values(profile.currently ?? {})) {
    if (typeof value === "string" && value.trim() !== "") lines.push(value.trim());
  }

  for (const answer of profile.promptAnswers ?? []) {
    if (answer.answer.trim() !== "") lines.push(answer.answer.trim());
  }

  // The form body is quoted a line at a time — a poem's line, a sentence
  // of a letter — rather than in one indivisible block.
  if (profile.formBody) {
    for (const line of profile.formBody.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed !== "") lines.push(trimmed);
    }
  }

  return lines;
}

export function isQuotable(profile: Profile, line: string): boolean {
  const target = line.trim();
  if (target === "") return false;
  return quotableLines(profile).includes(target);
}

export interface Completeness {
  complete: boolean;
  missing: string[];
}

/**
 * The floor for entering discovery. In a text-only app an empty profile is
 * the equivalent of a blank photo — there is nothing to read and nothing
 * to reply to, so it neither appears to others nor sees them.
 */
export function completeness(profile: Profile): Completeness {
  const missing: string[] = [];

  if (!profile.oneLine || profile.oneLine.trim() === "") missing.push("oneLine");

  const currentlyFilled = Object.values(profile.currently ?? {}).filter(
    (v) => typeof v === "string" && v.trim() !== ""
  ).length;
  const answers = (profile.promptAnswers ?? []).filter((a) => a.answer.trim() !== "").length;

  const written = (profile.formBody ?? "").trim() !== "";

  // One line, and one other thing a person can actually read: the letter,
  // something live, or one answer. Requiring the letter as well turned the
  // way in into a writing assignment, and people left at the blank page
  // rather than finishing. It is still the first thing invited, just no
  // longer the toll.
  if (!written && currentlyFilled === 0 && answers === 0) missing.push("somethingToRead");

  return { complete: missing.length === 0, missing };
}

/**
 * What another person is allowed to see. There is no field here that the
 * viewer has not earned: no email, no auth id, no exact location, no
 * timestamps that would amount to a last-seen.
 */
export interface PublicProfile {
  id: string;
  displayName: string;
  age: number;
  oneLine: string | null;
  formType: string | null;
  formBody: string | null;
  currently: Profile["currently"];
  currentlyAgeDays: number | null;
  promptAnswers: Profile["promptAnswers"];
  interests: string[];
  status: string | null;
  wantsKids: string | null;
  diet: string | null;
  languages: string[];
  religion: string | null;
  distance: string | null;
}

export function toPublicProfile(
  profile: Profile,
  distance: string | null,
  now = new Date()
): PublicProfile {
  const currentlyAgeDays =
    profile.currentlyUpdatedAt === null
      ? null
      : Math.floor((now.getTime() - profile.currentlyUpdatedAt.getTime()) / 86_400_000);

  return {
    id: profile.id,
    displayName: profile.displayName,
    age: ageFrom(profile.birthDate, now),
    oneLine: profile.oneLine,
    formType: profile.formType,
    formBody: profile.formBody,
    currently: profile.currently,
    // How stale the live section is, so a reader can tell. Deliberately a
    // day count on one field, not a general "last active" signal.
    currentlyAgeDays,
    promptAnswers: profile.promptAnswers,
    interests: profile.interests,
    status: profile.status,
    wantsKids: profile.wantsKids,
    diet: profile.diet,
    languages: profile.languages,
    religion: profile.religion,
    distance,
  };
}

export { MAX_ONE_LINE_LENGTH };
