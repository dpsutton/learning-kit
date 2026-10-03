// Review page: SM-2-style spaced repetition over EE.CARDS, interleaved across parts.
(function () {
  "use strict";
  const { el, store, PARTS } = EE;
  const DAY = 86400000;
  const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / DAY);
  const NEW_PER_DAY = 10;

  // state: { [cardId]: { due: day, ivl: days, ease, reps, lapses } }
  let sched = store.get("ee-sr", {});
  const daily = store.get("ee-sr-day", { day: today(), newSeen: 0, reviewed: 0 });
  if (daily.day !== today()) Object.assign(daily, { day: today(), newSeen: 0, reviewed: 0 });
  const read = store.get("ee-read", {});
  let enabled = store.get("ee-sr-parts", null) || Object.keys(read);
  if (!enabled.length) enabled = ["01"];

  const all = () => Object.values(EE.CARDS).flat();

  // Interval if graded g (0 again, 1 hard, 2 good, 3 easy).
  function next(s, g) {
    s = s ? { ...s } : { ivl: 0, ease: 2.5, reps: 0, lapses: 0 };
    if (g === 0) { s.reps = 0; s.lapses++; s.ease = Math.max(1.3, s.ease - 0.2); s.ivl = 0; }
    else if (g === 1) { s.ease = Math.max(1.3, s.ease - 0.15); s.ivl = Math.max(1, Math.round((s.ivl || 1) * 1.2)); s.reps++; }
    else if (g === 2) { s.ivl = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.round(s.ivl * s.ease); s.reps++; }
    else { s.ease += 0.15; s.ivl = s.reps === 0 ? 3 : Math.round(Math.max(s.ivl, 1) * s.ease * 1.3); s.reps++; }
    s.due = today() + s.ivl;
    return s;
  }
  const ivlLabel = (d) => (d === 0 ? "again soon" : d === 1 ? "1 day" : d < 30 ? `${d} days` : `${Math.round(d / 30)} mo`);

  // Build today's queue: due reviews first-class, plus a few new cards; interleave parts.
  function buildQueue() {
    const pool = all().filter((c) => enabled.includes(c.part));
    const due = pool.filter((c) => sched[c.id] && sched[c.id].due <= today());
    const fresh = pool.filter((c) => !sched[c.id]).slice(0, Math.max(0, NEW_PER_DAY - daily.newSeen));
    return interleave(shuffle(due.concat(fresh), today()));
  }
  function shuffle(a, seed) {
    a = a.slice(); let s = seed * 9301 + 49297;
    for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // Avoid two cards from the same part back to back when possible.
  function interleave(a) {
    const out = [];
    while (a.length) {
      const last = out.length ? out[out.length - 1].part : null;
      const i = a.findIndex((c) => c.part !== last);
      out.push(a.splice(i < 0 ? 0 : i, 1)[0]);
    }
    return out;
  }

  const app = document.getElementById("review-app");
  let queue = buildQueue();

  function render() {
    app.innerHTML = "";
    const pool = all();
    const partBtns = el("div", { class: "parts" }, PARTS.map(([, title], i) => {
      const p = String(i + 1).padStart(2, "0");
      const n = (EE.CARDS[p] || []).length;
      return el("button", {
        class: enabled.includes(p) ? "on" : null, title: n ? `${n} cards` : "no cards yet",
        text: `${i + 1} · ${title}${read[p] ? "" : " (unread)"}`,
        onclick: () => { enabled = enabled.includes(p) ? enabled.filter((x) => x !== p) : enabled.concat(p).sort(); store.set("ee-sr-parts", enabled); queue = buildQueue(); render(); },
      });
    }));
    const learned = pool.filter((c) => sched[c.id] && sched[c.id].reps > 0).length;
    const stats = el("div", { class: "stats-row" },
      stat(queue.length, "in today's queue"), stat(daily.reviewed, "reviewed today"), stat(`${learned} / ${pool.length}`, "cards learned"));
    app.append(el("p", { class: "caption", style: "margin:0 0 .5rem", text: "Parts to review (defaults to the ones you've opened):" }), partBtns, stats);
    if (!pool.length) { app.append(el("div", { class: "rcard done", text: "No cards yet." })); return; }
    if (!queue.length) {
      const nextDue = pool.filter((c) => sched[c.id]).map((c) => sched[c.id].due).sort((a, b) => a - b)[0];
      app.append(el("div", { class: "rcard done" },
        el("div", { class: "rq", text: "All caught up." }),
        el("p", { text: nextDue ? `Next card due ${nextDue - today() <= 1 ? "tomorrow" : "in " + (nextDue - today()) + " days"}.` : "Turn on more parts above to add cards." })));
      return;
    }
    const c = queue[0];
    const answer = el("div", { class: "ra", html: c.a, hidden: true });
    const typed = el("textarea", { placeholder: "Type your answer first (optional, but retrieval is the point)…" });
    const grades = el("div", { class: "grades", hidden: true }, ["Again", "Hard", "Good", "Easy"].map((label, g) =>
      el("button", { class: ["again", "", "good", ""][g] || null, onclick: () => grade(c, g) },
        el("span", { text: label }), el("small", { text: ivlLabel(next(sched[c.id], g).ivl) }))));
    const show = el("button", { class: "primary", text: "Show answer", onclick: () => { answer.hidden = false; grades.hidden = false; show.remove(); } });
    app.append(el("div", { class: "rcard" },
      el("span", { class: "tag accent", text: `Part ${Number(c.part)} · ${PARTS[Number(c.part) - 1][1]}` }),
      sched[c.id] ? null : el("span", { class: "tag violet", style: "margin-left:.4rem", text: "new" }),
      el("div", { class: "rq", html: c.q }), typed, el("div", { style: "margin-top:.8rem" }, show), answer, grades));
  }
  function stat(v, label) { return el("div", { class: "stat" }, el("b", { text: String(v) }), el("span", { text: label })); }

  function grade(c, g) {
    if (!sched[c.id]) daily.newSeen++;
    sched[c.id] = next(sched[c.id], g);
    daily.reviewed++;
    store.set("ee-sr", sched); store.set("ee-sr-day", daily);
    queue.shift();
    if (g === 0) queue.splice(Math.min(3, queue.length), 0, c); // see it again in a few cards
    render();
    window.scrollTo({ top: 0 });
  }

  // Cards live in assets/cards/NN.js, one file per part; load them all, then start.
  const parts = EE.SITE.parts.map((_, i) => String(i + 1).padStart(2, "0"));
  Promise.all(parts.map((p) => new Promise((done) => EE.loadCards(p, done)))).then(() => { queue = buildQueue(); render(); });
})();
