import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  NavLink,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  ApiError,
  getAuthConfig,
  getMatches,
  getMe,
  getPrompts,
  logout,
  requestLink,
  verifyCode,
  verifyLink,
  type MatchSummary,
  type Me,
} from "./lib/api";
import { Discovery } from "./screens/Discovery";
import { ProfileEdit } from "./screens/ProfileEdit";
import { Inbound } from "./screens/Inbound";
import { ProfileRead } from "./screens/ProfileRead";
import { Conversation } from "./screens/Conversation";
import { Account } from "./screens/Account";
import { Questions } from "./screens/Questions";
import { Turnstile } from "./components/Turnstile";
import { Privacy, Terms } from "./screens/Legal";
import { Moderate } from "./screens/Moderate";

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

function Shell({
  children,
  onSignedOut,
  isAdmin = false,
}: {
  children: React.ReactNode;
  onSignedOut: () => void;
  isAdmin?: boolean;
}) {
  async function signOut() {
    try {
      await logout();
    } finally {
      onSignedOut();
    }
  }

  return (
    <Scene>
      <header className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <div className="wordmark">Tum Mile</div>
        <button className="linkish meta" onClick={signOut}>
          sign out
        </button>
      </header>

      <nav className="row nav">
        {[
          ["/", "Read"],
          ["/letters", "Letters"],
          ["/matches", "Matches"],
          ["/you", "You"],
          ["/questions", "Questions"],
          ["/account", "Account"],
          // Offered to the moderator only; the server is the actual gate.
          ...(isAdmin ? [["/moderate", "Moderate"]] : []),
        ].map(([to, label]) => (
          <NavLink key={to} to={to} end={to === "/"} className="navlink">
            {label}
          </NavLink>
        ))}
      </nav>

      <main className="grow" style={{ paddingTop: 30 }}>
        {children}
      </main>
    </Scene>
  );
}

/* ── asking for a link ────────────────────────────────────────── */

function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [humanToken, setHumanToken] = useState<string | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // The code is for the person whose mail app opens links somewhere else.
  // Typed here, the session lands in THIS tab.
  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setCodeError(null);
    try {
      await verifyCode(email, code);
      // A full load, so the app starts from GET /me like any other visit.
      window.location.assign("/");
    } catch {
      setCodeError("That code did not work. It may have expired, or been typed wrong.");
      setChecking(false);
    }
  }

  useEffect(() => {
    // No site key means the check is off; the form works without it.
    getAuthConfig()
      .then((c) => setSiteKey(c.turnstileSiteKey))
      .catch(() => setSiteKey(null));
  }, []);

  const onCheckFailed = useCallback(() => setCheckFailed(true), []);
  const waitingOnCheck = siteKey !== null && humanToken === null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await requestLink(email, humanToken ?? undefined);
      setSent(true);
      setDevUrl(res.devUrl ?? null);
      setDevCode(res.devCode ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Scene>
      <div className="wordmark">Tum Mile</div>
      <div
        className="grow"
        style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 44 }}
      >
        <div className="stack" style={{ gap: 26 }}>
          <div className="label">people here are read, not looked at</div>
          <div className="said">You will not find a single photograph on this website.</div>
        </div>

        {sent ? (
          <div className="stack" style={{ gap: 26 }}>
            <p className="notice">
              If that address can be written to, an email is on its way with a link and a
              six-digit code. Either works once, for the next fifteen minutes.
            </p>

            <form className="stack" onSubmit={submitCode}>
              <label className="label" htmlFor="code">
                the code, if the link opens somewhere else
              </label>
              <input
                id="code"
                className="field field-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
              <button className="button" type="submit" disabled={checking || code.length !== 6}>
                {checking ? "Checking…" : "Sign in"}
              </button>
              {codeError ? <p className="notice notice-bad">{codeError}</p> : null}
            </form>

            <button
              className="linkish meta"
              type="button"
              style={{ alignSelf: "flex-start" }}
              onClick={() => {
                setSent(false);
                setCode("");
                setCodeError(null);
              }}
            >
              use a different address
            </button>

            {devUrl ? (
              <p className="notice">
                Local development: <a href={devUrl}>open the link</a>
                {devCode ? <>, or type {devCode}</> : null}, or read it in the{" "}
                <a href="http://localhost:8025" target="_blank" rel="noreferrer">
                  Mailpit inbox
                </a>
                .
              </p>
            ) : null}
          </div>
        ) : (
          <form className="stack" onSubmit={submit}>
            <label className="label" htmlFor="email">
              your email address
            </label>
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
            <Turnstile siteKey={siteKey} onToken={setHumanToken} onFailed={onCheckFailed} />
            <button
              className="button"
              type="submit"
              disabled={busy || email.length === 0 || waitingOnCheck}
            >
              {busy ? "Sending…" : "Send me a link"}
            </button>
            {checkFailed ? (
              <p className="notice notice-bad">
                The check that keeps scripts out could not load. Reload the page and try again.
              </p>
            ) : null}
            {error ? <p className="notice notice-bad">{error}</p> : null}
            <p className="notice" style={{ color: "var(--muted)" }}>
              No password to forget, and nothing to remember. We only ever ask for an address.
            </p>
            <p className="meta">
              asking for a link means you are eighteen or over and agree to{" "}
              <Link className="linkish meta" to="/terms">
                the rules
              </Link>{" "}
              ·{" "}
              <Link className="linkish meta" to="/privacy">
                what we keep
              </Link>
            </p>
          </form>
        )}
      </div>
    </Scene>
  );
}

