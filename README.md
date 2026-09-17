# Tum Mile

A dating app where there are no photographs.

Not "photos are optional", not "photos come later". There is no upload, no
avatar, no placeholder circle anywhere in the product. People are represented
entirely by what they write. That is the founding constraint, and almost every
other decision here falls out of it.

It is India-first, privacy-first, safety-first, and it is an experiment rather
than a startup. One person runs it. It may go quiet. That is written into the
terms rather than hidden.

**Live:** <https://tummile.mohitchdev.me>

---

## Why

Photo-first dating optimises for the half-second judgement, and everything else
in the product follows: a card stack to make that judgement fast, unlimited
swiping to make it cheap, and "hey" as the rational opening move because you
have been given nothing to respond to.

Tum Mile removes the photograph and then removes everything that only made
sense because of it. What is left is slower and much smaller, and the argument
is that slower and smaller is the point.

---

## What it actually does

### A profile is writing, not fields

- **One line**, 90 characters, the only thing discovery shows of you.
- **A chosen form** rather than a bio: letter, memoir, poem, or list, each
  typeset differently, because the shape of what someone writes is information.
- **"Currently"**, meaning reading / watching / listening / thinking, which
  visibly decays as it ages rather than sitting there stale.
- **Three answers** from a prompt bank that asks for an *object, a scene or a
  detail*, never for self-summary. "A book that annoyed you", not "something
  you changed your mind about". Self-summary is always performance.
- **Stated facts last**, deliberately, at the bottom.

**Excluded on purpose:** photographs, height, income, employer, college, caste.
The middle four are status proxies. Employer and college are also how a profile
gets tied to a real name in a small-world social graph.

### Filter on incompatibility, display what is merely true

`status` (single / not over my ex / situationship / …) is **display only and
can never become filterable**. The moment it filters, everybody selects
"single" and the honesty dies.

Religion and diet are fixed lists rather than free text, may be filtered on, and
are **never a ranking input**. "Not stated" is a real answer that stays null, so
it can never be ranked. There is deliberately no caste field.

### Discovery is one person at a time

No card stack, no deck, no swipe. One profile, and the like control sits
*below* everything they wrote, so reaching it means scrolling past it.

### Deciding is scarce; browsing is free

Six outbound and nine inbound likes a day, resetting at midnight IST. Inbound
overflow is triaged by a published compatibility score rather than by arrival
order, so a backlog cannot bury the person you would have chosen.

A pass can be taken back for two minutes and no longer: long enough to catch a
mistap on a phone, far too short to be a second look at a decision the daily
budget exists to make you take seriously.

### A like has to quote a line

You cannot simply like someone. You can quote a specific line of their writing
and send an opening message with it. The quote is checked server-side against an
allowlist derived from the *stored* profile, which is what makes "hey"
structurally impossible rather than merely discouraged.

### Messaging is deliberately thin

Matched pairs only, text only, polled over REST. Reactions yes.

**No read receipts, no typing indicator, no last-seen, no media.** The
principle: *automatic signals are surveillance; deliberate signals are
expression.* A reaction is something you chose to send. "Seen 2m ago" is
something taken from you.

### Nothing notifies, and nothing celebrates

No push, no badges, no "It's a match!" confetti. The matches list carries the
signal instead, ordered by when the conversation last moved and showing who
spoke last. That is a fact about your own list, not a report to the other
person.

There is one optional daily email, off by default.

### Scenes

Two-hander scenes: a fixed, authored dramatic premise, roles assigned and then
swapped, a finite number of turns, and a letter each at the end.

Drift is controlled by *premise design* rather than by policing. A specific
dramatic situation has nowhere sexual to go, where "two strangers at a bar" has
nowhere else to go. Premises are never custom.

### Safety

- Report and block are reachable **wherever a person appears**, not only inside
  a match. The one surface where a stranger writes to you unasked needs them
  most.
- A block ends the match and **deletes the conversation for both people**.
  Leaving it would keep a copy of your words in front of someone you blocked.
- A report **captures evidence at filing time**, because the next thing anyone
  does is block. Only the reported party's own messages are taken, never the
  reporter's.
- Off-platform links are recorded as the bare host (`wa.me`), never the message
  they appeared in.
- Moderation carries strikes; accounts can be warned, hidden, or closed.

### Ways out that are not destructive

