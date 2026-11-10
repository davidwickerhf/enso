// Getting Ensō working on a new Mac, from inside the extension.
//
// createHelperGuide: the first-run card shown while background.js can't reach
// the native helper (`helper.status` missing or failed). A WebExtension can't
// install or start a program itself: native messaging needs the helper's
// manifest on disk first. So there is exactly one terminal step (copy the
// command, paste it in Terminal). An extension can't open Terminal either (no
// WebExtension API launches apps, and external protocol links such as
// x-man-page:// only open a man page window), so the card says how. It then
// waits: background.js retries every 2 seconds and the card moves on by itself.
//
// createSetupKit: the setup items that Settings shows in its sections (Setup,
// Connections, Agents & screenshots, Advanced). Every item is checked by the
// helper (`setup.status`) and its buttons run there (`setup.run`), with the
// same code as the `enso` command. Secrets typed here go straight to the helper, which
// puts them in the Keychain; they are not kept in the UI.

import { h, icon, clear, iconButton } from "../dom.js";
import { inExtension } from "../transport.js";
import { copyDiagnosticsButton, describeHelper, LOG_PATH } from "./helperstate.js";

export const SITE = "https://enso.wicker.life";
export const INSTALL_COMMAND = `curl -fsSL ${SITE}/install.sh | bash`;
const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,read:org,notifications&description=Ens%C5%8D";
const POLL_MS = 4000;
const POLL_FOR_MS = 3 * 60_000;

function copyButton(text, label = "Copy", onCopied = () => {}) {
  const btn = h("button", { type: "button", class: "btn primary copy-btn" }, icon("copy"), h("span", null, label));
  let timer = null;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      clear(btn, icon("check"), h("span", null, "Copied"));
      btn.classList.add("copied");
      onCopied();
      clearTimeout(timer);
      timer = setTimeout(() => { clear(btn, icon("copy"), h("span", null, label)); btn.classList.remove("copied"); }, 2400);
    } catch {
      // No clipboard (unlikely in the extension): select the text so ⌘C works.
      const code = btn.parentElement?.querySelector("code");
      if (code) getSelection()?.selectAllChildren(code);
    }
  });
  return btn;
}

/** The one-line command with its Copy button. */
export function commandBox(text, onCopied) {
  return h("div", { class: "cmd-box" }, h("code", { class: "cmd-text", tabindex: "0" }, text), copyButton(text, "Copy", onCopied));
}

const kbd = t => h("kbd", null, t);

// ---------------------------------------------------------------------------
// First-run guide

