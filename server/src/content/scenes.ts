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