Most of these did not exist until someone outside the project went looking for
them. Each previously had only a heavier alternative:

| You want to | Before | Now |
|---|---|---|
| End a quiet conversation | Block them | Leave the match, quietly, told to nobody |
| Be invisible for a while | Delete the account | Pause |
| Take back an unanswered letter | nothing | Withdraw it |
| See what you have sent | nothing | Sent letters |
| Move to a new address | nothing | Email change, with a warning to the old one |
| Sign out everywhere | nothing | End every session at once |

The rule that produced them: *wherever the only available action is heavier
than the situation, that is the defect.* A passing test suite tells you the
built things work; it cannot tell you what was never built.

### Accessibility is a real claim

A text-only dating app should be the first one that works properly with a
screen reader. Hinglish and Devanagari must render, which constrains the
typeface. Everything the app says back carries `role="status"`.

---

## Design

Direction: **Nocturne**. The app is a rain-streaked window. You can read
someone through it, you cannot see them, and you cannot reach them yet.

Post-monsoon Bombay: grey-green ground, one sodium bloom, two rain layers, haze
behind the content and a condensation pane in front that actually blurs it,
grain over everything. A seam runs down every screen; in a conversation it
separates the two speakers, and the only thing that crosses it is the quoted
line.

**Amber is reserved for what a person wrote.** Never chrome, never a button
fill.

Nothing is borrowed from the film: no still, poster, lettering or likeness.

---

## How it was built

This repository is also an experiment in whether a coding agent can build a
genuinely usable product from a serious product and security specification,
rather than from a prompt.

The specifications came first and stayed authoritative: a PRD, a threat model
with numbered invariants, a security test plan written as an attack matrix, and
a design direction. The code is an attempt at those documents, and where the two
disagree the document wins. Those specs are not in this repository, because they
name the host and the tunnel and are of little use to someone reading the code.

**55 commits, 8 to 17 September 2026.**

| Day | Commits | |
|---|---|---|
| Sep 8 | 2 | schema, auth, the shape of it |
| Sep 9 | 4 | profiles, prompts |
| Sep 10 | 3 | discovery, likes, matching |
| Sep 11 | 9 | messaging, scenes, moderation |
| Sep 12 | 3 | export, deletion, hardening |
| Sep 13 | 8 | embeddings, compatibility, design pass |
| Sep 14 | 15 | the non-destructive exits, after an outsider went looking |
| Sep 15 | 2 | off the laptop, onto a machine that stays on |
| Sep 16 | 7 | the crash, link previews, the privacy page, screen readers, a leaked password scrubbed |
| Sep 17 | 2 | three more stated facts, a prompt, a guard against a recurring typo |

Roughly 6,900 lines of server source across 40 files, 4,700 lines of frontend,
5,000 lines of tests across 24 files, 11 migrations, 61 endpoints.

### What running the code found that reading it did not

Nine bugs, each caught by execution rather than review. This is why the
workflow insists on `psql`, `curl` and a real browser over a passing suite:

1. Reissuing a magic link **deleted the user row**.
2. Two concurrent verifications both minted a session.
3. Simultaneous mutual likes produced **no match at all**.
4. The six-a-day budget fell to a concurrent burst.
5. React StrictMode's double render called a good link already-used.
6. A millisecond-truncated message cursor re-delivered its own message.
7. The conversation poll meant **reactions never appeared**.
8. `z.coerce.boolean()` parses the string `"false"` as **true**, which silently
   turned `SMTP_SECURE` on.
9. The first guessed embedding calibration band clamped nearly every pairing to
   zero.

A tenth arrived in production: an idle Postgres connection terminated by a
routine security update emitted `error` on a pool with no listener, and Node
ended the process. `unattended-upgrades` restarts Postgres weekly, so it would
have happened every week.

---

## Architecture

Two packages, no shared package, both ESM.

```
server/    Fastify 5 · Drizzle ORM · Postgres 16 (+pgvector)
frontend/  Vite · React 18 · react-router
```

### Server

- **`src/index.ts`** is the only composition root. Helmet, CORS, cookies, a
  security-headers hook, the error handler, then route plugins under `/api/v1`.
  In production it also serves the built frontend.
- **`src/config.ts`** is one zod-validated env schema. Every tunable, including
  every rate limit, lives here. A `process.env` read anywhere else is a bug.
