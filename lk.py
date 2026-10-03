# /// script
# requires-python = ">=3.11"
# dependencies = ["genanki"]
# ///
"""lk: the learning-kit CLI. Run it from a learning project's root (or pass --project DIR).

A learning project holds only content (see README.md); this kit supplies the site shell, the
tooling, and CI. Commands:

  lk new DIR --title T [--headline H] [--tagline X] --part slug:Title:desc ...   scaffold a project
  lk build [--no-wasm] [--out _site]   assemble the static site from content + kit
  lk serve [--port 8000]               build, then serve _site over HTTP
  lk check                             load every built page in headless Chrome (+ terminal smoke)
  lk exercises [--no-check]            regenerate the exercise track from EXERCISE markers
  lk wild-add ...                      add a verbatim excerpt from a pinned clone (see --help)
  lk wild-verify                       check every excerpt against its GitHub permalink
  lk anki                              export the recall cards as an Anki deck
  lk ci                                everything above that can fail, in order: the definition of green
"""
import argparse, hashlib, html, http.server, functools, json, os, re, shutil, subprocess, sys, urllib.request
from pathlib import Path

KIT = Path(__file__).resolve().parent
ROOT = Path.cwd()


def die(msg):
    sys.exit(f"lk: {msg}")


def cfg():
    p = ROOT / "learning.json"
    if not p.exists():
        die(f"no learning.json in {ROOT} (run from a learning project, or pass --project)")
    c = json.loads(p.read_text())
    c.setdefault("parts", []); c.setdefault("terminal", {}); c.setdefault("wild", {}); c.setdefault("ci", {})
    c.setdefault("demos", {})
    return c


def nn(i):
    return f"{i:02d}"


def run(cmd, cwd=None, check=True, quiet=False, env=None):
    if not quiet:
        print(f"  $ {cmd if isinstance(cmd, str) else ' '.join(cmd)}")
    r = subprocess.run(cmd, cwd=cwd or ROOT, shell=isinstance(cmd, str), text=True,
                       capture_output=quiet, env={**os.environ, **(env or {})})
    if check and r.returncode != 0:
        if quiet:
            print(r.stdout[-3000:], r.stderr[-3000:])
        die(f"failed: {cmd}")
    return r


def step(title):
    print(f"\n━━ {title} " + "━" * max(0, 70 - len(title)))


# =============================================================================================
# new: scaffold a content-only project
# =============================================================================================
def cmd_new(a):
    dest = Path(a.dir).resolve()
    if dest.exists() and any(dest.iterdir()):
        die(f"{dest} exists and is not empty")
    shutil.copytree(KIT / "scaffold", dest, dirs_exist_ok=True)
    parts = []
    for spec in a.part:
        slug, title, *desc = spec.split(":", 2)
        parts.append({"slug": slug, "title": title, "desc": desc[0] if desc else ""})
    if not parts:
        die("give at least one --part slug:Title:description")
    c = json.loads((dest / "learning.json").read_text())
    c.update({"title": a.title, "headline": a.headline or a.title, "tagline": a.tagline or "", "parts": parts})
    (dest / "learning.json").write_text(json.dumps(c, indent=2) + "\n")
    stub = (dest / "site/posts/01-example.html").read_text()
    (dest / "site/posts/01-example.html").unlink()
    for i, p in enumerate(parts, 1):
        (dest / f"site/posts/{nn(i)}-{p['slug']}.html").write_text(stub.replace("{{PART_TITLE}}", p["title"]))
    for f in dest.rglob("*"):
        if f.is_file() and f.suffix in {".md", ".html", ".json", ".yml"}:
            f.write_text(f.read_text().replace("{{TITLE}}", a.title))
    subprocess.run(["git", "init", "-q"], cwd=dest)
    print(f"created {dest}\n  next: cd {dest} && lk exercises && lk build && lk serve")


# =============================================================================================
# exercises: strip EXERCISE regions from the reference lessons into an exercise track
# =============================================================================================
START = re.compile(r"^(\s*)(//|;;)\s*EXERCISE\(([\w-]+)\):\s*(.*)$")
END = re.compile(r"^\s*(//|;;)\s*END EXERCISE\s*$")


