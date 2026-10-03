# Authoring reference

Formats and APIs for a learning-kit project's content. The worked example for all of it is
`~/projects/learn/execution-engine/site/`.

## Contents
- Project layout
- Posts
- Figures (the `EE` API)
- Predict-then-reveal
- Recall cards
- Exercise markers
- In the wild excerpts
- learning.json

## Project layout

```
learning.json            title, headline, tagline, parts, demos, terminal, wild, ci (below)
DESIGN.md                the contract for every agent
site/intro.html          index intro (2–4 paragraphs), above the table of contents
site/outro.html          optional, after the index's generic "The code" section (capstone commands)
site/posts/NN-slug.html  article BODY only: <h1>, <p class="dek">, prose, figure mounts, callouts.
                         The kit adds <head>, header, kicker ("Part N · Title"), series nav.
                         A leading <style> block is fine for post-specific CSS.
site/viz/NN-slug.js      figures for that post (loaded automatically, deferred)
site/topic.js            optional shared figure data (e.g. a toy dataset): sets EE.<name> = …;
                         loads after common.js, before the figure scripts
site/cards/NN.js         recall cards        site/wild/NN.js   excerpts    site/wild/sources.js  blurbs
site/static/             copied to the site root as-is
clojure/ go/             lessons, capstone, generated exercise tracks
```

`lk build` assembles `_site/`; `lk serve` serves it (the terminal needs HTTP).

## Posts

Callouts: `.aside`, `.code-ref` ("In the code"), `.takeaway`, `.build-it` ("Now build it"),
`.compare` with `data-label="How X does it"` (contrast with a reference implementation).
Pseudocode: `<pre class="pseudo">` (keywords, `-- comments`, strings, calls get highlighted).
Real code: `<pre><code class="language-clojure|go|sql|bash|json">` (highlight.js). Captions:
`<p class="caption">`. Tables: `<div class="table-wrap"><table class="data">`; NULLs as
`<span class="null">NULL</span>`. Mounts the kit fills: `<div data-warmup></div>` right after the
dek (parts 2+), `<div data-wild></div>` before the takeaway.

## Figures (the `EE` API, from common.js)

Classic scripts only (no modules), so pages also work from file://. A figure replaces a mount:

```js
(function () {
  const { el, svg, clear, fmt, table, frame, stepper, seg, predict } = EE;
  const v = frame("#viz-hash", "Hash join", "build, then probe");   // → { root, controls, stage, foot }
  const frames = computeFrames();                                     // precompute every state
  const s = stepper(v.controls, frames, (f, i) => {                  // Reset / Back / Step / Play + speed
    clear(v.stage).append(table(["id", "name"], f.rows, { rowClass: (r, i) => (i === f.hl ? "hl" : null) }));
    v.foot.textContent = f.note;
  });
  v.controls.append(seg(["Nested loop", "Hash", "Merge"], 1, (i) => s.setFrames(framesFor(i))));
})();
```

- `el(tag, attrs, ...children)` / `svg(tag, attrs, ...children)`: attrs `class`, `text`, `html`,
  `onclick`, …; children may be arrays. `clear(node)`; `fmt(v)` formats values (NULL, floats 2dp).
- `table(columns, rows, {rowClass})`: mini table; row classes `hl` (accent), `hl2` (teal), `hl3`
  (violet), `pass`, `fail`, `dim`.
- Colors only via CSS variables (`var(--accent)`, `--teal`, `--violet`, `--good`, `--bad`, `--ink`,
  `--ink-soft`, `--ink-faint`, `--rule`, `--bg-raised`, `--bg-sunk`, and `-soft` variants) so light
  and dark both work. SVG helpers: `.node` (+ `active`, `done`, `teal`, `violet`), `.edge`, `.mono`,
  `.faint`. Stats: `.stats-row` of `.stat` (`<b>value</b><span>label</span>`). Tags: `.tag accent|teal|violet`.
  Bytecode listings: `table.listing` with `tr.pc`, `.op`, `.cmt`.
