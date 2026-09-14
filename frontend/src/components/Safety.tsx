import { useState, type ReactNode } from "react";
import { ApiError, blockProfile, reportProfile, type ReportReason } from "../lib/api";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "harassment", label: "Harassment" },
  { value: "scam", label: "Asking for money" },
  { value: "spam", label: "Spam" },
  { value: "deception", label: "Not who they say they are" },
  { value: "other", label: "Something else" },
];

/**
 * Reporting and blocking, wherever a person appears.
 *
 * This lived inside the conversation screen, which meant both actions only
 * existed AFTER a match — so the one place a stranger can write to you
 * unasked, the inbound letter, had no protective action at all, and a
 * profile in discovery could only be passed. Pass is not a report: it
 * removes them from your view and tells nobody anything.
 *
 * The trigger is deliberately quiet and the menu explains what each thing
 * does before it does it, because the difference between these two matters
 * and nothing else in the app will explain it.
 */
export function Safety({
  profileId,
  name,
  matchId,
  likeId,
  onBlocked,
  children,
  label = "report or block",
}: {
  profileId: string;
  name: string;
  /** The conversation this is about, if there is one. Captures evidence. */
  matchId?: string;
  /** The letter this is about, if there is one. Captures evidence. */
  likeId?: string;
  onBlocked: () => void;
  /** Actions that only make sense in the caller's context, shown first. */
  children?: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState<"none" | "menu" | "report">("none");
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [details, setDetails] = useState("");
  const [reported, setReported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function block() {
    if (busy) return;
    setBusy(true);
    try {
      await blockProfile(profileId);
      onBlocked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await reportProfile({ profileId, reason, details, matchId, likeId });
      setReported(true);
      setOpen("none");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (reported) return <p className="notice">Reported. Nothing is shown to them.</p>;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <button
        className="linkish label"
        style={{ alignSelf: "flex-start" }}
        onClick={() => setOpen(open === "none" ? "menu" : "none")}
      >
        {label}
      </button>

      {open === "menu" ? (
        <div className="card stack" style={{ gap: 14 }}>
          {children}
          <p className="prose">
            If something was wrong rather than merely not for you, report it. What they wrote is
            kept as evidence at that moment, and not afterwards — so report before you block.
          </p>
          <div className="row">
            <button className="button button-quiet grow" onClick={() => setOpen("report")}>
              Report {name}
            </button>
            <button className="button grow" onClick={block} disabled={busy}>
              Block
            </button>
          </div>
          <p className="meta">
            blocking stops them reaching you again and ends anything between you; it is not a
            report, and nobody reads it
          </p>
        </div>
      ) : null}

      {open === "report" ? (
        <form className="card stack" style={{ gap: 14 }} onSubmit={submit}>
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
          <p className="meta">They are never told, and never told it was you.</p>
          <div className="row">
            <button
              type="button"
              className="button button-quiet grow"
              onClick={() => setOpen("menu")}
            >
              Cancel
            </button>
            <button type="submit" className="button grow" disabled={busy}>
              Send the report
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p className="notice notice-bad">{error}</p> : null}
    </div>
  );
}
