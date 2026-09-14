import { useEffect, useState } from "react";
import {
  ApiError,
  getPrompts,
  getProfile,
  getProfilePreview,
  saveProfile,
  type OwnProfile,
  type PromptBank,
  type PublicProfile,
} from "../lib/api";
import { ProfileRead } from "./ProfileRead";

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

/**
 * Three, deliberately. "Has children" is a fourth thing the API still
 * accepts and still renders, but it is a different question wearing the
 * same coat — this one is about what you want, and three answers cover it.
 */
const KIDS = [
  ["want", "Wants children"],
  ["dont", "Does not want children"],
  ["unsure", "Not sure"],
] as const;

const DIETS = [
  ["veg", "Vegetarian"],
  ["eggetarian", "Eggetarian"],
  ["non_veg", "Eats meat"],
  ["jain", "Jain"],
  ["vegan", "Vegan"],
] as const;

/**
 * A list rather than a text box, so that the same answer is the same
 * value. Saying nothing is the default and stays a real answer — there is
 * no "prefer not to say" chip because not choosing one already is that.
 */
const RELIGIONS = [
  ["hindu", "Hindu"],
  ["muslim", "Muslim"],
  ["christian", "Christian"],
  ["sikh", "Sikh"],
  ["jain", "Jain"],
  ["buddhist", "Buddhist"],
  ["parsi", "Parsi"],
  ["jewish", "Jewish"],
  ["spiritual", "Spiritual, not religious"],
  ["atheist", "Atheist"],
  ["agnostic", "Agnostic"],
  ["other", "Something else"],
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
  diet: string;
  religion: string;
  wantsKids: string;
  ageMin: string;
  ageMax: string;
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
  diet: "",
  religion: "",
  wantsKids: "",
  // The same defaults the column carries, so an unsaved page and a stored
  // one say the same thing.
  ageMin: "18",
  ageMax: "45",
};

const AGE_FLOOR = 18;
const AGE_CEILING = 60;
/** The narrowest band anybody may ask for. Four years, not one. */
const AGE_WINDOW = 4;

/**
 * Two handles that cannot cross, and cannot close to nothing.
 *
 * Typed boxes let a person enter 22 to 21, which is not a range — and the
 * first version quietly re-read it as 21 to 22 rather than saying so,
 * which is worse than refusing: what the page showed and what was stored
 * were different things. Here the pair is repaired at the moment of the
 * drag, by pushing the handle that was NOT moved, so the invalid state
 * never exists to be displayed or saved.
 */
function clampAges(min: number, max: number, moved: "min" | "max") {
  const lo = Math.min(Math.max(min, AGE_FLOOR), AGE_CEILING - AGE_WINDOW);
  const hi = Math.max(Math.min(max, AGE_CEILING), AGE_FLOOR + AGE_WINDOW);
  if (hi - lo >= AGE_WINDOW) return { lo, hi };
  return moved === "min" ? { lo, hi: lo + AGE_WINDOW } : { lo: hi - AGE_WINDOW, hi };
}

/**
 * The band as both the sliders and the save read it, so the number on
 * screen is the number that is stored. A value that cannot be read at all
 * — an older stored draft, a hand-edited one — falls back to what the
 * server already holds rather than to the widest legal answer, since
 * widening this band means letting more people write to you.
 */
function ageRange(draft: Draft, stored: OwnProfile["preferences"]) {
  const read = (raw: string, fallback: number) => {
    const n = Math.trunc(Number(raw));
    return Number.isFinite(n) && n >= AGE_FLOOR && n <= AGE_CEILING ? n : fallback;
  };
  const { lo, hi } = clampAges(read(draft.ageMin, stored.ageMin), read(draft.ageMax, stored.ageMax), "min");
  return { ageMin: lo, ageMax: hi };
}

const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Where an unsaved page is kept.
 *
 * This is the longest thing anyone writes here, usually on a phone, and a
 * phone evicts a backgrounded tab without asking. Losing a letter to a
 * notification is the likeliest reason someone starts a profile and never
 * finishes one. Cleared the moment a save succeeds, so a stored draft only
 * ever exists for a page that was never sent.
 */
const STORAGE_KEY = "tummile:profile-draft";

function readStoredDraft(): Partial<Draft> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Draft>) : null;
  } catch {
    return null; // private window, or storage turned off
  }
}

