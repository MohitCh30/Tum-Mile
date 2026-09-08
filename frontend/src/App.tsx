import { useState, useEffect, useCallback } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";
import { getSession, clearSession } from "./lib/auth";
import { api } from "./lib/api";
import type { ProfileApi } from "./lib/api";

/* ─── types ──────────────────────────────────────────────────────── */

type ApiProfileResponse = {
  profile: ProfileApi | null;
  email: string | null;
};

/* ─── root router ────────────────────────────────────────────────── */

function RouterInner() {
  const [authed, setAuthed] = useState(() => !!getSession());
  const refresh = useCallback(() => setAuthed(!!getSession()), []);

  return (
    <Routes>
      <Route path="/register" element={<RegisterPage onAuthed={refresh} />} />
      <Route path="/login" element={<LoginPage onAuthed={refresh} />} />
      <Route path="/verify" element={<VerifyPage onVerified={refresh} />} />
      <Route
        path="/profile"
        element={authed ? <ProfilePage onLoggedOut={() => setAuthed(false)} /> : <Landing />}
      />
      <Route path="/" element={<Landing />} />
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}

export default function App() {
  return <BrowserRouter><RouterInner /></BrowserRouter>;
}

/* ─── shared layout ──────────────────────────────────────────────── */

function Nav({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 480,
        margin: "40px auto",
        fontFamily: "system-ui, -apple-system, sans-serif",
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Tum Mile</h1>
      <p style={{ fontSize: 13, color: "#555", margin: "0 0 12px" }}>
        Privacy-first dating. Who meets whom — you decide.
      </p>
      <nav
        style={{
          borderBottom: "1px solid #eee",
          paddingBottom: 10,
          marginBottom: 16,
          display: "flex",
          gap: 16,
          fontSize: 14,
        }}
      >
        <Link to="/">Home</Link>
        {getSession() ? (
          <Link to="/profile">My Profile</Link>
        ) : (
          <>
            <Link to="/login">Log in</Link>
            <span style={{ color: "#ccc" }}>|</span>
            <Link to="/register">Register</Link>
          </>
        )}
      </nav>
      <main>{children}</main>
    </div>
  );
}

/* ─── landing page ───────────────────────────────────────────────── */

function Landing() {
  return (
    <Nav>
      <h2 style={{ marginTop: 20 }}>Find someone who fits your world</h2>
      <p>
        Tum Mile uses a single magic link — no password, no friction. We verify
        your email, you set your preferences, and you decide how openly you
        share.
      </p>
      <ul style={{ textAlign: "left" }}>
        <li>Email-only sign-up. No phone number, no OTP spam.</li>
        <li>Your data stays yours. Privacy by design.</li>
        <li>Photo moderation so you control your image.</li>
      </ul>
      <p>
        <Link to="/register">Create an account</Link>
        {" "}·{" "}
        <Link to="/login">Log in</Link>
      </p>
    </Nav>
  );
}

/* ─── auth forms ─────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AuthForm({
  mode,
  onAuthed,
}: {
  mode: "register" | "login";
  onAuthed: () => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const endpoint = mode === "register" ? "/auth/register" : "/auth/login";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDevUrl(null);

    if (!EMAIL_RE.test(email)) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    api<{ ok: boolean; devUrl?: string }>(endpoint, {
      method: "POST",
      body: { email },
    })
      .then((d) => {
        setSent(true);
        if (d.devUrl) setDevUrl(d.devUrl);
      })
      .catch((err: any) => setError(err.message ?? "Request failed."))
      .finally(() => setLoading(false));
  }

  return (
    <Nav>
      <h2>{mode === "register" ? "Create your account" : "Welcome back"}</h2>
      <p style={{ fontSize: 13, color: "#555" }}>
        {mode === "register"
          ? "Enter your email and we'll send a verification link."
          : "Enter your email and we'll send you a magic link."}
      </p>

      {sent && !devUrl && (
        <p style={{ color: "#2a7" }}>Check your inbox for the verification link.</p>
      )}
      {devUrl && (
        <div
          style={{
            background: "#f6ffed",
            border: "1px solid #b7eb8f",
            padding: 12,
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          <p>
            <strong>Dev mode — no email sent</strong>
          </p>
          <p>Open the link below to verify:</p>
          <a href={devUrl} style={{ wordBreak: "break-all" }}>
            {devUrl}
          </a>
          <p style={{ marginTop: 8, color: "#888" }}>
            This link expires in 15 minutes.
          </p>
        </div>
      )}

      {!sent && (
        <form
          onSubmit={onSubmit}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoFocus
              style={{
                width: "100%",
                padding: 8,
                marginTop: 4,
                fontSize: 14,
                boxSizing: "border-box",
              }}
            />
          </label>
          {error && (
            <p style={{ color: "#c00", fontSize: 13 }}>{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{ padding: "10px 16px", fontSize: 14 }}
          >
            {loading
              ? "Sending…"
              : mode === "register"
              ? "Send verification link"
              : "Send magic link"}
          </button>
          <p style={{ fontSize: 13, color: "#888" }}>
            {mode === "register" ? (
              <>
                Already have an account? <Link to="/login">Log in</Link>
              </>
            ) : (
              <>
                Don't have an account? <Link to="/register">Register</Link>
              </>
            )}
          </p>
        </form>
      )}
    </Nav>
  );
}

function RegisterPage({ onAuthed }: { onAuthed: () => void }) {
  return <AuthForm mode="register" onAuthed={onAuthed} />;
}

function LoginPage({ onAuthed }: { onAuthed: () => void }) {
  return <AuthForm mode="login" onAuthed={onAuthed} />;
}

/* ─── verify (magic-link callback) ───────────────────────────────── */

function VerifyPage({ onVerified }: { onVerified: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const token = new URLSearchParams(location.search).get("token");

  useEffect(() => {
    if (!token) return;
    api(`/auth/verify?token=${encodeURIComponent(token)}`, { method: "GET" })
      .then(() => onVerified())
      .catch(() => {})
      .finally(() => navigate("/profile", { replace: true }));
  }, [token, navigate]);

  return <Nav><p>Verifying your email — hold on…</p></Nav>;
}

/* ─── profile page ───────────────────────────────────────────────── */

function ProfilePage({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [response, setResponse] = useState<ApiProfileResponse | null>(null);
  const [profileRow, setProfileRow] = useState<ProfileApi | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    displayName: "",
    bio: "",
    birthDate: "",
    gender: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api<ApiProfileResponse>("/profile")
      .then((d) => {
        setResponse(d);
        if (d.profile) {
          setProfileRow(d.profile);
          setForm({
            displayName: d.profile.displayName ?? "",
            bio: d.profile.bio ?? "",
            birthDate: d.profile.birthDate?.slice(0, 10) ?? "",
            gender: d.profile.gender ?? "",
          });
        }
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload: Record<string, unknown> = {};
    if (form.displayName) payload.displayName = form.displayName;
    if (form.bio) payload.bio = form.bio;
    if (form.birthDate)
      payload.birthDate = new Date(form.birthDate).toISOString();
    if (form.gender) payload.gender = form.gender;

    try {
      const d = await api<{ profile: ProfileApi }>("/profile", {
        method: "PATCH",
        body: payload,
      });
      setProfileRow(d.profile);
      setEditing(false);
    } catch (e: any) {
      setError(e.message ?? "Save failed.");
    }
  }

  async function handleLogout() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    clearSession();
    onLoggedOut();
    navigate("/");
  }

  async function handlePhotoUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const file = f.get("photo");
    if (!(file instanceof File)) return;
    try {
      await api("/profile/photos", { method: "POST", body: file });
      setError("Photo uploaded — pending moderation.");
      setTimeout(() => setError(null), 4000);
    } catch (e: any) {
      setError(e.message ?? "Upload failed.");
    }
  }

  if (loading) return <Nav><p>Loading…</p></Nav>;
  if (error) return <Nav><p style={{ color: "#c00" }}>{error}</p></Nav>;

  return (
    <Nav>
      <p>
        <strong>Signed in as</strong> {response?.email ?? "—"}
      </p>

      {editing ? (
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            maxWidth: 360,
          }}
        >
          <label>
            Display name
            <input
              value={form.displayName}
              onChange={(e) =>
                setForm((f) => ({ ...f, displayName: e.target.value }))
              }
            />
          </label>
          <label>
            Bio
            <textarea
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            />
          </label>
          <label>
            Date of birth
            <input
              type="date"
              value={form.birthDate}
              onChange={(e) =>
                setForm((f) => ({ ...f, birthDate: e.target.value }))
              }
            />
          </label>
          <label>
            Gender
            <input
              value={form.gender}
              onChange={(e) =>
                setForm((f) => ({ ...f, gender: e.target.value }))
              }
            />
          </label>
          <button type="submit">Save profile</button>
          <button
            type="button"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </form>
      ) : profileRow ? (
        <div>
          <p>
            <strong>Name:</strong> {profileRow.displayName ?? "—"}
          </p>
          <p>
            <strong>About:</strong> {profileRow.bio || "—"}
          </p>
          <p>
            <strong>DOB:</strong>{" "}
            {profileRow.birthDate
              ? new Date(profileRow.birthDate).toISOString().slice(0, 10)
              : "—"}
          </p>
          <p>
            <strong>Gender:</strong> {profileRow.gender || "—"}
          </p>
          <button
            onClick={() => setEditing(true)}
            style={{ marginTop: 10 }}
          >
            Edit profile
          </button>
        </div>
      ) : (
        <div>
          <p>No profile yet. Fill in the form to create one.</p>
          <button onClick={() => setEditing(true)}>Create profile</button>
        </div>
      )}

      <hr style={{ margin: "20px 0" }} />
      <form onSubmit={handlePhotoUpload} style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 8px" }}>Profile photo</h3>
        <input
          type="file"
          name="photo"
          accept="image/jpeg,image/png"
          required
        />
        <button type="submit" style={{ marginTop: 8 }}>
          Upload
        </button>
      </form>

      <button onClick={handleLogout}>Log out</button>
    </Nav>
  );
}