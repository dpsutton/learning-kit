// The Go programs from this series, compiled to WebAssembly (GOOS=js GOARCH=wasm), running in a
// ghostty-web terminal. The binaries are unmodified: they read os.Stdin and write os.Stdout.
//
// How: Go's js/wasm runtime does file I/O through a JS object, globalThis.fs, using callbacks, and
// a goroutine blocked on a read parks until its callback fires, which leaves the browser free to
// handle keystrokes. So we supply fs ourselves: writes to fd 1/2 go to the terminal, reads from fd 0
// wait for the user to press Enter (we do the "cooked mode" line editing a kernel tty would), and a
// few read-only files (learning.json "terminal.files") are fetched over HTTP.
import { init, Terminal, FitAddon } from "https://cdn.jsdelivr.net/npm/ghostty-web@0.4.0/dist/ghostty-web.js";

// From docs/assets/site.js (generated from learning.json). programs: name → one-line description
// (each is go/cmd/<name>, built to wasm/<name>.wasm). files: path a program may open → served URL.
const TERM = (window.SITE && window.SITE.terminal) || {};
const PROGRAMS = TERM.programs || {};
const FILES = Object.fromEntries(Object.keys(TERM.files || {}).map((p) => [p, `wasm/${p.split("/").pop()}`]));

// ---------------------------------------------------------------------------------------------
// terminal
// ---------------------------------------------------------------------------------------------
const mount = document.getElementById("terminal");
await init();
const term = new Terminal({
  fontSize: 14,
  fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  cursorBlink: true,
  convertEol: true,
  scrollback: 5000,
  theme: {
    background: "#17161a", foreground: "#ebe7e0", cursor: "#ef8a5c", selectionBackground: "#3d2519",
    black: "#17161a", red: "#f08a83", green: "#7ccf7f", yellow: "#e8c46b", blue: "#8fb4f0",
    magenta: "#a993f0", cyan: "#5cc2c0", white: "#ebe7e0", brightBlack: "#7f786e",
    brightRed: "#f5a39d", brightGreen: "#9be09d", brightYellow: "#f0d48c", brightBlue: "#aac8f5",
    brightMagenta: "#c2b2f5", brightCyan: "#85d6d4", brightWhite: "#ffffff",
  },
});
const fit = new FitAddon();
term.loadAddon(fit);
mount.textContent = "";
term.open(mount);
fit.fit();
addEventListener("resize", () => fit.fit());
term.focus();

// Everything written to the terminal, for tests (tools/check-site reads it).
window.__termLog = "";
// ghostty-web 0.4.0 can fail to allocate its input buffer for large writes ("offset is out of
// bounds"), so write in small pieces, and never let a rendering error propagate into Go's I/O
// callback (that would kill the program mid-run).
function out(s) {
  window.__termLog += s;
  for (let i = 0; i < s.length; i += 512) {
    try { term.write(s.slice(i, i + 512)); } catch (e) { console.warn("terminal write failed:", e); }
  }
}
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const accent = (s) => `\x1b[38;2;239;138;92m${s}\x1b[0m`;
const teal = (s) => `\x1b[36m${s}\x1b[0m`;

// ---------------------------------------------------------------------------------------------
// globalThis.fs: what Go's syscall package calls for I/O under js/wasm
// ---------------------------------------------------------------------------------------------
const err = (code, msg) => Object.assign(new Error(msg), { code });
const enosys = () => err("ENOSYS", "not implemented");
let proc = null;                     // the running program (see run)
const vfiles = new Map();            // fd → { data: Uint8Array, pos }
let nextFd = 100;
const decoders = { 1: new TextDecoder(), 2: new TextDecoder() };

function stat(size, mode) {
  return { dev: 0, ino: 0, mode, nlink: 1, uid: 0, gid: 0, rdev: 0, size, blksize: 4096,
    blocks: Math.ceil(size / 512), atimeMs: 0, mtimeMs: 0, ctimeMs: 0,
    isDirectory: () => (mode & 0o170000) === 0o040000 };   // Go calls this like Node's fs.Stats
}
const vpath = (p) => p.replace(/^\/+/, "").replace(/^(\.\.?\/)+/, "");

