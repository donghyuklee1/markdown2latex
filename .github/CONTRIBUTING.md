# Contributing to CleanMath

Thanks for helping. CleanMath has one job - turn messy LLM math into LaTeX that
compiles on the first try - and the bar for changes is set by that job.

## Setup

```bash
git clone https://github.com/donghyuklee1/markdown2latex.git
cd markdown2latex
npm install
npm run dev          # http://localhost:3000
```

Node 18.17+ (20 recommended, matching CI).

## The one command to run before pushing

```bash
npm run verify       # lint + typecheck + engine tests + production build
```

Individually:

| Command | What it checks |
| --- | --- |
| `npm run lint` | ESLint, zero warnings tolerated |
| `npm run typecheck` | `tsc --noEmit`, strict mode |
| `npm test` | Engine conformance + every example renders in KaTeX |
| `npm run build` | Production build |
| `npm run examples` | Regenerates `examples/` - commit the diff |

CI runs all of these, and fails if `examples/` is stale.

## Where things live

The engine is [`src/lib/cleaner.ts`](../src/lib/cleaner.ts). It is deliberately
pure: no DOM, no React, no I/O. That is what lets it run on every keystroke and
be tested under plain node. Keep it that way - if a change needs browser APIs, it
belongs in a component, not in the engine.

Read [`docs/ENGINE.md`](../docs/ENGINE.md) before changing the pipeline.

## Adding a cleanup rule

Every rule is a tradeoff: it fixes some inputs and risks rewriting others. A new
rule needs all three of these:

1. **A test that fails without it.** Add a `check(...)` to
   [`tests/cleaner.spec.ts`](../tests/cleaner.spec.ts).
2. **A test that pins down where it must *not* fire.** This matters more than the
   first one. `(y_i - f(x_i))^2` must never become `\text{...}`, and
   `npm test` has cases that exist purely to keep conservative behaviour
   conservative.
3. **Idempotence.** Running CleanMath on its own output must be a no-op. There is
   a check for this; do not weaken it.

If a rule cannot be made safe, it belongs behind a toggle in `ConfigOptions`
rather than on by default.

## Code style

- TypeScript strict, no `any`, no non-null `!` assertions on parsed input.
- Non-ASCII characters in the engine are written as `\uXXXX` escapes or built
  from `String.fromCharCode`. Half this project's job is hunting invisible
  codepoints; they have to stay greppable.
- Comments explain *why* a rule exists or which real-world breakage it fixes.
  Skip comments that restate the code.
- Tailwind utilities inline. No CSS modules, no styled-components.

## Commits and PRs

Short imperative subject lines (`fix: do not anchor \le rows in align`). In the
PR description, include the before/after LaTeX - it is the fastest possible
review.
