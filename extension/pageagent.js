// Page agent: injected into a tab when the assistant reads or acts on it.
// Builds a numbered list of interactive elements, performs clicks/typing on
// them, and shows what it is doing (outline + ribbon). Answers messages from
// background.js: { enso: true, action, args }.
//
// Developer tools: console capture in the page's own JS world (through
// window.wrappedJSObject + exportFunction, so page CSP doesn't matter),
// page-world eval, storage keys, and session requests with content.fetch
// (a request made as the page, with its cookies). Credential-looking values
// (JWTs, bearer tokens, secret-named keys) are redacted before they leave.

(() => {
  if (window.__ensoAgent) return;
  window.__ensoAgent = true;

  const ACCENT = "#d9643a";
  let refs = new Map();

  const INTERACTIVE =
    'a[href], button, input:not([type="hidden"]), textarea, select, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="textbox"], [role="combobox"], [role="searchbox"], [tabindex]:not([tabindex="-1"])';

  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };

  const clean = s => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 100);

  function roleOf(el) {
    const r = el.getAttribute("role");
    if (r) return r;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "input") return ["checkbox", "radio", "submit", "button", "search", "email", "password", "file", "range", "date"].includes(el.type) ? el.type : "textbox";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "select";
    if (el.isContentEditable) return "textbox";
    return tag;
  }

  function nameOf(el) {
    const labelled = el.getAttribute("aria-labelledby");
    const byId = labelled && labelled.split(/\s+/).map(id => document.getElementById(id)?.innerText).join(" ");
    const label = el.labels?.[0]?.innerText;
    return clean(el.getAttribute("aria-label") || byId || label || el.innerText || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") || el.value || el.getAttribute("name") || "");
  }

  function describe(el) {
    return `${roleOf(el)} "${nameOf(el) || "(unnamed)"}"`;
  }

  function snapshot() {
    refs = new Map();
    const all = [...document.querySelectorAll(INTERACTIVE)].filter(visible);
    const inView = el => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    };
    all.sort((a, b) => Number(inView(b)) - Number(inView(a)));
    const elements = [];
    for (const el of all.slice(0, 400)) {
      const ref = elements.length + 1;
      refs.set(ref, el);
      const role = roleOf(el);
      const item = { ref, role, name: nameOf(el) };
      if (["textbox", "search", "email", "select", "combobox", "searchbox", "date", "range"].includes(role)) item.value = role === "password" ? "••••" : clean(el.value ?? el.innerText);
      if (role === "checkbox" || role === "radio") item.value = el.checked ? "checked" : "unchecked";
      if (el.href) item.href = el.href.slice(0, 200);
      elements.push(item);
    }
    let text = document.body?.innerText ?? "";
    const transcript = youtubeTranscript();
    if (transcript) text = `${text}\n\n[Video transcript]\n${transcript}`;
    return { url: location.href, title: document.title, elements, text };
  }

  // YouTube: the captions the page already loaded, if any (so "chat with this video" works).
  function youtubeTranscript() {
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return "";
    const segs = [...document.querySelectorAll("ytd-transcript-segment-renderer .segment-text")].map(n => n.textContent.trim());
    return segs.join(" ").slice(0, 60_000);
  }

  // ---------- feedback on the page ----------

  let ribbon = null;
  let ribbonTimer = null;
  function showRibbon() {
    if (!ribbon) {
      ribbon = document.createElement("div");
      ribbon.textContent = "✦ Claude is working on this page";
      Object.assign(ribbon.style, {
        position: "fixed", top: "10px", left: "50%", transform: "translateX(-50%)", zIndex: 2147483647,
        background: ACCENT, color: "white", font: "500 12px -apple-system, system-ui, sans-serif",
        padding: "6px 12px", borderRadius: "999px", boxShadow: "0 4px 14px rgba(0,0,0,.18)", pointerEvents: "none",
        transition: "opacity .2s",
      });
      document.documentElement.appendChild(ribbon);
    }
    ribbon.style.opacity = "1";
    clearTimeout(ribbonTimer);
    ribbonTimer = setTimeout(() => (ribbon.style.opacity = "0"), 4000);
  }

  function highlight(el) {
    const r = el.getBoundingClientRect();
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed", left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px`,
      border: `2px solid ${ACCENT}`, borderRadius: "8px", boxShadow: `0 0 0 4px ${ACCENT}33`, zIndex: 2147483646,
      pointerEvents: "none", transition: "opacity .4s",
    });
    document.documentElement.appendChild(box);
    setTimeout(() => (box.style.opacity = "0"), 1200);
    setTimeout(() => box.remove(), 1700);
  }

  // ---------- actions ----------

  function target(ref) {
    const el = refs.get(Number(ref));
    if (!el || !el.isConnected) throw new Error(`Element [${ref}] is gone; call page_read again.`);
    el.scrollIntoView({ block: "center", inline: "nearest" });
    showRibbon();
    highlight(el);
    return el;
  }

  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function key(el, k) {
    const init = { key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  const actions = {
    snapshot,
    click({ ref }) {
      const el = target(ref);
      const description = describe(el);
      el.focus?.();
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      el.click();
      return { description, url: location.href, title: document.title };
    },
    type({ ref, text, submit }) {
      const el = target(ref);
      const description = describe(el);
      el.focus();
      if (el.isContentEditable) {
        document.execCommand("selectAll", false);
        document.execCommand("insertText", false, text);
      } else {
        setValue(el, text);
      }
      if (submit) {
        key(el, "Enter");
        const form = el.form;
        if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
      }
      return { description, url: location.href, title: document.title };
    },
    select({ ref, value }) {
      const el = target(ref);
      const description = describe(el);
      const want = String(value).toLowerCase();
      const opt = [...(el.options ?? [])].find(o => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want) ?? [...(el.options ?? [])].find(o => o.text.toLowerCase().includes(want));
      if (!opt) throw new Error(`No option "${value}" in ${description}.`);
      el.value = opt.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { description, url: location.href, title: document.title };
    },
    press({ key: k }) {
      showRibbon();
      const el = document.activeElement ?? document.body;
      key(el, k);
      if (k === "Enter" && el.form) el.form.requestSubmit?.();
      return { description: `key ${k}`, url: location.href, title: document.title };
    },
    scroll({ direction, ref }) {
      if (ref) target(ref);
      else window.scrollBy({ top: (direction === "up" ? -1 : 1) * innerHeight * 0.8, behavior: "smooth" });
      return { url: location.href, title: document.title };
    },
    text() {
      return { url: location.href, title: document.title, text: document.body?.innerText ?? "" };
    },
    console_start: startConsole,
    console_flush() {
      clearTimeout(consoleTimer);
      consoleTimer = null;
      const entries = consoleBuf;
      consoleBuf = [];
      return { entries, capturing: consoleOn };
    },
    eval: evaluate,
    storage,
    fetch: sessionFetch,
  };

  // ---------- developer tools ----------

  const pw = window.wrappedJSObject;
  const SECRET_NAME = /(cookie|authorization|auth|token|secret|passw|pwd|session|sess|jwt|bearer|credential|api[-_]?key|apikey|private|signature|csrf|xsrf|otp)/i;
  const looksSecret = v => /^eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]*$/.test(v) || /^(Bearer|Basic|token)\s+\S{8,}/i.test(v) || /^(gh[pousr]_|github_pat_|sk-|xox[abpr]-|AKIA)[A-Za-z0-9_-]{8,}/.test(v);
  const REDACTED = "[redacted: looks like a credential]";

  /** Page value (possibly an Xray/waived wrapper) → plain JSON-safe content object. */
  function toSafe(v, depth = 0, seen = new Set(), key = "") {
    if (typeof v === "string") return (key && SECRET_NAME.test(key) && v.length > 6) || looksSecret(v.trim()) ? REDACTED : v.length > 5000 ? `${v.slice(0, 5000)}…[${v.length} chars]` : v;
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
    if (v === undefined) return "[undefined]";
    if (typeof v === "bigint") return `${v}n`;
    if (typeof v === "symbol") return String(v);
    let w = v;
    try { w = v.wrappedJSObject ?? v; } catch {}
    if (typeof w === "function") { let n = ""; try { n = w.name; } catch {} return `[Function ${n || "anonymous"}]`; }
    try { if (typeof w.stack === "string" && "message" in w) return { error: String(w.name ?? "Error"), message: String(w.message), stack: w.stack.slice(0, 2000) }; } catch {}
    try { if (w.nodeType === 1) return String(w.outerHTML).slice(0, 500); if (w.nodeType) return `[${w.nodeName}]`; } catch {}
    if (seen.has(w)) return "[Circular]";
    let tag = "";
    try { tag = Object.prototype.toString.call(w); } catch {}
    if (depth > 5) return `[${tag.slice(8, -1) || "Object"}]`;
    seen.add(w);
    try {
      if (tag === "[object Date]") return new Date(w.getTime()).toISOString();
      if (Array.isArray(w) || tag === "[object NodeList]" || tag === "[object HTMLCollection]") {
        const out = [];
        for (let i = 0; i < Math.min(w.length, 200); i++) out.push(toSafe(w[i], depth + 1, seen));
        if (w.length > 200) out.push(`…${w.length - 200} more`);
        return out;
      }
      if (tag === "[object Map]") return { "[Map]": Array.from(w).slice(0, 100).map(([k, x]) => [toSafe(k, depth + 1, seen), toSafe(x, depth + 1, seen, String(k))]) };
      if (tag === "[object Set]") return { "[Set]": Array.from(w).slice(0, 100).map(x => toSafe(x, depth + 1, seen)) };
      if (tag === "[object Promise]") return "[Promise]";
      const out = {};
      const keys = Object.keys(w);
      for (const k of keys.slice(0, 200)) {
        try { out[k] = toSafe(w[k], depth + 1, seen, k); } catch { out[k] = "[unreadable]"; }
      }
      if (keys.length > 200) out["…"] = `${keys.length - 200} more keys`;
      return out;
    } catch (err) {
      return `[unserialisable: ${err.message}]`;
    }
  }
  const typeOf = v => {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    if (typeof v !== "object") return typeof v;
    try { return Object.prototype.toString.call(v.wrappedJSObject ?? v).slice(8, -1); } catch { return "object"; }
  };

  // Console capture: buffered here, pushed to background.js in small batches.
  let consoleOn = false;
  let consoleBuf = [];
  let consoleTimer = null;
  function pushConsole(entry) {
    consoleBuf.push(entry);
    if (consoleBuf.length > 300) consoleBuf.shift();
    if (!consoleTimer) consoleTimer = setTimeout(flushConsole, 400);
  }
  function flushConsole() {
    consoleTimer = null;
    if (!consoleBuf.length) return;
    const entries = consoleBuf;
    consoleBuf = [];
    browser.runtime.sendMessage({ ensoConsole: true, entries }).catch(() => {});
  }
  const fmtArg = a => {
    if (typeof a === "string") return a;
    const safe = toSafe(a, 3);
    if (safe && typeof safe === "object" && safe.error && "message" in safe && "stack" in safe) return `${safe.error}: ${safe.message}`;
    return typeof safe === "string" ? safe : JSON.stringify(safe);
  };
  const sourceOf = stack => {
    const line = String(stack ?? "").split("\n").find(l => l && !l.includes("moz-extension://") && /:\d+:\d+$/.test(l));
    return line ? line.replace(/^[^@]*@/, "") : "";
  };

  function startConsole() {
    if (consoleOn) return { started: false };
    consoleOn = true;
    const pc = pw.console;
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      const orig = pc[level];
      if (typeof orig !== "function") continue;
      exportFunction(function (...args) {
        try {
          pushConsole({ t: Date.now(), level, text: args.map(fmtArg).join(" ").slice(0, 4000), source: sourceOf(new Error().stack) });
        } catch {}
        return Reflect.apply(orig, pc, args);
      }, pc, { defineAs: level });
    }
    window.addEventListener("error", e => {
      const t = e.target;
      if (t && t !== window && t.nodeType) {
        pushConsole({ t: Date.now(), level: "error", text: `Failed to load ${String(t.nodeName).toLowerCase()} ${t.src || t.href || ""}`, source: "" });
        return;
      }
      let stack = "";
      try { const err = e.error?.wrappedJSObject ?? e.error; stack = typeof err?.stack === "string" ? err.stack.slice(0, 2000) : ""; } catch {}
      pushConsole({ t: Date.now(), level: "error", text: `Uncaught ${e.message ?? ""}`, source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : "", stack });
    }, true);
    window.addEventListener("unhandledrejection", e => {
      let stack = "";
      try { const r = e.reason?.wrappedJSObject ?? e.reason; stack = typeof r?.stack === "string" ? r.stack.slice(0, 2000) : ""; } catch {}
      pushConsole({ t: Date.now(), level: "error", text: `Unhandled promise rejection: ${fmtArg(e.reason)}`.slice(0, 4000), source: "", stack });
    });
    return { started: true };
  }

  const MAX_JSON = 20_000;
  async function evaluate({ expression }) {
    showRibbon();
    const base = { url: location.href, title: document.title, description: `JavaScript: ${expression.replace(/\s+/g, " ").slice(0, 100)}` };
    let value;
    let world = "page";
    try {
      value = pw.eval(expression);
    } catch (err) {
      const e = err?.wrappedJSObject ?? err;
      const msg = String(e?.message ?? e);
      if (!/CSP|Content Security Policy|blocked/i.test(msg)) return { ...base, ok: false, error: `${e?.name ?? "Error"}: ${msg}`, stack: String(e?.stack ?? "").slice(0, 2000) };
      world = "isolated";
      try {
        const page = pw; // eslint-disable-line no-unused-vars -- visible to the evaluated code
        value = eval(expression); // eslint-disable-line no-eval
      } catch (err2) {
        return { ...base, ok: false, world, error: `${err2?.name ?? "Error"}: ${err2?.message ?? err2}`, stack: String(err2?.stack ?? "").slice(0, 2000) };
      }
    }
    try {
      const w = value?.wrappedJSObject ?? value;
      if (w && typeof w.then === "function") {
        value = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("The promise did not settle within 10 s.")), 10_000);
          const ok = exportFunction(x => (clearTimeout(timer), resolve(x)), pw);
          const fail = exportFunction(x => (clearTimeout(timer), reject(x)), pw);
          w.then(ok, fail);
        });
      }
    } catch (err) {
      const e = err?.wrappedJSObject ?? err;
      return { ...base, ok: false, world, error: `Rejected: ${e?.name ? `${e.name}: ${e.message}` : fmtArg(err)}`, stack: String(e?.stack ?? "").slice(0, 2000) };
    }
    let json = JSON.stringify(toSafe(value), null, 2) ?? "undefined";
    if (json.length > MAX_JSON) json = `${json.slice(0, MAX_JSON)}\n[result cut at ${MAX_JSON} characters]`;
    return { ...base, ok: true, world, type: typeOf(value), json };
  }

  function storage({ includeValues }) {
    const read = which => {
      try {
        const st = which === "local" ? window.localStorage : window.sessionStorage;
        const items = [];
        for (let i = 0; i < st.length && i < 500; i++) {
          const k = st.key(i);
          const v = st.getItem(k) ?? "";
          const item = { key: k, length: v.length };
          if (includeValues) item.value = SECRET_NAME.test(k) || looksSecret(v.trim()) ? REDACTED : v.length > 1000 ? `${v.slice(0, 1000)}…` : v;
          items.push(item);
        }
        return { items };
      } catch (err) {
        return { error: `(not accessible: ${err.message})` };
      }
    };
    const local = read("local");
    const session = read("session");
    return { url: location.href, title: document.title, description: includeValues ? "storage values" : "storage keys", local: local.items, localError: local.error, session: session.items, sessionError: session.error };
  }

  const TEXTUAL = /^(text\/|application\/(json|xml|javascript|ld\+json|x-www-form-urlencoded|graphql)|[^;]*\+(json|xml))/i;
  async function sessionFetch({ url, method, headers, body, maxChars }) {
    showRibbon();
    const init = { method, headers: headers ?? {}, credentials: "include", redirect: "follow", cache: "no-store" };
    if (body != null && !["GET", "HEAD"].includes(method)) init.body = body;
    const f = typeof content !== "undefined" && content.fetch ? (u, i) => content.fetch(u, cloneInto(i, window)) : (u, i) => fetch(u, i);
    const res = await f(url, init);
    const hdrs = [];
    try {
      res.headers.forEach((value, name) => hdrs.push({ name, value: SECRET_NAME.test(name) || looksSecret(String(value)) ? "[redacted]" : String(value).slice(0, 300) }));
    } catch {}
    const type = res.headers.get("content-type") ?? "";
    let text = "";
    let length = 0;
    if (method === "HEAD") {
      text = "";
    } else if (!type || TEXTUAL.test(type)) {
      text = await res.text();
      length = text.length;
    } else {
      const buf = await res.arrayBuffer();
      length = buf.byteLength;
      text = `[binary body: ${type}, ${length} bytes]`;
    }
    const cap = maxChars ?? 100_000;
    return { status: res.status, statusText: res.statusText, url: res.url, redirected: res.redirected, headers: hdrs, contentType: type, body: text.length > cap ? text.slice(0, cap) : text, bodyLength: length, truncated: text.length > cap, tabOrigin: location.origin, tabTitle: document.title };
  }

  browser.runtime.onMessage.addListener(msg => {
    if (!msg?.enso) return undefined;
    return (async () => {
      try {
        const fn = actions[msg.action];
        if (!fn) throw new Error(`Unknown page action ${msg.action}`);
        return { ok: true, result: await fn(msg.args ?? {}) };
      } catch (err) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    })();
  });
})();
