import type { Profile, QuestionAnswer } from "../storage/schema.js";
import { ageFrom } from "./profile.js";
import { distanceKm } from "./geo.js";
import { cosineSimilarity } from "../services/embeddings.js";

/**
 * Compatibility, as arithmetic.
 *
 * This is not a model and does not learn. With no users there are no
 * interactions to learn from, and an interaction-trained ranker is exactly
 * what produces the popularity bias and feedback loops catalogued in the
 * research. A weighted score that can be published in full is better on
 * every axis this product cares about.
 *
 * It is TWO-SIDED: how well each satisfies the other, combined with a
 * geometric mean so that a pairing one person is indifferent to cannot be
 * rescued by the other's enthusiasm. That is what dampens the one-sided
 * desirability chase a photo feed produces.
 *
 * Its job here is queue triage — deciding which nine of the people who
 * already chose you are worth reading today — not ranking a browsable
 * feed. You cannot climb it by polishing a profile; you can only be
 * reached by someone spending one of their six.
 */

/** Published weights. Change them in a commit, with a reason. */
export const WEIGHTS = {
  answers: 0.34,
  text: 0.16,
  interests: 0.2,
  languages: 0.08,
  age: 0.08,
  proximity: 0.14,
} as const;

/** A profile seen for the first time gets a hand up, once. */
export const NEWCOMER_BONUS = 0.08;
export const NEWCOMER_DAYS = 14;

export interface Breakdown {
  answers: number | null;
  /** How alike the two people's WRITING is. Null when either has none. */
  text: number | null;
  interests: number;
  languages: number;
  age: number;
  proximity: number;
  newcomer: number;
}

export interface Compatibility {
  score: number;
  breakdown: Breakdown;
  /** Shared ground, for the truthful explanation the PRD asks for. */
  sharedInterests: string[];
  sharedLanguages: string[];
  /** True when one of their three non-negotiables is not met. */
  nonNegotiableConflict: boolean;
}

function overlap(a: readonly string[], b: readonly string[]): string[] {
  const set = new Set(b.map((x) => x.toLowerCase()));
  return a.filter((x) => set.has(x.toLowerCase()));
}

/** Jaccard, so answering "everything" does not buy a higher score. */
function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const shared = overlap(a, b).length;
  const union = new Set([...a.map((x) => x.toLowerCase()), ...b.map((x) => x.toLowerCase())]).size;
  return union === 0 ? 0 : shared / union;
}

/**
 * One direction of the question agreement: how much of what MATTERS TO
 * `mine` does `theirs` actually satisfy. Weight comes from the answerer's
 * own marking, so the score reflects what each person said mattered rather
 * than what keeps anyone on the site.
 */
function satisfaction(
  mine: readonly QuestionAnswer[],
  theirs: readonly QuestionAnswer[]
): { ratio: number | null; unmetNonNegotiable: boolean } {
  if (mine.length === 0 || theirs.length === 0) {
    return { ratio: null, unmetNonNegotiable: false };
  }

  const theirAnswers = new Map(theirs.map((a) => [a.questionId, a.answer]));

  let earned = 0;
  let possible = 0;
  let unmetNonNegotiable = false;

  for (const answer of mine) {
    const theirValue = theirAnswers.get(answer.questionId);
    if (theirValue === undefined) continue;

    const weight = answer.isNonNegotiable ? 8 : 1;
    possible += weight;

    // An empty `acceptable` means "no preference" — everything satisfies.
    const acceptable = answer.acceptable.length === 0 || answer.acceptable.includes(theirValue);
    if (acceptable) earned += weight;
    else if (answer.isNonNegotiable) unmetNonNegotiable = true;
  }

  if (possible === 0) return { ratio: null, unmetNonNegotiable: false };
  return { ratio: earned / possible, unmetNonNegotiable };
}

function ageAffinity(a: Profile, b: Profile, now: Date): number {
  const ageA = ageFrom(a.birthDate, now);
  const ageB = ageFrom(b.birthDate, now);
  const gap = Math.abs(ageA - ageB);
  // Full marks within three years, tapering to nothing at fifteen.
  if (gap <= 3) return 1;
  if (gap >= 15) return 0;
  return 1 - (gap - 3) / 12;
}