def strip_regions(text, lang, where):
    out, found, lines, i = [], [], text.split("\n"), 0
    while i < len(lines):
        m = START.match(lines[i])
        if not m:
            if END.match(lines[i]):
                die(f"{where}:{i+1}: END EXERCISE without EXERCISE")
            out.append(lines[i]); i += 1; continue
        indent, cm, ex_id, hint = m.group(1), m.group(2), m.group(3), [m.group(4).strip()]
        j = i + 1
        while j < len(lines) and lines[j].strip().startswith(cm) and not END.match(lines[j]):
            hint.append(lines[j].strip()[len(cm):].strip()); j += 1
        k = j
        while k < len(lines) and not END.match(lines[k]):
            if START.match(lines[k]):
                die(f"{where}:{k+1}: nested EXERCISE")
            k += 1
        if k == len(lines):
            die(f"{where}:{i+1}: EXERCISE({ex_id}) has no END EXERCISE")
        hint_text = " ".join(h for h in hint if h)
        out.append(f"{indent}{cm} EXERCISE({ex_id}): {hint_text}")
        out.append(f'{indent}panic("TODO: exercise {ex_id}")' if lang == "go"
                   else f'{indent}(throw (ex-info "TODO: exercise {ex_id}" {{:exercise "{ex_id}"}}))')
        found.append({"id": ex_id, "hint": hint_text, "lines": k - j})
        i = k + 1
    return "\n".join(out), found


def go_module():
    m = re.search(r"^module\s+(\S+)", (ROOT / "go/go.mod").read_text(), re.M)
    return m.group(1)


def gen_go_exercises():
    go = ROOT / "go"
    if not (go / "go.mod").exists():
        return []
    mod, dest_root, index = go_module(), go / "exercises", []
    shutil.rmtree(dest_root, ignore_errors=True)
    for src in sorted(go.glob("lesson[0-9][0-9]")):
        dest = dest_root / src.name
        dest.mkdir(parents=True)
        for f in sorted(src.glob("*.go")):
            text = f.read_text()
            if not f.name.endswith("_test.go"):
                text, found = strip_regions(text, "go", f.relative_to(ROOT))
                index += [{**e, "lang": "Go", "lesson": src.name[-2:], "file": f"go/exercises/{src.name}/{f.name}"} for e in found]
            text = text.replace(f'"{mod}/{src.name}"', f'"{mod}/exercises/{src.name}"')
            (dest / f.name).write_text(f"// Code generated by lk exercises from go/{src.name}/{f.name}. DO NOT EDIT;\n"
                                       "// edit the reference lesson and regenerate. Fill in the TODOs here.\n\n" + text)
        for _ in range(5):  # Go refuses unused imports; the stripped code may no longer need some
            r = subprocess.run(["go", "build", f"./exercises/{src.name}"], cwd=go, capture_output=True, text=True)
            bad = re.findall(r'^(.+?\.go):(\d+):\d+: "[^"]+" imported and not used', r.stderr, re.M)
            if not bad:
                break
            for fname, line in bad:
                p = go / fname
                ls = p.read_text().split("\n"); ls[int(line) - 1] = ""; p.write_text("\n".join(ls))
        if r.returncode != 0:
            print(r.stderr); die(f"go/exercises/{src.name} does not compile")
    return index


def gen_clj_exercises():
    clj = ROOT / "clojure"
    if not (clj / "deps.edn").exists():
        return []
    dest_root, index = clj / "ex", []
    shutil.rmtree(dest_root, ignore_errors=True)
    for kind in ("src", "test"):
        for src in sorted((clj / kind).glob("lesson[0-9][0-9]")):
            for f in sorted(src.rglob("*.clj")):
                text = f.read_text()
                if kind == "src":
                    text, found = strip_regions(text, "clj", f.relative_to(ROOT))
                    index += [{**e, "lang": "Clojure", "lesson": src.name[-2:],
                               "file": f"clojure/ex/exercises/{src.name}/{f.relative_to(src)}"} for e in found]
                text = re.sub(r"(?<![\w.\-])lesson(\d\d)\.", r"exercises.lesson\1.", text)
                out = dest_root / "exercises" / src.name / f.relative_to(src)
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(f";; Generated by lk exercises from clojure/{kind}/{src.name}/{f.relative_to(src)}. DO NOT EDIT;\n"
                               ";; edit the reference lesson and regenerate. Fill in the TODOs here.\n\n" + text)
    return index


