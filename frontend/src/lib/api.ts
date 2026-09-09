const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The server answers `{ error: { code, message } }` and nothing else on
 * failure — the message is already safe to show, so we never invent one.
 */
export async function api<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: init?.method ?? "GET",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      credentials: "include",
    });
  } catch {
    throw new ApiError("NETWORK", "Cannot reach the server.", 0);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } })?.error;
    throw new ApiError(err?.code ?? "UNKNOWN", err?.message ?? "Something went wrong.", res.status);
  }

  return data as T;
}

export interface Me {
  email: string;
  emailVerified: boolean;
  hasProfile: boolean;
}

export const requestLink = (email: string) =>
  api<{ ok: true; devUrl?: string }>("/auth/request", { method: "POST", body: { email } });

export const verifyLink = (token: string) =>
  api<{ ok: true }>("/auth/verify", { method: "POST", body: { token } });

export const logout = () => api<{ ok: true }>("/auth/logout", { method: "POST" });

export const getMe = () => api<Me>("/me");

/* ── profile ──────────────────────────────────────────────────── */

export interface Prompt {
  id: string;
  body: string;
  group: "present" | "objects" | "scenes";
}

export interface PromptBank {
  prompts: Prompt[];
  maxAnswers: number;
  maxAnswerLength: number;
  maxOneLineLength: number;
  forms: string[];
}

export interface Currently {
  reading?: string;
  watching?: string;
  listening?: string;
  thinking?: string;
}

export interface OwnProfile {
  id: string;
  displayName: string;
  birthDate: string;
  age: number;
  gender: string;
  seeking: string[];
  oneLine: string | null;
  formType: string | null;
  formBody: string | null;
  currently: Currently;
  promptAnswers: { promptId: string; answer: string }[];
  interests: string[];
  languages: string[];
  status: string | null;
  preferences: {
    ageMin: number;
    ageMax: number;
    distanceRadiusKm: number;
    openToLongDistance: boolean;
  };
  privacy: { showDistance: boolean };
}

export interface OwnProfileResponse {
  profile: OwnProfile | null;
  complete: boolean;
  missing: string[];
}

export interface PublicProfile {
  id: string;
  displayName: string;
  age: number;
  oneLine: string | null;
  formType: string | null;
  formBody: string | null;
  currently: Currently;
  currentlyAgeDays: number | null;
  promptAnswers: { promptId: string; answer: string }[];
  interests: string[];
  status: string | null;
  wantsKids: string | null;
  diet: string | null;
  languages: string[];
  religion: string | null;
  distance: string | null;
}

export interface Budget {
  limit: number;
  used: number;
  remaining: number;
}

export interface DiscoveryResponse {
  profile: PublicProfile | null;
  reason?: "incomplete_profile" | "nobody_new";
  missing?: string[];
  why?: { sharedInterests: string[]; sharedLanguages: string[]; nonNegotiableConflict: boolean };
  budget?: Budget;
}

export interface InboundLike {
  id: string;
  quotedLine: string;
  message: string;
  from: PublicProfile;
}

export interface MatchSummary {
  id: string;
  since: string;
  with: PublicProfile;
}

export const getPrompts = () => api<PromptBank>("/prompts");
export const getProfile = () => api<OwnProfileResponse>("/profile");
export const saveProfile = (patch: Record<string, unknown>) =>
  api<OwnProfileResponse>("/profile", { method: "PUT", body: patch });

export const getDiscovery = () => api<DiscoveryResponse>("/discovery");
export const sendLike = (profileId: string, quotedLine: string, message: string) =>
  api<{ matched: boolean; matchId: string | null; budget: Budget }>("/likes", {
    method: "POST",
    body: { profileId, quotedLine, message },
  });
export const sendPass = (profileId: string) =>
  api<void>("/passes", { method: "POST", body: { profileId } });

export const getInbound = () => api<{ likes: InboundLike[]; budget: Budget }>("/likes/inbound");
export const getMatches = () => api<{ matches: MatchSummary[] }>("/matches");
