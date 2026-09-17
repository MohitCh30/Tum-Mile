/**
 * The prompt bank.
 *
 * Every prompt here asks for an OBJECT, a SCENE, or a DETAIL. None asks
 * anyone to characterise themselves, because self-characterisation is
 * always performance: "something you changed your mind about" performs
 * growth, "an opinion you'll defend" performs having takes, and everyone
 * can answer both, so neither reveals anything.
 *
 * A good prompt is one a lot of people would have to skip.
 *
 * This is app content, not user data — it lives in the codebase so it can
 * be edited in a commit rather than a migration. Ids are permanent: a
 * profile stores the id it answered, so renaming one orphans an answer.
 */

export interface Prompt {
  id: string;
  body: string;
  group: "present" | "objects" | "scenes";
}

export const PROMPTS: readonly Prompt[] = [
  // Unfakeable, present tense — you cannot prepare an answer to these.
  { id: "tabs", body: "What's open in your tabs right now", group: "present" },
  {
    id: "saved-unread",
    body: "The last thing you saved to read later and still haven't read",
    group: "present",
  },
  {
    id: "hour-before",
    body: "What you were doing an hour before you made this",
    group: "present",
  },
  {
    id: "annoying-now",
    body: "What's annoying you at the moment that really shouldn't be",
    group: "present",
  },

  // Taste, approached sideways. Irritation is harder to perform than taste.
  { id: "annoying-book", body: "A book that annoyed you", group: "objects" },
  {
    id: "quotable",
    body: "A line you can quote without looking it up",
    group: "objects",
  },
  {
    id: "reread",
    body: "The thing you reread, or rewatch, and don't defend",
    group: "objects",
  },
  {
    id: "twice-in-a-row",
    body: "A song you've skipped back to twice in a row",
    group: "objects",
  },
  {
    id: "quiet-beauty",
    body: "Something you find beautiful that most people don't",
    group: "objects",
  },
  {
    id: "kept-quote",
    body: "A quote you keep coming back to, and why it stuck",
    group: "objects",
  },
  {
    id: "political-pushback",
    body: "A political opinion you hold that most people you know don't",
    group: "objects",
  },

  // Scenes. The anti-highlight-reel: everyone else's profile is a holiday.
  { id: "tuesday", body: "Describe your Tuesday", group: "scenes" },
  { id: "cannot-sleep", body: "What you do when you can't sleep", group: "scenes" },
  {
    id: "never-entered",
    body: "A place you've walked past a hundred times and never gone into",
    group: "scenes",
  },
  {
    id: "lost-argument",
    body: "The argument you lost that you still think about",
    group: "scenes",
  },
] as const;

const BY_ID = new Map(PROMPTS.map((p) => [p.id, p]));

export function isPromptId(id: string): boolean {
  return BY_ID.has(id);
}

export function promptBody(id: string): string | undefined {
  return BY_ID.get(id)?.body;
}

/** How many of the bank a profile may answer. */
export const MAX_ANSWERS = 3;
export const MAX_ANSWER_LENGTH = 300;
export const MAX_ONE_LINE_LENGTH = 90;
export const MAX_FORM_BODY_LENGTH = 2000;
export const MAX_CURRENTLY_LENGTH = 120;

/**
 * The four forms a profile can take instead of a bio. A blank box labelled
 * "Bio" has no genre, no length and no permission; a form is scaffolding.
 * "list" exists so the app does not admit only people who write prose.
 */
export const FORM_TYPES = ["letter", "memoir", "poem", "list"] as const;
export type FormType = (typeof FORM_TYPES)[number];