def write_exercise_index(index):
    c = cfg()
    md = [f"# Exercises: {c.get('title', '')}", "",
          "Each lesson's key functions with the bodies removed and the tests left in. Read the post, then make",
          "the tests pass. Generated by `lk exercises` from EXERCISE markers in the reference lessons, which",
          "are also the answer key.", "",
          "```bash", "cd clojure && clojure -M:ex -d ex -n exercises.lessonNN.<ns>-test",
          "cd go && go test ./exercises/lessonNN/", "```", ""]
    for i, p in enumerate(c["parts"], 1):
        es = [e for e in index if e["lesson"] == nn(i)]
        if not es:
            continue
        md += [f"## Part {i} · [{p['title']}](site/posts/{nn(i)}-{p['slug']}.html)", ""]
        md += [f"- **`{e['id']}`** ({e['lang']}, `{e['file']}`, {e['lines']} lines): {e['hint']}" for e in es] + [""]
    (ROOT / "EXERCISES.md").write_text("\n".join(md))
    (ROOT / "site").mkdir(exist_ok=True)
    (ROOT / "site/exercises.json").write_text(json.dumps(index, indent=1) + "\n")


def check_exercises(index):
    ok = True
    if (ROOT / "go/go.mod").exists():
        pkgs = [p for p in run(["go", "list", "./..."], cwd=ROOT / "go", quiet=True).stdout.split() if "/exercises/" not in p]
        r = run(["go", "test", *pkgs], cwd=ROOT / "go", check=False, quiet=True)
        print("  reference go tests:", "PASS" if r.returncode == 0 else "FAIL"); ok &= r.returncode == 0
        for d in sorted((ROOT / "go/exercises").glob("lesson*")):
            has = any(e["lang"] == "Go" and e["lesson"] == d.name[-2:] for e in index)
            r = run(["go", "test", f"./exercises/{d.name}/"], cwd=ROOT / "go", check=False, quiet=True)
            broken = "build failed" in r.stdout + r.stderr or "setup failed" in r.stdout
            status = "DOES NOT COMPILE" if broken else ("fails as expected" if r.returncode else
                     ("PASSES: its tests don't catch the TODOs" if has else "no exercises"))
            ok &= not broken and (r.returncode != 0 or not has)
            print(f"  go exercises/{d.name}: {status}")
    if (ROOT / "clojure/ex").exists() and any(e["lang"] == "Clojure" for e in index):
        r = run(["clojure", "-M:ex", "-d", "ex"], cwd=ROOT / "clojure", check=False, quiet=True)
        loaded = not re.search(r"Syntax error|Could not locate|CompilerException", r.stdout + r.stderr)
        print("  clojure exercises:", "fail as expected" if r.returncode and loaded else ("DO NOT LOAD" if not loaded else "PASS: tests don't catch the TODOs"))
        ok &= bool(r.returncode) and loaded
    return ok


def cmd_exercises(a):
    index = gen_go_exercises() + gen_clj_exercises()
    write_exercise_index(index)
    print(f"{len(index)} exercises: " + (", ".join(f"{e['lang'][0]}{e['lesson']}:{e['id']}" for e in index) or "none yet"))
    if not a.no_check and index and not check_exercises(index):
        die("exercise checks failed")


# =============================================================================================
# wild: verbatim excerpts from real implementations
# =============================================================================================
WILD_RE = re.compile(r'EE\.addWild\(\s*"(\d\d)"\s*,\s*(\[.*\])\s*\)\s*;?\s*$', re.S)


def read_wild(f):
    m = WILD_RE.search(f.read_text())
    if not m:
        die(f"{f}: not EE.addWild(\"NN\", [...])")
    return json.loads(m.group(2))


