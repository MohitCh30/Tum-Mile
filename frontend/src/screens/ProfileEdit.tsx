import { useEffect, useState } from "react";
import {
  ApiError,
  getPrompts,
  getProfile,
  saveProfile,
  type OwnProfile,
  type PromptBank,
} from "../lib/api";

const FORMS: { value: string; label: string; help: string }[] = [
  { value: "letter", label: "A letter", help: "To whoever is reading. It can be short." },
  { value: "memoir", label: "A memoir", help: "One scene, not your life story." },
  { value: "poem", label: "A poem", help: "Line breaks are kept exactly as you type them." },
  { value: "list", label: "A list", help: "For when prose is not the point." },
];

const STATUSES = [
  ["single", "Single"],
  ["newly_single", "Newly single"],
  ["single_long", "Single a long while"],
  ["not_over_ex", "Not over my ex"],
  ["situationship", "In a situationship"],
  ["complicated", "It's complicated"],
  ["not_in_a_hurry", "Single, not in a hurry"],
] as const;

/**
 * Three answers, not a text box. Free text here meant "Female" and "woman"
 * were different people to the matcher, and the pair simply never saw each
 * other. The server stores these same three values.
 */
const GENDERS = [
  ["woman", "A woman"],
  ["man", "A man"],
  ["non-binary", "Non-binary"],
] as const;

type Draft = {
  displayName: string;
  birthDate: string;
  gender: string;
  seeking: string[];
  oneLine: string;
  formType: string;
  formBody: string;
  reading: string;
  watching: string;
  listening: string;
  thinking: string;
  answers: { promptId: string; answer: string }[];
  interests: string;
  languages: string;
  status: string;
};

const EMPTY: Draft = {
  displayName: "",
  birthDate: "",
  gender: "",
  seeking: [],
  oneLine: "",
  formType: "letter",
  formBody: "",
  reading: "",
  watching: "",
  listening: "",
  thinking: "",
  answers: [],
  interests: "",
  languages: "",
  status: "",
};

