export type SessionApi = { email: string; id: string };
export type ProfileApi = {
  id: string;
  displayName: string | null;
  bio: string;
  birthDate: string | null;
  gender: string;
  seeking: string[];
  preferences: { distanceRadiusKm: number; ageMin: number; ageMax: number };
  privacy: { showDistance: boolean };
};

const API_BASE = "/api/v1";

export async function api<T>(path: string, opts?: RequestInit, body?: unknown): Promise<T> {
  const url = `${API_BASE}${path}`;

  let fetched: Response;
  try {
    fetched = await fetch(url, {
      method: opts?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...opts?.headers,
      },
      body: buildBody(body, opts),
      credentials: "include",
    });
  } catch (e: any) {
    throw new Error("Network error");
  }

  // 204 => empty response, callers expect no body
  if (fetched.status === 204) return undefined as T;

  let data: any = null;
  const text = await fetched.text().catch(() => "");
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }

  // API returns { error: { code, message } }
  if (!fetched.ok) {
    const detail = data?.error?.code ?? String(fetched.status);
    const msg = data?.error?.message ?? detail;
    const err = new Error(msg);
    (err as { code: string }).code = detail;
    (err as { status: number }).status = fetched.status;
    throw err;
  }

  return data as T;
}

function buildBody(body: unknown | undefined, opts?: RequestInit): BodyInit | undefined {
  if (!body) return undefined;
  // multipart/form-data => pass the raw form data the browser sent
  if (body instanceof FormData) return body;
  // Blob / File (raw photo upload)
  if (body instanceof Blob) return body;
  // default: JSON
  return JSON.stringify(body);
}