def cmd_wild_add(a):
    git = lambda *args: subprocess.run(["git", "-C", a.clone, *args], capture_output=True, text=True, check=True).stdout
    sha = git("rev-parse", "HEAD").strip()
    repo = re.sub(r"^(https://github.com/|git@github.com:)|\.git$", "", git("remote", "get-url", "origin").strip())
    lines = git("show", f"HEAD:{a.path}").split("\n")
    segments = []
    for rng in a.lines:
        s, e = map(int, rng.split("-"))
        if not (1 <= s <= e <= len(lines)):
            die(f"--lines {rng} out of range (file has {len(lines)} lines)")
        segments.append({"start": s, "end": e, "code": "\n".join(lines[s - 1:e])})
    entry = {"id": a.id, "engine": a.source, "repo": repo, "sha": sha, "path": a.path, "lang": a.lang, "title": a.title,
             **({"prompt": a.prompt} if a.prompt else {}), "notes": a.notes, "segments": segments}
    f = ROOT / f"site/wild/{a.part}.js"
    f.parent.mkdir(parents=True, exist_ok=True)
    entries = [x for x in (read_wild(f) if f.exists() else []) if x["id"] != a.id] + [entry]
    f.write_text(f'EE.addWild("{a.part}", ' + json.dumps(entries, indent=1, ensure_ascii=False) + ");\n")
    print(f"{a.id}: {repo}@{sha[:7]} {a.path} " + ", ".join(f"L{s['start']}-{s['end']}" for s in segments) + f" → {f.relative_to(ROOT)}")


def cmd_wild_verify(a=None):
    c = cfg()
    lo, hi = c["wild"].get("min_sources", 3), c["wild"].get("max_per_source", 2)
    cache = Path.home() / ".cache" / "learning-kit-wild"; cache.mkdir(parents=True, exist_ok=True)
    errors, ids, total = [], set(), 0
    for f in sorted((ROOT / "site/wild").glob("[0-9][0-9].js")):
        entries, per = read_wild(f), {}
        for e in entries:
            total += 1
            where = f"{f.name}:{e.get('id', '?')}"
            missing = {"id", "engine", "repo", "sha", "path", "lang", "title", "notes", "segments"} - e.keys()
            if missing:
                errors.append(f"{where}: missing {sorted(missing)}"); continue
            if e["id"] in ids: errors.append(f"{where}: duplicate id")
            ids.add(e["id"]); per[e["engine"]] = per.get(e["engine"], 0) + 1
            if not re.fullmatch(r"[0-9a-f]{40}", e["sha"]): errors.append(f"{where}: sha must be a full commit hash")
            key = cache / hashlib.sha1(f"{e['repo']}/{e['sha']}/{e['path']}".encode()).hexdigest()
            try:
                if not key.exists():
                    with urllib.request.urlopen(f"https://raw.githubusercontent.com/{e['repo']}/{e['sha']}/{e['path']}", timeout=60) as r:
                        key.write_text(r.read().decode("utf-8"))
                src = key.read_text().split("\n")
            except Exception as ex:
                errors.append(f"{where}: cannot fetch source: {ex}"); continue
            for s in e["segments"]:
                if s["code"] != "\n".join(src[s["start"] - 1:s["end"]]):
                    errors.append(f"{where}: L{s['start']}-{s['end']} is not verbatim at {e['repo']}@{e['sha'][:7]}:{e['path']}")
        if entries and len(per) < lo: errors.append(f"{f.name}: {len(per)} sources (want ≥{lo})")
        errors += [f"{f.name}: {k} appears {n} times (max {hi})" for k, n in per.items() if n > hi]
    if errors:
        print("\n".join(errors)); die("wild-verify failed")
    print(f"  OK: {total} excerpts, all verbatim at their permalinks")


# =============================================================================================
# build: content + kit → _site
# =============================================================================================
def fill(template, **kw):
    for k, v in kw.items():
        template = template.replace("{{" + k + "}}", str(v))
    return template


