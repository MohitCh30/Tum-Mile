import { describe, it, expect } from "vitest";
import { embeddableText, cosineSimilarity, embed } from "../../src/services/embeddings.js";
import { compatibility, WEIGHTS } from "../../src/lib/compatibility.js";
import type { Profile } from "../../src/storage/schema.js";

/** A profile row, filled only where a test cares. */
function profileOf(patch: Partial<Profile> = {}): Profile {
  return {
    id: "p1",
    authUserId: "u1",
    displayName: "Someone",
    birthDate: new Date(Date.UTC(1997, 0, 1)),
    gender: "woman",
    seeking: ["man"],
    oneLine: null,
    formType: null,
    formBody: null,
    currently: {},
    currentlyUpdatedAt: null,
    promptAnswers: [],
    interests: [],
    status: null,
    wantsKids: null,
    diet: null,
    languages: [],
    religion: null,
    preferences: { ageMin: 18, ageMax: 60, distanceRadiusKm: 40, openToLongDistance: true },
    privacy: { showDistance: true },
    moderationStatus: "active",
    embedding: null,
    embeddedAt: null,
    locationGeohash: null,
    lastLocationUpdate: null,
    createdAt: new Date(Date.UTC(2020, 0, 1)),
    updatedAt: new Date(Date.UTC(2020, 0, 1)),
    ...patch,
  } as Profile;
}

describe("what gets embedded", () => {
  it("takes the writing", () => {
    const text = embeddableText(
      profileOf({
        oneLine: "I read too late.",
        formBody: "A letter about nothing.",
        promptAnswers: [{ promptId: "annoying-book", answer: "The Alchemist." }],
        currently: { reading: "गुनाहों का देवता" },
      })
    );

    expect(text).toContain("I read too late.");
    expect(text).toContain("A letter about nothing.");
    expect(text).toContain("The Alchemist.");
    expect(text).toContain("गुनाहों का देवता");
  });

  // Embedding a stated fact would quietly turn a filter into a ranking
  // signal — people matched for being vegetarian rather than for what
  // they wrote. Religion especially is filterable and never rankable.
  it("leaves the stated facts out", () => {
    const text = embeddableText(
      profileOf({
        oneLine: "One line.",
        diet: "veg",
        religion: "Hindu",
        status: "not_over_ex",
        languages: ["Hindi", "Urdu"],
        displayName: "Meher",
      })
    );

    expect(text).toBe("One line.");
    expect(text).not.toContain("veg");
    expect(text).not.toContain("Hindu");
    expect(text).not.toContain("Meher");
  });

  it("is empty for a profile with nothing written on it", () => {
    expect(embeddableText(profileOf())).toBe("");
  });

  it("returns nothing for empty text, without needing the model", async () => {
    expect(await embed("   ")).toBeNull();
  });

  // Disabled here (see vitest.config.ts), which is itself the guarantee
  // that the product does not depend on it.
  it("returns nothing when the feature is switched off", async () => {
    expect(await embed("a real sentence with words in it")).toBeNull();
  });
});

describe("cosine similarity", () => {
  it("is 1 for a vector against itself and 0 for orthogonal ones", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBeCloseTo(-1);
  });

  it("refuses mismatched or empty vectors rather than guessing", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
    expect(cosineSimilarity([], [])).toBeNull();
  });
});

describe("the score without embeddings", () => {
  it("reports the text term as not applicable rather than as a failure", () => {
    const fit = compatibility(profileOf(), [], profileOf({ id: "p2" }), []);
    expect(fit.breakdown.text).toBeNull();
    expect(fit.score).toBeGreaterThan(0);
  });

  // The weight of a term that does not apply is redistributed, so two
  // people are not scored as though they had failed a test nobody sat.
  it("does not penalise a pairing for a term that cannot be computed", () => {
    const shared = { interests: ["books"], languages: ["Hindi"] };
    const withoutText = compatibility(
      profileOf(shared),
      [],
      profileOf({ id: "p2", ...shared }),
      []
    );

    // Same pairing, but now both sides have an identical embedding, so
    // the text term is a perfect 1.
    const vector = new Array(384).fill(0);
    vector[0] = 1;
    const withText = compatibility(
      profileOf({ ...shared, embedding: vector }),
      [],
      profileOf({ id: "p2", ...shared, embedding: vector }),
      []
    );

    expect(withoutText.breakdown.text).toBeNull();
    expect(withText.breakdown.text).toBe(1);
    // Identical writing should help, never hurt.
    expect(withText.score).toBeGreaterThanOrEqual(withoutText.score);
  });

  it("publishes a text weight alongside the others", () => {
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(WEIGHTS.text).toBeGreaterThan(0);
    expect(total).toBeCloseTo(1);
  });
});