function proximity(a: Profile, b: Profile): number {
  const km = distanceKm(a.locationGeohash, b.locationGeohash);
  // Unknown location is neutral rather than penalised — not everyone
  // shares one, and refusing to should not cost them visibility.
  if (km === null) return 0.5;
  if (km < 5) return 1;
  if (km >= 100) return 0;
  return 1 - (km - 5) / 95;
}

/**
 * Text affinity, rescaled to where the signal actually lives.
 *
 * Cosine similarity never approaches 0 for two pieces of English, so the
 * raw number separates nobody. Measured on five deliberately different
 * profiles with this model: two literary ones sat at 0.66, a gym profile
 * and a startup profile at 0.55, and genuinely unrelated pairs at
 * 0.43-0.48. So the useful band is roughly 0.42 to 0.70, and that is what
 * is stretched across 0..1 here.
 *
 * These constants are model-specific. Change the model and they have to
 * be measured again — the numbers above came from running it, not from
 * guessing, and an earlier guess of 0.55-0.95 would have clamped almost
 * every pairing to zero.
 */
function textAffinity(a: Profile, b: Profile): number | null {
  if (!a.embedding || !b.embedding) return null;
  const cosine = cosineSimilarity(a.embedding, b.embedding);
  if (cosine === null) return null;
  const FLOOR = 0.42;
  const CEILING = 0.7;
  return Math.min(1, Math.max(0, (cosine - FLOOR) / (CEILING - FLOOR)));
}

function newcomerBonus(profile: Profile, now: Date): number {
  const days = (now.getTime() - profile.createdAt.getTime()) / 86_400_000;
  if (days >= NEWCOMER_DAYS) return 0;
  return NEWCOMER_BONUS * (1 - days / NEWCOMER_DAYS);
}

export function compatibility(
  viewer: Profile,
  viewerAnswers: readonly QuestionAnswer[],
  candidate: Profile,
  candidateAnswers: readonly QuestionAnswer[],
  now = new Date()
): Compatibility {
  const mine = satisfaction(viewerAnswers, candidateAnswers);
  const theirs = satisfaction(candidateAnswers, viewerAnswers);

  // Geometric mean: neither side can carry a pairing alone.
  const answers =
    mine.ratio === null || theirs.ratio === null
      ? null
      : Math.sqrt(mine.ratio * theirs.ratio);

  const sharedInterests = overlap(viewer.interests, candidate.interests);
  const sharedLanguages = overlap(viewer.languages, candidate.languages);

  const text = textAffinity(viewer, candidate);

  const breakdown: Breakdown = {
    answers,
    text,
    interests: jaccard(viewer.interests, candidate.interests),
    languages: jaccard(viewer.languages, candidate.languages),
    age: ageAffinity(viewer, candidate, now),
    proximity: proximity(viewer, candidate),
    newcomer: newcomerBonus(candidate, now),
  };

  // A term that does not apply — no questions answered, no embedding —
  // has its weight redistributed across the rest, rather than scoring
  // everyone as though they had failed it.
  const usableWeight =
    1 - (answers === null ? WEIGHTS.answers : 0) - (text === null ? WEIGHTS.text : 0);

  let score =
    (answers === null ? 0 : WEIGHTS.answers * answers) +
    (text === null ? 0 : WEIGHTS.text * text) +
    WEIGHTS.interests * breakdown.interests +
    WEIGHTS.languages * breakdown.languages +
    WEIGHTS.age * breakdown.age +
    WEIGHTS.proximity * breakdown.proximity;

  score = score / usableWeight + breakdown.newcomer;

  return {
    score: Math.min(1, Math.max(0, score)),
    breakdown,
    sharedInterests,
    sharedLanguages,
    // Reported to the viewer as the FACT of a conflict, never its content —
    // saying which answer clashed would leak what the other person wrote.
    nonNegotiableConflict: mine.unmetNonNegotiable || theirs.unmetNonNegotiable,
  };
}
