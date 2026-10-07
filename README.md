# WhyFinder

**A chat-based tool that helps people notice patterns in their own lives, with a journal to keep what matters and Scripture a tap away.**

You talk. WhyFinder asks questions that build on what you actually said, remembers the thread, and now and then offers a *guess* about a pattern, which you can keep, rewrite in your own words, or throw away. When you ask what the Bible says, it answers carefully and shows you the real passage from YouVersion. When you are struggling, it points you to people, not to itself.

It is a tool for thinking out loud. It is not a counselor, a pastor or a friend, and it says so.

It is governed by 32 hard constraints (Volume I) and 18 judgment-call preferences (Volume II). A violation of a Volume I rule is a bug, not a style note.

**Live demo:** [ADD LINK] · **Video:** [ADD LINK] · **Team:** [ADD NAMES]

---

## The thing worth looking at

**`/filter-demo`.**

Most AI products put their safety in the system prompt. This one enforces its rules *after* generation, in the request path, with no way to switch them off. C-15 states it directly:

> C-08 through C-14 are enforced post-generation as well as in the prompt. Prompt-only enforcement does not satisfy them. The filter sits in the request path with no bypass flag; an integration test with the prompt rules removed proves the filter still blocks.

`filterSynthesis(candidate, context)` takes two arguments. It reads no environment variable and accepts no options object, so there is no bypass to find, and a test asserts the function's arity, which fails the moment someone adds one.

The constraints live outside the model adapter, so swapping providers changes nothing about what the app is allowed to say.

---

## Try it in two minutes

1. **An ordinary day.** Say what you did this week (for example, "I spent Saturday rewiring a shed with my neighbor"). Keep going for a few messages. Each reply stays with your own words and asks one follow-up. After a few messages you will see a card labelled **"A guess, not a finding"** with the quotes it is based on. Press **Keep this**, **Edit** (say it in your own words) or **That's not it**.
2. **Save something by asking.** After a message, type "add this to my journal" or "this is important to me". Open the **Journal** (top bar): it is under "Things you saved", next to your kept guesses and saved questions. Press **Clear chat**: the conversation goes, the journal stays. Copy or download it as plain text.
3. **A faith question.** Ask "what does the Bible say about anxiety?" You get a short, hedged answer, questions to sit with, people worth talking to, and the real verse text from the YouVersion API with its version, copyright and a link. Save any question to bring to a pastor or counselor.
4. **A hard moment.** Say you are anxious and overwhelmed. A support card appears pointing to a counselor or doctor, a pastor or small group, one person who knows you, and 988. The app pauses its questions and says so out loud. Language about ending one's life, even misspelled ("kill myslef"), gets 988 and real people at once, says plainly that this is beyond what an app can help with, offers a short Christian word that the person is loved and made for community, and shows Psalm 34:18. For the next several messages there are no stock questions and no guesses.

---

## What it does

| | |
|---|---|
| **Follow-ups that listen** | Each reply refers to something concrete you just said, then asks one open question. It does not just walk down a list. |
| **Guesses with receipts** | A guess must cite at least two of your own entries and name something you actually said. It is always a hypothesis ("worth exploring whether..."), never a claim about who you are. Guesses are spaced a few messages apart. |
| **You decide what is kept** | Nothing goes into the journal unless you press Keep, or write it yourself. |
| **Scripture, not just opinions** | Faith questions get a labelled answer ("What the Bible says" vs. "How many Christians read it") with live passages from the YouVersion API. |
| **Points to people** | Distress leads to a counselor, a pastor, a friend, or 988, never to the app as a substitute. |
| **A journal you come back to** | Kept guesses, things you asked to save ("add this to my journal"), questions to bring to someone, export. It survives closing the browser and clearing the chat. All on your device. |
| **Honest when it breaks** | If the language model is unreachable, the app tells you and holds back. It never passes off canned text as a real guess. |

---

## How AI is used

The model (Anthropic Claude) does four jobs: a short reply to what you said, a follow-up question, a faith answer, and the pattern guess. **Every model output is checked by our own rules before you see it**, and anything that breaks them is discarded.

Examples of what those rules enforce:

- Guesses need evidence from at least two of the person's own entries and a concrete noun they used.
- Never "you are a..." or "your purpose is...". Describe what someone keeps *doing*, not who they *are*.
- Never say what God wants for the person, and never say a past event *caused* a present feeling.
- No clinical or personality-type labels the person did not use first.
- Scripture is labelled by kind (what the Bible says, how traditions read it, a guess), never mixed.
- No streaks, badges or gamification.

If a faith answer is rejected, the app retries once, telling the model why, and otherwise falls back to a safe line.

**The model.** With `ANTHROPIC_API_KEY` set, the app generates live. With no key it runs on recorded responses, which costs nothing and cannot fail on stage. If a live call fails, the person is told so and the guess is held back. Fixtures are never dressed up as a real reply.

### YouVersion integration (live)

For each faith answer the model proposes references only (it never quotes verses). The server then calls the YouVersion API (`GET /bibles/{id}/passages/{reference}`) and shows the real text, with the Bible version, its copyright line and a "Read on YouVersion" link. Default Bible: Berean Standard Bible (public domain). Only the references are sent to YouVersion, not anything the person wrote.

### Gloo AI

A guarded Gloo AI Studio adapter is built (`src/providers/gloo.ts`) with a retry and a fallback to the primary model. It is **switched off on purpose**. C-21 requires written confirmation that no provider, including any subprocessor, trains on user content, and Gloo has not yet given it. It turns on only when both `GLOO_API_KEY` and `GLOO_C21_CONFIRMED=yes` are set.