def build_wasm(c, out):
    progs = c["terminal"].get("programs", {})
    if not progs:
        return False
    wasm = out / "wasm"; wasm.mkdir(parents=True, exist_ok=True)
    for name in progs:
        run(["go", "build", "-trimpath", "-ldflags=-s -w", "-o", str(wasm / f"{name}.wasm"), f"./cmd/{name}"],
            cwd=ROOT / "go", env={"GOOS": "js", "GOARCH": "wasm"}, quiet=True)
    goroot = run(["go", "env", "GOROOT"], cwd=ROOT / "go", quiet=True).stdout.strip()
    shutil.copy(Path(goroot) / "lib/wasm/wasm_exec.js", wasm)
    for served, src in c["terminal"].get("files", {}).items():
        shutil.copy(ROOT / src, wasm / Path(served).name)
    print(f"  built {len(progs)} wasm programs")
    return True


def render_exercises_page(c):
    f = ROOT / "site/exercises.json"
    index = json.loads(f.read_text()) if f.exists() else []
    parts = []
    for i, p in enumerate(c["parts"], 1):
        es = [e for e in index if e["lesson"] == nn(i)]
        if not es:
            continue
        items = "\n".join(f'      <li><code>{html.escape(e["id"])}</code> <span class="tag {"teal" if e["lang"] == "Go" else "violet"}">'
                          f'{e["lang"]}</span> <span class="ex-file">{html.escape(e["file"])}</span><br>{html.escape(e["hint"])}</li>' for e in es)
        parts.append(f'  <h2>Part {i} · <a href="posts/{nn(i)}-{p["slug"]}.html">{html.escape(p["title"])}</a></h2>\n'
                     f'  <pre><code class="language-bash">cd clojure &amp;&amp; clojure -M:ex -d ex -n exercises.lesson{nn(i)}.&lt;ns&gt;-test\n'
                     f'cd go &amp;&amp; go test ./exercises/lesson{nn(i)}/</code></pre>\n  <ul class="ex-list">\n{items}\n  </ul>')
    return "\n".join(parts) or "  <p>No exercises yet.</p>"


def cmd_build(a):
    c = cfg()
    out = (ROOT / a.out).resolve()
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(KIT / "web/assets", out / "assets")
    site = ROOT / "site"
    for sub in ("cards", "wild", "viz"):
        if (site / sub).exists():
            shutil.copytree(site / sub, out / "assets" / sub, dirs_exist_ok=True)
    if (site / "topic.js").exists():
        shutil.copy(site / "topic.js", out / "assets/topic.js")
    if (site / "static").exists():
        shutil.copytree(site / "static", out, dirs_exist_ok=True)
    (out / ".nojekyll").touch()
    have = lambda sub: sorted(f.stem for f in (site / sub).glob("[0-9][0-9].js")) if (site / sub).exists() else []
    if not (out / "assets/wild/sources.js").exists():
        (out / "assets/wild").mkdir(parents=True, exist_ok=True)
        (out / "assets/wild/sources.js").write_text("window.SOURCE_BLURBS = {};\n")
    (out / "assets/site.js").write_text("window.SITE = " + json.dumps({
        "title": c.get("title", ""), "parts": c["parts"], "cards": have("cards"), "wild": have("wild"),
        "terminal": {k: c["terminal"].get(k) for k in ("programs", "files", "try") if c["terminal"].get(k)}}, indent=1) + ";\n")
    common = dict(TITLE=html.escape(c.get("title", "")), HEADLINE=html.escape(c.get("headline", c.get("title", ""))),
                  TAGLINE=html.escape(c.get("tagline", "")), PART_COUNT=len(c["parts"]))
    pages = KIT / "web/pages"
    topic = '<script src="{p}assets/topic.js"></script>' if (site / "topic.js").exists() else ""
    intro = (site / "intro.html").read_text() if (site / "intro.html").exists() else ""
    outro = (site / "outro.html").read_text() if (site / "outro.html").exists() else ""
    (out / "index.html").write_text(fill((pages / "index.html").read_text(), INTRO=intro, OUTRO=outro, **common))
    for name in ("review", "wild", "terminal"):
        (out / f"{name}.html").write_text(fill((pages / f"{name}.html").read_text(), **common))
    (out / "exercises.html").write_text(fill((pages / "exercises.html").read_text(), CONTENT=render_exercises_page(c), **common))
    (out / "posts").mkdir()
    for i, p in enumerate(c["parts"], 1):
        name = f"{nn(i)}-{p['slug']}"
        src = site / "posts" / f"{name}.html"
        if not src.exists():
            die(f"missing {src.relative_to(ROOT)} (one post per part in learning.json)")
        head = topic.format(p="../")
        if (site / "viz" / f"{name}.js").exists():
            head += f'\n<script src="../assets/viz/{name}.js" defer></script>'
        (out / "posts" / f"{name}.html").write_text(fill((pages / "post.html").read_text(), CONTENT=src.read_text(),
            HEAD_EXTRA=head, PART_N=i, PART_TITLE=html.escape(p["title"]), **common))
    if not a.no_wasm and (ROOT / "go/go.mod").exists():
        build_wasm(c, out)
    stamp = run(["git", "rev-parse", "--short", "HEAD"], check=False, quiet=True).stdout.strip() or "dev"
    pat = re.compile(r'''((?:src|href)=")((?!https?:|//|data:)[^"?#]+\.(?:js|css))(")''')
    for f in out.rglob("*.html"):  # cache-bust: Pages serves with max-age=600
        f.write_text(pat.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={stamp}{m.group(3)}", f.read_text()))
    print(f"  built {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out} ({len(c['parts'])} posts)")


def cmd_serve(a):
    cmd_build(a)
    out = (ROOT / a.out).resolve()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(out))
    handler.extensions_map[".wasm"] = "application/wasm"
    print(f"serving http://localhost:{a.port}/")
    http.server.ThreadingHTTPServer(("", a.port), handler).serve_forever()