- **`src/storage/schema.ts`** holds the whole relational model in one Drizzle
  file. Invariants are enforced at the database level: `CHECK` constraints for
  no-self-like, no-self-match, no-self-block, and unique pair indexes.
- **`src/middleware/auth.ts`**: `requireSession` establishes *who is calling*
  and nothing more. `requireVerified`, `requireProfile` and `requireAdmin`
  chain after it. What an actor may *do* is decided per route, never in the
  client. Session tokens come from the cookie only, never an `Authorization`
  header.
- **`src/lib/tokens.ts`** is the only place tokens are minted or hashed. Keyed
  HMAC, so a database dump alone cannot forge or verify one.

### Things worth reading

- **`lib/geo.ts`**: a coordinate is reduced to a 5-character geohash *in the
  request that carried it* and the exact point is never stored. Distance is
  reported as a band ("about 5 km away"), never a number, so repeated
  observations cannot trilaterate. Declining the browser prompt costs nothing:
  with no location on either side the check is skipped, so you are filtered by
  nobody and hidden from nobody.
- **`lib/compatibility.ts`**: a published weighted score, not a model.
  Two-sided via a geometric mean, so one person's enthusiasm cannot carry a
  pairing. Its job is queue triage, not feed ranking. Weights are served at
  `GET /discovery/ranking`.
- **`lib/conversation.ts`**: `requireParticipant()` re-runs on **every**
  message read and write, never once at open. A match can end or a block can
  land between two requests.
- **`lib/profile.ts`**: `quotableLines()` is the allowlist a like must quote
  from, checked against the stored profile.
- **`services/embeddings.ts`**: a 384-dimension model run locally from a cached
  copy, so nothing leaves the machine. Only the *writing* is embedded, never
  messages and never stated facts, because embedding "vegetarian" would quietly
  turn a filter into a ranking signal. The similarity band is measured, not
  guessed, and is model-specific. Currently switched off in production, for the
  reason given below.

### Authorization posture

Deny by default. Every cross-user operation establishes an authenticated actor,
an authorized relationship, an allowed state transition, permitted fields, and
a permitted resource.

Anything a viewer may not reach answers the **same 404 as something that does
not exist**, so a response never confirms that a person is there.

The frontend is never a security boundary. There is no client-side session
state at all: `GET /me` is the only source of truth.

---

## Running it locally

**Requires:** Node 20+, Docker (for Postgres and a mail catcher).

```bash
npm install
docker compose up -d postgres     # publishes 5434, not 5432
cp .env.example server/.env       # then fill in the blanks below
cd server && npm run db:push
cd .. && npm run dev              # API on :3007, Vite on :5173
```

Email in development goes to **Mailpit** on <http://localhost:8025>, so no SMTP
account is needed and the magic link is waiting in the inbox.

```bash
npm run typecheck    # tsc --noEmit, both packages
npm test             # vitest, 250 integration and unit tests
npm run build        # tsc, then vite build
```

Tests want a dedicated `tummile_test` database.

### Development and production environments differ structurally

They are not the same file with different passwords. Four of these change the
*shape* of the system rather than a value in it.

| | Development | Production | Why |
|---|---|---|---|
| `FRONTEND_DIST` | empty | path to `frontend/dist` | **The structural one.** Empty means the API serves JSON only and Vite serves the app on another port. Set, the API serves the built frontend too, so there is one origin, one hostname and one port: the session cookie stays first-party and CORS never applies to a real visitor. |
| `TRUST_PROXY` | `false` | `true` | Behind a tunnel, the connector reaches the app over loopback and every visitor looks like `127.0.0.1`, which would collapse all per-IP rate limiting into a single bucket. On, the real address is read from `CF-Connecting-IP`. **This must stay off when the server is directly reachable**, because then the header is attacker-controlled and rate limiting is trivially bypassed. |
| `EMBEDDINGS_ENABLED` | `true` | `false` | The model needs more memory than the production box has spare. The compatibility score is designed to be correct without it and redistributes the text weight across the other signals. |
| `TURNSTILE_SECRET` / `TURNSTILE_SITE_KEY` | empty | set | Unset skips the check entirely, so the app runs locally with no Cloudflare dependency. Turnstile also **fails open** on a verification error, deliberately: a Cloudflare outage should not lock everyone out of sign-in. |
| `SMTP_*` | Mailpit, `localhost:1025`, no auth, `SMTP_SECURE=false` | a real relay with credentials | Development must never be able to mail a stranger. |
| `DATABASE_URL` | Docker Postgres on **5434** | native Postgres on **5432** | 5432 was already taken on the development machine. |
| `EMAIL_MAGIC_LINK_BASE_URL` | `http://localhost:5173` | the public origin | The link in the email has to land somewhere real. |
| `SESSION_SECRET` | any 32+ characters | a distinct secret | Keys the HMAC for session and magic-link tokens. |
| `ADMIN_EMAIL` | optional | set | The single pre-provisioned moderator identity. |
| `NODE_ENV` | `development` | `production` | |

