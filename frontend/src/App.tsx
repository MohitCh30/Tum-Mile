import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, getMe, logout, requestLink, verifyLink, type Me } from "./lib/api";

/* ── the window everything is read through ────────────────────── */

function Scene({ children }: { children: React.ReactNode }) {
  return (
    <div className="scene">
      <div className="lamp" />
      <div className="rain-far" />
      <div className="rain-near" />
      <div className="haze" />
      <div className="grain" />
      <div className="seam" />
      <div className="condensation" />
      <div className="content">{children}</div>
    </div>
  );
}

function Header({ right }: { right?: string }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
      <div className="wordmark">Tum Mile</div>
      {right ? <div className="meta">{right}</div> : null}
    </div>
  );
}

/* ── asking for a link ────────────────────────────────────────── */

function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await requestLink(email);
      setSent(true);
      setDevUrl(res.devUrl ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scene>
      <Header />

      <div className="grow" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 44 }}>
        <div className="stack" style={{ gap: 26 }}>
          <div className="label">people here are read, not looked at</div>
          <div className="said">You will not find a single photograph on this website.</div>
        </div>

        {sent ? (
          <div className="stack">
            <p className="notice">
              If that address can be written to, a link is on its way. It works once, and only for
              the next fifteen minutes.
            </p>
            {devUrl ? (
              <p className="notice">
                Local development — <a href={devUrl}>open the link</a>, or read it in the{" "}
                <a href="http://localhost:8025" target="_blank" rel="noreferrer">Mailpit inbox</a>.
              </p>
            ) : null}
          </div>
        ) : (
          <form className="stack" onSubmit={submit}>
            <label className="label" htmlFor="email">your email address</label>
            <input
              id="email"
              className="field"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="button" type="submit" disabled={busy || email.length === 0}>
              {busy ? "Sending…" : "Send me a link"}
            </button>
            {error ? <p className="notice notice-bad">{error}</p> : null}
            <p className="notice" style={{ color: "var(--muted-deep)" }}>
              No password to forget, and nothing to remember. We only ever ask for an address.
            </p>
          </form>
        )}
      </div>
    </Scene>
  );
}

/* ── coming back through the link ─────────────────────────────── */

function Verify({ onSignedIn }: { onSignedIn: () => void }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const token = params.get("token");

  useEffect(() => {
    if (!token) {
      setError("That link is missing its token.");
      return;
    }
    let cancelled = false;
    verifyLink(token)
      .then(() => {
        if (cancelled) return;
        onSignedIn();
        navigate("/", { replace: true });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? "That link has already been used, or it has expired."
            : "Something went wrong."
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token, navigate, onSignedIn]);

  return (
    <Scene>
      <Header />
      <div className="grow" style={{ display: "flex", alignItems: "center" }}>
        {error ? (
          <div className="stack">
            <p className="notice notice-bad">{error}</p>
            <p className="notice">
              <a href="/">Ask for another one.</a>
            </p>
          </div>
        ) : (
          <p className="notice">Letting you in…</p>
        )}
      </div>
    </Scene>
  );
}

/* ── signed in ────────────────────────────────────────────────── */

function Home({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  async function signOut() {
    try {
      await logout();
    } finally {
      onSignedOut();
    }
  }

  return (
    <Scene>
      <Header right="six left today" />
      <div className="grow" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 40 }}>
        <div className="stack" style={{ gap: 22 }}>
          <div className="label">signed in as {me.email}</div>
          <div className="said">There is nobody here yet. You are the first one in.</div>
        </div>
        <p className="prose">
          Your profile is next — a line, a letter, and what you are reading. Until then there is
          nothing to read and nobody to read it.
        </p>
      </div>
      <div className="row">
        <button className="button button-quiet" onClick={signOut}>Sign out</button>
      </div>
    </Scene>
  );
}

/* ── root ─────────────────────────────────────────────────────── */

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await getMe());
    } catch {
      setMe(null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!loaded) {
    return (
      <Scene>
        <Header />
      </Scene>
    );
  }

  return (
    <Routes>
      <Route path="/verify" element={<Verify onSignedIn={refresh} />} />
      <Route
        path="*"
        element={me ? <Home me={me} onSignedOut={() => setMe(null)} /> : <SignIn />}
      />
    </Routes>
  );
}

export default function Root() {
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}
