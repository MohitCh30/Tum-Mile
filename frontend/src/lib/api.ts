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

let unauthorized: (() => void) | null = null;

/**
 * Told whenever the server says there is no session.
 *
 * A cookie expires, or you sign out in another tab, and every screen then
 * printed the refusal in red with the navigation still above it and no way
 * back to the sign-in form. One handler, at the one place every request
 * passes through.
 */
export function onUnauthorized(handler: () => void) {
  unauthorized = handler;
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
    if (res.status === 401) unauthorized?.();
    throw new ApiError(err?.code ?? "UNKNOWN", err?.message ?? "Something went wrong.", res.status);
  }

  return data as T;
}

export interface Me {
  email: string;
  emailVerified: boolean;
  hasProfile: boolean;
  isAdmin: boolean;
}

export const getAuthConfig = () =>
  api<{ turnstileSiteKey: string | null }>("/auth/config");

export const requestLink = (email: string, turnstileToken?: string) =>
  api<{ ok: true; devUrl?: string; devCode?: string }>("/auth/request", {
    method: "POST",
    body: { email, turnstileToken },
  });

export const verifyLink = (token: string) =>
  api<{ ok: true }>("/auth/verify", { method: "POST", body: { token } });

export const verifyCode = (email: string, code: string) =>
  api<{ ok: true }>("/auth/verify-code", { method: "POST", body: { email, code } });

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
  diet: string | null;
  religion: string | null;
  wantsKids: string | null;
  preferences: {
    ageMin: number;
    ageMax: number;
    distanceRadiusKm: number;
    openToLongDistance: boolean;
  };
  privacy: { showDistance: boolean };
  /** Whether a coarse cell is stored. Never the cell itself. */
  hasLocation: boolean;
  lastLocationUpdate: string | null;
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
  reason?: "incomplete_profile" | "nobody_new" | "paused";
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
  /** When anyone last wrote here, or null while nobody has. */
  lastAt: string | null;
  /** Whether the last thing said was theirs. Not a read receipt. */
  theirTurn: boolean;
  with: PublicProfile;
}

export const getPrompts = () => api<PromptBank>("/prompts");
export const getProfile = () => api<OwnProfileResponse>("/profile");

/** Yourself, assembled by the server exactly as it assembles anyone else. */
export const getProfilePreview = () => api<{ profile: PublicProfile }>("/profile/preview");
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

/**
 * Takes back a pass made seconds ago. The server refuses an old one, so
 * this is a mistap being corrected, never a decision being revisited.
 */
export const undoPass = (profileId: string) =>
  api<void>(`/passes/${profileId}`, { method: "DELETE" });

export const getInbound = () => api<{ likes: InboundLike[]; budget: Budget }>("/likes/inbound");
export const getMatches = () => api<{ matches: MatchSummary[] }>("/matches");

/** Ends a conversation without barring anyone. Block is the other thing. */
export const leaveMatch = (matchId: string) => api<void>(`/matches/${matchId}`, { method: "DELETE" });

export interface SentLike {
  profileId: string;
  quotedLine: string;
  message: string;
  at: string;
  to: PublicProfile;
}

/**
 * Only the ones still waiting. There is deliberately no way to learn
 * whether yours has been READ — that would be a read receipt, which this
 * product does not have. Declined and expired ones simply leave the list.
 */
export const getSentLikes = () => api<{ likes: SentLike[] }>("/likes/sent");

/** Recalls the words. The like still counts against the day's six. */
export const withdrawLike = (profileId: string) =>
  api<void>(`/likes/${profileId}`, { method: "DELETE" });

/**
 * Asks to move the account. The answer is identical whether the address
 * was free, already an account, malformed, or the one already in use —
 * so there is nothing here to tell a caller which.
 */
export const requestEmailChange = (email: string) =>
  api<{ ok: true; devCode?: string }>("/account/email", { method: "POST", body: { email } });

/** On success every session ends, including this one. */
export const confirmEmailChange = (code: string) =>
  api<void>("/account/email/confirm", { method: "POST", body: { code } });

/** Ends every session including this one, so treat it like signing out. */
export const signOutEverywhere = () => api<void>("/account/sessions", { method: "DELETE" });

export const getPause = () => api<{ paused: boolean }>("/account/pause");
export const setPause = (paused: boolean) =>
  api<{ paused: boolean }>("/account/pause", { method: "PUT", body: { paused } });

/* ── conversation ─────────────────────────────────────────────── */

export interface Message {
  id: string;
  body: string;
  at: string;
  mine: boolean;
  reactions: { reaction: string; mine: boolean }[];
}

export interface Conversation {
  with: { id: string; displayName: string } | null;
  messages: Message[];
  latest: string | null;
}

export const getReactions = () => api<{ reactions: string[] }>("/reactions");

export const getMessages = (matchId: string, after?: string | null) =>
  api<Conversation>(
    `/matches/${matchId}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`
  );

export const sendMessage = (matchId: string, body: string) =>
  api<Message>(`/matches/${matchId}/messages`, { method: "POST", body: { body } });

export const react = (messageId: string, reaction: string) =>
  api<void>(`/messages/${messageId}/reaction`, { method: "PUT", body: { reaction } });

export const unreact = (messageId: string) =>
  api<void>(`/messages/${messageId}/reaction`, { method: "DELETE" });

/* ── safety ───────────────────────────────────────────────────── */

export type ReportReason = "spam" | "harassment" | "scam" | "deception" | "other";