def cmd_check(a):
    cs = KIT / "check-site"
    if not (cs / "node_modules").exists():
        run(["npm", "ci", "--silent"], cwd=cs)
    env = {"SITE_DIR": str((ROOT / a.out).resolve()), "LEARNING_JSON": str(ROOT / "learning.json")}
    if cfg()["terminal"].get("programs") and not getattr(a, "no_wasm", False):
        env["REQUIRE_WASM"] = "1"
    run(["node", str(cs / "check.mjs")], cwd=cs, env=env)


# =============================================================================================
# anki
# =============================================================================================
def cmd_anki(a):
    import genanki
    c = cfg()
    model = genanki.Model(1607392319, "learning-kit card", fields=[{"name": "Q"}, {"name": "A"}, {"name": "Part"}],
        templates=[{"name": "Card", "qfmt": "<div class=part>{{Part}}</div>{{Q}}", "afmt": "{{FrontSide}}<hr id=answer>{{A}}"}],
        css=".card{font-family:-apple-system,sans-serif;font-size:18px;text-align:left;max-width:40em;margin:auto}"
            ".part{font-size:12px;color:#999;text-transform:uppercase;letter-spacing:.1em}code{font-family:Menlo,monospace}")
    decks, n = [], 0
    for i, p in enumerate(c["parts"], 1):
        f = ROOT / f"site/cards/{nn(i)}.js"
        if not f.exists():
            continue
        cards = json.loads(re.search(r'EE\.addCards\(\s*"\d\d"\s*,\s*(\[.*\])\s*\)\s*;?\s*$', f.read_text(), re.S).group(1))
        name = f"{c['title']}::{nn(i)} {p['title']}"
        deck = genanki.Deck(int(hashlib.md5(name.encode()).hexdigest()[:8], 16), name)
        for card in cards:
            deck.add_note(genanki.Note(model=model, fields=[card["q"], card["a"], f"Part {i} · {p['title']}"], guid=genanki.guid_for(card["id"])))
        decks.append(deck); n += len(cards)
    slug = re.sub(r"[^a-z0-9]+", "-", c["title"].lower()).strip("-")
    genanki.Package(decks).write_to_file(ROOT / f"{slug}.apkg")
    print(f"  {n} cards → {slug}.apkg")