export function createHelperGuide(store) {
  const { state: s, actions } = store;
  const el = h("div", { class: "onboarding helper-guide", role: "dialog", aria: { modal: "true", labelledby: "hg-title" } });
  let copied = false;
  let phase = "waiting"; // waiting | connected
  let closeTimer = null;
  let onClose = () => {};

  function render() {
    const failed = s.helper.state === "failed";
    const connected = phase === "connected";
    const head = h("div", { class: "ob-head" }, h("img", { class: "ob-mark", src: "icons/enso.svg", alt: "", width: 36, height: 36 }));
    if (connected) {
      clear(el, h("div", { class: "ob-card hg-card done" }, head,
        h("div", { class: "hg-done" }, h("span", { class: "hg-check" }, icon("check")),
          h("div", null,
            h("h1", { id: "hg-title", class: "ob-title" }, "Ensō is connected"),
            h("p", { class: "ob-lede" }, "The helper is running. Claude, your agents and the rest are one button each in Settings."))),
        h("div", { class: "ob-actions end" }, h("button", { type: "button", class: "btn primary", onclick: () => close() }, "Continue", icon("chevronRight")))));
      return;
    }
    const steps = h("ol", { class: "hg-steps" },
      h("li", { class: copied ? "done" : "" },
        h("span", { class: "hg-num" }, copied ? icon("check") : "1"),
        h("div", { class: "hg-step" }, h("strong", null, "Copy this command"), commandBox(INSTALL_COMMAND, markCopied))),
      h("li", null,
        h("span", { class: "hg-num" }, "2"),
        h("div", { class: "hg-step" }, h("strong", null, "Open Terminal"),
          h("p", null, "Press ", kbd("⌘"), " ", kbd("Space"), ", type ", h("em", null, "Terminal"), " and press ", kbd("Return"), "."))),
      h("li", null,
        h("span", { class: "hg-num" }, "3"),
        h("div", { class: "hg-step" }, h("strong", null, "Paste it and press Return"),
          h("p", null, kbd("⌘"), " ", kbd("V"), ", then ", kbd("Return"), ". It takes under a minute and asks no questions."))));
    clear(el, h("div", { class: "ob-card hg-card" }, head,
      h("h1", { id: "hg-title", class: "ob-title" }, failed ? "Ensō's helper didn't start" : "One step in Terminal"),
      failed
        ? h("p", { class: "ob-lede" }, "The helper is installed, but it stopped as soon as it started", describeHelper(s.helper).reason ? ` (${describeHelper(s.helper).reason})` : "", ". Running the install command again repairs it. If it doesn't, copy the diagnostics and send them with ", h("code", null, LOG_PATH), ".")
        : h("p", { class: "ob-lede" }, "Ensō's assistant runs in a small helper program on your Mac. Browsers don't let extensions install programs, so this one step happens in Terminal. Everything after it is buttons in Ensō."),
      failed ? h("div", { class: "hg-diag" }, copyDiagnosticsButton(store, "btn ghost small")) : null,
      steps,
      h("div", { class: ["hg-wait", copied && "on"], role: "status", aria: { live: "polite" } },
        h("span", { class: "spinner" }),
        h("div", null,
          h("strong", null, "Waiting for the helper…"),
          h("span", { class: "muted" }, " This continues by itself when it's installed. No need to restart Zen.")),
        h("button", { type: "button", class: "btn ghost small", onclick: () => actions.helperRetry() }, "Check now")),
      h("details", { class: "hg-more" },
        h("summary", null, "What does it install?"),
        h("ul", null,
          h("li", null, "The helper, in ", h("code", null, "~/Library/Application Support/Enso"), ", and a file that tells Zen where it is."),
          h("li", null, "Its own copy of Node.js (about 27 MB to download) only if your Mac doesn't have Node 18 or newer."),
          h("li", null, "Nothing outside your home folder, no administrator password. Safe to run again: it's also how you update."),
          h("li", null, "Claude Code is optional and comes later, in Setup.")),
        h("p", null,
          h("a", { href: `${SITE}/install.sh`, target: "_blank", rel: "noopener" }, "Read the script"), " · ",
          h("a", { href: `${SITE}/docs/install`, target: "_blank", rel: "noopener" }, "Install guide"), " · ",
          h("a", { href: `${SITE}/docs/troubleshooting`, target: "_blank", rel: "noopener" }, "It didn't work")),
        failed ? null : h("p", null, "Still stuck? ", copyDiagnosticsButton(store, "btn ghost small"))),
    ));
  }

  // Patch in place, so the Copy button keeps showing "Copied".
  function markCopied() {
    copied = true;
    const li = el.querySelector(".hg-steps > li");
    li?.classList.add("done");
    li?.querySelector(".hg-num")?.replaceChildren(icon("check"));
    el.querySelector(".hg-wait")?.classList.add("on");
  }

  function close() {
    clearTimeout(closeTimer);
    onClose();
  }

  return {
    el,
    show() { phase = "waiting"; render(); requestAnimationFrame(() => el.querySelector(".copy-btn")?.focus({ preventScroll: true })); },
    connected(after) {
      onClose = after;
      phase = "connected";
      render();
      el.querySelector(".ob-actions .btn")?.focus({ preventScroll: true });
      closeTimer = setTimeout(close, 2600);
    },
    update(topics) { if (topics.has("helper") && phase === "waiting") render(); },
  };
}
// ---------------------------------------------------------------------------
// Setup items, shared by the Settings sections (views/settings.js)

