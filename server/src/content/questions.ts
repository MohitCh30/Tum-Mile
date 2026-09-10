/**
 * The question bank.
 *
 * Not the profile prompts — those ask for an artifact and are read by a
 * person. These are answered by choosing, and are read by the scoring
 * function in `lib/compatibility.ts`.
 *
 * Eight at sign-up, then one a day. Nobody fills in a fifty-question
 * survey to maybe meet someone, and an empty questionnaire is worth
 * nothing, so the answer is to ask slowly and give a reason to come back
 * that is not a notification about somebody else.
 *
 * They ask about temperament and how a life is arranged, not trivia and
 * not preferences already stated on the profile. Ids are permanent: an
 * answer stores the id it answered, so renaming one orphans it.
 */

export interface Question {
  id: string;
  body: string;
  options: string[];
  /** The first eight, asked together at sign-up. */
  onboarding?: true;
}

export const QUESTIONS: readonly Question[] = [
  // ── The eight ────────────────────────────────────────────────
  {
    id: "when-bothered",
    body: "When something is bothering you, what actually happens?",
    options: [
      "I say it straight away",
      "I wait until I have worked out what I think",
      "I go quiet and hope it passes",
      "I write it down instead",
    ],
    onboarding: true,
  },
  {
    id: "free-saturday",
    body: "A Saturday with no plans is",
    options: ["a relief", "slightly unbearable", "for other people", "spent working anyway"],
    onboarding: true,
  },
  {
    id: "parents-know",
    body: "How much of your life do your parents get to know about?",
    options: ["most of it", "the safe parts", "very little", "they would be the first to know"],
    onboarding: true,
  },
  {
    id: "moving-cities",
    body: "Moving cities for someone",
    options: ["I would consider it", "much later, maybe", "no", "I already have"],
    onboarding: true,
  },
  {
    id: "faith-daily",
    body: "Faith, in your ordinary week, is",
    options: ["central", "present", "cultural more than religious", "absent"],
    onboarding: true,
  },
  {
    id: "how-often",
    body: "How often would you want to see someone you were seeing?",
    options: ["most days", "a few times a week", "about once a week", "when it happens"],
    onboarding: true,
  },
  {
    id: "argument-ends",
    body: "An argument should end with",
    options: [
      "someone conceding",
      "a decision, even a rough one",
      "both people tired",
      "it does not have to end",
    ],
    onboarding: true,
  },
  {
    id: "marriage",
    body: "Marriage is",
    options: ["the point", "possible", "not for me", "I have not decided"],
    onboarding: true,
  },

  // ── The drip ─────────────────────────────────────────────────
  {
    id: "money-between-two",
    body: "Money between two people should be",
    options: [
      "split evenly, always",
      "whoever has more, pays",
      "worked out case by case",
      "not discussed for a long while",
    ],
  },
  {
    id: "living-together",
    body: "Living together before marriage",
    options: ["yes", "depends on the circumstances", "no"],
  },
  {
    id: "politics-disagree",
    body: "If the two of you disagreed about politics",
    options: ["fine", "depends which politics", "not fine"],
  },
  {
    id: "silence",
    body: "How much silence can a room hold before it gets uncomfortable?",
    options: ["a lot", "some", "almost none"],
  },
  {
    id: "phone-at-dinner",
    body: "Your phone at dinner",
    options: ["face down, or in another room", "on the table", "in my hand", "depends who I am with"],
  },
  {
    id: "when-ill",
    body: "When you are ill you want",
    options: ["to be left alone", "to be looked after", "company, but no fuss"],
  },
  {
    id: "who-tells-story",
    body: "At a party, who tells the story?",
    options: ["me", "them", "neither of us", "we interrupt each other"],
  },
  {
    id: "ambition-in-others",
    body: "Ambition in someone else is",
    options: ["attractive", "neutral", "exhausting"],
  },
  {
    id: "reading-your-writing",
    body: "Someone reading your writing before anyone else does",
    options: ["yes", "only once it is finished", "absolutely not", "I do not write"],
  },
  {
    id: "punctuality",
    body: "Punctuality is",
    options: ["a courtesy", "a personality trait", "overrated", "something I keep failing at"],
  },
  {
    id: "drinking",
    body: "Drinking",
    options: ["often", "socially", "rarely", "never"],
  },
  {
    id: "smoking",
    body: "Smoking",
    options: ["yes", "socially", "no", "trying to stop"],
  },
  {
    id: "pets",
    body: "Animals in the house",
    options: ["yes", "one day", "no", "I am allergic, sadly"],
  },
  {
    id: "big-group",
    body: "A big group, or three people?",
    options: ["big group", "three people", "depends entirely on the three"],
  },
  {
    id: "wrong-on-internet",
    body: "Someone is wrong on the internet. You",
    options: ["argue", "mute", "screenshot it for a friend", "genuinely do not notice"],
  },
] as const;

const BY_ID = new Map(QUESTIONS.map((q) => [q.id, q]));

export const ONBOARDING_QUESTIONS = QUESTIONS.filter((q) => q.onboarding);
export const ONBOARDING_COUNT = ONBOARDING_QUESTIONS.length;

/** Three, and no more. Weighting everything weights nothing. */
export const MAX_NON_NEGOTIABLE = 3;

export function getQuestion(id: string): Question | undefined {
  return BY_ID.get(id);
}

export function isValidAnswer(id: string, answer: string): boolean {
  return BY_ID.get(id)?.options.includes(answer) ?? false;
}