function Verify({ onSignedIn }: { onSignedIn: () => void }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef<string | null>(null);
  const token = params.get("token");

  useEffect(() => {
    if (!token) {
      setError("That link is missing its token.");
      return;
    }

    // A link is good exactly once, so it must be spent exactly once.
    // Without this guard React's StrictMode fires the effect twice, the
    // server correctly refuses the second attempt, and a link that just
    // worked reports itself as already used. A double-click did the same.
    if (attempted.current === token) return;
    attempted.current = token;

    verifyLink(token)
      .then(() => {
        onSignedIn();
        navigate("/", { replace: true });
      })
      .catch(async () => {
        // The token may have been spent by an attempt that succeeded —
        // ask who we are before deciding this failed.
        try {
          await getMe();
          onSignedIn();
          navigate("/", { replace: true });
        } catch {
          setError("That link has already been used, or it has expired.");
        }
      });
  }, [token, navigate, onSignedIn]);

  return (
    <Scene>
      <div className="wordmark">Tum Mile</div>
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

/* ── matches ──────────────────────────────────────────────────── */

function Matches() {
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [prompts, setPrompts] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMatches((await getMatches()).matches);
    } catch {
      setMatches([]);
    }
  }, []);

  useEffect(() => {
    void load();
    // Without the bank an answer renders as its slug ("annoying-book")
    // instead of the question it answers.
    void getPrompts()
      .then((bank) => setPrompts(new Map(bank.prompts.map((p) => [p.id, p.body]))))
      .catch(() => undefined);
  }, [load]);

  if (open) {
    return (
      <Conversation
        matchId={open}
        onLeft={() => {
          setOpen(null);
          void load();
        }}
      />
    );
  }

  if (!matches) return <p className="notice">Looking…</p>;

  if (matches.length === 0) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <div className="said said-sm">Nobody yet.</div>
        <p className="prose">
          When you and someone else have both written, they appear here. Nothing announces it.
        </p>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 30 }}>
      {matches.map((match) => (
        <section className="card stack" style={{ gap: 18 }} key={match.id}>
          <ProfileRead profile={match.with} prompts={prompts} />
          <button className="button" onClick={() => setOpen(match.id)}>
            Write to {match.with.displayName}
          </button>
        </section>
      ))}
    </div>
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
        <div className="wordmark">Tum Mile</div>
      </Scene>
    );
  }

  // Readable signed in or out: someone should be able to see what is kept
  // about them before they hand over an address.
  const legal = (page: React.ReactNode) =>
    me ? (
      <Shell onSignedOut={() => setMe(null)} isAdmin={me?.isAdmin ?? false}>{page}</Shell>
    ) : (
      <Scene>
        <div className="wordmark">Tum Mile</div>
        <main className="grow" style={{ paddingTop: 30 }}>
          {page}
        </main>
      </Scene>
    );

  return (
    <Routes>
      <Route path="/verify" element={<Verify onSignedIn={refresh} />} />
      <Route path="/privacy" element={legal(<Privacy />)} />
      <Route path="/terms" element={legal(<Terms />)} />
      {me ? (
        <>
          <Route
            path="/"
            element={
              <Shell onSignedOut={() => setMe(null)} isAdmin={me?.isAdmin ?? false}>
                <Discovery />
              </Shell>
            }
          />
          <Route
            path="/letters"
            element={
              <Shell onSignedOut={() => setMe(null)} isAdmin={me?.isAdmin ?? false}>
                <Inbound />
              </Shell>
            }
          />
          <Route
            path="/matches"
            element={
              <Shell onSignedOut={() => setMe(null)} isAdmin={me?.isAdmin ?? false}>
                <Matches />
              </Shell>
            }
          />
          <Route
            path="/questions"
            element={
              <Shell onSignedOut={() => setMe(null)} isAdmin={me?.isAdmin ?? false}>
                <Questions />
              </Shell>
            }
          />
          <Route
            path="/account"
            element={
              <Shell onSignedOut={() => setMe(null)} isAdmin={me?.isAdmin ?? false}>
                <Account onGone={() => setMe(null)} />
              </Shell>
            }
          />
          <Route
            path="/you"
            element={
              <Shell onSignedOut={() => setMe(null)} isAdmin={me?.isAdmin ?? false}>
                <ProfileEdit onSaved={refresh} />
              </Shell>
            }
          />
          {me.isAdmin ? (
            <Route
              path="/moderate"
              element={
                <Shell onSignedOut={() => setMe(null)} isAdmin>
                  <Moderate />
                </Shell>
              }
            />
          ) : null}
        </>
      ) : (
        <Route path="*" element={<SignIn />} />
      )}
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