export function ProfileEdit({ onSaved }: { onSaved?: () => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [bank, setBank] = useState<PromptBank | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [preview, setPreview] = useState<PublicProfile | null>(null);
  // Preferences are stored as one object, so the two nobody can set yet
  // have to travel back out untouched rather than be rewritten to their
  // defaults every time somebody saves a page.
  const [prefs, setPrefs] = useState<OwnProfile["preferences"]>({
    ageMin: 18,
    ageMax: 45,
    distanceRadiusKm: 40,
    openToLongDistance: false,
  });

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
          diet: p.diet ?? "",
          religion: p.religion ?? "",
          wantsKids: p.wantsKids ?? "",
          ageMin: String(p.preferences?.ageMin ?? 18),
          ageMax: String(p.preferences?.ageMax ?? 45),
        });
        if (p.preferences) setPrefs(p.preferences);
      })
      .catch(() => undefined)
      .finally(() => {
        // Anything unsaved wins over what the server last heard.
        const stored = readStoredDraft();
        if (stored) setDraft((d) => ({ ...d, ...stored }));
        setRestored(true);
      });
  }, []);

  // Only after the load has settled, or the empty form would overwrite the
  // very draft it is about to restore.
  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Storage full or refused. Losing the safety net is not worth an error.
    }
  }, [draft, restored]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Read through the same function the save uses, so the pair on screen
  // and the pair that gets stored cannot be two different things.
  const ages = ageRange(draft, prefs);
  const setAges = (min: number, max: number, moved: "min" | "max") => {
    const { lo, hi } = clampAges(min, max, moved);
    setDraft((d) => ({ ...d, ageMin: String(lo), ageMax: String(hi) }));
  };

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
        diet: draft.diet || null,
        religion: draft.religion || null,
        wantsKids: draft.wantsKids || null,
        preferences: { ...prefs, ...ageRange(draft, prefs) },
      });
      setMissing(res.missing);
      setSaved(true);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing to do: the server has it now either way.
      }
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Fetched rather than assembled from the draft on screen, and refetched
   * every time it is opened. The draft is what you are typing; this is
   * what is stored — so unsaved edits correctly do not appear in it, which
   * is the answer to the question people are actually asking.
   */
  async function togglePreview() {
    if (preview) {
      setPreview(null);
      return;
    }
    try {
      setPreview((await getProfilePreview()).profile);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save something first.");
    }
  }

  const oneLineLeft = (bank?.maxOneLineLength ?? 90) - draft.oneLine.length;
  const chosen = new Set(draft.answers.map((a) => a.promptId));

  return (
    <form className="stack" style={{ gap: 34 }} onSubmit={submit}>
      <div className="stack" style={{ gap: 14 }}>
        <button
          type="button"
          className="linkish label"
          style={{ alignSelf: "flex-start" }}
          onClick={togglePreview}
        >
          {preview ? "back to editing" : "read yourself as others do"}
        </button>

        {preview ? (
          <div className="card stack" style={{ gap: 14 }}>
            <p className="meta">
              What is saved, exactly as anybody else reads it. Anything you have changed since the
              last save is not here yet.
            </p>
            <ProfileRead
              profile={preview}
              prompts={new Map((bank?.prompts ?? []).map((p) => [p.id, p.body]))}
            />
          </div>
        ) : null}
      </div>

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

        <div className="stack" style={{ gap: 6 }}>
          <span className="meta">Between these ages</span>
          <p className="prose" style={{ margin: 0 }}>
            {ages.ageMin} to {ages.ageMax}
          </p>
          <input
            aria-label="Youngest"
            type="range"
            min={AGE_FLOOR}
            max={AGE_CEILING}
            value={ages.ageMin}
            onChange={(e) => setAges(Number(e.target.value), ages.ageMax, "min")}
          />
          <input
            aria-label="Oldest"
            type="range"
            min={AGE_FLOOR}
            max={AGE_CEILING}
            value={ages.ageMax}
            onChange={(e) => setAges(ages.ageMin, Number(e.target.value), "max")}
          />
          <span className="meta">
            This works both ways. Someone outside these ages is not shown to you — and you are
            not shown to them, so they cannot write to you either.
          </span>
        </div>
      </section>

      <section className="stack" style={{ gap: 12 }}>
        <h2 className="label">the plain facts</h2>
        {(
          [
            [
              "displayName",
              "Name",
              "text",
              // This page never asks for a college or an employer, for the
              // reason that a small circle needs very little to put a name
              // to a page. A surname is most of that little.
              "A first name is enough. Everyone reading can see it.",
            ],
            ["birthDate", "Date of birth", "date"],
            ["languages", "Languages you would rather talk in", "text"],
            ["interests", "Interests, comma separated", "text"],
          ] as const
        ).map(([key, label, type, hint]) => (
          <label className="stack" style={{ gap: 6 }} key={key}>
            <span className="meta">{label}</span>
            <input
              className="field"
              type={type}
              value={draft[key]}
              onChange={(e) => set(key, e.target.value)}
            />
            {hint ? <span className="meta">{hint}</span> : null}
          </label>
        ))}

        <div className="stack" style={{ gap: 6 }}>
          <span className="meta">Children</span>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {KIDS.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={`chip${draft.wantsKids === value ? " chip-on" : ""}`}
                onClick={() => set("wantsKids", draft.wantsKids === value ? "" : value)}
                aria-pressed={draft.wantsKids === value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="meta">What you eat</span>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {DIETS.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={`chip${draft.diet === value ? " chip-on" : ""}`}
                onClick={() => set("diet", draft.diet === value ? "" : value)}
                aria-pressed={draft.diet === value}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="meta">Religion, if you want to say</span>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {RELIGIONS.map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={`chip${draft.religion === value ? " chip-on" : ""}`}
                onClick={() => set("religion", draft.religion === value ? "" : value)}
                aria-pressed={draft.religion === value}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="meta">Leave it alone and it says nothing, which is a real answer.</span>
        </div>
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
                  : "your letter, something in Currently, or one answer"
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
