import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  abandonScene,
  answerScene,
  getPremises,
  getScenes,
  proposeScene,
  sayLine,
  writeLetter,
  type PremiseCard,
  type Scene,
} from "../lib/api";
import { usePoll } from "../lib/usePoll";

const POLL_MS = 5000;

/**
 * A scene, played by two people who have matched.
 *
 * Not roleplay: a two-hander. You are handed a person with a wound and
 * something they want, the other half is played by someone you barely
 * know, and what you find out is whether they listen. Roles are assigned
 * rather than chosen, the premise speaks first so nobody faces a blank
 * page, and it ends — which is the thing that keeps it from drifting.
 */
export function Scenes({ matchId, withWhom }: { matchId: string; withWhom: string }) {
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [premises, setPremises] = useState<PremiseCard[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setScenes((await getScenes(matchId)).scenes);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setScenes([]);
    }
  }, [matchId]);

  usePoll(load, POLL_MS);

  useEffect(() => {
    void getPremises().then((p) => setPremises(p.premises)).catch(() => undefined);
  }, []);

  async function run<T>(action: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDraft("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!scenes) return <p className="notice" role="status">Looking…</p>;

  const open = scenes.find((s) => ["proposed", "playing", "letters"].includes(s.status));
  const finished = scenes.filter((s) => s.status === "finished");

  if (choosing) {
    return (
      <div className="stack" style={{ gap: 22 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="label">choose a scene</div>
          <button className="linkish label" onClick={() => setChoosing(false)}>
            cancel
          </button>
        </div>
        <p className="prose">
          You will not choose which part you play. That is assigned, so nobody takes only the
          flattering half. {withWhom} has to agree before it starts.
        </p>
        {premises.map((premise) => (
          <div className="card stack" style={{ gap: 12 }} key={premise.id}>
            <div className="answer">{premise.title}</div>
            <p className="prose">{premise.blurb}</p>
            <p className="meta">{premise.turnsEach} turns each, then a letter</p>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await proposeScene(matchId, premise.id);
                  setChoosing(false);
                })
              }
            >
              Ask {withWhom} to play this
            </button>
          </div>
        ))}
        {error ? <p className="notice notice-bad" role="status">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 28 }}>
      {open ? (
        <OpenScene
          scene={open}
          withWhom={withWhom}
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          run={run}
        />
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="said said-sm">Play something.</div>
          <p className="prose">
            A scene with two parts and an ending. You each get a person to be, and afterwards you
            each write them a last letter.
          </p>
          <button className="button" onClick={() => setChoosing(true)}>
            Choose a scene
          </button>
        </div>
      )}

      {error ? <p className="notice notice-bad" role="status">{error}</p> : null}

      {finished.length > 0 ? (
        <section className="stack" style={{ gap: 18 }}>
          <h2 className="label">what you have played</h2>
          {finished.map((scene) => (
            <div className="card stack" style={{ gap: 14 }} key={scene.id}>
              <div className="answer">{scene.premise.title}</div>
              {scene.letters.map((letter, i) => (
                <div className="stack" style={{ gap: 6 }} key={i}>
                  <div className="meta">{letter.from} wrote</div>
                  <div className="prose form-letter">{letter.body}</div>
                </div>
              ))}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function OpenScene({
  scene,
  withWhom,
  draft,
  setDraft,
  busy,
  run,
}: {
  scene: Scene;
  withWhom: string;
  draft: string;
  setDraft: (v: string) => void;
  busy: boolean;
  run: <T>(action: () => Promise<T>) => Promise<void>;
}) {
  if (scene.status === "proposed") {
    return (
      <div className="card stack" style={{ gap: 16 }}>
        <div className="answer">{scene.premise.title}</div>
        <p className="prose">{scene.premise.blurb}</p>
        <div className="stack" style={{ gap: 6 }}>
          <div className="label">you would play</div>
          <div className="prose">
            <strong>{scene.you.name}</strong>, {scene.you.who}
          </div>
        </div>
        {scene.proposedByYou ? (
          <p className="meta">waiting for {withWhom} to agree</p>
        ) : (
          <div className="row">
            <button
              className="button button-quiet grow"
              disabled={busy}
              onClick={() => run(() => answerScene(scene.id, false))}
            >
              Not this one
            </button>
            <button
              className="button grow"
              disabled={busy}
              onClick={() => run(() => answerScene(scene.id, true))}
            >
              Play it
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="answer">{scene.premise.title}</div>
          <button className="linkish label" onClick={() => run(() => abandonScene(scene.id))}>
            leave the scene
          </button>
        </div>
        <p className="prose">{scene.premise.setting}</p>
        <p className="meta">
          you are {scene.you.name}, {scene.you.wants}
        </p>
      </div>

      <ol className="conversation">
        <li className="said-by-them">
          <div className="meta">{scene.them.isRoleA === false ? scene.you.name : scene.them.name}</div>
          <div className="bubble">{scene.premise.opensWith}</div>
        </li>
        {scene.lines.map((line) => (
          <li key={line.ordinal} className={line.mine ? "said-by-me" : "said-by-them"}>
            <div className="meta">{line.speaker}</div>
            <div className="bubble">{line.body}</div>
          </li>
        ))}
      </ol>

      {scene.status === "playing" ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="meta">
            {scene.yourTurn ? `your line, as ${scene.you.name}` : `waiting for ${withWhom}`} ·{" "}
            {scene.turnsRemaining} turns left
          </div>
          {scene.yourTurn ? (
            <>
              <textarea
                className="field field-multi"
                rows={3}
                maxLength={700}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Say it as ${scene.you.name} would.`}
                aria-label="your line"
              />
              <button
                className="button"
                disabled={busy || draft.trim() === ""}
                onClick={() => run(() => sayLine(scene.id, draft.trim()))}
              >
                Say it
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {scene.status === "letters" ? (
        <div className="stack" style={{ gap: 12 }}>
          <div className="label">the scene is over</div>
          <p className="prose">{scene.premise.letterPrompt}</p>
          {scene.youHaveWritten ? (
            <p className="notice" role="status">Yours is written. Waiting for {withWhom}.</p>
          ) : (
            <>
              <textarea
                className="field field-multi"
                rows={6}
                maxLength={1200}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`As ${scene.you.name}.`}
                aria-label="your letter"
              />
              <button
                className="button"
                disabled={busy || draft.trim() === ""}
                onClick={() => run(() => writeLetter(scene.id, draft.trim()))}
              >
                Write it
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
