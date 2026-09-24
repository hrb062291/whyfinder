# WhyFinder

A chat-based tool that helps people notice patterns in their own lives.

It is governed by 32 hard constraints (Volume I) and 18 judgment-call preferences
(Volume II). A violation of a Volume I rule is a bug, not a style note.

## The thing worth looking at

**`/filter-demo`.**

Most AI products put their safety in the system prompt. This one enforces its
rules *after* generation, in the request path, with no way to switch them off.
C-15 states it directly:

> C-08 through C-14 are enforced post-generation as well as in the prompt.
> Prompt-only enforcement does not satisfy them. The filter sits in the request
> path with no bypass flag; an integration test with the prompt rules removed
> proves the filter still blocks.

`filterSynthesis(candidate, context)` takes two arguments. It reads no
environment variable and accepts no options object, so there is no bypass to
find — and a test asserts the function's arity, which fails the moment someone
adds one.

The constraints live outside the model adapter, so swapping providers changes
nothing about what the app is allowed to say.

## Running it

```bash
npm install
npm run dev          # the app
npm test             # 169 tests — must be green
npm run gates        # deferred release gates — RED BY DESIGN, see below
npm run demo         # the filter demo in the terminal, no network needed
```

## Two test suites, on purpose

`npm test` must be green. `npm run gates` is **red until reviewers sign off** —
each failure is an unmet release gate from Volume I, not a bug.

They are separate because a single red CI destroys the signal a suite exists to
give: a genuine regression becomes indistinguishable from a known gap, and
within a week nobody reads the failures. A release requires both green.

## REVIEW_STATE

| | DEMO | BETA |
|---|---|---|
| Reviewers | none | clinician + pastoral signed off |
| Heavy question rows | disabled | live |
| Crisis copy | borrowed verbatim from 988 / Crisis Text Line | authored, clinician-approved |
| Expiry | **2026-10-09**, then refuses to serve | none |

DEMO carries a hard expiry in code. Past it the build stops and says why —
temporary infrastructure without an expiry is how it becomes permanent.

## The model

Fixtures by default: costs nothing, cannot fail on stage. Set `ANTHROPIC_API_KEY`
and it switches to live generation with no code change. The Gloo adapter exists
and **throws** — C-21 requires written confirmation that no subprocessor trains
on user content, and Gloo has not given it.

## Layout

```
src/constraints/   the filter, the acute-signal path, the question gate
src/content/       the question bank (heavy tier deliberately empty)
src/profile/       the Why Profile: confirm-before-write, history, deletion
src/engine/        the conversation engine
src/config/        pattern lists, REVIEW_STATE, the deferred-gate register
src/demo/          the strip-the-prompt demo
app/               Next.js — the chat screen and /filter-demo
tests/             must pass
gates/             must fail until reviewed
```

## What is not built

Named so it does not get built by accident: dark mode; streaks, badges, counts,
points or progress bars (C-27); any admin surface that can display conversation
content (C-19); any staff review queue (C-03); anything that pauses or locks a
surface (C-04); ranked or scored calling matches (P-14).
