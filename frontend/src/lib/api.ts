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
