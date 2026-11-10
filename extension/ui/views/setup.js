// Getting Ensō working on a new computer (macOS, Linux, Windows), from inside the extension.
//
// createHelperGuide: the first-run card shown while background.js can't reach
// the native helper (`helper.status` missing or failed). A WebExtension can't
// install or start a program itself: native messaging needs the helper's
// manifest on disk first. So there is exactly one terminal step (copy the
// command, paste it in Terminal / a terminal / PowerShell: ui/platform.js
// installInfo per system). An extension can't open a terminal either (no
// WebExtension API launches apps), so the card says how. It then waits:
// background.js retries every 2 seconds and the card moves on by itself.
//
// createSetupPage: Settings → Setup. Every item is checked by the helper
// (`setup.status`) and its buttons run there (`setup.run`), with the same code
// as the `enso` command. Secrets typed here go straight to the helper, which
// puts them in the system's secret store (Keychain, keyring, Credential
// Manager; the helper says which); they are not kept in the UI.

import { h, icon, clear, iconButton } from "../dom.js";
import { inExtension } from "../transport.js";
import { copyDiagnosticsButton, describeHelper, loadingOr } from "./helperstate.js";
import { installInfo, keys, logPath, secretStoreName } from "../platform.js";

export const SITE = "https://enso.wicker.life";
/** The macOS/Linux command (Windows: installInfo("win").command). */
export const INSTALL_COMMAND = installInfo("mac").command;
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
/** installInfo's step text: strings, [key] for <kbd>, { em } for emphasis. */
const stepText = parts => parts.map(p => (Array.isArray(p) ? kbd(p[0]) : p && typeof p === "object" ? h("em", null, p.em) : p));

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
    const info = installInfo(s.platform);
    const connected = phase === "connected";
    const head = h("div", { class: "ob-head" }, h("img", { class: "ob-mark", src: "icons/enso.svg", alt: "", width: 36, height: 36 }));
    if (connected) {
      clear(el, h("div", { class: "ob-card hg-card done" }, head,
        h("div", { class: "hg-done" }, h("span", { class: "hg-check" }, icon("check")),
          h("div", null,
            h("h1", { id: "hg-title", class: "ob-title" }, "Ensō is connected"),
            h("p", { class: "ob-lede" }, "The helper is running. Claude, your agents and the rest are one button each in Settings → Setup."))),
        h("div", { class: "ob-actions end" }, h("button", { type: "button", class: "btn primary", onclick: () => close() }, "Continue", icon("chevronRight")))));
      return;
    }
    const steps = h("ol", { class: "hg-steps" },
      h("li", { class: copied ? "done" : "" },
        h("span", { class: "hg-num" }, copied ? icon("check") : "1"),
        h("div", { class: "hg-step" }, h("strong", null, "Copy this command"), commandBox(info.command, markCopied))),
      h("li", null,
        h("span", { class: "hg-num" }, "2"),
        h("div", { class: "hg-step" }, h("strong", null, `Open ${info.terminal}`),
          h("p", null, ...stepText(info.open)))),
      h("li", null,
        h("span", { class: "hg-num" }, "3"),
        h("div", { class: "hg-step" }, h("strong", null, info.pasteTitle),
          h("p", null, ...stepText(info.paste)))));
    const where = s.platform === "win" ? "PowerShell" : s.platform === "linux" ? "a terminal" : "Terminal";
    const machine = s.platform === "mac" || !s.platform ? "your Mac" : "your computer";
    clear(el, h("div", { class: "ob-card hg-card" }, head,
      h("h1", { id: "hg-title", class: "ob-title" }, failed ? "Ensō's helper didn't start" : `One step in ${where}`),
      failed
        ? h("p", { class: "ob-lede" }, "The helper is installed, but it stopped as soon as it started", describeHelper(s.helper).reason ? ` (${describeHelper(s.helper).reason})` : "", ". Running the install command again repairs it. If it doesn't, copy the diagnostics and send them with ", h("code", null, logPath(s.platform)), ".")
        : h("p", { class: "ob-lede" }, `Ensō's assistant runs in a small helper program on ${machine}. Browsers don't let extensions install programs, so this one step happens in ${where}. Everything after it is buttons in Ensō.`),
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
          h("li", null, "The helper, in ", h("code", null, info.folder), `, and ${info.where}.`),
          h("li", null, info.nodeNote),
          h("li", null, info.noAdmin),
          h("li", null, "Claude Code is optional and comes later, in Setup.")),
        h("p", null,
          h("a", { href: info.script, target: "_blank", rel: "noopener" }, "Read the script"), " · ",
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
// Setup checklist

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

/** Where the helper keeps secrets ("your macOS login Keychain", "the Windows Credential Manager"…). */
const vaultOf = (st, os) => st?.secrets?.location ?? secretStoreName(os);

function engineState(st, settings, os) {
  const selected = settings?.engine ?? st.engine.selected;
  if (selected === "api") {
    return st.engine.api.stored
      ? { level: "good", text: st.engine.api.source === "environment" ? "Using the API key from ANTHROPIC_API_KEY." : `An API key is in ${vaultOf(st, os)}.`, short: "" }
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
function switchRow(label, desc, checked, onChange, { disabled = false, busy = false } = {}) {
  const id = `su-sw-${++sw}`;
  return h("div", { class: "setting" },
    h("div", { class: "setting-text" }, h("label", { for: id }, label), desc ? h("p", { id: `${id}-d` }, desc) : null),
    busy ? h("span", { class: "spinner" }) : null,
    h("button", { type: "button", role: "switch", class: "switch", id, aria: { checked: String(!!checked), describedby: desc ? `${id}-d` : null }, disabled: disabled || busy, onclick: () => onChange(!checked) }, h("span", { class: "knob" })));
}

export function createSetupPage(store, ctx) {
  const { state: s, actions } = store;
  // Per system: the terminal Setup opens, what to call this computer, where secrets go.
  const term = () => (s.platform === "win" ? "PowerShell" : s.platform === "linux" ? "a terminal" : "Terminal");
  const here = () => (s.platform === "mac" || !s.platform ? "this Mac" : "this computer");
  const vault = st => vaultOf(st, s.platform);
  const body = h("div", { class: "setup-body" });
  const headNote = h("p", { class: "muted" }, `What Ensō uses on ${here()}. The helper checks each item; the buttons do the work.`);
  const el = h("section", { class: "page-view setup-view", aria: { label: "Setup" } },
    h("header", { class: "page-head setup-head" },
      h("div", null, h("h2", null, "Setup"), headNote),
      iconButton("refresh", "Check again", () => actions.setupStatus(true), { class: "small" })),
    body);
  const drafts = { apiKey: "", ghToken: "" };
  let poll = null; // { step, until, timer, done(st) }
  let installType = null;
  if (inExtension) globalThis.browser?.management?.getSelf?.().then(i => { installType = i?.installType ?? null; render(); }, () => {});

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

  function item({ id, level, title, optional, status, actions: acts, extra, done }) {
    const mark = level === "good" ? icon("check") : level === "bad" || level === "warn" ? icon("alert") : h("i");
    return h("li", { class: ["setup-item", level], id: `setup-${id}` },
      h("span", { class: "si-mark", aria: { hidden: "true" } }, mark),
      h("div", { class: "si-body" },
        h("div", { class: "si-head" }, h("h3", null, title), optional ? h("span", { class: "tag" }, "Optional") : null),
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

  function helperItem(st) {
    const hp = st.helper;
    const node = `Node ${hp.node.version}${hp.node.source === "private" ? " (Ensō's own copy)" : ""}`;
    if (hp.dev) return item({ id: "helper", level: "good", title: "Helper", status: `Helper ${hp.version} from a checkout (scripts/dev.sh) · ${node}. Update it with git pull.` });
    if (hp.updateAvailable) {
      return item({ id: "helper", level: "warn", title: "Helper", status: `Helper ${hp.version} · ${hp.latest} is available · ${node}`,
        actions: [btn("helper.update", busy("helper.update") ? "Updating…" : `Update to ${hp.latest}`, "refresh", { primary: true })],
        extra: busy("helper.update") ? h("p", { class: "hint" }, "Running the installer in the background. Ensō reconnects by itself when it's done.") : null,
        done: doneLine(["helper."]) });
    }
    return item({ id: "helper", level: "good", title: "Helper", status: `Helper ${hp.version}${hp.latest ? " · up to date" : ""} · ${node}`, extra: hp.error ? h("p", { class: "hint" }, hp.error) : null, done: doneLine(["helper."]) });
  }

  function engineItem(st) {
    const selected = s.settings?.engine ?? st.engine.selected;
    const e = engineState(st, s.settings, s.platform);
    const c = st.engine.subscription;
    const picker = h("div", { class: "segmented", role: "radiogroup", aria: { label: "Engine" } },
      [["subscription", "Claude subscription"], ["api", "API key"]].map(([v, label]) =>
        h("button", { type: "button", role: "radio", class: ["seg", v === selected && "on"], aria: { checked: String(v === selected) }, onclick: () => v !== selected && actions.updateSettings({ engine: v }) }, label)));
    let acts = [];
    let extra = null;
    if (selected === "api") {
      if (st.engine.api.stored && st.engine.api.source === "keychain") acts = [btn("engine.forgetApiKey", "Remove key", "trash", { ghost: true, confirmText: `Remove the Anthropic API key from ${vault(st)}?` })];
      extra = h("div", null,
        secretForm({ id: "su-api-key", label: "Anthropic API key", placeholder: "sk-ant-…", draftKey: "apiKey", step: "engine.apiKey", optionKey: "key", submit: st.engine.api.stored ? "Replace key" : s.platform === "mac" || !s.platform ? "Save to Keychain" : "Save key",
          hint: [`It goes straight to the helper and into ${vault(st)}, and isn't shown again. Get one at `, h("a", { href: "https://console.anthropic.com/settings/keys", target: "_blank", rel: "noopener" }, "console.anthropic.com"), "."] }));
    } else if (!c.found) {
      acts = [btn("engine.install", "Install Claude Code", "arrowUpRight", { primary: true })];
      extra = h("p", { class: "hint" }, `Opens ${term()} with Anthropic's installer (`, h("code", null, c.installCommand ?? (s.platform === "win" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash")), "), then asks you to sign in. Or switch to an API key.");
    } else if (c.loggedIn === false) {
      acts = [btn("engine.login", "Sign in", "arrowUpRight", { primary: true })];
      extra = h("p", { class: "hint" }, `Opens ${term()} with `, h("code", null, "claude auth login"), "; your browser asks you to sign in to claude.ai.");
    }
    const waiting = poll && poll.step.startsWith("engine.") ? h("p", { class: "si-wait" }, h("span", { class: "spinner" }), `Waiting for you to finish in ${term()}…`) : null;
    return item({ id: "engine", level: e.level, title: "Claude", status: e.text, actions: [picker, ...acts], extra: [extra, waiting], done: doneLine(["engine."]) });
  }

  function agentsItem(st) {
    const a = st.agents;
    const registered = a.clients.filter(c => c.registration);
    const claudeOn = a.clients.find(c => c.id === "claude")?.registration;
    const busyClient = s.setup.busy?.startsWith("agents.") ? s.setup.busyFor : null;
    const rows = h("ul", { class: "si-clients" }, a.clients.map(c => {
      const desc = c.registration === "http" ? "Older entry with the token in its config: turn off and on to switch to the launcher."
        : c.registration === "launcher-read" ? "Uses Zen, read only"
        : c.registration ? "Uses Zen"
        : c.detected ? `Found on ${here()}` : "Not installed";
      return h("li", null, switchRow(c.name, desc, !!c.registration, on => run(on ? "agents.register" : "agents.unregister", { client: c.id, readOnly: a.readOnly }), { disabled: !c.detected && !c.registration, busy: busyClient === c.id }));
    }));
    return item({
      id: "agents", optional: true,
      level: registered.length ? "good" : "off",
      title: "Use Zen from your agents",
      status: registered.length ? `${registered.map(c => c.name).join(", ")} can read and use your Zen tabs (every action shows in Activity).` : "Let Claude Code, Codex, Cursor or OpenCode read and use your Zen tabs through the zen-browser tool.",
      extra: h("div", { class: "si-sub" },
        rows,
        h("div", { class: "si-options" },
          switchRow("Read only", "Agents can see tabs and pages, but not click, type, open or close.", a.readOnly, v => run("agents.readOnly", { readOnly: v }), { disabled: !registered.length }),
          switchRow("Claude Code hook", "Screenshots and notes you send an idle Claude Code arrive with your next message.", a.hook, v => run("agents.hook", { on: v }), { disabled: !claudeOn && !a.hook }))),
      done: doneLine(["agents."]),
    });
  }

  function t3Item(st) {
    const t = st.t3;
    if (!t.installed) return item({ id: "t3", optional: true, level: "off", title: "Send screenshots to T3 Code", status: `T3 Code isn't on ${here()}. Screenshots can still go to agents connected through Zen, or be copied.` });
    const level = !t.connected ? "off" : t.tokenValid === false ? "warn" : "good";
    const status = !t.connected ? `Connect so screenshots (${keys(s.platform).shot}) can go straight to a T3 Code thread.` : t.tokenValid === false ? "T3 Code no longer accepts Ensō's token. Connect again." : !t.reachable ? "Connected. T3 Code isn't running right now." : `Connected${t.serverVersion ? ` to T3 Code ${t.serverVersion}` : ""}.`;
    const acts = !t.connected || t.tokenValid === false ? [btn("t3.connect", t.connected ? "Reconnect" : "Connect T3", "link")] : [btn("t3.disconnect", "Disconnect", null, { ghost: true })];
    return item({ id: "t3", optional: true, level, title: "Send screenshots to T3 Code", status, actions: acts, extra: !t.connected ? h("p", { class: "hint" }, `Gives Ensō a token that can read and message your T3 threads for 30 days, kept in ${vault(st)}.`) : null, done: doneLine(["t3."]) });
  }

  function githubItem(st) {
    const g = st.github;
    if (g.connected) {
      return item({ id: "github", optional: true, level: "good", title: "GitHub", status: `Signed in as ${g.login}${g.via ? ` (${g.via})` : ""}.`,
        actions: g.via === "Keychain" ? [btn("github.forget", "Remove token", "trash", { ghost: true, confirmText: `Remove Ensō's GitHub token from ${vault(st)}?` })] : [],
        done: doneLine(["github."]) });
    }
    return item({
      id: "github", optional: true, level: "off", title: "GitHub",
      status: g.error ? `Not connected: ${g.error}` : "Your pull requests, reviews and notifications across every org, for chat, the new tab and your agents.",
      actions: g.ghInstalled ? [btn("github.login", "Sign in with gh", "arrowUpRight")] : [],
      extra: h("div", { class: "si-sub" },
        g.ghInstalled ? h("p", { class: "hint" }, `Opens ${term()} with `, h("code", null, "gh auth login"), ". Or paste a token instead:") : h("p", { class: "hint" }, "Paste a token (", h("a", { href: TOKEN_URL, target: "_blank", rel: "noopener" }, "create one"), ", with repo, read:org and notifications), or install the GitHub CLI and run ", h("code", null, "gh auth login"), "."),
        secretForm({ id: "su-gh-token", label: "GitHub token", placeholder: "ghp_… or github_pat_…", draftKey: "ghToken", step: "github.token", optionKey: "token", submit: "Save token" }),
        poll && poll.step === "github.login" ? h("p", { class: "si-wait" }, h("span", { class: "spinner" }), `Waiting for you to finish in ${term()}…`) : null),
      done: doneLine(["github."]),
    });
  }

  function toolsItem(st) {
    const t = st.tools;
    return item({ id: "tools", optional: true, level: t.needsAuth ? "warn" : t.on ? "good" : "off", title: "Tools",
      status: t.total ? `${t.on} of ${t.total} on${t.needsAuth ? ` · ${t.needsAuth} need${t.needsAuth === 1 ? "s" : ""} sign-in` : ""}. Connectors from claude.ai and your MCP servers.` : "Connect Gmail, Calendar, Drive and other tools from claude.ai, or add MCP servers.",
      actions: [h("button", { type: "button", class: "btn small", onclick: () => actions.go("tools") }, "Open Tools", icon("chevronRight"))] });
  }

  function tokenItem() {
    return item({ id: "token", level: "good", title: "Agent access token", optional: true,
      status: "Agents reach Zen with a token kept in Ensō's folder. Replace it if it may have leaked; agents started with enso mcp keep working.",
      actions: [btn("mcp.rotate", "Rotate token", "refresh", { confirmText: "Replace the agent access token? Agents registered the old way (http with a token header) will need to be registered again." })],
      done: doneLine(["mcp."]) });
  }

  function devItem(st) {
    if (!st.helper.dev && installType !== "development") return null;
    return item({ id: "dev", level: "off", title: "Unsigned builds", optional: true,
      status: "Zen installs an unsigned build (scripts/dev.sh) only with xpinstall.signatures.required set to false in about:config. Release builds are signed and don't need it.",
      actions: [copyButtonSmall("xpinstall.signatures.required")] });
  }

  function copyButtonSmall(text) {
    const b = h("button", { type: "button", class: "btn small" }, icon("copy"), "Copy setting name");
    b.addEventListener("click", () => navigator.clipboard?.writeText(text).then(() => { clear(b, icon("check"), "Copied"); setTimeout(() => clear(b, icon("copy"), "Copy setting name"), 2000); }, () => {}));
    return b;
  }

  function render() {
    const st = s.setup.status;
    headNote.textContent = `What Ensō uses on ${here()}. The helper checks each item; the buttons do the work.`;
    if (!st) { clear(body, loadingOr(store, "setup", `Checking ${here()}…`)); return; }
    const sum = setupSummary(st, s.settings);
    clear(body,
      h("div", { class: ["setup-summary", sum.essentialsReady ? "good" : "warn"] },
        h("span", { class: "si-mark" }, icon(sum.essentialsReady ? "check" : "alert")),
        h("div", null,
          h("strong", null, sum.essentialsReady ? "Ensō is ready" : sum.todo[0] ? `Next: ${sum.todo[0]}` : "Almost there"),
          h("span", { class: "muted" }, sum.essentialsReady ? ` · ${sum.optionalOn} optional connection${sum.optionalOn === 1 ? "" : "s"} on. Everything here also works from the enso command.` : " · Chat needs Claude: your subscription through Claude Code, or an API key."))),
      h("h3", { class: "setup-group" }, "Essentials"),
      h("ol", { class: "setup-list" }, helperItem(st), engineItem(st)),
      h("h3", { class: "setup-group" }, "Connections"),
      h("ol", { class: "setup-list" }, agentsItem(st), t3Item(st), githubItem(st), toolsItem(st), tokenItem(), devItem(st)),
      placesBlock(st));
  }

  /** Where the helper keeps its files, logs and secrets, as the helper reports them (older helpers: nothing). */
  function placesBlock(st) {
    if (!st.paths && !st.secrets) return null;
    const isPath = v => /^([~/]|[A-Za-z]:\\|%)/.test(String(v));
    const row = (label, value, note) => h("div", { class: "place-row" }, h("span", { class: "place-label" }, label), isPath(value) ? h("code", { class: "place-path" }, value) : h("span", null, value), note ? h("p", { class: "hint" }, note) : null);
    return h("div", { class: "setup-places" },
      h("h3", { class: "setup-group" }, "Where Ensō keeps things"),
      st.paths?.data ? row("Data and helper", st.paths.data) : null,
      st.paths?.logs ? row("Log", st.paths.logs, `enso doctor shows its end. Send it with Copy diagnostics when something breaks.`) : null,
      st.secrets ? row("Sign-ins and keys", st.secrets.location) : null,
      st.secrets?.warning ? h("p", { class: "setup-warn", role: "note" }, icon("alert"), st.secrets.warning) : null);
  }

  // After a terminal step, check every few seconds until it took effect (or 3 minutes passed).
  function startPoll(step, isDone) {
    stopPoll();
    poll = { step, until: Date.now() + POLL_FOR_MS, isDone, timer: setInterval(() => {
      if (!poll || Date.now() > poll.until || !el.isConnected) return stopPoll(true);
      actions.setupStatus(true);
    }, POLL_MS) };
  }
  function stopPoll(rerender = false) {
    if (poll) clearInterval(poll.timer);
    poll = null;
    if (rerender) render();
  }

  let lastDone = null;
  return {
    el,
    show() { actions.setupStatus(); render(); },
    update(topics) {
      if (topics.has("setup")) {
        const d = s.setup.done;
        if (d && d !== lastDone) {
          lastDone = d;
          if (d.ok && d.step === "engine.login") startPoll(d.step, st => st.engine.subscription.loggedIn === true);
          if (d.ok && d.step === "engine.install") startPoll(d.step, st => st.engine.subscription.found && st.engine.subscription.loggedIn !== false);
          if (d.ok && d.step === "github.login") startPoll(d.step, st => st.github.connected);
        }
        if (poll && s.setup.status && poll.isDone(s.setup.status)) stopPoll();
        render();
      }
      if (topics.has("settings") || topics.has("state") || (!s.setup.status && (topics.has("waits") || topics.has("helper")))) render();
    },
    hide() { stopPoll(); },
  };
}