const PLAN = { max: "Max", pro: "Pro", team: "Team", enterprise: "Enterprise" };

/** { essentialsReady, essentials, todo: [text], optionalOn } from a SetupStatus. */
export function setupSummary(st, settings) {
  if (!st) return null;
  const engine = engineState(st, settings);
  const todo = [];
  if (engine.level !== "good") todo.push(engine.short);
  if (st.helper.updateAvailable) todo.push(`Helper ${st.helper.latest} is available`);
  const agents = st.agents.clients.filter(c => c.registration).length;
  const optionalOn = [agents > 0, st.t3.connected && st.t3.tokenValid !== false, st.github.connected].filter(Boolean).length;
  return { essentialsReady: engine.level === "good", todo, optionalOn };
}

function engineState(st, settings) {
  const selected = settings?.engine ?? st.engine.selected;
  if (selected === "api") {
    return st.engine.api.stored
      ? { level: "good", text: st.engine.api.source === "environment" ? "Using the API key from ANTHROPIC_API_KEY." : "An API key is in your Keychain.", short: "" }
      : { level: "warn", text: "No API key yet. Paste one below.", short: "Add an API key" };
  }
  const c = st.engine.subscription;
  if (!c.found) return { level: "bad", text: "Claude Code isn't installed. Ensō runs on your Claude plan through it.", short: "Install Claude Code" };
  if (c.loggedIn === false) return { level: "warn", text: `Claude Code ${shortVersion(c.version)} is installed, but not signed in.`, short: "Sign in to Claude Code" };
  const plan = PLAN[c.subscriptionType] ?? null;
  return { level: "good", text: c.loggedIn ? `Signed in${plan ? ` (${plan} plan)` : ""} · Claude Code ${shortVersion(c.version)}` : `Claude Code ${shortVersion(c.version)} found.`, short: "" };
}

const shortVersion = v => String(v ?? "").replace(/\s*\(Claude Code\)\s*/, "").trim();

let sw = 0;
/** A settings row with a switch: label and one line on the left, the switch on the right. */
export function switchRow(label, desc, checked, onChange, { disabled = false, busy = false, keys = "" } = {}) {
  const id = `su-sw-${++sw}`;
  return h("div", { class: "setting set-row", dataset: { search: `${label} ${desc ?? ""} ${keys}`.toLowerCase() } },
    h("div", { class: "setting-text" }, h("label", { for: id }, label), desc ? h("p", { id: `${id}-d` }, desc) : null),
    busy ? h("span", { class: "spinner" }) : null,
    h("button", { type: "button", role: "switch", class: "switch", id, aria: { checked: String(!!checked), describedby: desc ? `${id}-d` : null }, disabled: disabled || busy, onclick: () => onChange(!checked) }, h("span", { class: "knob" })));
}

/**
 * The helper-backed setup steps (`setup.status` / `setup.run`): one controller
 * per Settings view, so drafts of secrets and the "waiting for Terminal" poll
 * survive re-renders. `rerender` is called when a poll ends.
 */