export const blockProfile = (profileId: string) =>
  api<void>("/blocks", { method: "POST", body: { profileId } });

export const getBlocks = () =>
  api<{ blocks: { id: string; name: string; since: string }[] }>("/blocks");

export const unblockProfile = (profileId: string) =>
  api<void>(`/blocks/${profileId}`, { method: "DELETE" });

export const reportProfile = (input: {
  profileId: string;
  reason: ReportReason;
  details?: string;
  /** The conversation it is about, if any — captures their messages. */
  matchId?: string;
  /** The unanswered letter it is about, if any — captures what they wrote. */
  likeId?: string;
}) => api<{ id: string }>("/reports", { method: "POST", body: input });

/* ── account ──────────────────────────────────────────────────── */

export const deleteAccount = () =>
  api<void>("/account", { method: "DELETE", body: { confirm: "delete my account" } });

/* ── moderation (the server refuses all of this to anyone else) ── */

export type ModerationStatus = "active" | "restricted" | "suspended";

export interface ModerationCase {
  id: string;
  profileId: string;
  displayName: string;
  moderationStatus: ModerationStatus;
  strikes: number;
  pending: number;
  opened: string;
}

export interface CaseReport {
  id: string;
  reason: string;
  details: string | null;
  evidence: { messageId: string; body: string; at: string; source?: "message" | "scene" }[];
  status: string;
  at: string;
}

export const getCases = () => api<{ cases: ModerationCase[] }>("/admin/cases");

export const getCaseReports = (caseId: string) =>
  api<{ reports: CaseReport[] }>(`/admin/cases/${encodeURIComponent(caseId)}/reports`);

export const decideReport = (reportId: string, decision: "actioned" | "dismissed", note?: string) =>
  api<{ decision: string; strikes: number; restricted: boolean }>(
    `/admin/reports/${encodeURIComponent(reportId)}`,
    { method: "PATCH", body: { decision, note: note || undefined } }
  );

export const setProfileStatus = (profileId: string, moderationStatus: ModerationStatus) =>
  api<{ moderationStatus: ModerationStatus }>(`/admin/profiles/${encodeURIComponent(profileId)}`, {
    method: "PATCH",
    body: { moderationStatus },
  });

export const getNotifications = () =>
  api<{ emailWhenWaiting: boolean }>("/account/notifications");

export const setNotifications = (emailWhenWaiting: boolean) =>
  api<{ emailWhenWaiting: boolean }>("/account/notifications", {
    method: "PUT",
    body: { emailWhenWaiting },
  });

/* ── the daily question ───────────────────────────────────────── */

export interface QuestionCard {
  id: string;
  body: string;
  options: string[];
}

export interface NextQuestions {
  stage: "onboarding" | "daily" | "done";
  questions?: QuestionCard[];
  remaining?: number;
  of?: number;
  answered?: number;
  total?: number;
  nonNegotiablesUsed: number;
  maxNonNegotiable: number;
}

export interface MyAnswer {
  questionId: string;
  body: string;
  options: string[];
  answer: string;
  acceptable: string[];
  isNonNegotiable: boolean;
}

export const getNextQuestions = () => api<NextQuestions>("/questions/next");

export const getMyAnswers = () =>
  api<{ answers: MyAnswer[]; nonNegotiablesUsed: number; maxNonNegotiable: number }>(
    "/questions/mine"
  );

export const answerQuestion = (
  id: string,
  body: { answer: string; acceptable?: string[]; isNonNegotiable?: boolean }
) => api<{ nonNegotiablesUsed: number }>(`/questions/${id}/answer`, { method: "PUT", body });

export const unanswerQuestion = (id: string) =>
  api<void>(`/questions/${id}/answer`, { method: "DELETE" });

/* ── two-handers ──────────────────────────────────────────────── */

export interface PremiseCard {
  id: string;
  title: string;
  blurb: string;
  turnsEach: number;
}

export interface SceneRole {
  name: string;
  who: string;
  wants: string;
  isRoleA?: boolean;
}

export interface Scene {
  id: string;
  matchId: string;
  status: "proposed" | "declined" | "playing" | "letters" | "finished" | "abandoned";
  premise: {
    id: string;
    title: string;
    blurb: string;
    setting: string;
    opensWith: string;
    letterPrompt: string;
    turnsEach: number;
  };
  you: SceneRole;
  them: SceneRole;
  proposedByYou: boolean;
  turnsRemaining: number;
  yourTurn: boolean;
  lines: { ordinal: number; body: string; mine: boolean; speaker: string }[];
  letters: { body: string; mine: boolean; from: string }[];
  youHaveWritten: boolean;
}

export const getPremises = () => api<{ premises: PremiseCard[] }>("/scenes/premises");
export const getScenes = (matchId: string) =>
  api<{ scenes: Scene[] }>(`/matches/${matchId}/scenes`);
export const proposeScene = (matchId: string, premiseId: string) =>
  api<Scene>("/scenes", { method: "POST", body: { matchId, premiseId } });
export const answerScene = (id: string, accept: boolean) =>
  api<Scene>(`/scenes/${id}/answer`, { method: "POST", body: { accept } });
export const sayLine = (id: string, body: string) =>
  api<Scene>(`/scenes/${id}/turns`, { method: "POST", body: { body } });
export const writeLetter = (id: string, body: string) =>
  api<Scene>(`/scenes/${id}/letter`, { method: "POST", body: { body } });
export const abandonScene = (id: string) =>
  api<Scene>(`/scenes/${id}/abandon`, { method: "POST", body: {} });
