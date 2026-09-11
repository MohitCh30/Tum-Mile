/**
 * Two-handers.
 *
 * Not roleplay between two strangers — a SCENE, performed. You are handed
 * a person with a wound and something they want, and the other half is
 * played by someone you have just matched with. What you learn is not
 * what they fancy: it is whether they are funny, whether they are cruel,
 * whether they will take the unflattering part, whether they listen or
 * wait to deliver their line.
 *
 * Three things keep it from drifting where open roleplay always drifts:
 *
 *   1. The premises are AUTHORED and fixed. There is no custom premise
 *      and no free-form world. A specific dramatic situation about a life
 *      being negotiated across a dinner table has nowhere sexual to go;
 *      "you are two strangers at a bar" has nowhere else to go.
 *   2. Every scene is FINITE. Four turns each, then it ends. Open-ended
 *      roleplay drifts because there is no other direction available.
 *   3. Roles are ASSIGNED, not chosen — otherwise everyone takes the
 *      sympathetic side and nobody finds anything out.
 *
 * It ends with each person writing their character's last letter. That is
 * the artifact both of them keep.
 */

export interface Role {
  /** Named people, not "Role A". Easier to inhabit than to invent. */
  name: string;
  /** One line the player sees before they start. */
  who: string;
  /** What this person is trying to get. Scenes need two of these. */
  wants: string;
}

export interface Premise {
  id: string;
  title: string;
  /** The pitch, as the pair choosing it will read it. */
  blurb: string;
  setting: string;
  /** Spoken by roleA, so nobody faces a blank page. */
  opensWith: string;
  roleA: Role;
  roleB: Role;
  /** What each person is writing their final letter about. */
  letterPrompt: string;
  /** Turns each, before the letters. Four is enough to find someone out. */
  turnsEach: number;
  /**
   * RETIRED, never deleted: a scene already played keeps its premise, and
   * the letters two people wrote in it are not ours to make disappear. A
   * retired premise is hidden from the library and cannot be proposed.
   */
  retired?: boolean;
}