---

## Privacy and safety

- **No database.** The conversation and journal live in the browser (`localStorage`) on the person's own device. Both survive closing the browser. "Clear chat" erases the conversation and keeps the journal; "Erase everything on this device" (in the journal) erases both. The server keeps nothing.
- Each turn sends the conversation text to the server and then to the model provider to generate a reply. The opening screen says that training on what you write is off unless you turn it on yourself.
- **Crisis language** gets 988 and the crisis resources immediately. It is detected as written and after correcting common typos and slang, and for several messages afterwards the app asks no stock questions and offers no guesses. Lower-level distress gets a support card and pauses the question flow, and the card says that nothing is reported to anyone.
- **This is an unreviewed prototype.** The wording of the support and crisis messages was written by us and has not been reviewed by a clinician or a pastoral reviewer. The app says so on its first screen ("See what's still open") and lists exactly what is unreviewed.

### REVIEW_STATE

| | DEMO | BETA |
|---|---|---|
| Reviewers | none | clinician + pastoral signed off |
| Heavy question rows | disabled | live |
| Crisis copy | resources borrowed verbatim from 988 / Crisis Text Line; the hand-off lines, the Christian word and the check-in line are authored and **unreviewed** | authored, clinician- and pastor-approved |
| Expiry | 2026-10-09, then refuses to serve | none |

DEMO carries a hard expiry in code. Past it the build stops and says why. Temporary infrastructure without an expiry is how it becomes permanent.

---

## Running it

```bash
npm install
npm run dev          # the app, http://localhost:3000
npm test             # must be green
npm run gates        # deferred release gates: RED BY DESIGN, see below
npm run demo         # the filter demo in the terminal, no network needed
```

Create a file named `.env.local` in the project root. Never commit it.

```
ANTHROPIC_API_KEY=...        # the language model
ANTHROPIC_MODEL=...          # optional
YVP_APP_KEY=...              # YouVersion Platform app key (live verses)
YVP_BIBLE_ID=3034            # optional, default Berean Standard Bible
# Gloo stays off unless BOTH are set:
# GLOO_API_KEY=...
# GLOO_C21_CONFIRMED=yes
```

With no model key the app runs on recorded responses and says so. With no YouVersion key, answers appear without verse text.

### Two test suites, on purpose

`npm test` must be green. `npm run gates` is red until reviewers sign off. Each failure is an unmet release gate from Volume I, not a bug.

They are separate because a single red CI destroys the signal a suite exists to give: a genuine regression becomes indistinguishable from a known gap, and within a week nobody reads the failures. A release requires both green.

---

## Layout

```
src/constraints/   the filter, the acute-signal path, the support path, the question gate
src/content/       the question bank (heavy tier deliberately empty), experiments, scripture (YouVersion)
src/profile/       the Why Profile: confirm-before-write, history, deletion
src/engine/        the conversation engine
src/providers/     model providers, fallback, and the guarded Gloo adapter
src/config/        pattern lists, REVIEW_STATE, the deferred-gate register
src/demo/          the strip-the-prompt demo
app/               Next.js: the chat screen, the journal panel, /filter-demo, /api/turn
scripts/           try.mjs plays scripted conversations through /api/turn
tests/             must pass
gates/             must fail until reviewed
```

```
Browser (Next.js / React)         Server: /api/turn                    Services
  conversation + journal  ──►   takeConversationTurn
  kept on this device           ├─ concern tier + support path
                                ├─ reply / follow-up / guess ──────►  Claude  (Gloo optional, off)
                                ├─ faith answer ───────────────────►  Claude
                                │     └─ passages ─────────────────►  YouVersion API
                                └─ filters on every output (rules C-xx)
```

## What was built during the hackathon

**All of the code was written inside the build window (Sept 8 – Oct 8, 2026).** The first commit is `1596588` on 2026-09-24, and there are 20 commits in total. No code in this repository predates the hackathon.

| Dates | Commits | Who | What |
|---|---|---|---|
| Sept 24 – Oct 2 | 11 (`1596588` → `2e92edf`) | Professor-led, written with an AI coding assistant (commit author "Claude"), question-bank edits by Ray | Constraint engine and filters, question gate, Why Profile, chat screen, live Claude API with a fallback, `/api/health`, question bank expanded to 50, organization-scoped API keys |
| Oct 4 – Oct 5 | 9 (`ce93286` → `c261eba`) | Phillip Stupak | Reply layer, faith Q&A, tiered concern and support path, follow-up questions, device memory, journal panel with export, spaced guesses, answer retry, crisis phrasing, fixed top bar, staying with lonely users |

`[CONFIRM]` If any design documents (the Volume I constraints, the Volume II preferences, the product doc) were written before Sept 8, say so here and give the date.

Run `git log --reverse --format="%h %ad %an %s" --date=short` to see the full history.

## What is not built

Named so it does not get built by accident: dark mode; streaks, badges, counts, points or progress bars (C-27); any admin surface that can display conversation content (C-19); any staff review queue (C-03); anything that pauses or locks a surface (C-04); ranked or scored calling matches (P-14).

## What is next

- Clinician and pastoral review of every support and crisis message.
- Turning on Gloo once its data terms are confirmed in writing.
- A timeline in the journal, so patterns can be revisited over time.

---

*WhyFinder is a prototype built for the Gloo AI Hackathon 2026.*