---
name: construct-learning
description: Build a complete interactive learning project for a technical topic on top of learning-kit — a series of illustrated blog posts aimed at a toy implementation, the implementation itself in Clojure and in Go (standalone lesson per post plus a capstone), an exercise track, predict-then-reveal figures, spaced-repetition cards, verified excerpts from real-world source, the Go programs running in the browser via WebAssembly in a ghostty-web terminal, and GitHub Actions CI deploying to GitHub Pages. Use when Dan says "construct the learning for <topic>", "build me a learning series on X", "I want to learn how X works by building it", or asks for a course/tutorial/blog series with code for a topic such as a DSL and its interpreter, a regex engine, a type checker, a database component, a consensus protocol, a garbage collector, a bytecode VM. Also use when extending or adding parts to an existing learning-kit project (a repo with learning.json).
---

# Construct the learning

Turns a topic into a learning project like
[execution-engine-learning](https://github.com/dpsutton/execution-engine-learning) (live:
https://dpsutton.github.io/execution-engine-learning/). That project is the worked example: when in
doubt about tone, depth, structure, or file shapes, read its `site/`, `DESIGN.md`, and lessons.

The machinery (site shell, tooling, CI, deploy) lives in **learning-kit**
(`~/projects/learn/learning-kit`, `github.com/dpsutton/learning-kit`). A learning project holds only
content. Read `references/authoring.md` before writing posts, figures, cards, or excerpts; it has the
formats and the `EE.*` figure API.

## What the learner wants (and why it shapes everything)

- **Toy, not production.** Pitch it like sqlglot's Python executor: small enough to read in an
  afternoon, real enough that the ideas carry over. No performance tuning, no robust error handling,
  no persistence unless the topic is persistence. Every detour into robustness is time not spent on
  the mechanism.
- **Clojure first, Go second.** Clojure is the confident language: it's where the learner thinks,
  at a REPL. Go is the language being practiced, and it's the one that compiles to wasm for the
  browser terminal. Both implement the same lessons idiomatically. **Go↔Clojure parity is not a
  goal**: don't add machinery (shared PRNG bit-identity, identical float formatting) to make them match.
- **The learner does the learning.** The posts explain and the reference lessons are the answer key,
  but the payoff is the learner building it: exercises with failing tests, predictions before
  reveals, "find it" prompts on real source. Don't pre-solve beyond that. When the learner later
  asks questions, guide and hint; don't build ahead of them.
- **Accuracy over flourish.** Every factual claim (about real systems, defaults, history) is
  something you checked. Prose is dense and literal: pseudocode and concrete numbers over metaphor.

## Workflow

### 1. Shape the curriculum (short, with the learner)

Propose 5–8 parts as a table: slug, title, one-line description, what gets built. The arc should
build toward a **payoff part** that's genuinely surprising (execution-engine's was a resumable
bytecode VM: "a query you can pause, save, and resume somewhere else"). Name the capstone: the
integrated program that combines every part (for a DSL: lexer → parser → evaluator → compiler → VM
REPL). Name the toy data or toy programs the posts will use throughout. Get a yes, then build without
further check-ins unless something is genuinely the learner's call.

### 2. Scaffold

```bash
export PATH=~/projects/learn/learning-kit/bin:$PATH     # clone dpsutton/learning-kit there if missing
lk new ~/projects/learn/<slug> --title "<Title>" --headline "<headline>" --tagline "<tagline>" \
  --part "<slug>:<Title>:<desc>" ...
```

This creates a one-lesson sample (`lesson01` in both languages, with an exercise marker, test, demo,
post stub, card, and the 8-line workflow) that already passes `lk ci`. Keep its shapes; replace its
content.

### 3. Write DESIGN.md before any code

The contract every agent builds against: the data model and semantics (with edge cases decided),
the toy dataset or example programs, the interfaces each part introduces, file and namespace names
(`clojure/src/lessonNN/<slug>.clj` ns `lessonNN.<slug>`, `go/lessonNN/<slug>.go`, `go/cmd/lessonNN`),
the capstone's CLI and REPL commands, and the exercise ids per lesson (same id in both languages for
the same function). Ambiguity here becomes inconsistency across six parallel agents.

### 4. Build in parallel

Use fork agents, each owning disjoint files, all reading DESIGN.md first:

| Agent | Owns |
|---|---|
| Clojure lessons | `clojure/src/lessonNN`, `clojure/test/lessonNN` |
| Clojure capstone | `clojure/src/<capstone>`, its tests |
| Go lessons | `go/lessonNN`, `go/cmd/lessonNN` |
| Go capstone | `go/<capstone>`, `go/cmd/<capstone>` |
| Posts A / Posts B | `site/posts/NN-*.html`, `site/viz/NN-*.js`, `site/cards/NN.js` for their parts |