export const PREMISES: readonly Premise[] = [
  {
    id: "candlelight",
    title: "Candlelight",
    blurb:
      "A power cut, a stairwell, and two people from the same building who have never once spoken.",
    setting:
      "The eleventh floor has gone dark. The lift is stuck somewhere below. Two neighbours end up on the same landing with one candle between them, waiting.",
    opensWith: "You are on the eleventh too, no? I have seen your slippers outside the door.",
    roleA: {
      name: "Nikhil",
      who: "Has lived here four years and knows nobody. Talks when nervous.",
      wants: "For this to last slightly longer than the power cut does.",
    },
    roleB: {
      name: "Sana",
      who: "Moved in eight months ago. Was on her way out to be somewhere else.",
      wants: "To not be here, and then, gradually, not to mind being here.",
    },
    letterPrompt:
      "Write what your character would have said on the landing, and did not.",
    turnsEach: 4,
  },

  {
    id: "incompetence-and-despair",
    title: "Incompetence and Despair",
    blurb:
      "A son who wants to play football for India, and a father who has already priced that dream.",
    setting:
      "A dinner table in a flat where the JEE coaching brochures have been left out on purpose. This argument has been had before, in smaller pieces. Tonight it gets had properly.",
    opensWith: "But Papa, I want to be the number ten of India.",
    roleA: {
      name: "Arjun",
      who: "Nineteen. Good enough to be told he is good, not good enough to be certain.",
      wants: "To be allowed to fail at the thing he chose, rather than succeed at the thing he did not.",
    },
    roleB: {
      name: "His father",
      who: "Has done the arithmetic on every version of his son's life, and loves him in that arithmetic.",
      wants: "To be wrong about how this ends, and cannot afford to be.",
    },
    letterPrompt:
      "Write the letter your character would write years later, and never send.",
    turnsEach: 5,
    // A father and son is the wrong pairing to hand two people who just
    // matched. Retired in favour of the same story told as Arjun and Ananya.
    retired: true,
  },

  // Two people who could fix it with one sentence each and will not say it.
  {
    id: "sometimes-in-life",
    title: "Sometimes in Life",
    blurb:
      "The night before she leaves for Germany. A friend has arranged for them to be in the same place, and neither of them asked him to.",
    setting:
      "A terrace in Arjun's building, after eleven. Her flight is at six. His father chose Arjun's life for him and ended the two of them in the process; they have not spoken in two years. The friend who set this up has gone downstairs and is pretending not to wait.",
    opensWith: "He said you would not come. He cannot lie to save his life, your friend.",
    roleA: {
      name: "Ananya",
      who: "Twenty-three. Leaving for a Master's she applied to the week it ended. Has read too much Dostoevsky to believe in timing.",
      wants: "To be asked to stay, so that she is the one who decides.",
    },
    roleB: {
      name: "Arjun",
      who: "Twenty-three. Two years into an MNC job forty kilometres away. Still plays on Sundays, and has stopped calling it temporary.",
      wants: "To ask her to stay, and cannot, because deciding someone else's life is his father's move.",
    },
    letterPrompt:
      "Write the letter your character hands the friend at the gate, in case the other one never reads it.",
    turnsEach: 5,
  },

  {
    id: "the-margins",
    title: "The Margins",
    blurb:
      "Two regulars in a Delhi library that closes for good tomorrow. For a year they have written to each other in the margins of the same book, and never once spoken.",
    setting:
      "The reading room of an old municipal library, the afternoon before it shuts. Half the shelves are already in boxes. The book is on the table between them, and each of them knows what the other has written in it.",
    opensWith: "You underline in pencil. Nobody underlines in pencil any more.",
    roleA: {
      name: "Meher",
      who: "Came here to study for an exam she has since given up on. Kept coming anyway.",
      wants: "To find out whether he knew it was her.",
    },
    roleB: {
      name: "Kabir",
      who: "Retired from nothing in particular. Writes better in the margins than he speaks.",
      wants: "For the notes not to be ruined by his turning into a real person.",
    },
    letterPrompt: "Write the last note your character leaves in the margin.",
    turnsEach: 4,
  },

  {
    id: "results-day",
    title: "Results Day, a Year Late",
    blurb:
      "Two people from the same Kota hostel. One cleared, one did not. They meet at the same chai stall exactly a year later.",
    setting:
      "The chai stall outside the coaching institute, on results day, a year after theirs. New seventeen-year-olds are crowding the notice board. Neither of them planned to be here.",
    opensWith: "You still take it with no sugar. You said that was temporary too.",
    roleA: {
      name: "Riya",
      who: "Cleared. In her first year at an IIT she does not much like, home for the week.",
      wants: "To be forgiven for getting in, without having to say that is what she wants.",
    },
    roleB: {
      name: "Aman",
      who: "Did not. Took a drop, then another, and now works at his uncle's shop.",
      wants: "For her to stop being kind about it.",
    },
    letterPrompt: "Write what your character would say to the other's seventeen-year-old self.",
    turnsEach: 4,
  },

  {
    id: "two-weeks-notice",
    title: "Two Weeks' Notice",
    blurb:
      "Two colleagues, a resignation already accepted, and a fortnight in which neither says the thing.",
    setting:
      "A half-empty office at nine at night. One of them is leaving on the thirty-first. The handover document is open on the screen and has not been touched for an hour.",
    opensWith: "You have written 'miscellaneous' as a heading. That is not a handover, that is a shrug.",
    roleA: {
      name: "Nandini",
      who: "Staying. Extremely competent about everything except this.",
      wants: "To be given a reason to say something, so she does not have to find one.",
    },
    roleB: {
      name: "Ishaan",
      who: "Leaving. Has rehearsed this conversation in eleven versions, none of which he will use.",
      wants: "To leave without having been a coward, which is not the same as staying.",
    },
    letterPrompt: "Write what your character puts in the last email, at 6pm on the thirty-first.",
    turnsEach: 4,
  },

  {
    id: "the-statement",
    title: "The Statement",
    blurb:
      "An interview room, a man who has certainly done something, and an officer who has charged him with the wrong thing.",
    setting:
      "A station room with a fan that does not help. It is the fourth hour. Both of them know the file is thin, and only one of them knows why.",
    opensWith: "Sit. I am not going to ask you about Tuesday yet. Tell me about the money.",
    roleA: {
      name: "Inspector Vaidya",
      who: "Right about the man and wrong about the crime, and beginning to suspect it.",
      wants: "A confession she can live with, which is not necessarily the one on the form.",
    },
    roleB: {
      name: "Rehan",
      who: "Guilty of something quieter and more shameful than what he is sitting here for.",
      wants: "To be convicted of the wrong thing rather than say the right one out loud.",
    },
    letterPrompt: "Write what your character writes down when the room is finally empty.",
    turnsEach: 5,
  },
] as const;

const BY_ID = new Map(PREMISES.map((p) => [p.id, p]));

export function getPremise(id: string): Premise | undefined {
  return BY_ID.get(id);
}

export const MAX_TURN_LENGTH = 700;
export const MAX_LETTER_LENGTH = 1200;