globalThis.fs = {
  constants: { O_WRONLY: -1, O_RDWR: -1, O_CREAT: -1, O_TRUNC: -1, O_APPEND: -1, O_EXCL: -1, O_DIRECTORY: -1 },
  writeSync(fd, buf) {
    if (proc && (fd === 1 || fd === 2)) out(decoders[fd].decode(buf, { stream: true }));
    return buf.length;
  },
  write(fd, buf, offset, length, position, cb) {
    cb(null, this.writeSync(fd, buf.subarray(offset, offset + length)));
  },
  read(fd, buffer, offset, length, position, cb) {
    if (fd === 0) return stdinRead(buffer, offset, length, cb);
    const f = vfiles.get(fd);
    if (!f) return cb(enosys());
    const pos = position ?? f.pos;
    const n = Math.max(0, Math.min(length, f.data.length - pos));
    buffer.set(f.data.subarray(pos, pos + n), offset);
    if (position == null) f.pos += n;
    cb(null, n);
  },
  open(path, flags, mode, cb) {
    const url = FILES[vpath(path)];
    if (!url) return cb(err("ENOENT", "no such file or directory"));
    fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(err("ENOENT", "not found"))))
      .then((b) => { const fd = nextFd++; vfiles.set(fd, { data: new Uint8Array(b), pos: 0 }); cb(null, fd); }, cb);
  },
  fstat(fd, cb) {
    const f = vfiles.get(fd);
    cb(null, f ? stat(f.data.length, 0o100444) : stat(0, 0o20666)); // regular file : character device
  },
  close(fd, cb) { vfiles.delete(fd); cb(null); },
  fsync(fd, cb) { cb(null); },
  stat(path, cb) { cb(FILES[vpath(path)] ? null : err("ENOENT", "no such file or directory"), stat(0, 0o100444)); },
  lstat(path, cb) { this.stat(path, cb); },
  ...Object.fromEntries(["chmod", "chown", "fchmod", "fchown", "ftruncate", "lchown", "link", "mkdir",
    "readdir", "readlink", "rename", "rmdir", "symlink", "truncate", "unlink", "utimes"]
    .map((name) => [name, (...args) => args[args.length - 1](enosys())])),
};

// stdin: bytes the user has entered (after Enter), handed to Go's pending read when there is one.
function stdinRead(buffer, offset, length, cb) {
  if (!proc) return cb(null, 0);
  proc.pending = { buffer, offset, length, cb };
  pump();
}
function pump() {
  const p = proc;
  if (!p || !p.pending) return;
  if (p.inbuf.length) {
    const n = Math.min(p.pending.length, p.inbuf.length);
    p.pending.buffer.set(p.inbuf.subarray(0, n), p.pending.offset);
    p.inbuf = p.inbuf.subarray(n);
    const { cb } = p.pending; p.pending = null; cb(null, n);
  } else if (p.eof) {
    const { cb } = p.pending; p.pending = null; cb(null, 0);
  }
}
function feed(text) {
  const bytes = new TextEncoder().encode(text);
  const merged = new Uint8Array(proc.inbuf.length + bytes.length);
  merged.set(proc.inbuf); merged.set(bytes, proc.inbuf.length);
  proc.inbuf = merged;
  pump();
}

// ---------------------------------------------------------------------------------------------
// running a program
// ---------------------------------------------------------------------------------------------
await new Promise((resolve, reject) => {           // Go's loader; must match the compiler version
  const s = Object.assign(document.createElement("script"), { src: "wasm/wasm_exec.js", onload: resolve, onerror: reject });
  document.head.appendChild(s);
}).catch(() => { throw new Error("wasm/wasm_exec.js missing: run tools/build_wasm.sh"); });

const modules = new Map();
function loadModule(name) {
  if (!modules.has(name)) {
    modules.set(name, fetch(`wasm/${name}.wasm`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`wasm/${name}.wasm: HTTP ${r.status}`))))
      .then((b) => WebAssembly.compile(b))
      .catch((e) => { modules.delete(name); throw e; }));
  }
  return modules.get(name);
}

const histories = {};
async function run(name, args) {
  out(dim(`loading ${name}.wasm…`));
  let mod;
  try { mod = await loadModule(name); } catch (e) { out(`\r\x1b[2K${e.message}\n`); return; }
  out("\r\x1b[2K");
  const go = new Go();
  go.argv = [name, ...args];
  go.env = { TERM: "xterm-256color", HOME: "/" };
  let code = 0;
  go.exit = (c) => {
    code = c;
    // The runtime may leave a scheduler timer pending; firing it after exit throws
    // "Go program has already exited", so cancel them.
    for (const t of go._scheduledTimeouts?.values?.() ?? []) clearTimeout(t);
    go._scheduledTimeouts?.clear?.();
  };
  const inst = await WebAssembly.instantiate(mod, go.importObject);
  proc = { name, inbuf: new Uint8Array(0), eof: false, pending: null, history: (histories[name] ||= []) };
  editor.history = proc.history;
  try { await go.run(inst); } catch (e) { out(`\n${e.message}\n`); code = 2; }
  for (const fd of [1, 2]) out(decoders[fd].decode());
  proc = null;
  editor.history = histories.shell;
  if (code !== 0) out(dim(`[${name} exited with status ${code}]\n`));
}

