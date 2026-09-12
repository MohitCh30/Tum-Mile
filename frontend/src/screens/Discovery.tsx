import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  getDiscovery,
  getPrompts,
  sendLike,
  sendPass,
  type Budget,
  type DiscoveryResponse,
} from "../lib/api";
import { ProfileRead } from "./ProfileRead";

/**
 * One person at a time.
 *
 * You cannot act until you have chosen a line to answer, and the controls
 * sit below everything they wrote — so reaching them means scrolling past
 * the writing. That is the whole interaction design: the cost of a like is
 * having read.
 */
export function Discovery() {
  const [state, setState] = useState<DiscoveryResponse | null>(null);
  const [prompts, setPrompts] = useState<Map<string, string>>(new Map());
  const [quoted, setQuoted] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [budget, setBudget] = useState<Budget | null>(null);
  const [matched, setMatched] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setQuoted(null);
    setMessage("");
    setError(null);
    try {
      const next = await getDiscovery();
      setState(next);
      if (next.budget) setBudget(next.budget);
    } catch (err) {
      setErrorCode(err instanceof ApiError ? err.code : null);
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }, []);

  useEffect(() => {
    void load();
    void getPrompts()
      .then((bank) => setPrompts(new Map(bank.prompts.map((p) => [p.id, p.body]))))
      .catch(() => undefined);
  }, [load]);

  async function write() {
    if (!state?.profile || !quoted) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendLike(state.profile.id, quoted, message);
      setBudget(result.budget);
      if (result.matched) setMatched(state.profile.displayName);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function pass() {
    if (!state?.profile) return;
    setBusy(true);
    try {
      await sendPass(state.profile.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (matched) {
    // Nothing celebrates. It says what is true and what to do next.
    return (
      <div className="stack" style={{ gap: 26 }}>
        <div className="said said-sm">You stopped at each other.</div>
        <p className="prose">
          {matched} can read you now, and you can read {matched}. Nobody is told you were here.
        </p>
        <button className="button button-quiet" onClick={() => setMatched(null)}>
          Keep reading
        </button>
      </div>
    );
  }

  // A person who has just signed in has no profile, so discovery refuses
  // them. That used to render as one line of error text with nowhere to go,
  // and it was the first thing anyone saw. It is now the way in.
  if (error && !state) {
    return errorCode === "NO_PROFILE" ? (
      <div className="stack" style={{ gap: 22 }}>
        <div className="said said-sm">Nobody here has a photograph.</div>
        <p className="prose">
          People are read instead. Write a line about yourself and one other thing, and you can
          start reading other people. It takes about three minutes, and nobody sees you until you
          are done.
        </p>
        <a className="button" href="/you">
          Write your page
        </a>
      </div>
    ) : (
      <p className="notice notice-bad">{error}</p>
    );
  }
  if (!state) return <p className="notice">Looking…</p>;

  if (!state.profile) {
    return (
      <div className="stack" style={{ gap: 22 }}>
        <div className="said said-sm">
          {state.reason === "incomplete_profile"
            ? "Finish your own page first."
            : "Nobody new tonight."}
        </div>
        <p className="prose">
          {state.reason === "incomplete_profile"
            ? `Still needed before anyone can read you: ${(state.missing ?? [])
                .map((m) =>
                  m === "oneLine"
                    ? "your one line"
                    : "your letter, something in Currently, or one answer"
                )
                .join(", ")}.`
            : "Everyone who fits has been read. More people, or a wider preference, and there will be someone here."}
        </p>
        {state.reason === "incomplete_profile" ? (
          <a className="button" href="/you">
            Finish your page
          </a>
        ) : null}
      </div>
    );
  }

  const shared = state.why?.sharedInterests ?? [];
  const outOfBudget = budget !== null && budget.remaining === 0;

  return (
    <div className="stack" style={{ gap: 34 }}>
      <ProfileRead
        profile={state.profile}
        prompts={prompts}
        onQuote={(line) => setQuoted(line === quoted ? null : line)}
        selected={quoted}
      />

      {shared.length > 0 || state.why?.nonNegotiableConflict ? (
        <p className="meta">
          {shared.length > 0 ? `You both wrote down ${shared.join(" and ")}.` : null}
          {state.why?.nonNegotiableConflict
            ? " You disagree on one of the things they said they will not bend on."
            : null}
        </p>
      ) : null}

      <div className="stack" style={{ gap: 14 }}>
        {quoted ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="label">answering</div>
            <blockquote className="quoted">{quoted}</blockquote>
            <label className="label" htmlFor="reply">
              what you want to say about it
            </label>
            <textarea
              id="reply"
              className="field field-multi"
              rows={3}
              maxLength={600}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Say the thing you actually thought."
            />
          </div>
        ) : (
          <p className="label">choose a line to answer</p>
        )}

        {error ? <p className="notice notice-bad">{error}</p> : null}

        <div className="row">
          <button className="button button-quiet grow" onClick={pass} disabled={busy}>
            Not tonight
          </button>
          <button
            className="button grow"
            onClick={write}
            disabled={busy || !quoted || message.trim().length === 0 || outOfBudget}
          >
            {outOfBudget ? "That is all six" : `Write to ${state.profile.displayName}`}
          </button>
        </div>

        {budget ? (
          <p className="meta">
            {budget.remaining === 0
              ? "that is all six for today"
              : `${budget.remaining} of ${budget.limit} left today`}
          </p>
        ) : null}
      </div>
    </div>
  );
}