# =============================================================================================
# ci: the definition of green
# =============================================================================================
def cmd_ci(a):
    c = cfg()
    clj, go = ROOT / "clojure", ROOT / "go"
    if (clj / "deps.edn").exists():
        step("Clojure: tests")
        run(["clojure", "-M:test", "-d", "test"], cwd=clj)
        if c["demos"].get("clojure"):
            step("Clojure: lesson demos")
            forms = " ".join(c["demos"]["clojure"])
            run(["clojure", "-M", "-e", f"(doseq [n '[{forms}]] (require n) ((requiring-resolve (symbol (str n) \"-main\"))))"], cwd=clj, quiet=True)
            print(f"  ran {len(c['demos']['clojure'])} demos")
    if (go / "go.mod").exists():
        step("Go: gofmt, vet, tests")
        files = [f for f in run(["git", "ls-files", "*.go"], cwd=go, quiet=True).stdout.split() if not f.startswith("exercises/")]
        bad = run(["gofmt", "-l", *files], cwd=go, quiet=True).stdout.strip() if files else ""
        if bad:
            die(f"gofmt needed:\n{bad}")
        pkgs = [p for p in run(["go", "list", "./..."], cwd=go, quiet=True).stdout.split() if "/exercises/" not in p]
        run(["go", "vet", *pkgs], cwd=go)
        run(["go", "test", *pkgs], cwd=go)
        if c["demos"].get("go"):
            step("Go: lesson demos")
            for d in c["demos"]["go"]:
                run(["go", "run", f"./cmd/{d}"], cwd=go, quiet=True)
            print(f"  ran {len(c['demos']['go'])} demos")
    for cmd in c["ci"].get("extra", []):
        step(f"extra: {cmd[:60]}")
        run(cmd)
    step("Exercise track: regenerate, check, committed")
    cmd_exercises(argparse.Namespace(no_check=False))
    gen = ["go/exercises", "clojure/ex", "EXERCISES.md", "site/exercises.json"]
    stale = run(["git", "status", "--porcelain", "--", *gen], quiet=True).stdout.strip()
    if stale and not a.allow_dirty:
        die(f"exercise track is stale or uncommitted (run lk exercises and commit):\n{stale}")
    if (ROOT / "site/wild").exists():
        step("In the wild: verbatim at pinned permalinks")
        cmd_wild_verify()
    step("Build site")
    cmd_build(argparse.Namespace(out=a.out, no_wasm=False))
    step("Check site in headless Chrome")
    cmd_check(argparse.Namespace(out=a.out, no_wasm=False))
    if (ROOT / "site/cards").exists():
        step("Anki export")
        cmd_anki(a)
    print("\nlk ci: green")


def main():
    global ROOT
    ap = argparse.ArgumentParser(prog="lk", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", default=".")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("new"); p.add_argument("dir"); p.add_argument("--title", required=True)
    p.add_argument("--headline"); p.add_argument("--tagline"); p.add_argument("--part", action="append", default=[])
    for name in ("build", "serve", "check", "ci"):
        p = sub.add_parser(name); p.add_argument("--out", default="_site")
        if name in ("build", "serve", "check"): p.add_argument("--no-wasm", action="store_true")
        if name == "serve": p.add_argument("--port", type=int, default=8000)
        if name == "ci": p.add_argument("--allow-dirty", action="store_true", help="don't require the exercise track to be committed")
    p = sub.add_parser("exercises"); p.add_argument("--no-check", action="store_true")
    p = sub.add_parser("wild-add")
    for flag in ("--part", "--id", "--source", "--clone", "--path", "--lang", "--title"):
        p.add_argument(flag, required=True)
    p.add_argument("--lines", action="append", required=True, help="start-end (1-based, inclusive); repeatable")
    p.add_argument("--prompt", default=""); p.add_argument("--notes", default="")
    sub.add_parser("wild-verify"); sub.add_parser("anki")
    a = ap.parse_args()
    ROOT = Path(a.project).resolve()
    {"new": cmd_new, "build": cmd_build, "serve": cmd_serve, "check": cmd_check, "exercises": cmd_exercises,
     "wild-add": cmd_wild_add, "wild-verify": cmd_wild_verify, "anki": cmd_anki, "ci": cmd_ci}[a.cmd](a)


if __name__ == "__main__":
    main()
