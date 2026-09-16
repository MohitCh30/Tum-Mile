import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  deleteAccount,
  getBlocks,
  getMe,
  confirmEmailChange,
  getNotifications,
  getPause,
  requestEmailChange,
  setNotifications,
  setPause,
  signOutEverywhere,
  unblockProfile,
  type Me,
} from "../lib/api";

/**
 * Privacy controls that read as ordinary settings rather than a security
 * console — who you have blocked, a copy of your own data, and leaving.
 */
export function Account({ onGone }: { onGone: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [blocks, setBlocks] = useState<{ id: string; name: string; since: string }[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [noteOn, setNoteOn] = useState<boolean | null>(null);
  const [paused, setPausedState] = useState<boolean | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [askedCode, setAskedCode] = useState(false);
  const [code, setCode] = useState("");

  async function load() {
    try {
      const who = await getMe();
      setMe(who);
      // Blocks and the note belong to a profile; before one exists there
      // is nothing to ask for, and asking only produced a refusal.
      if (who.hasProfile) {
        setBlocks((await getBlocks()).blocks);
        setNoteOn((await getNotifications()).emailWhenWaiting);
        setPausedState((await getPause()).paused);
      }
    } catch {
      // A signed-out or profile-less account simply shows less.
    }
  }

  async function toggleNote() {
    if (noteOn === null) return;
    try {
      setNoteOn((await setNotifications(!noteOn)).emailWhenWaiting);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function askEmailChange() {
    setError(null);
    try {
      await requestEmailChange(newEmail);
      // The same screen whether that address was free, already an account,
      // or malformed. The server does not say which, so neither does this.
      setAskedCode(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function submitEmailCode() {
    setError(null);
    try {
      await confirmEmailChange(code);
      // Every session ended, this one included, so there is nothing left
      // to show here.
      onGone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function togglePause() {
    if (paused === null) return;
    try {
      setPausedState((await setPause(!paused)).paused);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function unblock(profileId: string) {
    await unblockProfile(profileId);
    await load();
  }

  async function endSessions() {
    setError(null);
    try {
      await signOutEverywhere();
      // This browser was one of them, so there is nothing left to show.
      onGone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function remove() {
    setError(null);
    try {
      await deleteAccount();
      onGone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="stack" style={{ gap: 36 }}>
      <section className="stack" style={{ gap: 10 }}>
        <h2 className="label">your account</h2>
        <p className="prose">{me?.email}</p>
      </section>

      {noteOn !== null ? (
        <section className="stack" style={{ gap: 12 }}>
          <h2 className="label">a note when something is waiting</h2>
          <p className="prose">
            Nothing here ever notifies you. If you would rather not have to check, we can send one
            short email, at most once a day, saying only that something is waiting, never who, and
            never what.
          </p>
          <button
            className={`chip${noteOn ? " chip-on" : ""}`}
            aria-pressed={noteOn}
            onClick={toggleNote}
            style={{ alignSelf: "flex-start" }}
          >
            {noteOn ? "On, one note a day at most" : "Off"}
          </button>
        </section>
      ) : null}

      {me ? (
        <section className="stack" style={{ gap: 12 }}>
          <h2 className="label">the address you sign in with</h2>
          <p className="prose">
            Currently {me.email}. Moving the account sends a code to the new address and a warning
            to this one. Nothing changes until the code comes back. When it does, everyone signed in
            is signed out, including you, here.
          </p>
          {askedCode ? (
            <div className="stack" style={{ gap: 10 }}>
              <p className="prose">
                If that address can be used, a six-digit code is on its way to it. It lasts fifteen
                minutes.
              </p>
              <input
                className="field"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                aria-label="the code sent to the new address"
              />
              <div className="row">
                <button
                  className="button button-quiet grow"
                  onClick={() => {
                    setAskedCode(false);
                    setCode("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="button grow"
                  disabled={code.trim().length !== 6}
                  onClick={submitEmailCode}
                >
                  Move the account
                </button>
              </div>
            </div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              <input
                className="field"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="the new address"
                aria-label="the new address"
              />
              <button
                className="button button-quiet"
                disabled={newEmail.trim().length < 3}
                onClick={askEmailChange}
                style={{ alignSelf: "flex-start" }}
              >
                Send a code to it
              </button>
            </div>
          )}
        </section>
      ) : null}

      {me?.hasProfile && paused !== null ? (
        <section className="stack" style={{ gap: 12 }}>
          <h2 className="label">stepping away</h2>
          <p className="prose">
            Nobody can read you, and there is nobody here to read, until you come back. Your page,
            your conversations and your matches are left exactly as they are. This is not leaving,
            and nothing is deleted.
          </p>
          <button
            className={`chip${paused ? " chip-on" : ""}`}
            aria-pressed={paused}
            onClick={togglePause}
            style={{ alignSelf: "flex-start" }}
          >
            {paused ? "Away, and nobody can see you" : "Here, and readable"}
          </button>
        </section>
      ) : null}

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">people you have blocked</h2>
        {blocks.length === 0 ? (
          <p className="prose">Nobody.</p>
        ) : (
          <ul className="facts" style={{ flexDirection: "column", gap: 10 }}>
            {blocks.map((b) => (
              <li className="row" key={b.id} style={{ justifyContent: "space-between" }}>
                <span className="prose">{b.name}</span>
                <button className="linkish label" onClick={() => unblock(b.id)}>
                  unblock
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="meta">
          unblocking does not bring back a conversation; those are deleted for good
        </p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">a copy of your data</h2>
        <p className="prose">
          Everything you wrote and every choice you made, as a file. Messages other people sent you
          are their words, not yours, so they are not in it.
        </p>
        <a className="button" href="/api/v1/account/export">
          Download it
        </a>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">signed in somewhere you are not</h2>
        <p className="prose">
          Ends every session, on every machine, including this one. Use it if you left yourself
          signed in somewhere you no longer are. Nothing you wrote is touched.
        </p>
        <button className="button button-quiet" onClick={endSessions} style={{ alignSelf: "flex-start" }}>
          Sign out everywhere
        </button>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">leaving</h2>
        <p className="prose">
          Erased: your address, your sessions, everything on your page, every like and pass, and
          every message you sent, including the ones in other people's conversations.
        </p>
        <p className="prose">
          Kept: reports other people filed about this account, and the log of actions taken. Neither
          holds anything you wrote. They stay so that leaving cannot be used to clear a record.
        </p>

        {confirming ? (
          <div className="stack" style={{ gap: 10 }}>
            <label className="label" htmlFor="confirm">
              type: delete my account
            </label>
            <input
              id="confirm"
              className="field"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
            <div className="row">
              <button className="button button-quiet grow" onClick={() => setConfirming(false)}>
                Keep it
              </button>
              <button
                className="button grow"
                disabled={typed !== "delete my account"}
                onClick={remove}
              >
                Delete for good
              </button>
            </div>
          </div>
        ) : (
          <button className="button button-quiet" onClick={() => setConfirming(true)}>
            Delete my account
          </button>
        )}

        {error ? <p className="notice notice-bad" role="status">{error}</p> : null}
      </section>

      <p className="meta">
        <Link className="linkish meta" to="/privacy">
          what we keep
        </Link>{" "}
        ·{" "}
        <Link className="linkish meta" to="/terms">
          the rules
        </Link>
      </p>
    </div>
  );
}
