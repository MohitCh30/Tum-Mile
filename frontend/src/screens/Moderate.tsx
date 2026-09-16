import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  decideReport,
  getCaseReports,
  getCases,
  setProfileStatus,
  type CaseReport,
  type ModerationCase,
  type ModerationStatus,
} from "../lib/api";

/**
 * The moderation queue, for the one person who runs this.
 *
 * Offered only when GET /me says you are the moderator, and that is a
 * convenience, not the lock: every call this screen makes is refused by
 * the server to anyone else. Reporters are never shown — a decision is
 * made on what was said, not on who objected.
 *
 * Evidence is set in plain text rather than amber. Amber is for what
 * someone wrote to be read; this is what someone wrote that hurt.
 */

const REASONS: Record<string, string> = {
  spam: "spam",
  harassment: "harassment",
  scam: "a scam",
  deception: "deception: presenting as single, or as someone else",
  other: "something else",
};

const STATUSES: { value: ModerationStatus; label: string; means: string }[] = [
  { value: "active", label: "active", means: "shown to people as normal" },
  { value: "restricted", label: "restricted", means: "hidden from reading; can still sign in" },
  { value: "suspended", label: "suspended", means: "hidden everywhere" },
];

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function Moderate() {
  const [cases, setCases] = useState<ModerationCase[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reports, setReports] = useState<CaseReport[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : "Something went wrong.");

  const loadQueue = useCallback(async () => {
    try {
      setCases((await getCases()).cases);
    } catch (err) {
      fail(err);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  async function open(caseId: string) {
    setError(null);
    setNotice(null);
    setNote("");
    if (openId === caseId) {
      setOpenId(null);
      return;
    }
    try {
      setReports((await getCaseReports(caseId)).reports);
      setOpenId(caseId);
    } catch (err) {
      fail(err);
    }
  }

  async function decide(reportId: string, decision: "actioned" | "dismissed") {
    setBusy(true);
    setError(null);
    try {
      const r = await decideReport(reportId, decision, note.trim());
      setNotice(
        decision === "dismissed"
          ? "Dismissed. No strike."
          : r.restricted
            ? `Strike ${r.strikes}. That is the second, so the account is now restricted.`
            : `Strike ${r.strikes}.`
      );
      setNote("");
      await loadQueue();
      if (openId) setReports((await getCaseReports(openId)).reports);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(profileId: string, status: ModerationStatus) {
    setBusy(true);
    setError(null);
    try {
      await setProfileStatus(profileId, status);
      setNotice(`The account is now ${status}.`);
      await loadQueue();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  if (cases === null) {
    return error ? <p className="notice notice-bad" role="status">{error}</p> : <p className="notice" role="status">Loading…</p>;
  }

  return (
    <div className="stack" style={{ gap: 30 }}>
      <div className="stack" style={{ gap: 10 }}>
        <h2 className="label">reports waiting on you</h2>
        <p className="prose">
          {cases.length === 0
            ? "Nothing. Nobody has reported anyone."
            : "Each is one person someone has reported. Two strikes and they stop being shown to anyone; you can also act directly."}
        </p>
      </div>

      {error ? <p className="notice notice-bad" role="status">{error}</p> : null}
      {notice ? <p className="notice" role="status">{notice}</p> : null}

      <ul className="stack" style={{ gap: 16, listStyle: "none", margin: 0, padding: 0 }}>
        {cases.map((c) => (
          <li key={c.id} className="card stack" style={{ gap: 14 }}>
            <button
              className="linkish"
              onClick={() => open(c.id)}
              aria-expanded={openId === c.id}
              style={{ textAlign: "left" }}
            >
              <div className="name">{c.displayName}</div>
              <div className="meta" style={{ marginTop: 6 }}>
                {c.pending} waiting · {c.strikes} strike{c.strikes === 1 ? "" : "s"} · account{" "}
                {c.moderationStatus} · since {when(c.opened)}
              </div>
            </button>

            {openId === c.id ? (
              <div className="stack" style={{ gap: 22 }}>
                {reports.map((r) => {
                  const waiting = r.status === "submitted" || r.status === "reviewing";
                  return (
                    <section
                      key={r.id}
                      className="stack"
                      style={{ gap: 10, borderTop: "1px solid var(--line-soft)", paddingTop: 16 }}
                    >
                      <div className="label">
                        {REASONS[r.reason] ?? r.reason} · {when(r.at)} ·{" "}
                        {waiting ? "waiting" : r.status}
                      </div>
                      {r.details ? <p className="prose">“{r.details}”</p> : null}

                      {r.evidence.length === 0 ? (
                        <p className="meta">no conversation was attached, so nothing was captured</p>
                      ) : (
                        <ol className="stack" style={{ gap: 8, margin: 0, paddingLeft: 18 }}>
                          {r.evidence.map((e) => (
                            <li key={e.messageId} className="prose">
                              <span className="meta">
                                {e.source === "scene" ? "in a scene" : "message"} · {when(e.at)}
                              </span>
                              <br />
                              {e.body}
                            </li>
                          ))}
                        </ol>
                      )}

                      {waiting ? (
                        <div className="row" style={{ flexWrap: "wrap" }}>
                          <button className="button" disabled={busy} onClick={() => decide(r.id, "actioned")}>
                            Strike
                          </button>
                          <button
                            className="button button-quiet"
                            disabled={busy}
                            onClick={() => decide(r.id, "dismissed")}
                          >
                            Dismiss
                          </button>
                        </div>
                      ) : null}
                    </section>
                  );
                })}

                <label className="label" htmlFor={`note-${c.id}`}>
                  a note for the record, kept with your next decision (optional)
                </label>
                <input
                  id={`note-${c.id}`}
                  className="field"
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />

                <div className="stack" style={{ gap: 10 }}>
                  <div className="label">act on the account directly</div>
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    {STATUSES.map((s) => (
                      <button
                        key={s.value}
                        className={`chip${c.moderationStatus === s.value ? " chip-on" : ""}`}
                        aria-pressed={c.moderationStatus === s.value}
                        disabled={busy || c.moderationStatus === s.value}
                        onClick={() => changeStatus(c.profileId, s.value)}
                        title={s.means}
                      >
                        {s.label}: {s.means}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