export function createSetupKit(store, { rerender = () => {}, isActive = () => true } = {}) {
  const { state: s, actions } = store;
  const drafts = { apiKey: "", ghToken: "" };
  let poll = null; // { step, until, timer, isDone(st) }
  let installType = null;
  if (inExtension) globalThis.browser?.management?.getSelf?.().then(i => { installType = i?.installType ?? null; rerender(); }, () => {});

  const busy = step => s.setup.busy === step;
  const run = (step, options) => actions.setupRun(step, options);
  const btn = (step, label, iconName, { primary = false, options, ghost = false, disabled = false, confirmText } = {}) =>
    h("button", {
      type: "button", class: ["btn", primary && "primary", ghost && "ghost", "small"], disabled: disabled || !!s.setup.busy,
      onclick: () => { if (confirmText && !confirm(confirmText)) return; run(step, options); },
    }, busy(step) ? h("span", { class: "spinner" }) : iconName ? icon(iconName) : null, label);

  /** The last result, shown under the item it belongs to. */
  function doneLine(prefixes) {
    const d = s.setup.done;
    if (!d || !prefixes.some(p => d.step.startsWith(p))) return null;
    return h("p", { class: ["si-done", d.ok ? "good" : "bad"], role: d.ok ? "status" : "alert" }, icon(d.ok ? "check" : "alert"), d.ok ? d.message : d.error);
  }

  /** A checklist row: a status mark, a title, one status line and its buttons. */
  function item({ id, level, title, optional, status, actions: acts, extra, done, keys = "" }) {
    const mark = level === "good" ? icon("check") : level === "bad" || level === "warn" ? icon("alert") : h("i");
    return h("li", { class: ["setup-item", "set-row", level], id: `setup-${id}`, dataset: { search: `${title} ${typeof status === "string" ? status : ""} ${keys}`.toLowerCase() } },
      h("span", { class: "si-mark", aria: { hidden: "true" } }, mark),
      h("div", { class: "si-body" },
        h("div", { class: "si-head" }, h("h4", null, title), optional ? h("span", { class: "tag" }, "Optional") : null),
        status ? h("p", { class: "si-status" }, status) : null,
        acts?.filter(Boolean).length ? h("div", { class: "si-actions" }, acts) : null,
        extra,
        done));
  }

  function secretForm({ id, label, placeholder, draftKey, step, optionKey, submit, hint }) {
    const input = h("input", { type: "password", class: "input mono", id, placeholder, autocomplete: "off", spellcheck: "false", value: drafts[draftKey], aria: { label } });
    input.addEventListener("input", () => { drafts[draftKey] = input.value; save.disabled = !input.value.trim() || !!s.setup.busy; });
    const save = h("button", { type: "submit", class: "btn primary small", disabled: !drafts[draftKey].trim() || !!s.setup.busy }, busy(step) ? h("span", { class: "spinner" }) : icon("key"), submit);
    return h("form", { class: "si-secret", onsubmit: e => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      run(step, { [optionKey]: value });
      // Don't keep the secret around in the page.
      drafts[draftKey] = "";
      input.value = "";
    } }, h("div", { class: "form-actions" }, input, save), hint ? h("p", { class: "hint" }, hint) : null);
  }

  const waiting = () => h("p", { class: "si-wait" }, h("span", { class: "spinner" }), "Waiting for you to finish in Terminal…");

  function helperItem(st) {
    const hp = st.helper;
    const node = `Node ${hp.node.version}${hp.node.source === "private" ? " (Ensō's own copy)" : ""}`;
    const keys = "helper version update node install";
    if (hp.dev) return item({ id: "helper", level: "good", title: "Helper", keys, status: `Helper ${hp.version} from a checkout (scripts/dev.sh) · ${node}. Update it with git pull.` });
    if (hp.updateAvailable) {
      return item({ id: "helper", level: "warn", title: "Helper", keys, status: `Helper ${hp.version} · ${hp.latest} is available · ${node}`,
        actions: [btn("helper.update", busy("helper.update") ? "Updating…" : `Update to ${hp.latest}`, "refresh", { primary: true })],
        extra: busy("helper.update") ? h("p", { class: "hint" }, "Running the installer in the background. Ensō reconnects by itself when it's done.") : null,
        done: doneLine(["helper."]) });
    }
    return item({ id: "helper", level: "good", title: "Helper", keys, status: `Helper ${hp.version}${hp.latest ? " · up to date" : ""} · ${node}`, extra: hp.error ? h("p", { class: "hint" }, hp.error) : null, done: doneLine(["helper."]) });
  }

  function engineItem(st) {
    const selected = s.settings?.engine ?? st.engine.selected;
    const e = engineState(st, s.settings);
    const c = st.engine.subscription;
    let acts = [];
    let extra = null;
    if (selected === "api") {
      if (st.engine.api.stored && st.engine.api.source === "keychain") acts = [btn("engine.forgetApiKey", "Remove key", "trash", { ghost: true, confirmText: "Remove the Anthropic API key from your Keychain?" })];
      extra = secretForm({ id: "su-api-key", label: "Anthropic API key", placeholder: "sk-ant-…", draftKey: "apiKey", step: "engine.apiKey", optionKey: "key", submit: st.engine.api.stored ? "Replace key" : "Save to Keychain",
        hint: ["Goes straight to the helper and your macOS Keychain. Get one at ", h("a", { href: "https://console.anthropic.com/settings/keys", target: "_blank", rel: "noopener" }, "console.anthropic.com"), "."] });
    } else if (!c.found) {
      acts = [btn("engine.install", "Install Claude Code", "arrowUpRight", { primary: true })];
      extra = h("p", { class: "hint" }, "Opens Terminal with Anthropic's installer (", h("code", null, c.installCommand ?? "curl -fsSL https://claude.ai/install.sh | bash"), "), then asks you to sign in. Or switch to an API key in General.");
    } else if (c.loggedIn === false) {
      acts = [btn("engine.login", "Sign in", "arrowUpRight", { primary: true })];
      extra = h("p", { class: "hint" }, "Opens Terminal with ", h("code", null, "claude auth login"), "; your browser asks you to sign in to claude.ai.");
    }
    return item({ id: "engine", level: e.level, title: selected === "api" ? "Claude · API key" : "Claude · subscription", keys: "claude code engine sign in install api key keychain anthropic", status: e.text, actions: acts,
      extra: [extra, poll && poll.step.startsWith("engine.") ? waiting() : null], done: doneLine(["engine."]) });
  }

  function githubItem(st) {
    const g = st.github;
    const keys = "github gh token sign in pull requests notifications";
    if (g.connected) {
      return item({ id: "github", level: "good", title: "GitHub", keys, status: `Signed in as ${g.login}${g.via ? ` (${g.via})` : ""}.`,
        actions: g.via === "Keychain" ? [btn("github.forget", "Remove token", "trash", { ghost: true, confirmText: "Remove Ensō's GitHub token from your Keychain?" })] : [],
        done: doneLine(["github."]) });
    }
    return item({
      id: "github", level: g.error ? "warn" : "off", title: "GitHub", keys,
      status: g.error ? `Not connected: ${g.error}` : "Pull requests, reviews and notifications across your orgs, for chat, the new tab and your agents.",
      actions: g.ghInstalled ? [btn("github.login", "Sign in with gh", "arrowUpRight")] : [],
      extra: h("div", { class: "si-sub" },
        g.ghInstalled ? h("p", { class: "hint" }, "Opens Terminal with ", h("code", null, "gh auth login"), ". Or paste a token:") : h("p", { class: "hint" }, "Paste a token (", h("a", { href: TOKEN_URL, target: "_blank", rel: "noopener" }, "create one"), " with repo, read:org and notifications), or install the GitHub CLI and run ", h("code", null, "gh auth login"), "."),
        secretForm({ id: "su-gh-token", label: "GitHub token", placeholder: "ghp_… or github_pat_…", draftKey: "ghToken", step: "github.token", optionKey: "token", submit: "Save token" }),
        poll && poll.step === "github.login" ? waiting() : null),
      done: doneLine(["github."]),
    });
  }

  /** One switch per agent (Claude Code, Codex, Cursor, OpenCode): registered with `enso mcp install` or not. */
  function agentRows(st) {
    const a = st.agents;
    const busyClient = s.setup.busy?.startsWith("agents.") ? s.setup.busyFor : null;
    return a.clients.map(c => {
      const desc = c.registration === "http" ? "Older entry with the token in its config. Turn it off and on again to fix."
        : c.registration === "launcher-read" ? "Uses Zen, read only"
        : c.registration ? "Uses Zen"
        : c.detected ? "Found on this Mac" : "Not installed";
      return switchRow(c.name, desc, !!c.registration, on => run(on ? "agents.register" : "agents.unregister", { client: c.id, readOnly: a.readOnly }),
        { disabled: !c.detected && !c.registration, busy: busyClient === c.id, keys: "agent mcp zen-browser enso mcp install register claude code codex cursor opencode" });
    });
  }

  function readOnlyRow(st) {
    const a = st.agents;
    const registered = a.clients.some(c => c.registration);
    return switchRow("Register read only", "A hard limit in each agent's config: it can never click, type, open or close, whatever the access level above.", a.readOnly, v => run("agents.readOnly", { readOnly: v }), { disabled: !registered, keys: "read-only token scope" });
  }

  function hookRow(st) {
    const a = st.agents;
    const claudeOn = a.clients.find(c => c.id === "claude")?.registration;
    return switchRow("Claude Code hook", "Screenshots and notes you send an idle Claude Code arrive with your next message.", a.hook, v => run("agents.hook", { on: v }), { disabled: !claudeOn && !a.hook, keys: "UserPromptSubmit hook idle screenshot" });
  }

  function tokenRow() {
    return h("div", { class: "setting set-row", dataset: { search: "agent access token rotate replace leaked mcp" } },
      h("div", { class: "setting-text" }, h("label", null, "Agent access token"), h("p", null, "Replace it if it may have leaked. Agents started with enso mcp keep working."), doneLine(["mcp."])),
      btn("mcp.rotate", "Rotate", "refresh", { confirmText: "Replace the agent access token? Agents registered the old way (http with a token header) will need to be registered again." }));
  }

  /** Only for unsigned builds (scripts/dev.sh, or a temporary add-on). */
  function devRow(st) {
    if (!st?.helper.dev && installType !== "development") return null;
    const b = h("button", { type: "button", class: "btn small" }, icon("copy"), "Copy setting name");
    b.addEventListener("click", () => navigator.clipboard?.writeText("xpinstall.signatures.required").then(() => { clear(b, icon("check"), "Copied"); setTimeout(() => clear(b, icon("copy"), "Copy setting name"), 2000); }, () => {}));
    return h("div", { class: "setting set-row", dataset: { search: "unsigned builds dev xpinstall signatures about:config" } },
      h("div", { class: "setting-text" }, h("label", null, "Unsigned builds"), h("p", null, "Zen installs an unsigned build (scripts/dev.sh) only with xpinstall.signatures.required set to false in about:config.")), b);
  }

  // After a Terminal step, check every few seconds until it took effect (or 3 minutes passed).
  function startPoll(step, isDone) {
    stopPoll();
    poll = { step, until: Date.now() + POLL_FOR_MS, isDone, timer: setInterval(() => {
      if (!poll || Date.now() > poll.until || !isActive()) return stopPoll(true);
      actions.setupStatus(true);
    }, POLL_MS) };
  }
  function stopPoll(again = false) {
    if (poll) clearInterval(poll.timer);
    poll = null;
    if (again) rerender();
  }

  let lastDone = null;
  /** Call on every store update with the topics. */
  function onTopics(topics) {
    if (!topics.has("setup")) return;
    const d = s.setup.done;
    if (d && d !== lastDone) {
      lastDone = d;
      if (d.ok && d.step === "engine.login") startPoll(d.step, st => st.engine.subscription.loggedIn === true);
      if (d.ok && d.step === "engine.install") startPoll(d.step, st => st.engine.subscription.found && st.engine.subscription.loggedIn !== false);
      if (d.ok && d.step === "github.login") startPoll(d.step, st => st.github.connected);
    }
    if (poll && s.setup.status && poll.isDone(s.setup.status)) stopPoll();
  }

  return { helperItem, engineItem, githubItem, agentRows, readOnlyRow, hookRow, tokenRow, devRow, onTopics, stopPoll, doneLine };
}
