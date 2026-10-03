# learning-kit

Everything a learning project needs except the content: the site shell, the tooling, and CI.

A **learning project** teaches a topic by building a toy version of it: a series of interactive
posts, standalone lessons in Clojure and Go plus a capstone that combines them, an exercise track,
predict-then-reveal figures, spaced-repetition cards, verified excerpts from real-world source, and
the Go programs running in the browser (WebAssembly in a [ghostty-web](https://github.com/coder/ghostty-web)
terminal). The first one: [execution-engine-learning](https://github.com/dpsutton/execution-engine-learning)
([live](https://dpsutton.github.io/execution-engine-learning/)).

A project holds only content: `learning.json`, `site/` (post bodies, figures, cards, excerpts),
`clojure/`, `go/`. This kit supplies the rest.

## Use

```bash
export PATH=~/projects/learn/learning-kit/bin:$PATH      # needs uv, go, clojure, node, Chrome

lk new ~/projects/learn/regex --title "Regex Engine" --part "parsing:Parsing:From pattern to AST" \
                                                     --part "nfa:NFAs:Thompson's construction"
cd ~/projects/learn/regex
lk serve          # build _site/ (wasm included) and serve it at http://localhost:8000
lk exercises      # regenerate the exercise track from EXERCISE markers, check it fails as designed
lk wild-add …     # add a verbatim excerpt from a pinned clone of a real implementation
lk test 01        # one part's exercise tests: ✓/✗ each, what each failure waits on, what's newly passing
lk progress       # scoreboard: exercise-track tests passing per part, Go and Clojure
lk ci             # tests, demos, CI extras, exercises, excerpts, build, headless-Chrome check, Anki
```

A project's whole CI/deploy workflow (scaffolded by `lk new`):

```yaml
permissions: { contents: read, pages: write, id-token: write }
jobs:
  learning:
    uses: dpsutton/learning-kit/.github/workflows/learning.yml@main
```

Set the repo's Pages source to GitHub Actions. Pushes to `main` run `lk ci` and deploy `_site/`.

## Layout

```
lk.py, bin/lk                the CLI (uv script)
web/assets/                  style.css, common.js (EE: figures, predict, cards, warm-ups, excerpts,
                             highlighting), review.js (spaced repetition), terminal.js (Go wasm I/O)
web/pages/                   index, post, review, wild, terminal, exercises page templates
check-site/                  headless-Chrome checker: links, cards, every page, terminal smoke steps
scaffold/                    what `lk new` copies: a one-lesson sample that passes `lk ci`
.github/workflows/learning.yml   the reusable workflow projects call
skill/construct-learning/    the Claude Code skill: "construct the learning for <topic>"
```

The skill is installed by linking it: `ln -s ~/projects/learn/learning-kit/skill/construct-learning ~/.claude/skills/`.
