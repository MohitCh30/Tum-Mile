/**
 * Frontend auth helper — session is a single httpOnly cookie,
 * so this just provides session-awareness for UI decisions.
 */

export function getSession(): { email: string } | null {
  try {
    const raw = localStorage.getItem("tum_mile_session");
    if (!raw) return null;
    return JSON.parse(raw) as { email: string };
  } catch {
    return null;
  }
}

export function setSession(value: { email: string }) {
  localStorage.setItem("tum_mile_session", JSON.stringify(value));
}

export function clearSession() {
  localStorage.removeItem("tum_mile_session");
}