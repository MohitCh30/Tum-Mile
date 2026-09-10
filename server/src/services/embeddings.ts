import { eq, isNull } from "drizzle-orm";
import { db, profiles } from "../storage/db.js";
import type { Profile } from "../storage/schema.js";
import { config } from "../config.js";

/**
 * Text affinity, computed locally.
 *
 * The model runs in this process from a cached local copy. Nothing is
 * sent anywhere: putting people's writing through a hosted embedding API
 * would hand a third party the entire contents of the product, which is
 * the opposite of what it is for.
 *
 * This is the one honest use of a model here. It needs no interaction
 * data — so the empty-database problem that rules out a learned ranker
 * does not apply — and it can notice that two people circle the same
 * preoccupations without either having listed the same interest.
 *
 * Everything below is optional by construction. The score works with it
 * switched off, and a null embedding simply means that term does not
 * apply to this pairing.
 */

export const EMBEDDING_DIMENSIONS = 384;
const MODEL = "Xenova/bge-small-en-v1.5";

type Extractor = (
  text: string,
  options: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: Float32Array | number[] }>;

let extractor: Extractor | null = null;
let loading: Promise<Extractor | null> | null = null;

async function getExtractor(): Promise<Extractor | null> {
  if (!config.EMBEDDINGS_ENABLED) return null;
  if (extractor) return extractor;

  // One load, shared by every caller that arrives while it is loading.
  loading ??= (async () => {
    try {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Keep the weights beside the code, not in a user's home directory.
      env.cacheDir = config.EMBEDDINGS_CACHE_DIR;
      const pipe = await pipeline("feature-extraction", MODEL);
      extractor = pipe as unknown as Extractor;
      return extractor;
    } catch {
      // No model, no network, no disk — the feature simply does not exist
      // in this deployment, and everything else carries on.
      return null;
    }
  })();

  return loading;
}

/**
 * Warm the model and catch up on anyone without a vector, without
 * blocking startup. Failure is not fatal — the app is correct either way.
 */
export function warmEmbeddings(): void {
  if (!config.EMBEDDINGS_ENABLED) return;
  void (async () => {
    await getExtractor();
    await backfillEmbeddings();
  })();
}

/**
 * The text a profile is embedded from.
 *
 * Only what the person wrote to be read: their line, their chosen form,
 * their answers. Never messages — those are private, and running them
 * through anything is the line this product does not cross. Never the
 * stated facts either: embedding "vegetarian" would quietly turn a
 * filter into a ranking signal.
 */
export function embeddableText(profile: Profile): string {
  const parts: string[] = [];
  if (profile.oneLine) parts.push(profile.oneLine);
  if (profile.formBody) parts.push(profile.formBody);
  for (const answer of profile.promptAnswers ?? []) parts.push(answer.answer);
  for (const value of Object.values(profile.currently ?? {})) {
    if (typeof value === "string" && value.trim() !== "") parts.push(value.trim());
  }
  return parts.join("\n").trim();
}

export async function embed(text: string): Promise<number[] | null> {
  if (text.trim() === "") return null;
  const extract = await getExtractor();
  if (!extract) return null;

  try {
    const output = await extract(text, { pooling: "mean", normalize: true });
    const vector = Array.from(output.data);
    return vector.length === EMBEDDING_DIMENSIONS ? vector : null;
  } catch {
    return null;
  }
}

/**
 * Recompute one profile's vector. Called after a profile is written.
 * Silent on failure: a profile save must never fail because an optional
 * scoring term could not be computed.
 */
export async function updateProfileEmbedding(profileId: string): Promise<boolean> {
  if (!config.EMBEDDINGS_ENABLED) return false;

  const [profile] = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (!profile) return false;

  const vector = await embed(embeddableText(profile));
  if (!vector) return false;

  await db
    .update(profiles)
    .set({ embedding: vector, embeddedAt: new Date() })
    .where(eq(profiles.id, profileId));

  return true;
}

/**
 * Give a vector to anyone written before the feature existed, or before
 * the model could load. Runs in the background at boot and stops at the
 * first failure rather than hammering a model that is not there.
 */
export async function backfillEmbeddings(limit = 200): Promise<number> {
  if (!config.EMBEDDINGS_ENABLED) return 0;
  if (!(await getExtractor())) return 0;

  const pending = await db
    .select()
    .from(profiles)
    .where(isNull(profiles.embedding))
    .limit(limit);

  let done = 0;
  for (const profile of pending) {
    if (embeddableText(profile) === "") continue;
    if (!(await updateProfileEmbedding(profile.id))) break;
    done += 1;
  }
  return done;
}

/**
 * Cosine similarity of two unit vectors, mapped to 0..1.
 *
 * The model normalises its output, so the dot product IS the cosine.
 * Unrelated English measures around 0.43-0.52 with this model rather than
 * 0, so the caller rescales before this becomes a score — see
 * `textAffinity` in lib/compatibility.ts for the measured band.
 */
export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.min(1, Math.max(-1, dot));
}
