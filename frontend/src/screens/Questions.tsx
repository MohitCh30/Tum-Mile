import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  answerQuestion,
  getMyAnswers,
  getNextQuestions,
  unanswerQuestion,
  type MyAnswer,
  type NextQuestions,
  type QuestionCard,
} from "../lib/api";

/**
 * Eight at sign-up, then one a day.
 *
 * The reason to come back is a question, not a notification about
 * somebody else. Insisting on an answer is the whole weighting system —
 * three, and no more, because weighting everything weights nothing.
 */
export function Questions() {
  const [next, setNext] = useState<NextQuestions | null>(null);
  const [mine, setMine] = useState<MyAnswer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [insisting, setInsisting] = useState<string | null>(null);
  const [acceptable, setAcceptable] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [n, m] = await Promise.all([getNextQuestions(), getMyAnswers()]);
      setNext(n);
      setMine(m.answers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function pick(question: QuestionCard, option: string) {
    setBusy(true);
    setError(null);
    try {
      await answerQuestion(question.id, { answer: option });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function saveInsistence(answer: MyAnswer) {
    if (acceptable.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await answerQuestion(answer.questionId, {
        answer: answer.answer,
        acceptable,
        isNonNegotiable: true,
      });
      setInsisting(null);
      setAcceptable([]);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function stopInsisting(answer: MyAnswer) {
    await answerQuestion(answer.questionId, { answer: answer.answer, acceptable: [] });
    await load();
  }

  async function forget(answer: MyAnswer) {
    await unanswerQuestion(answer.questionId);
    await load();
  }

  if (!next) return <p className="notice" role="status">Looking…</p>;

  const insisted = mine.filter((a) => a.isNonNegotiable);
  const slotsLeft = next.maxNonNegotiable - next.nonNegotiablesUsed;

  return (
    <div className="stack" style={{ gap: 36 }}>
      {next.stage === "onboarding" ? (
        <section className="stack" style={{ gap: 20 }}>
          <div className="said said-sm">Eight questions, then one a day.</div>
          <p className="prose">
            They are not a test and there are no right answers. {next.remaining} of {next.of} left.
          </p>
          {next.questions?.map((question) => (
            <Ask key={question.id} question={question} busy={busy} onPick={pick} />
          ))}
        </section>
      ) : null}

      {next.stage === "daily" && next.questions ? (
        <section className="stack" style={{ gap: 18 }}>
          <div className="label">today's question</div>
          <Ask question={next.questions[0]} busy={busy} onPick={pick} />
          <p className="meta">
            {next.answered} of {next.total} answered
          </p>
        </section>
      ) : null}

      {next.stage === "done" ? (
        <section className="stack" style={{ gap: 16 }}>
          <div className="said said-sm">Nothing to ask today.</div>
          <p className="prose">
            There will be another one tomorrow. {next.answered} of {next.total} answered so far.
          </p>
        </section>
      ) : null}

      {error ? <p className="notice notice-bad" role="status">{error}</p> : null}

      {mine.length > 0 ? (
        <section className="stack" style={{ gap: 18 }}>
          <h2 className="label">
            what you have said · {insisted.length} of {next.maxNonNegotiable} insisted on
          </h2>
          <p className="prose">
            Insisting on an answer means you will only meet people who answered a way you can live
            with. Three at most. Insisting on everything insists on nothing.
          </p>

          {mine.map((answer) => (
            <div className="card stack" style={{ gap: 12 }} key={answer.questionId}>
              <div className="prompt">{answer.body}</div>
              <div className="answer">{answer.answer}</div>

              {answer.isNonNegotiable ? (
                <>
                  <p className="meta">
                    you will only meet: {answer.acceptable.join(" · ")}
                  </p>
                  <div className="row">
                    <button className="linkish label" onClick={() => stopInsisting(answer)}>
                      stop insisting
                    </button>
                    <button className="linkish label" onClick={() => forget(answer)}>
                      forget this answer
                    </button>
                  </div>
                </>
              ) : insisting === answer.questionId ? (
                <div className="stack" style={{ gap: 10 }}>
                  <div className="label">what could you live with?</div>
                  <div className="row" style={{ flexWrap: "wrap" }}>
                    {answer.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`chip${acceptable.includes(option) ? " chip-on" : ""}`}
                        aria-pressed={acceptable.includes(option)}
                        onClick={() =>
                          setAcceptable((prev) =>
                            prev.includes(option)
                              ? prev.filter((o) => o !== option)
                              : [...prev, option]
                          )
                        }
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                  <div className="row">
                    <button
                      className="button button-quiet grow"
                      onClick={() => {
                        setInsisting(null);
                        setAcceptable([]);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="button grow"
                      disabled={busy || acceptable.length === 0}
                      onClick={() => saveInsistence(answer)}
                    >
                      Insist on this
                    </button>
                  </div>
                </div>
              ) : (
                <div className="row">
                  <button
                    className="linkish label"
                    disabled={slotsLeft === 0}
                    onClick={() => {
                      setInsisting(answer.questionId);
                      setAcceptable([answer.answer]);
                    }}
                  >
                    {slotsLeft === 0 ? "no slots left" : "insist on this one"}
                  </button>
                  <button className="linkish label" onClick={() => forget(answer)}>
                    forget this answer
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Ask({
  question,
  busy,
  onPick,
}: {
  question: QuestionCard;
  busy: boolean;
  onPick: (q: QuestionCard, option: string) => void;
}) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="answer">{question.body}</div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {question.options.map((option) => (
          <button
            key={option}
            type="button"
            className="chip"
            disabled={busy}
            onClick={() => onPick(question, option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