`SMTP_SECURE` is why the config parses booleans with an explicit enum rather
than `z.coerce.boolean()`. The string `"false"` is a non-empty string, so
coercion makes it **true**, and every documented way of switching something off
would have switched it on.

---

## How it is deployed

### Now: one small VM, one port, one origin

An Azure VM, Ubuntu 24.04, 2 vCPU, under a gigabyte of RAM, running:

- the API under `systemd` with `Restart=always`, serving the built frontend
  from the same process, so **the app and the API share one origin**;
- Postgres 16 natively rather than in a container, because the container
  runtime does not pay for itself at this size;
- `cloudflared` as a tunnel connector, so **no inbound port is open to the
  internet**. Cloudflare terminates TLS and forwards over the tunnel.

The box is too small to compile on. Builds happen on a workstation and the
`dist/` output is shipped over `rsync`; migrations run from the built
JavaScript with the `.sql` files rsynced beside it.

Backups are a weekly `pg_dump` with eight kept, which is a **seven-day
worst-case RPO on the same disk as the database**. That is stated here rather
than implied, and the privacy page says so too.

The move to a VM is also why two headers had to change. Both had been correct
only because the process had never returned HTML:

- `Content-Security-Policy: default-src 'none'` was on every response, which is
  right for an API returning JSON and wrong the moment it returns a page. It
  splits now: `/api/` keeps `'none'` and the shell gets a real policy.
  `script-src` stays strict. `style-src` takes `'unsafe-inline'` because React
  writes `style=""` attributes and CSP counts those as inline styles, which is
  a far smaller concession than the same word in `script-src`.
- `Permissions-Policy: geolocation=()` denies geolocation to the *document*. It
  had only ever reached API responses. Left alone it would have killed the
  distance prompt outright, the browser refusing before the control was ever
  shown, which is the exact dead control the design exists to prevent. It is
  now `geolocation=(self)`: nobody else may ask, we may.

### Before: a laptop and a tunnel

It ran on a development laptop behind a Cloudflare Tunnel, with Postgres in
Docker and the frontend served by `vite preview` on a second port.

It worked, and it was honest about what it was, but a laptop hosts a site only
while it is open, so the link could not be shared without an asterisk about
when it would answer. Everything above follows from removing that asterisk.

The laptop stack is still installed as the rollback.

---

## Known gaps, stated rather than hidden

- **Deletion frees the address.** A restricted account can delete and sign up
  again, and the new profile carries none of the old one's strikes. Closing
  that needs a durable identifier this product refuses to hold. The old profile
  row and its reports remain for the record.
- **Rate limiting is in-memory.** Lost on restart, and wrong the moment there
  are two instances. This is the one thing that must change before this is ever
  deployed twice.
- **The inbound cap counts what surfaced today**, so someone who never opens
  their letters accumulates a backlog that expires rather than waits.
- **An account cannot be recovered if its address is lost**, and this is
  deliberate. The address *is* the identity, so every recovery route is a
  second way in: a phone number, a security question, an appeal answered by
  someone who cannot verify anything. Each is a better attack than it is a
  rescue. Changing the address while you still hold it exists; losing it is
  final.
- **A conversation shows its newest 200 messages.** Anything older is out of
  reach. That is a known ceiling rather than a silent stall, and the price of
  refetching the whole thread on every poll so that reactions on old messages
  arrive.
- **The screen-reader announcements have not been heard by a real screen
  reader.** The markup is there and verified in the shipped bundle; the
  experience is not yet tested.

---

## Identity, stated plainly

Email verification proves control of an email address. It does **not** prove
real-world identity, good intentions, age, compatibility, or trustworthiness,
and nothing in this product describes it as identity verification.

---

*Nothing here is borrowed from the film of the same name.*
