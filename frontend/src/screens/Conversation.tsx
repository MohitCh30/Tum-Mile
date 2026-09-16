import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getMessages,
  getReactions,
  leaveMatch,
  react,
  sendMessage,
  unreact,
  type Message,
} from "../lib/api";
import { usePoll } from "../lib/usePoll";
import { Safety } from "../components/Safety";
import { Scenes } from "./Scenes";

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
  const [tab, setTab] = useState<"talk" | "scene">("talk");
  // A tap on a phone over a slow connection is easy to repeat before the
  // first one has visibly done anything. Sending twice duplicates a message;
  // leaving twice succeeds and then shows an error over a thing that worked.
  const [busy, setBusy] = useState(false);
  // A screen reader is told about changes to a live region, not about the
  // region arriving already full. The thread mounts empty and the first
  // poll drops up to two hundred messages into it, so switching the region
  // on before that happens would read the entire conversation aloud — a
  // worse failure than the silence it is meant to fix. This turns on in an
  // effect AFTER the first fill has been committed, which leaves exactly
  // the additions a person wants announced: the ones that arrive while
  // they are sitting there.
  const [announcing, setAnnouncing] = useState(false);
  const filled = useRef(false);

  useEffect(() => {
    if (filled.current && !announcing) setAnnouncing(true);
  }, [messages, announcing]);

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
      // The thread has been delivered once; anything after this is new.
      filled.current = true;
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
    if (draft.trim() === "" || busy) return;
    setError(null);
    setBusy(true);
    try {
      await sendMessage(matchId, draft.trim());
      setDraft("");
      await poll();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setGone(true);
      else setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
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

  async function leave() {
    if (busy) return;
    setBusy(true);
    try {
      await leaveMatch(matchId);
      onLeft();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
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
      </div>

      {withWhom ? (
        <Safety
          profileId={withWhom.id}
          name={withWhom.displayName}
          matchId={matchId}
          label="leave or report"
          onBlocked={onLeft}
        >
          <p className="prose">
            Leaving ends this quietly, for both of you. {withWhom.displayName} is not told, nothing
            of it is kept, and neither of you is barred from anything.
          </p>
          <button className="button button-quiet" onClick={leave} disabled={busy}>
            Leave this conversation
          </button>
        </Safety>
      ) : null}


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
      <ol
        className="conversation"
        aria-live={announcing ? "polite" : "off"}
        aria-relevant="additions"
      >
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

      {error ? <p className="notice notice-bad" role="status">{error}</p> : null}

      <form className="row" onSubmit={send}>
        <input
          className="field grow"
          value={draft}
          maxLength={2000}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say something back"
          aria-label="your message"
        />
        <button className="button" type="submit" disabled={busy || draft.trim() === ""}>
          Send
        </button>
      </form>
      </>
      ) : null}
    </div>
  );
}
