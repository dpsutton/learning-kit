// Shared helpers for every post. Classic script (no modules) so file:// works.
// Exposes a single global: EE.
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // el("div", {class: "x", onclick: fn}, child, "text", [more children])
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    applyAttrs(node, attrs);
    append(node, children);
    return node;
  }

  function svg(tag, attrs, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    applyAttrs(node, attrs);
    append(node, children);
    return node;
  }

  function applyAttrs(node, attrs) {
    if (!attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
  }

  function append(node, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  // Format a SQL value the way the engines print it.
  function fmt(v) {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "number" && !Number.isInteger(v)) return v.toFixed(2);
    return String(v);
  }
  function cell(v) {
    return v === null || v === undefined ? el("td", { class: "null", text: "NULL" }) : el("td", { text: fmt(v) });
  }

  // Render a mini table. rows: array of arrays. opts.rowClass(row, i) -> class string.
  function table(columns, rows, opts = {}) {
    return el("table", { class: "mini" },
      el("thead", null, el("tr", null, columns.map((c) => el("th", { text: c })))),
      el("tbody", null, rows.map((r, i) =>
        el("tr", { class: opts.rowClass ? opts.rowClass(r, i) : null }, r.map(cell)))));
  }

  // A standard viz frame: returns {root, controls, stage, foot}.
  // Usage: const v = EE.frame("#mount", "Hash join", "build, then probe");
  function frame(mount, title, sub) {
    const host = typeof mount === "string" ? document.querySelector(mount) : mount;
    const controls = el("div", { class: "viz-controls" });
    const stage = el("div", { class: "viz-stage" });
    const foot = el("div", { class: "viz-foot" });
    const root = el("figure", { class: "viz" },
      el("div", { class: "viz-head" }, el("span", { class: "viz-title", text: title }), sub ? el("span", { class: "viz-sub", text: sub }) : null),
      controls, stage, foot);
    host.replaceWith(root);
    return { root, controls, stage, foot };
  }

  // Step-through controller for animations built from a precomputed list of frames.
  // frames: array of anything; render(frame, index) draws it.
  // Adds Reset / Step back / Step / Play controls + a speed slider to `controls`.
  function stepper(controls, frames, render, opts = {}) {
    let i = 0, timer = null;
    const speed = el("input", { type: "range", min: 1, max: 20, value: opts.speed || 6 });
    const counter = el("span", { class: "viz-sub" });
    const play = el("button", { class: "primary", text: "▶ Play" });
    const btnReset = el("button", { text: "⟲ Reset", onclick: () => { stop(); go(0); } });
    const btnBack = el("button", { text: "◀ Back", onclick: () => { stop(); go(i - 1); } });
    const btnStep = el("button", { text: "Step ▶", onclick: () => { stop(); go(i + 1); } });
    play.addEventListener("click", () => (timer ? stop() : start()));
    controls.append(btnReset, btnBack, btnStep, play, el("label", null, "speed", speed), counter);

    function go(n) {
      i = Math.max(0, Math.min(frames.length - 1, n));
      counter.textContent = `step ${i + 1} / ${frames.length}`;
      btnBack.disabled = i === 0;
      btnStep.disabled = i === frames.length - 1;
      render(frames[i], i);
    }
    function tick() { if (i >= frames.length - 1) return stop(); go(i + 1); timer = setTimeout(tick, 1000 / speed.value); }
    function start() { if (i >= frames.length - 1) go(0); play.textContent = "❚❚ Pause"; timer = setTimeout(tick, 1000 / speed.value); }
    function stop() { clearTimeout(timer); timer = null; play.textContent = "▶ Play"; }
    function setFrames(f) { stop(); frames = f; go(0); }

    go(0);
    return { go, stop, setFrames, get index() { return i; } };
  }

  // Segmented control: EE.seg(["Nested loop","Hash","Merge"], 1, (i)=>...)
  function seg(labels, selected, onchange) {
    const wrap = el("span", { class: "seg" });
    const buttons = labels.map((l, i) => el("button", {
      text: l, class: i === selected ? "on" : null,
      onclick: () => { buttons.forEach((b, j) => b.classList.toggle("on", j === i)); onchange(i); },
    }));
    wrap.append(...buttons);
    return wrap;
  }

  // Pseudocode highlighting for <pre class="pseudo">: keywords, comments, strings, fn calls.
  const KW = /\b(for|each|in|if|then|else|elif|while|return|yield|emit|function|let|and|or|not|null|true|false|break|continue|do|end|loop|until|of|new|is|interface|method|struct|case|when|match)\b/g;
  function highlightPseudo(pre) {
    const src = pre.textContent;
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const out = src.split("\n").map((line) => {
      const ci = line.indexOf("--");
      const code = ci >= 0 ? line.slice(0, ci) : line;
      const cmt = ci >= 0 ? line.slice(ci) : "";
      let h = esc(code)
        .replace(/("[^"]*"|'[^']*')/g, "\u0001$1\u0002")
        .replace(KW, '<span class="kw">$1</span>')
        .replace(/\b([a-zA-Z_][\w]*)(?=\()/g, '<span class="fn">$1</span>')
        .replace(/\u0001([^\u0002]*)\u0002/g, '<span class="st">$1</span>');
      return h + (cmt ? `<span class="cm">${esc(cmt)}</span>` : "");
    });
    pre.innerHTML = out.join("\n");
  }

  // Theme toggle: cycles system → light → dark, persisted per browser.
  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem("ee-theme"); } catch (_) {}
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    const btn = document.querySelector(".theme-toggle");
    if (!btn) return;
    const label = () => (btn.textContent = { light: "☀ light", dark: "☾ dark" }[document.documentElement.getAttribute("data-theme")] || "◐ auto");
    label();
    btn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      const next = cur === null ? "light" : cur === "light" ? "dark" : null;
      if (next) document.documentElement.setAttribute("data-theme", next);
      else document.documentElement.removeAttribute("data-theme");
      try { next ? localStorage.setItem("ee-theme", next) : localStorage.removeItem("ee-theme"); } catch (_) {}
      label();
    });
  }

  // The series' parts, from docs/assets/site.js (generated from learning.json by tools/sync_site.py).
  // Each entry: [file, title, description].
  const SITE = window.SITE || { title: "", parts: [] };
  const PARTS = SITE.parts.map((p, i) => [`${String(i + 1).padStart(2, "0")}-${p.slug}.html`, p.title, p.desc]);

  function initSeries() {
    const mount = document.querySelector("[data-series]");
    if (!mount) return;
    const here = location.pathname.split("/").pop();
    const idx = PARTS.findIndex((p) => p[0] === here);
    const list = el("ol", null, PARTS.map(([href, title], i) =>
      el("li", { class: i === idx ? "current" : null }, el("a", { href, text: title }))));
    const prev = PARTS[idx - 1], next = PARTS[idx + 1];
    mount.replaceWith(el("nav", { class: "series" },
      el("strong", null, "The series"), list,
      el("div", { class: "prevnext" },
        prev ? el("a", { href: prev[0] }, el("span", { text: "← Previous" }), prev[1]) : el("a", { href: "../index.html" }, el("span", { text: "← Back" }), "Contents"),
        next ? el("a", { class: "next", href: next[0] }, el("span", { text: "Next →" }), next[1]) : el("a", { class: "next", href: "../index.html" }, el("span", { text: "Done" }), "Contents"))));
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initSeries();
    document.querySelectorAll("pre.pseudo").forEach(highlightPseudo);
  });

  // ------------------------------------------------------------------------------------------
  // Learning aids: predict-then-reveal, recall cards, warm-ups, read tracking.
  // Progress is kept in localStorage (per browser); everything degrades gracefully without it.
  // ------------------------------------------------------------------------------------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };

  // Predict-then-reveal. Commit to a guess before the figure shows the answer.
  //   const p = EE.predict(mountEl, {
  //     prompt: "How many comparisons will the nested loop make?",
  //     number: { min: 0, max: 50, step: 1, value: 10 }   // or: choices: ["A", "B", "C"]
  //     answer: 20,                     // number, or index into choices (may be omitted and passed to reveal)
  //     tolerance: 0.25,                // numbers: within ±25% counts as "close" (default 0.2)
  //     explain: "Every customer meets every order: 4 × 5.",   // html, shown on reveal
  //     onLock(guess) { ...start the animation, then call p.reveal() when it finishes... },
  //   });
  // If onLock is omitted, the answer is revealed immediately on lock.
  // p.reveal(actual?) shows the verdict; p.reset() clears it; p.locked tells you whether a guess was made.
  function predict(mount, o) {
    const host = typeof mount === "string" ? document.querySelector(mount) : mount;
    const id = o.id || (location.pathname.split("/").pop() + "#" + o.prompt.slice(0, 40));
    let guess = null, locked = false;
    const verdict = el("div", { class: "predict-verdict", hidden: true });
    let input;
    const lockBtn = el("button", { class: "primary", text: "Lock in my guess" });
    if (o.choices) {
      input = el("div", { class: "predict-choices" }, o.choices.map((c, i) => el("button", {
        type: "button", html: c,
        onclick: (e) => { if (locked) return; guess = i; input.querySelectorAll("button").forEach((b, j) => b.classList.toggle("on", j === i)); },
      })));
    } else {
      const n = o.number || {};
      const out = el("output", { class: "predict-num", text: fmtGuess(n.value ?? n.min ?? 0) });
      const range = el("input", { type: "range", min: n.min ?? 0, max: n.max ?? 100, step: n.step ?? 1, value: n.value ?? n.min ?? 0 });
      if (n.log) range.dataset.log = "1";
      const val = () => (n.log ? Math.round(Math.pow(10, Number(range.value))) : Number(range.value));
      guess = val();
      out.textContent = fmtGuess(guess);
      range.addEventListener("input", () => { if (locked) return; guess = val(); out.textContent = fmtGuess(guess); });
      input = el("div", { class: "predict-range" }, range, out, o.unit ? el("span", { class: "predict-unit", text: o.unit }) : null);
    }
    function fmtGuess(v) { return typeof v === "number" ? v.toLocaleString("en-US") : String(v); }
    const box = el("div", { class: "predict" },
      el("div", { class: "predict-head" }, el("span", { class: "predict-tag", text: "Predict" }), el("span", { html: o.prompt })),
      input, el("div", { class: "predict-actions" }, lockBtn), verdict);
    lockBtn.addEventListener("click", () => {
      if (locked || guess === null) { if (guess === null) lockBtn.textContent = "Pick one first"; return; }
      locked = true; box.classList.add("locked"); lockBtn.disabled = true; lockBtn.textContent = "Locked in";
      box.querySelectorAll("input,button").forEach((b) => { if (b !== lockBtn) b.disabled = true; });
      if (o.onLock) o.onLock(guess); else api.reveal();
    });
    const api = {
      el: box,
      get locked() { return locked; },
      get guess() { return guess; },
      reveal(actual = o.answer) {
        let good, text;
        if (o.choices) {
          good = guess === actual;
          text = good ? "You called it." : `You picked <b>${o.choices[guess]}</b>; the answer is <b>${o.choices[actual]}</b>.`;
        } else {
          const tol = o.tolerance ?? 0.2;
          const ratio = actual === 0 ? (guess === 0 ? 1 : Infinity) : guess / actual;
          good = Math.abs(ratio - 1) <= tol;
          const off = ratio >= 1 ? ratio : 1 / ratio;
          text = guess === actual ? `<b>${fmtGuess(actual)}</b>: exactly right.`
            : good ? `You guessed <b>${fmtGuess(guess)}</b>; actual <b>${fmtGuess(actual)}</b>. Close.`
            : `You guessed <b>${fmtGuess(guess)}</b>; actual <b>${fmtGuess(actual)}</b>${isFinite(off) ? ` (off by ${off < 10 ? off.toFixed(1) : Math.round(off)}×)` : ""}.`;
        }
        verdict.className = "predict-verdict " + (good ? "good" : "bad");
        verdict.innerHTML = text + (o.explain ? ` <span class="predict-explain">${o.explain}</span>` : "");
        verdict.hidden = false;
        const log = store.get("ee-predictions", {}); log[id] = { guess, actual, good, at: Date.now() }; store.set("ee-predictions", log);
      },
      reset() {
        locked = false; box.classList.remove("locked"); lockBtn.disabled = false; lockBtn.textContent = "Lock in my guess";
        box.querySelectorAll("input,button").forEach((b) => (b.disabled = false)); verdict.hidden = true;
      },
    };
    if (host) host.replaceWith(box);
    return api;
  }

  // Recall cards. Each post's cards live in assets/cards/NN.js as:
  //   EE.addCards("03", [ { "id": "03-build-side", "q": "…", "a": "…" }, … ]);
  // (strict JSON inside the array, so tools/cards_to_anki.py can read it). q/a may contain HTML.
  // Where common.js was loaded from, and its ?v= cache-busting stamp (added at deploy time by
  // tools/stamp_assets.py), so files it loads itself get the same stamp.
  function assetBase() {
    const src = document.querySelector('script[src*="common.js"]').getAttribute("src");
    const m = src.match(/^(.*)common\.js(\?.*)?$/);
    return { base: m[1], query: m[2] || "" };
  }

  const CARDS = {};
  function addCards(part, cards) { CARDS[part] = cards.map((c) => ({ ...c, part })); }

  // SITE.cards / SITE.wild list the parts that have those files (written by lk build), so missing
  // optional files are never requested.
  const hasFile = (kind, part) => !Array.isArray(SITE[kind]) || SITE[kind].includes(part);
  function loadCards(part, cb) {
    if (CARDS[part]) return cb(CARDS[part]);
    if (!hasFile("cards", part)) return cb([]);
    const { base, query } = assetBase();
    const s = document.createElement("script");
    s.src = `${base}cards/${part}.js${query}`;
    s.onload = () => cb(CARDS[part] || []);
    s.onerror = () => cb([]);
    document.head.appendChild(s);
  }

  // Which parts has this reader opened? Used by the review page to decide what to quiz.
  function partHere() { const m = location.pathname.match(/posts\/(\d\d)-/); return m ? m[1] : null; }
  function markRead() { const p = partHere(); if (!p) return; const r = store.get("ee-read", {}); if (!r[p]) { r[p] = Date.now(); store.set("ee-read", r); } }

  // Warm-up: <div data-warmup></div> near the top of post N shows three recall cards from part N−1.
  function initWarmup() {
    const mount = document.querySelector("[data-warmup]");
    const here = partHere();
    if (!mount || !here || here === "01") { if (mount) mount.remove(); return; }
    const prev = String(Number(here) - 1).padStart(2, "0");
    loadCards(prev, (cards) => {
      if (!cards.length) return mount.remove();
      const picks = cards.filter((c) => c.warmup).concat(cards.filter((c) => !c.warmup)).slice(0, 3);
      const title = PARTS[Number(prev) - 1][1];
      const box = el("aside", { class: "warmup" },
        el("div", { class: "warmup-head" }, el("span", { class: "predict-tag", text: "Warm-up" }),
          el("span", null, "From ", el("a", { href: PARTS[Number(prev) - 1][0], text: `Part ${Number(prev)} · ${title}` }), ". Answer in your head, then check.")),
        picks.map((c) => flipCard(c)),
        el("div", { class: "warmup-foot" }, el("a", { href: "../review.html", text: "Review everything you've read →" })));
      mount.replaceWith(box);
    });
  }
  function flipCard(c) {
    const a = el("div", { class: "card-a", html: c.a, hidden: true });
    const btn = el("button", { class: "card-reveal", text: "Show answer" });
    btn.addEventListener("click", () => { a.hidden = false; btn.remove(); });
    return el("div", { class: "card" }, el("div", { class: "card-q", html: c.q }), btn, a);
  }

  function initTopbarLinks() {
    const bar = document.querySelector(".topbar .spacer");
    if (!bar || document.querySelector(".topbar a.review-link")) return;
    const up = /\/posts\//.test(location.pathname) ? "../" : "";
    const due = (() => { const s = store.get("ee-sr", {}); const d = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000); return Object.values(s).filter((x) => x.due <= d).length; })();
    bar.after(
      SITE.terminal && SITE.terminal.programs ? el("a", { class: "nav-link", href: up + "terminal.html", text: "Terminal" }) : null,
      el("a", { class: "nav-link", href: up + "wild.html", text: "In the wild" }),
      el("a", { class: "review-link", href: up + "review.html", text: due ? `Review · ${due} due` : "Review" }));
  }
  // ------------------------------------------------------------------------------------------
  // Syntax highlighting: highlight.js from cdnjs (common bundle + clojure + scala), colored by
  // style.css with the site's palette. Plain blocks opt in with <code class="language-X">;
  // "In the wild" excerpts are highlighted per line (see highlightLines). Without the network,
  // code just stays uncolored.
  // ------------------------------------------------------------------------------------------
  const HLJS = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.2/";
  let hljsReady = null;
  function loadHljs() {
    if (hljsReady) return hljsReady;
    const add = (src) => new Promise((resolve, reject) => {
      const s = document.createElement("script"); s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    hljsReady = add(HLJS + "highlight.min.js")
      .then(() => Promise.all(["clojure", "scala"].map((l) => add(`${HLJS}languages/${l}.min.js`))))
      .then(() => window.hljs, () => null);
    return hljsReady;
  }
  function highlightBlocks(root = document) {
    const blocks = root.querySelectorAll('pre code[class*="language-"]:not(.hljs)');
    if (!blocks.length) return;
    loadHljs().then((hljs) => hljs && blocks.forEach((b) => hljs.highlightElement(b)));
  }
  // Highlight a whole snippet, then split the HTML into lines, closing any span still open at the
  // end of a line and reopening it on the next (a block comment spans many lines).
  function highlightLines(hljs, code, lang) {
    if (!hljs || !hljs.getLanguage(lang)) return null;
    const html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    const out = []; let open = [];
    for (const line of html.split("\n")) {
      let cur = open.join("");
      for (const m of line.matchAll(/<span[^>]*>|<\/span>/g)) {
        if (m[0] === "</span>") open.pop(); else open.push(m[0]);
      }
      cur += line + "</span>".repeat(open.length);
      out.push(cur);
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------
  // "In the wild": verbatim excerpts from real engines, pinned to a commit.
  // assets/wild/NN.js = EE.addWild("NN", [ …strict JSON… ]); each entry:
  //   { id, engine, repo: "owner/name", sha, path, lang, title, prompt?, notes (html),
  //     segments: [ { start, end, code } ] }   -- code is lines start..end of path at sha, verbatim
  // tools/verify_wild.py checks every segment against GitHub.
  // ------------------------------------------------------------------------------------------
  const WILD = {};
  function addWild(part, entries) { WILD[part] = entries.map((e) => ({ ...e, part })); }
  function loadWild(part, cb) {
    if (WILD[part]) return cb(WILD[part]);
    if (!hasFile("wild", part)) return cb([]);
    const { base, query } = assetBase();
    const s = document.createElement("script");
    s.src = `${base}wild/${part}.js${query}`;
    s.onload = () => cb(WILD[part] || []);
    s.onerror = () => cb([]);
    document.head.appendChild(s);
  }
  const permalink = (e, seg) => `https://github.com/${e.repo}/blob/${e.sha}/${e.path}#L${seg.start}-L${seg.end}`;
  function wildCard(e, opts = {}) {
    const code = e.segments.map((seg, i) => {
      const lines = seg.code.split("\n");
      const width = String(seg.end).length;
      return el("div", { class: "src-seg" },
        i > 0 ? el("div", { class: "src-gap", text: "⋮" }) : null,
        el("pre", { class: "src" }, el("code", { "data-lang": e.lang }, lines.map((l, j) => {
          const text = el("span", { class: "src-text" }, l.replace(/\t/g, "    "));
          return el("span", { class: "src-line" }, el("span", { class: "src-ln", text: String(seg.start + j).padStart(width) }), text, "\n");
        }))));
    });
    const seg0 = e.segments[0], segN = e.segments[e.segments.length - 1];
    const link = `https://github.com/${e.repo}/blob/${e.sha}/${e.path}#L${seg0.start}-L${segN.end}`;
    loadHljs().then((hljs) => code.forEach((segEl, i) => {
      const lines = highlightLines(hljs, e.segments[i].code.replace(/\t/g, "    "), e.lang);
      if (lines) segEl.querySelectorAll(".src-text").forEach((t, j) => { t.innerHTML = lines[j]; });
    }));
    return el("section", { class: "wild-card", id: e.id },
      el("div", { class: "wild-head" },
        el("span", { class: "wild-engine", text: e.engine }),
        el("span", { class: "wild-title", html: e.title }),
        opts.partLink ? el("a", { class: "wild-part", href: `posts/${PARTS[Number(e.part) - 1][0]}`, text: `Part ${Number(e.part)} · ${PARTS[Number(e.part) - 1][1]}` }) : null),
      e.prompt ? el("div", { class: "wild-prompt" }, el("span", { class: "predict-tag", text: "Find it" }), el("span", { html: e.prompt })) : null,
      code,
      el("div", { class: "wild-src" }, e.repo.startsWith("local:")
        ? el("span", { text: `${e.repo.slice(6).split("/").slice(-2).join("/")} · ${e.path} · L${seg0.start}–${segN.end} · local working tree (unpinned)` })
        : el("a", { href: link, target: "_blank", rel: "noopener", text: `${e.repo} · ${e.path} · L${seg0.start}–${segN.end} @ ${e.sha.slice(0, 7)} ↗` })),
      e.notes ? el("div", { class: "wild-notes", html: e.notes }) : null);
  }
  // <div data-wild></div> in a post: a collapsed section of this part's excerpts.
  function initWild() {
    const mount = document.querySelector("[data-wild]");
    const here = partHere();
    if (!mount || !here) return;
    loadWild(here, (entries) => {
      if (!entries.length) return mount.remove();
      const engines = [...new Set(entries.map((e) => e.engine))];
      mount.replaceWith(el("details", { class: "wild" },
        el("summary", null,
          el("span", { class: "wild-sum-title", text: `In the wild: ${engines.join(", ")}` }),
          el("span", { class: "wild-sum-sub", text: "Real engine source for what you just built. Open it after the exercises." })),
        entries.map((e) => wildCard(e)),
        el("p", { class: "wild-foot" }, "All excerpts are verbatim, pinned to a commit, and linked to the exact lines. ",
          el("a", { href: "../wild.html", text: "The whole tour, by engine →" }))));
    });
  }

  // <ol class="toc" data-toc></ol> on the index: one card per part, from the site config.
  function initToc() {
    const ol = document.querySelector("[data-toc]");
    if (!ol) return;
    ol.append(...PARTS.map(([file, title, desc]) => el("li", null,
      el("a", { href: `posts/${file}` }, el("span", { class: "t", text: title }), el("span", { class: "d", text: desc || "" })))));
  }

  document.addEventListener("DOMContentLoaded", () => { markRead(); initToc(); initWarmup(); initTopbarLinks(); initWild(); highlightBlocks(); });

  window.EE = { el, svg, clear, fmt, cell, table, frame, stepper, seg, highlightPseudo, PARTS, SITE,
    predict, addCards, loadCards, CARDS, store, flipCard, addWild, loadWild, WILD, wildCard, permalink, highlightBlocks };
})();