const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export function ProfileEdit({ onSaved }: { onSaved?: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [bank, setBank] = useState<PromptBank | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPrompts().then(setBank).catch(() => undefined);
    void getProfile()
      .then((res) => {
        setMissing(res.missing);
        const p: OwnProfile | null = res.profile;
        if (!p) return;
        setDraft({
          displayName: p.displayName ?? "",
          birthDate: p.birthDate ? p.birthDate.slice(0, 10) : "",
          gender: p.gender ?? "",
          seeking: p.seeking ?? [],
          oneLine: p.oneLine ?? "",
          formType: p.formType ?? "letter",
          formBody: p.formBody ?? "",
          reading: p.currently?.reading ?? "",
          watching: p.currently?.watching ?? "",
          listening: p.currently?.listening ?? "",
          thinking: p.currently?.thinking ?? "",
          answers: p.promptAnswers ?? [],
          interests: (p.interests ?? []).join(", "),
          languages: (p.languages ?? []).join(", "),
          status: p.status ?? "",
        });
      })
      .catch(() => undefined);
  }, []);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  function toggleAnswer(promptId: string) {
    setDraft((d) => {
      const existing = d.answers.find((a) => a.promptId === promptId);
      if (existing) return { ...d, answers: d.answers.filter((a) => a.promptId !== promptId) };
      if (d.answers.length >= (bank?.maxAnswers ?? 3)) return d;
      return { ...d, answers: [...d.answers, { promptId, answer: "" }] };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await saveProfile({
        displayName: draft.displayName,
        birthDate: draft.birthDate ? new Date(draft.birthDate).toISOString() : undefined,
        gender: draft.gender,
        seeking: draft.seeking,
        oneLine: draft.oneLine || null,
        formType: draft.formType,
        formBody: draft.formBody || null,
        currently: {
          reading: draft.reading || undefined,
          watching: draft.watching || undefined,
          listening: draft.listening || undefined,
          thinking: draft.thinking || undefined,
        },
        promptAnswers: draft.answers.filter((a) => a.answer.trim() !== ""),
        interests: csv(draft.interests),
        languages: csv(draft.languages),
        status: draft.status || null,
      });
      setMissing(res.missing);
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const oneLineLeft = (bank?.maxOneLineLength ?? 90) - draft.oneLine.length;
  const chosen = new Set(draft.answers.map((a) => a.promptId));

  return (
    <form className="stack" style={{ gap: 34 }} onSubmit={submit}>
      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">one line</h2>
        <p className="prose">
          The only thing anyone sees before they decide to read you. Ninety characters.
        </p>
        <input
          className="field"
          maxLength={bank?.maxOneLineLength ?? 90}
          value={draft.oneLine}
          onChange={(e) => set("oneLine", e.target.value)}
          placeholder="One true sentence."
          aria-label="your one line"
        />
        <div className="meta">{oneLineLeft} characters left</div>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">instead of a bio, choose a form</h2>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {FORMS.map((form) => (
            <button
              type="button"
              key={form.value}
              className={`chip${draft.formType === form.value ? " chip-on" : ""}`}
              onClick={() => set("formType", form.value)}
              aria-pressed={draft.formType === form.value}
            >
              {form.label}
            </button>
          ))}
        </div>
        <p className="meta">{FORMS.find((f) => f.value === draft.formType)?.help}</p>
        <textarea
          className="field field-multi"
          rows={8}
          maxLength={2000}
          value={draft.formBody}
          onChange={(e) => set("formBody", e.target.value)}
          aria-label="your writing"
        />
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">currently</h2>
        <p className="prose">Changes often. It goes grey when it stops changing.</p>
        {(
          [
            ["reading", "Reading"],
            ["watching", "Watching"],
            ["listening", "Listening"],
            ["thinking", "Thinking about"],
          ] as const
        ).map(([key, label]) => (
          <label className="stack" style={{ gap: 6 }} key={key}>
            <span className="meta">{label}</span>
            <input
              className="field"
              maxLength={120}
              value={draft[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
      </section>

      <section className="stack" style={{ gap: 14 }}>
        <h2 className="label">answer up to three</h2>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {bank?.prompts.map((prompt) => (
            <button
              type="button"
              key={prompt.id}
              className={`chip${chosen.has(prompt.id) ? " chip-on" : ""}`}
              onClick={() => toggleAnswer(prompt.id)}
              aria-pressed={chosen.has(prompt.id)}
            >
              {prompt.body}
            </button>
          ))}
        </div>
        {draft.answers.map((answer, i) => (
          <label className="stack" style={{ gap: 6 }} key={answer.promptId}>
            <span className="prompt">{bank?.prompts.find((p) => p.id === answer.promptId)?.body}</span>
            <textarea
              className="field field-multi"
              rows={3}
              maxLength={bank?.maxAnswerLength ?? 300}
              value={answer.answer}
              onChange={(e) =>
                setDraft((d) => {
                  const answers = [...d.answers];
                  answers[i] = { ...answers[i], answer: e.target.value };
                  return { ...d, answers };
                })
              }
            />
          </label>
        ))}
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">where you are</h2>
        <p className="prose">Nobody is filtered out by this. It is shown because it is true.</p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {STATUSES.map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={`chip${draft.status === value ? " chip-on" : ""}`}
              onClick={() => set("status", draft.status === value ? "" : value)}
              aria-pressed={draft.status === value}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">you, and who you would like to meet</h2>
        <p className="prose">
          The only thing this decides is who is shown to whom. You are shown to someone
          when each of you is looking for the other.
        </p>

        <div className="stack" style={{ gap: 6 }}>
          <span className="meta">You are</span>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {GENDERS.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={`chip${draft.gender === value ? " chip-on" : ""}`}
                onClick={() => set("gender", value)}
                aria-pressed={draft.gender === value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="meta">You would like to meet</span>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {GENDERS.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={`chip${draft.seeking.includes(value) ? " chip-on" : ""}`}
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    seeking: d.seeking.includes(value)
                      ? d.seeking.filter((g) => g !== value)
                      : [...d.seeking, value],
                  }))
                }
                aria-pressed={draft.seeking.includes(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">the plain facts</h2>
        {(
          [
            ["displayName", "Name", "text"],
            ["birthDate", "Date of birth", "date"],
            ["languages", "Languages you would rather talk in", "text"],
            ["interests", "Interests, comma separated", "text"],
          ] as const
        ).map(([key, label, type]) => (
          <label className="stack" style={{ gap: 6 }} key={key}>
            <span className="meta">{label}</span>
            <input
              className="field"
              type={type}
              value={draft[key]}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
      </section>

      {missing.length > 0 ? (
        <p className="notice">
          Still needed before anyone can read you:{" "}
          {missing
            .map((m) =>
              m === "oneLine"
                ? "your one line"
                : m === "form"
                  ? "your letter, memoir, poem or list"
                  : "something in Currently, or one answer"
            )
            .join(", ")}
          .
        </p>
      ) : null}

      {error ? <p className="notice notice-bad">{error}</p> : null}
      {saved && missing.length === 0 ? <p className="notice">Saved. You are readable.</p> : null}
      {saved && missing.length > 0 ? <p className="notice">Saved.</p> : null}

      <button className="button" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
