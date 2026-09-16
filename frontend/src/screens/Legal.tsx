import { Link } from "react-router-dom";

/**
 * What we keep, and the rules.
 *
 * Written in the product's own voice rather than as a legal wall, and
 * every sentence is true of the code as it stands — if the app changes
 * what it keeps, this page changes in the same commit. It is a plain
 * account by one person running an experiment, not legal advice.
 */

const UPDATED = "11 September 2026";
const CONTACT = "hello@mohitchdev.me";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="stack" style={{ gap: 12 }}>
      <h2 className="label">{title}</h2>
      {children}
    </section>
  );
}

function Footer() {
  return (
    <p className="meta" style={{ marginTop: 12 }}>
      last changed {UPDATED} ·{" "}
      <Link className="linkish meta" to="/privacy">
        what we keep
      </Link>{" "}
      ·{" "}
      <Link className="linkish meta" to="/terms">
        the rules
      </Link>{" "}
      · <Link className="linkish meta" to="/">back</Link>
    </p>
  );
}

export function Privacy() {
  return (
    <article className="stack" style={{ gap: 36 }}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="label">what we keep</div>
        <p className="prose">
          Tum Mile is run by one person, as an experiment, on one computer. It was built to hold as
          little about you as it can, and this is all of it.
        </p>
      </div>

      <Section title="what you give us">
        <p className="prose">
          Your email address, so we can send you a way in. Everything you write on your page, your
          answers to the questions, and the facts you choose to state. Your date of birth, though other
          people see only your age.
        </p>
        <p className="prose">
          What you do here: the lines you quote when you write to someone, the people you pass on,
          your matches, your messages and reactions, and the scenes and letters you write with
          someone.
        </p>
      </Section>

      <Section title="where you are">
        <p className="prose">
          Only if you share it, and only roughly: your position is reduced to an area about five
          kilometres across before it is saved, and the exact point is never kept. Other people see
          a distance band, "about 5 km away", never a number, and you can hide even that.
        </p>
      </Section>

      <Section title="what we never ask for">
        <p className="prose">
          Photographs, a phone number, your exact location, your employer or college, your caste,
          income or height. There are no read receipts, no typing indicator and no "last seen". No
          advertising, no trackers, no analytics.
        </p>
      </Section>

      <Section title="what the machine does with your writing">
        <p className="prose">
          Nothing, at the moment. When more letters are waiting than a day will show you, the ones
          that surface first are chosen by a published score built from your answers to the
          questions, your interests, the languages you read in, age and rough distance. None of that
          reads your writing; it is arithmetic on things you filled in, and the weights it uses are
          written down in the open source rather than tuned quietly.
        </p>
        <p className="prose">
          There was a step that did read it — the words on your page turned into numbers by a model
          running on this same computer, so that two people who write alike surface to each other.
          It is switched off. The model needs more memory than this machine has left over, and
          buying a larger one to reorder a queue this short would be a strange thing to spend money
          on. If it comes back, this page says so before it does.
        </p>
        <p className="prose">
          What was true of it then is what will be true of it again: your writing is not sent
          anywhere, your messages are never used for it, and neither are the facts you state.
        </p>
      </Section>

      <Section title="who sees what">
        <p className="prose">
          People reading here see your page. Only the person you are matched with sees your
          messages and scenes. If someone reports you, the moderator, the one person who runs this,
          sees your own recent messages and scene lines from that conversation, copied at the
          moment of the report, and nothing the reporter wrote.
        </p>
      </Section>

      <Section title="other services involved">
        <p className="prose">
          Three, each doing one job. Cloudflare carries the connection to this site and runs the
          check on the sign-in page that keeps scripts out; it sees your IP address. Brevo delivers
          our emails; it sees your address and the email itself. Google Fonts supplies the
          typefaces; your browser fetches them from Google, which sees your IP address.
        </p>
      </Section>

      <Section title="emails">
        <p className="prose">
          A sign-in link and code when you ask for one. A short note when something is waiting for
          you, only if you turn that on in Account. Nothing else, ever.
        </p>
      </Section>

      <Section title="what you can do">
        <p className="prose">
          Download everything you wrote from Account, as a file. Block anyone, which also deletes
          your conversation with them for both of you. Delete your account, which erases your
          address, your page and every message you sent, straight away.
        </p>
        <p className="prose">
          Two things survive a deletion, on purpose: reports other people filed about the account,
          and a log of actions taken. Neither holds anything you wrote. They stay so that leaving
          cannot be used to wipe a record.
        </p>
        <p className="prose">
          The database is copied once a week onto the same computer, and the last eight copies are
          kept. So something you delete can remain in a backup for up to about two months before it
          is gone everywhere.
        </p>
      </Section>

      <Section title="asking">
        <p className="prose">
          For anything you cannot do yourself, such as a correction, a question or a complaint, write to{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. It reaches a person.
        </p>
      </Section>

      <Footer />
    </article>
  );
}

export function Terms() {
  return (
    <article className="stack" style={{ gap: 36 }}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="label">the rules</div>
        <p className="prose">
          Few, and meant. By asking for a sign-in link you agree to them.
        </p>
      </div>

      <Section title="who can be here">
        <p className="prose">
          Adults. You must be eighteen or over, and the date of birth you give must be yours. One
          account per person.
        </p>
      </Section>

      <Section title="be who you are">
        <p className="prose">
          Say what is true. "Not over my ex" and "it's complicated" are welcome answers here. What is
          not welcome is deception: no one who is married or with a partner may present themselves
          as single, and no one may pretend to be somebody else.
        </p>
      </Section>

      <Section title="how to treat people">
        <p className="prose">
          No harassment, and no pressing someone who has stopped replying. Nothing sexual sent to
          someone who has not asked for it. No hate. No asking anyone for money, and no selling. Do
          not share what someone wrote to you, or who you think they are, anywhere outside this
          place.
        </p>
        <p className="prose">
          Scenes are fiction, and these rules still hold inside them.
        </p>
      </Section>

      <Section title="what happens if you do not">
        <p className="prose">
          Reports are read by the one person who runs this. An account can be warned, hidden from
          others, or closed, depending on what happened and whether it has happened before.
        </p>
      </Section>

      <Section title="what this place cannot promise">
        <p className="prose">
          Signing in proves only that you can open an email. It does not prove who anyone is, how
          old they are, or what they intend, here or on any other app. Meet somewhere public, tell
          a friend where you are going, and trust how a person treats you over what they wrote.
        </p>
        <p className="prose">
          This is an experiment run by one person, offered as it is. It may go quiet for a while
          or end. If it ends, you will be told here first, with time to download what you wrote,
          and then everything will be deleted.
        </p>
      </Section>

      <Section title="changes">
        <p className="prose">
          If these change, the new version appears here with its date. Questions go to{" "}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </Section>

      <Footer />
    </article>
  );
}