- Precompute frames, then render one: deterministic, steppable backwards, easy to test.
- Test at ~400px wide; wide content scrolls inside `.viz-stage`.

## Predict-then-reveal

```js
const p = predict(mountEl, {
  prompt: "With LIMIT 2, how many of the 4 rows does Scan read?",
  number: { min: 0, max: 4, step: 1, value: 4 },        // or log: true; or choices: ["A", "B"]
  answer: 3, tolerance: 0.2,                             // numbers: ±20% counts as close
  explain: "Bo fails the filter, so Scan reads Cy before Limit is satisfied.",
  onLock(guess) { s.go(0); playToEnd().then(() => p.reveal()); },   // run the figure, then reveal
});
```

Aim each at a misconception (NULL is not false; LIMIT doesn't always stop early; an index isn't
always faster). The figure must stay usable without predicting.

## Recall cards

`site/cards/NN.js`: `EE.addCards("NN", [ … ]);` with **strict JSON** inside (double quotes, no
trailing commas: `lk anki` parses it). Each card: `{"id": "NN-slug", "q": html, "a": html,
"warmup": true?}`. 8–12 per post; mechanisms and reasons, not trivia; answers 1–3 sentences; mark
the 3 best `warmup` (they open the next post).

## Exercise markers

In reference lessons only (never the capstone):

```go
func (j *HashJoin) Next() (Row, bool) {
	// EXERCISE(hash-join-probe): For the current probe row, look its key up in the table built in
	// Open and emit one joined row per match; pad with NULLs for left outer when nothing matched.
	...reference code...
	// END EXERCISE
}
```
```clojure
;; EXERCISE(hash-join-probe): …hint…
…complete, balanced forms…
;; END EXERCISE
```

A region is the whole body of one function or method (or a contiguous run of complete forms), so the
stub compiles; extract a helper if the mechanism is buried mid-function. Markers start their own
line. Hints say what, not how. 2–4 per lesson, each covered by a test that fails with the TODO.
`lk exercises` regenerates and checks; commit the output.

## In the wild excerpts

```bash
lk wild-add --part 03 --id 03-postgres-hashjoin --source PostgreSQL --clone /tmp/lk-sources/postgres \
  --path src/backend/executor/nodeHashjoin.c --lines 269-269 --lines 435-446 --lang c \
  --title "ExecHashJoinImpl: the whole join is a switch" \
  --prompt "Which fields play the roles of our <code>cur</code> and <code>matches</code>?" \
  --notes "<p>What to notice, the mapping to our names, one real difference and why.</p>"
```

Languages for highlighting: c, cpp, go, rust, scala, java, python, … (highlight.js names). 10–45
lines per excerpt across segments. `site/wild/sources.js`: `window.SOURCE_BLURBS = {"Name": "one or
two factual sentences"}`. `lk wild-verify` re-checks every excerpt against GitHub.

## learning.json

```json
{
  "title": "Execution Engine", "headline": "Building a query execution engine", "tagline": "…",
  "parts": [{"slug": "expressions", "title": "Expressions", "desc": "…"}],
  "demos": {"clojure": ["lesson01.expressions"], "go": ["lesson01"]},
  "terminal": {
    "programs": {"engine": "description", "lesson01": "description"},
    "files": {"queries/golden.sql": "queries/golden.sql"},
    "try": [["engine -vm", "note"]],
    "smoke": [["lesson02", "scan read 3 of 4[\\s\\S]*\\$ $", "lesson02 to finish"]]
  },
  "wild": {"min_sources": 3, "max_per_source": 2},
  "ci": {"extra": ["cd go && go run ./cmd/engine -golden ../queries/golden.sql | diff - engine/testdata/golden.out"]}
}
```

Terminal programs are `go/cmd/<name>`; the shell prompt ends in `$ `, so smoke regexes waiting for
the shell end with `\\$ $`.