// ---------------------------------------------------------------------------------------------
// line editing (what a tty's cooked mode would do) + a tiny shell
// ---------------------------------------------------------------------------------------------
histories.shell = [];
const editor = { line: "", history: histories.shell, idx: -1 };
const SHELL_PROMPT = `${accent("❯")} ${dim("$")} `;
let busy = false;                                   // shell command running, not a Go program

function setLine(s) { out("\b \b".repeat([...editor.line].length) + s); editor.line = s; }

term.onData((data) => {
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    const esc = ch === "\x1b" && data.slice(i).match(/^\x1b\[[0-9;]*[A-Za-z~]/);
    if (esc) {
      i += esc[0].length - 1;
      const h = editor.history;
      if (esc[0] === "\x1b[A" && h.length) { editor.idx = editor.idx < 0 ? h.length - 1 : Math.max(0, editor.idx - 1); setLine(h[editor.idx]); }
      if (esc[0] === "\x1b[B" && editor.idx >= 0) { editor.idx++; if (editor.idx >= h.length) { editor.idx = -1; setLine(""); } else setLine(h[editor.idx]); }
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\n" && data[i - 1] === "\r") continue;
      const line = editor.line;
      editor.line = ""; editor.idx = -1;
      out("\n");
      if (line.trim() && editor.history[editor.history.length - 1] !== line) editor.history.push(line);
      if (proc) feed(line + "\n");
      else if (!busy) shell(line);
    } else if (ch === "\x7f" || ch === "\b") {
      if (editor.line) setLine([...editor.line].slice(0, -1).join(""));
    } else if (ch === "\x03") {                       // Ctrl-C
      out("^C\n"); editor.line = "";
      if (proc) { proc.eof = true; pump(); }          // a Go program can't be interrupted mid-compute; EOF ends a REPL
      else if (!busy) out(SHELL_PROMPT);
    } else if (ch === "\x04") {                       // Ctrl-D
      if (proc && !editor.line) { proc.eof = true; pump(); }
    } else if (ch === "\x15") {                       // Ctrl-U
      setLine("");
    } else if (ch === "\x0c") {                       // Ctrl-L
      out("\x1b[2J\x1b[H" + (proc ? "" : SHELL_PROMPT) + editor.line);
    } else if (ch === "\t") {
      if (!proc) { const m = Object.keys(PROGRAMS).concat(["help", "clear", "cat"]).filter((c) => c.startsWith(editor.line)); if (m.length === 1) setLine(m[0] + " "); }
    } else if (ch >= " ") {
      editor.line += ch; out(ch);
    }
  }
});

function words(line) {
  const out = []; let m; const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

async function shell(line) {
  let [cmd, ...args] = words(line);
  if (cmd === "go" && args[0] === "run") { cmd = (args[1] || "").replace(/^\.\/cmd\//, "").replace(/\/$/, ""); args = args.slice(2); }
  cmd = cmd && cmd.replace(/^\.\//, "");
  busy = true;
  try {
    if (!cmd) {}
    else if (PROGRAMS[cmd]) await run(cmd, args);
    else if (cmd === "help" || cmd === "ls" || cmd === "?") help();
    else if (cmd === "clear") out("\x1b[2J\x1b[H");
    else if (cmd === "cat" && FILES[vpath(args[0] || "")]) out(await (await fetch(FILES[vpath(args[0])])).text());
    else out(`${cmd}: command not found ${dim("(try help)")}\n`);
  } finally { busy = false; }
  out(SHELL_PROMPT);
}

function help() {
  out(`${accent("programs")} ${dim("(the Go code from the series, compiled to WebAssembly)")}\n`);
  for (const [k, v] of Object.entries(PROGRAMS)) out(`  ${teal(k.padEnd(12))} ${v}\n`);
  if (TERM.try && TERM.try.length) {
    out(`${accent("try")}\n`);
    for (const [cmd, note] of TERM.try) out(`  ${cmd.padEnd(30)} ${note ? dim(note) : ""}\n`);
  }
  out(`${accent("keys")}  ${dim("↑/↓ history · Tab completes · Ctrl-D/Ctrl-C ends a REPL · Ctrl-L clears")}\n`);
  out(`${accent("also")}  ${dim("help · clear · cat <file> · `go run ./cmd/<name>` works too")}\n`);
}

out(`${accent(window.SITE?.title || "Terminal")} ${dim("· Go → WebAssembly · ghostty-web")}\n`);
help();
out("\n");
// terminal.html#<command> (e.g. #lesson03) runs a command on load
const auto = decodeURIComponent(location.hash.slice(1));
if (auto) { out(SHELL_PROMPT + auto + "\n"); await shell(auto); } else out(SHELL_PROMPT);
