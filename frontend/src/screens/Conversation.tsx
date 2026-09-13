import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  blockProfile,
  getMessages,
  getReactions,
  react,
  reportProfile,
  sendMessage,
  unreact,
  type Message,
  type ReportReason,
} from "../lib/api";
import { usePoll } from "../lib/usePoll";
import { Scenes } from "./Scenes";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "harassment", label: "Harassment" },
  { value: "scam", label: "Asking for money" },
  { value: "spam", label: "Spam" },
  { value: "deception", label: "Not who they say they are" },
  { value: "other", label: "Something else" },
];

const POLL_MS = 4000;

/**
 * Two people, text only.
 *
 * Polled rather than pushed, and reading writes nothing anywhere — there
 * is no read receipt, no typing indicator, no last-seen and no way to
 * attach a file, because none of those exist on the server either.
 */
export function Conversation({
  matchId,
  onLeft,
}: {
  matchId: string;
  onLeft: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [withWhom, setWithWhom] = useState<{ id: string; displayName: string } | null>(null);
  const [reactions, setReactions] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [safety, setSafety] = useState<"none" | "menu" | "report">("none");
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [details, setDetails] = useState("");
  const [reported, setReported] = useState(false);
  const [tab, setTab] = useState<"talk" | "scene">("talk");

  const poll = useCallback(async () => {
    try {
      // The whole conversation each time, not just what is new.
      //
      // An incremental cursor only ever returns messages you do not have,
      // so a reaction added to one you DO have never arrives — and
      // reactions are the only interpersonal signal this design keeps.
      // The server caps a conversation at 200 messages, so refetching it
      // is cheap; being clever here was simply wrong.
      const next = await getMessages(matchId);
      if (next.with) setWithWhom(next.with);
      setMessages(next.messages);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setGone(true);
    }
  }, [matchId]);

  usePoll(poll, POLL_MS);

  useEffect(() => {
    void getReactions().then((r) => setReactions(r.reactions)).catch(() => undefined);
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (draft.trim() === "") return;
    setError(null);
    try {
      await sendMessage(matchId, draft.trim());
      setDraft("");
      await poll();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setGone(true);
      else setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function toggleReaction(message: Message, emoji: string) {
    const had = message.reactions.find((r) => r.mine);
    setPickerFor(null);
    try {
      if (had && had.reaction === emoji) await unreact(message.id);
      else await react(message.id, emoji);
      await poll();
    } catch {
      setError("That reaction did not stick.");
    }
  }

  async function block() {
    if (!withWhom) return;
    try {
      await blockProfile(withWhom.id);
      onLeft();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function submitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!withWhom) return;
    try {
      await reportProfile({ profileId: withWhom.id, reason, details, matchId });
      setReported(true);
      setSafety("none");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  if (gone) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <div className="said said-sm">This conversation has ended.</div>
        <p className="prose">
          Either one of you stepped away from it, or it was blocked. Nothing of it remains.
        </p>
        <button className="button button-quiet" onClick={onLeft}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <button className="linkish label" onClick={onLeft}>
          ← everyone
        </button>
        <div className="name">{withWhom?.displayName ?? ""}</div>
        <button className="linkish label" onClick={() => setSafety(safety === "none" ? "menu" : "none")}>
          safety
        </button>
      </div>

      {safety === "menu" ? (
        <div className="card stack" style={{ gap: 14 }}>
          <p className="prose">
            Blocking ends this conversation and deletes it for both of you. Report first if you want
            it looked at. The messages are kept as evidence at that moment, and not after.
          </p>
          <div className="row">
            <button className="button button-quiet grow" onClick={() => setSafety("report")}>
              Report {withWhom?.displayName}
            </button>
            <button className="button grow" onClick={block}>
              Block and delete
            </button>
          </div>
        </div>
      ) : null}

      {safety === "report" ? (
        <form className="card stack" style={{ gap: 14 }} onSubmit={submitReport}>
          <div className="label">what happened</div>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {REASONS.map((r) => (
              <button
                type="button"
                key={r.value}
                className={`chip${reason === r.value ? " chip-on" : ""}`}
                onClick={() => setReason(r.value)}
                aria-pressed={reason === r.value}
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            className="field field-multi"
            rows={3}
            maxLength={1000}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Anything you want to add. Optional."
            aria-label="details"
          />
          <p className="meta">
            They are never told, and never told it was you.
          </p>
          <div className="row">
            <button type="button" className="button button-quiet grow" onClick={() => setSafety("none")}>
              Cancel
            </button>
            <button type="submit" className="button grow">
              Send the report
            </button>
          </div>
        </form>
      ) : null}

      {reported ? <p className="notice">Reported. Nothing is shown to them.</p> : null}

      <div className="row nav" style={{ marginTop: 0 }}>
        {(["talk", "scene"] as const).map((which) => (
          <button
            key={which}
            className={`navlink linkish${tab === which ? " active" : ""}`}
            onClick={() => setTab(which)}
            aria-pressed={tab === which}
          >
            {which === "talk" ? "Talk" : "Play a scene"}
          </button>
        ))}
      </div>

      {tab === "scene" ? (
        <Scenes matchId={matchId} withWhom={withWhom?.displayName ?? "them"} />
      ) : null}

      {tab === "talk" ? (
      <>
      <ol className="conversation">
        {messages.map((message) => (
          <li key={message.id} className={message.mine ? "said-by-me" : "said-by-them"}>
            <div className="bubble">{message.body}</div>
            <div className="row" style={{ gap: 6 }}>
              {message.reactions.map((r) => (
                <span key={r.reaction} className="reaction">
                  {r.reaction}
                </span>
              ))}
              <button
                className="linkish reaction-add"
                onClick={() => setPickerFor(pickerFor === message.id ? null : message.id)}
                aria-label="react to this message"
              >
                +
              </button>
            </div>
            {pickerFor === message.id ? (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {reactions.map((emoji) => (
                  <button
                    key={emoji}
                    className="reaction-pick"
                    onClick={() => toggleReaction(message, emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      {messages.length === 0 ? (
        <p className="prose">
          Nothing said yet. You each answered a line of the other's, which is more than most
          conversations start with.
        </p>
      ) : null}

      {error ? <p className="notice notice-bad">{error}</p> : null}

      <form className="row" onSubmit={send}>
        <input
          className="field grow"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say something back"
          aria-label="your message"
        />
        <button className="button" type="submit" disabled={draft.trim() === ""}>
          Send
        </button>
      </form>
      </>
      ) : null}
    </div>
  );
}
