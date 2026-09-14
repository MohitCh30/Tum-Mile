import type { FastifyInstance } from "fastify";
import { resetRateLimits } from "../src/middleware/rate-limit.js";

const API = "/api/v1";

export interface Actor {
  email: string;
  cookie: string;
  profileId: string;
}

function tokenFrom(body: string): string {
  const { devUrl } = JSON.parse(body) as { devUrl?: string };
  if (!devUrl) throw new Error("no devUrl");
  return new URL(devUrl).searchParams.get("token")!;
}

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw[0] : String(raw);
  return header.split(";")[0];
}

/**
 * A verified session with no profile yet.
 *
 * Clears the limiter first: a suite that builds a dozen actors would
 * otherwise trip the real three-an-hour cap during SETUP and fail as a
 * missing token, hiding whatever it meant to test.
 */
export async function signUp(app: FastifyInstance, email: string): Promise<string> {
  resetRateLimits();
  const asked = await app.inject({ method: "POST", url: `${API}/auth/request`, payload: { email } });
  const verified = await app.inject({
    method: "POST",
    url: `${API}/auth/verify`,
    payload: { token: tokenFrom(asked.body) },
  });
  return cookieFrom(verified);
}

export interface ProfileOptions {
  displayName?: string;
  gender?: string;
  seeking?: string[];
  age?: number;
  oneLine?: string;
  interests?: string[];
  languages?: string[];
  location?: { lat: number; lon: number } | null;
  ageMin?: number;
  ageMax?: number;
  distanceRadiusKm?: number;
  openToLongDistance?: boolean;
}

/** A verified actor with a complete, discoverable profile. */
export async function makeActor(
  app: FastifyInstance,
  email: string,
  options: ProfileOptions = {}
): Promise<Actor> {
  const cookie = await signUp(app, email);
  const age = options.age ?? 27;
  const birthDate = new Date(Date.UTC(new Date().getUTCFullYear() - age, 0, 15));

  const res = await app.inject({
    method: "PUT",
    url: `${API}/profile`,
    headers: { cookie },
    payload: {
      displayName: options.displayName ?? email.split("@")[0],
      birthDate: birthDate.toISOString(),
      gender: options.gender ?? "woman",
      seeking: options.seeking ?? ["man"],
      oneLine: options.oneLine ?? "I read too late and apologise for it in the morning.",
      formType: "letter",
      formBody: "I have started this four times.\nEach time it became a list.",
      currently: { reading: "गुनाहों का देवता, slowly" },
      promptAnswers: [{ promptId: "annoying-book", answer: "The Alchemist." }],
      interests: options.interests ?? ["books"],
      languages: options.languages ?? ["Hindi", "English"],
      status: "not_over_ex",
      preferences: {
        ageMin: options.ageMin ?? 18,
        ageMax: options.ageMax ?? 60,
        distanceRadiusKm: options.distanceRadiusKm ?? 70,
        openToLongDistance: options.openToLongDistance ?? true,
      },
      privacy: { showDistance: true },
      location: options.location === undefined ? { lat: 19.076, lon: 72.877 } : options.location,
    },
  });

  if (res.statusCode !== 200) {
    throw new Error(`profile setup failed (${res.statusCode}): ${res.body}`);
  }

  return { email, cookie, profileId: JSON.parse(res.body).profile.id };
}

export { API };
