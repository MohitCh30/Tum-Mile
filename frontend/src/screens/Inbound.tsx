import { useEffect, useState } from "react";
import { ApiError, getInbound, getPrompts, sendLike, type InboundLike } from "../lib/api";
import { ProfileRead } from "./ProfileRead";

/**
 * Who reached for you. Nine a day at most, chosen by fit rather than by
 * who happened to arrive first — so a backlog cannot bury the one you
 * would have wanted under the earliest nine.
 *
 * Each arrives already attached to a line of yours, so there is never a
 * bare "hey" to answer.
 */
export function Inbound() {
  const [likes, setLikes] = useState<InboundLike[] | null>(null);
  const [prompts, setPrompts] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [quoted, setQuoted] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [matched, setMatched] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await getInbound();
      setLikes(res.likes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  useEffect(() => {
    void load();
    void getPrompts()
      .then((bank) => setPrompts(new Map(bank.prompts.map((p) => [p.id, p.body]))))
      .catch(() => undefined);
  }, []);

  async function writeBack(like: InboundLike) {
    if (!quoted) return;
    setBusy(true);
    setError(null);
    try {
      const res = await sendLike(like.from.id, quoted, reply);
      if (res.matched) setMatched(like.from.displayName);
      setOpen(null);
      setQuoted(null);
      setReply("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (matched) {
    return (
      <div className="stack" style={{ gap: 26 }}>
        <div className="said said-sm">You stopped at each other.</div>
        <p className="prose">You and {matched} can read each other now.</p>
        <button className="button button-quiet" onClick={() => setMatched(null)}>
          Back
        </button>
      </div>
    );
  }

  if (error && !likes) return <p className="notice notice-bad">{error}</p>;
  if (!likes) return <p className="notice">Looking…</p>;

  if (likes.length === 0) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <div className="said said-sm">Nobody has written yet.</div>
        <p className="prose">
          When someone answers a line of yours, it waits here. At most nine a day, so the pile stays
          readable.
        </p>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 30 }}>
      {likes.map((like) => (
        <section className="stack card" style={{ gap: 16 }} key={like.id}>
          <div className="stack" style={{ gap: 8 }}>
            <div className="meta">
              {like.from.displayName}, {like.from.age} answered
            </div>
            <blockquote className="quoted">{like.quotedLine}</blockquote>
          </div>

          <p className="prose">{like.message}</p>

          {open === like.id ? (
            <div className="stack" style={{ gap: 14 }}>
              <ProfileRead
                profile={like.from}
                prompts={prompts}
                onQuote={(line) => setQuoted(line === quoted ? null : line)}
                selected={quoted}
              />
              {quoted ? (
                <div className="stack" style={{ gap: 10 }}>
                  <div className="label">answering</div>
                  <blockquote className="quoted">{quoted}</blockquote>
                  <textarea
                    className="field field-multi"
                    rows={3}
                    maxLength={600}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Say the thing you actually thought."
                    aria-label="your reply"
                  />
                </div>
              ) : (
                <p className="label">choose a line of theirs to answer</p>
              )}
              <div className="row">
                <button
                  className="button button-quiet grow"
                  onClick={() => {
                    setOpen(null);
                    setQuoted(null);
                  }}
                >
                  Close
                </button>
                <button
                  className="button grow"
                  disabled={busy || !quoted || reply.trim().length === 0}
                  onClick={() => writeBack(like)}
                >
                  Write back
                </button>
              </div>
            </div>
          ) : (
            <button className="button button-quiet" onClick={() => setOpen(like.id)}>
              Read {like.from.displayName}
            </button>
          )}
        </section>
      ))}
      {error ? <p className="notice notice-bad">{error}</p> : null}
    </div>
  );
}
