import { useEffect, useState } from "react";
import { ApiError, deleteAccount, getBlocks, getMe, unblockProfile, type Me } from "../lib/api";

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

  async function load() {
    try {
      setMe(await getMe());
      setBlocks((await getBlocks()).blocks);
    } catch {
      // A signed-out or profile-less account simply shows less.
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function unblock(profileId: string) {
    await unblockProfile(profileId);
    await load();
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
          unblocking does not bring back a conversation — those are deleted for good
        </p>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">a copy of your data</h2>
        <p className="prose">
          Everything you wrote and every choice you made, as a file. Messages other people sent you
          are their words, not yours, so they are not in it.
        </p>
        <a className="button" href="/api/v1/account/export" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
          Download it
        </a>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">leaving</h2>
        <p className="prose">
          Erased: your address, your sessions, everything on your page, every like and pass, and
          every message you sent — including the ones in other people's conversations.
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

        {error ? <p className="notice notice-bad">{error}</p> : null}
      </section>
    </div>
  );
}