Brief each with: what to build, the quality bar, how to verify (tests green, demos run, `lk build`
+ headless screenshots for posts), and "don't touch other agents' files". Lessons are standalone
(each copies the few helpers it needs rather than importing earlier lessons) so a reader can open one
directory and see everything. Every lesson has a `-main`/`cmd` demo that prints a narrated
walkthrough, and 2–4 `EXERCISE(id)` regions (rules in `references/authoring.md`).

Posts: 1,500–2,500 words each (the payoff part may be longer), language-neutral pseudocode in
`<pre class="pseudo">` (ML-style `match`/`case ... ->`, `--` comments; the learner likes the
destructuring), at least two genuinely instructive interactive figures, 1–2 predict-then-reveal
moments aimed at misconceptions, 8–12 recall cards (3 marked warm-up), a `.code-ref` linking the
lesson files plus `../terminal.html#lessonNN`, a `.build-it` naming the exercises, `data-warmup` and
`data-wild` mounts, and a takeaway. Plant the payoff early without spoiling it.

### 5. Exercises, terminal, CI wiring

- `lk exercises` regenerates `clojure/ex` and `go/exercises` from the markers and checks that each
  exercise compiles/loads and fails, and that reference tests pass. Commit the generated files.
- `learning.json`: `demos` (Clojure namespaces and Go cmds run in CI), `terminal.programs` (Go cmds
  built to wasm; they must just read stdin and write stdout), `terminal.files` (files a program
  opens, served next to the wasm), `terminal.try` (suggestions in the help), `terminal.smoke`
  (`[input, regex, description]` steps CI types into the browser terminal), `ci.extra` (shell
  commands, e.g. golden-file diffs).

### 6. In the wild (after posts exist)

Real-source excerpts, one collapsed section per post, opened after the exercises. Pick 4–9 real
implementations relevant to the topic and spread them (`wild.min_sources`/`max_per_source` enforce
it). Blobless-clone them pinned: `git clone --depth 1 --filter=blob:none --no-checkout <url>
/tmp/lk-sources/<name>`; read files with `git -C … show HEAD:path`. Agents add excerpts **only** via
`lk wild-add` (copies code verbatim; never hand-typed), each with a "find it" prompt and notes that
contrast the real choice with ours, every claim verified in the source. `lk wild-verify` checks
everything against GitHub. Name contrasts honestly (a source that doesn't fit the topic is skipped).

### 7. Verify, then publish

- `lk ci` green (it is exactly what CI runs). Look at screenshots of every post yourself and read
  the prose; agents' self-reports are claims, not evidence.
- Publishing is outward-facing: **ask** before `gh repo create dpsutton/<slug>-learning --public`
  and before each push (one approval = one push). Then enable Pages from Actions:
  `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow`, watch the run
  (`gh run watch <id> --exit-status`), and confirm the live URLs.

## Things that bit us (keep them fixed)

- **ghostty-web** fails on large single writes ("offset is out of bounds"); the kit's terminal writes
  in 512-char pieces and never lets a render error reach Go's I/O callback.
- **Go js/wasm**: the kit supplies `globalThis.fs` so stdin parks the goroutine until Enter; Go's
  `Open` calls Node-style `stat.isDirectory()`; leftover scheduler timers after exit must be
  cancelled. Don't hand-roll this again.
- **Pages caching** (`max-age=600`) can pair new HTML with stale JS; `lk build` stamps `?v=<sha>`.
- **file:// vs http**: the site works from `_site/` over file:// except the terminal (needs HTTP);
  use `lk serve`.
- **YAML**: a step name starting with a quote doesn't parse. **zsh**: `$var` doesn't word-split;
  pipe to `while read` instead.
- **Headless Chrome** won't go below ~500px wide; test 400px layouts inside an iframe.
- **Font ligatures** turn `->`/`==` into glyphs in code; the kit disables them for code but keeps
  them in pseudocode on purpose.
- Generated ids and names drift between languages; that's fine. Just keep each `.build-it` honest
  (list what `lk exercises` actually generated).

## Optional extras (only when asked)

- A trailer video: see execution-engine's `video/` (Kokoro TTS phrase-by-phrase timeline, numpy
  music bed, deterministic `renderAt(t)` HTML animation captured with puppeteer, ffmpeg mix). Verify
  the voiceover with a Whisper transcription; fix mispronunciations phonetically ("Closure").
- A Go/Clojure tab under pseudocode, extracted from the lesson files (mind that exercise bodies are
  answer keys).
