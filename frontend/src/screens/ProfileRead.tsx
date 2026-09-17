import type { PublicProfile } from "../lib/api";

const FORM_LABEL: Record<string, string> = {
  letter: "A letter",
  memoir: "A memoir",
  poem: "A poem",
  list: "A list",
};

const CURRENTLY_ORDER: [keyof PublicProfile["currently"], string][] = [
  ["reading", "Reading"],
  ["watching", "Watching"],
  ["listening", "Listening"],
  ["thinking", "Thinking"],
];

const DIET_LABEL: Record<string, string> = {
  veg: "Vegetarian",
  non_veg: "Eats meat",
  eggetarian: "Eggetarian",
  jain: "Jain",
  vegan: "Vegan",
};

const RELIGION_LABEL: Record<string, string> = {
  hindu: "Hindu",
  muslim: "Muslim",
  christian: "Christian",
  sikh: "Sikh",
  jain: "Jain",
  buddhist: "Buddhist",
  parsi: "Parsi",
  jewish: "Jewish",
  spiritual: "Spiritual, not religious",
  atheist: "Atheist",
  agnostic: "Agnostic",
  other: "Something else",
};

const DRINKING_LABEL: Record<string, string> = {
  none: "Doesn't drink",
  social: "Drinks socially",
  regular: "Drinks regularly",
};

const SMOKING_LABEL: Record<string, string> = {
  none: "Doesn't smoke",
  social: "Smokes socially",
  regular: "Smokes regularly",
};

const SLEEP_LABEL: Record<string, string> = {
  early_riser: "Early riser",
  night_owl: "Night owl",
  depends: "Depends on the day",
};

const STATUS_LABEL: Record<string, string> = {
  single: "Single",
  newly_single: "Newly single",
  single_long: "Single a long while",
  not_over_ex: "Not over my ex",
  situationship: "In a situationship",
  complicated: "It's complicated",
  not_in_a_hurry: "Single, not in a hurry",
};

/**
 * Someone read, not looked at. The order is deliberate: the line they
 * wrote, then what they are in the middle of, then what they answered,
 * and only at the very bottom the stated facts. Nothing here is a badge.
 *
 * `onQuote` turns every quotable line into a control — that is how a
 * reply gets attached to a specific sentence rather than to a person.
 */
export function ProfileRead({
  profile,
  prompts,
  onQuote,
  selected,
}: {
  profile: PublicProfile;
  /** id -> the question itself, so an answer is never shown as a slug. */
  prompts?: Map<string, string>;
  onQuote?: (line: string) => void;
  selected?: string | null;
}) {
  const quotable = (line: string, key: string) =>
    onQuote ? (
      <button
        key={key}
        type="button"
        className={`quotable${selected === line ? " quotable-on" : ""}`}
        onClick={() => onQuote(line)}
        aria-pressed={selected === line}
      >
        {line}
      </button>
    ) : (
      <span key={key}>{line}</span>
    );

  const currently = CURRENTLY_ORDER.filter(([key]) => {
    const value = profile.currently?.[key];
    return typeof value === "string" && value.trim() !== "";
  });

  const facts = [
    profile.status ? (STATUS_LABEL[profile.status] ?? profile.status) : null,
    profile.wantsKids === "want"
      ? "Wants children"
      : profile.wantsKids === "dont"
        ? "Does not want children"
        : profile.wantsKids === "unsure"
          ? "Unsure about children"
          : profile.wantsKids === "have"
            ? "Has children"
            : null,
    profile.languages.length > 0 ? profile.languages.join(", ") : null,
    profile.diet ? (DIET_LABEL[profile.diet] ?? profile.diet) : null,
    profile.drinking ? (DRINKING_LABEL[profile.drinking] ?? profile.drinking) : null,
    profile.smoking ? (SMOKING_LABEL[profile.smoking] ?? profile.smoking) : null,
    profile.sleepRhythm ? (SLEEP_LABEL[profile.sleepRhythm] ?? profile.sleepRhythm) : null,
    profile.religion ? (RELIGION_LABEL[profile.religion] ?? profile.religion) : null,
  ].filter((f): f is string => Boolean(f));

  return (
    <article className="stack" style={{ gap: 30 }}>
      <div className="stack" style={{ gap: 7 }}>
        <div className="name">
          {profile.displayName}, {profile.age}
        </div>
        {profile.distance ? <div className="meta">{profile.distance}</div> : null}
      </div>

      {profile.oneLine ? (
        <div className="said said-sm">{quotable(profile.oneLine, "one-line")}</div>
      ) : null}

      {profile.formBody ? (
        <section className="stack" style={{ gap: 12 }}>
          <h2 className="label">{profile.formType ? FORM_LABEL[profile.formType] : "Their writing"}</h2>
          <div className={`prose form-${profile.formType ?? "letter"}`}>
            {profile.formBody.split(/\r?\n/).map((line, i) =>
              line.trim() === "" ? (
                <br key={`br-${i}`} />
              ) : (
                <div key={`l-${i}`}>{quotable(line.trim(), `form-${i}`)}</div>
              )
            )}
          </div>
        </section>
      ) : null}

      {currently.length > 0 ? (
        <section className="stack" style={{ gap: 13 }}>
          <h2 className="label">
            Currently
            {profile.currentlyAgeDays !== null && profile.currentlyAgeDays > 14 ? (
              <span className="stale"> · last changed {profile.currentlyAgeDays} days ago</span>
            ) : null}
          </h2>
          <dl className="currently">
            {currently.map(([key, heading]) => (
              <div className="currently-row" key={key}>
                <dt className="meta">{heading}</dt>
                <dd className="prose">{quotable(profile.currently[key]!.trim(), `c-${key}`)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {profile.promptAnswers.length > 0 ? (
        <section className="stack" style={{ gap: 22 }}>
          {profile.promptAnswers.map((answer) => (
            <div className="stack" style={{ gap: 8 }} key={answer.promptId}>
              <h3 className="prompt">{prompts?.get(answer.promptId) ?? answer.promptId}</h3>
              <div className="answer">{quotable(answer.answer, `a-${answer.promptId}`)}</div>
            </div>
          ))}
        </section>
      ) : null}

      {profile.interests.length > 0 ? (
        <section className="stack" style={{ gap: 10 }}>
          <h2 className="label">Interested in</h2>
          <ul className="facts">
            {profile.interests.map((interest) => (
              <li className="meta" key={interest}>
                {interest}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {facts.length > 0 ? (
        <ul className="facts">
          {facts.map((fact) => (
            <li className="meta" key={fact}>
              {fact}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
