// Settings: profile (name, about, space notes), engine, model, effort, page
// default, auto-approve, always-allowed tools, MCP servers, developer tools
// (session access, headless), dashboard refresh, skills and the editable memory.

import { h, icon, clear, iconButton } from "../dom.js";
import { renderMarkdown } from "../markdown.js";
import { relTime } from "../format.js";
import { sortTools, labelOf, statusOf, toolGlyph, openToolPopover } from "./tools.js";
import { profileFields, spaceHintFields } from "./onboarding.js";
import { SCREENSHOT_SHORTCUT } from "./send.js";
import { setupSummary } from "./setup.js";
import { loadingOr } from "./helperstate.js";
import { secretStoreName } from "../platform.js";

const MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
  ["claude-haiku-5-5", "Claude Haiku 5.5"],
];
const REFRESH = [[0, "Off"], [15, "Every 15 min"], [30, "Every 30 min"], [60, "Every hour"], [120, "Every 2 hours"], [240, "Every 4 hours"]];

let uid = 0;

function toggle(label, desc, checked, onChange, disabled = false) {
  const id = `sw-${++uid}`;
  const btn = h("button", { type: "button", role: "switch", class: "switch", id, aria: { checked: String(!!checked), describedby: desc ? `${id}-d` : null }, disabled, onclick: () => onChange(!checked) }, h("span", { class: "knob" }));
  return h("div", { class: "setting" }, h("div", { class: "setting-text" }, h("label", { for: id }, label), desc ? h("p", { id: `${id}-d` }, desc) : null), btn);
}

function segmented(name, options, value, onChange) {
  return h("div", { class: "segmented", role: "radiogroup", aria: { label: name } },
    options.map(([v, label, disabled, title]) => h("button", { type: "button", role: "radio", class: ["seg", v === value && "on"], aria: { checked: String(v === value) }, disabled, title, onclick: () => v !== value && onChange(v) }, label)));
}

export function createSettings(store, ctx) {
  const { state: s, actions } = store;
  const setupBlock = h("div", { id: "settings-setup" });
  const profile = h("div");
  const prof = { dirty: false, draft: null, error: null };
  const general = h("div");
  const developer = h("div");
  const sendBlock = h("div", { id: "settings-send" });
  const servers = h("div");
  const skills = h("div");
  const memory = h("div");
  const mem = { dirty: false, preview: false, draft: "", scope: "global" };
  const skillUi = { editing: null, error: null }; // null | "new" | name

  const el = h("section", { class: "page-view settings-view", aria: { label: "Settings" } },
    h("header", { class: "page-head" }, h("h2", null, "Settings"), h("p", { class: "muted" }, s.platform === "mac" || !s.platform ? "Saved to the Ensō helper on this Mac." : "Saved to the Ensō helper on this computer.")),
    setupBlock, profile, general, sendBlock, developer, servers, skills, memory);

  function block(title, desc, ...content) {
    return h("section", { class: "settings-block" }, h("h3", null, title), desc ? h("p", { class: "block-desc" }, desc) : null, ...content);
  }

  // Setup: one line on what's left, and the way to the checklist.
  function renderSetup() {
    const sum = setupSummary(s.setup.status, s.settings);
    const text = !sum ? "Claude, your agents, T3 Code and GitHub: what's connected, with a button for each."
      : sum.essentialsReady ? `Ensō is ready · ${sum.optionalOn} optional connection${sum.optionalOn === 1 ? "" : "s"} on.`
      : `Next: ${sum.todo[0]}.`;
    clear(setupBlock, block("Setup", null,
      h("div", { class: "setting" },
        h("div", { class: "setting-text" }, h("p", { class: ["setup-line", sum && !sum.essentialsReady && "warn"] }, sum ? icon(sum.essentialsReady ? "check" : "alert") : null, text)),
        h("button", { type: "button", class: ["btn", sum && !sum.essentialsReady && "primary"], onclick: () => actions.go("setup") }, "Open Setup", icon("chevronRight")))));
  }

  function renderProfile() {
    const p = s.profile;
    if (!s.ready) { clear(profile); return; }
    if (!prof.dirty || !prof.draft) prof.draft = { name: p?.name ?? "", about: p?.about ?? "", spaceHints: { ...(p?.spaceHints ?? {}) } };
    const draft = prof.draft;
    const status = h("span", { class: "muted small", aria: { live: "polite" } }, s.profileSaving ? "Saving…" : prof.dirty ? "Unsaved changes" : s.profileSavedAt ? `Saved ${relTime(s.profileSavedAt)}` : "");
    const saveBtn = h("button", { type: "submit", class: "btn primary", disabled: !prof.dirty || s.profileSaving }, "Save profile");
    const revert = h("button", { type: "button", class: "btn ghost", disabled: !prof.dirty, onclick: () => { prof.dirty = false; prof.error = null; renderProfile(); } }, "Revert");
    const touched = () => {
      if (prof.dirty) return;
      prof.dirty = true; saveBtn.disabled = false; revert.disabled = false; status.textContent = "Unsaved changes";
    };
    const fields = profileFields(store, draft, { idPrefix: "set-pf", onInput: touched });
    const spaces = s.spaces ?? [];
    const save = () => {
      if (!draft.name.trim()) { prof.error = "Your name can't be empty."; renderProfile(); return; }
      // Send every known space, so a cleared field removes its note.
      const hints = Object.fromEntries(spaces.map(sp => [sp.id, draft.spaceHints?.[sp.id] ?? ""]));
      actions.saveProfile({ name: draft.name, about: draft.about, spaceHints: hints });
      prof.dirty = false; prof.error = null;
    };
    const paths = s.paths;
    clear(profile, block("Profile", "Who you are, in your own words. Ensō reads it at the start of every conversation.",
      h("form", { class: "profile-form", onsubmit: e => { e.preventDefault(); save(); } },
        fields.el,
        spaces.length ? h("div", { class: "field" }, h("span", null, "Zen spaces"), h("small", { class: "muted" }, "What each space is for. Conversations started in a space get its note."), spaceHintFields(spaces, draft, { idPrefix: "set-sh", onInput: touched })) : null,
        prof.error ? h("p", { class: "form-error", role: "alert" }, prof.error) : null,
        h("div", { class: "form-actions" }, saveBtn, revert, status)),
      paths ? h("p", { class: "hint" }, "Saved in ", h("code", null, `${paths.data}/profile.md`), ". Personal tool and space settings can also go in ", h("code", null, paths.localConfig), ".") : null));
  }

  function renderGeneral() {
    const st = s.settings;
    if (!st) { clear(general, loadingOr(store, "state", "Loading settings…")); return; }
    const eng = s.engines ?? {};
    const models = MODELS.some(([v]) => v === st.model) ? MODELS : [[st.model, st.model], ...MODELS];
    const modelSelect = h("select", { class: "select", aria: { label: "Model" }, onchange: e => actions.updateSettings({ model: e.target.value }) }, models.map(([v, l]) => h("option", { value: v, selected: v === st.model }, l)));
    const refreshSelect = h("select", { class: "select", aria: { label: "Dashboard auto-refresh" }, onchange: e => actions.updateSettings({ dashboard: { autoRefreshMinutes: Number(e.target.value) } }) },
      REFRESH.map(([v, l]) => h("option", { value: v, selected: v === (st.dashboard?.autoRefreshMinutes ?? 60) }, l)));
    const always = st.alwaysAllowedTools ?? [];
    clear(general,
      block("Engine", "Which Claude runs your conversations.",
        h("div", { class: "engine-cards" }, ["subscription", "api"].map(key => {
          const e = eng[key] ?? {};
          const on = st.engine === key;
          return h("button", { type: "button", role: "radio", class: ["engine", on && "on"], aria: { checked: String(on) }, disabled: e.available === false && !on, onclick: () => !on && actions.updateSettings({ engine: key }) },
            h("span", { class: "engine-top" }, icon(key === "api" ? "key" : "sparkle"), h("strong", null, key === "api" ? "API key" : "Claude subscription"), on ? h("span", { class: "tag accent" }, "In use") : null),
            h("span", { class: "engine-label" }, e.label ?? ""),
            h("span", { class: ["engine-status", e.available === false ? "bad" : "good"] }, h("i"), e.available === false ? "Not available" : "Available"));
        })),
        eng.subscription?.available === false && eng.subscription.reason ? h("p", { class: "hint" }, eng.subscription.reason) : null,
        h("div", { class: "setting" },
          h("div", { class: "setting-text" }, h("label", { for: "set-claude-path" }, "Claude Code location"),
            h("p", null, eng.subscription?.path ? `Using ${eng.subscription.path}${eng.subscription.version ? ` (${eng.subscription.version})` : ""}.` : `Found automatically on your PATH, in ${s.platform === "win" ? "%USERPROFILE%\\.local\\bin or npm" : s.platform === "linux" ? "~/.local/bin, npm or Linuxbrew" : "~/.local/bin or Homebrew"}. Set a path only if yours lives elsewhere.`)),
          h("input", { type: "text", class: "input mono", id: "set-claude-path", value: st.claudePath ?? "", placeholder: "/path/to/claude", spellcheck: "false", onchange: e => actions.updateSettings({ claudePath: e.target.value.trim() }) })),
        eng.api?.available === false || eng.subscription?.available === false ? h("p", { class: "hint" }, eng.subscription?.available === false ? "Install and sign in to Claude Code, or add an API key, in " : `Add an API key (kept in ${s.setup?.status?.secrets?.location ?? secretStoreName(s.platform)}) in `, h("button", { type: "button", class: "link-btn", onclick: () => actions.go("setup") }, "Setup"), ".") : null),
      block("Model", null,
        h("div", { class: "setting" }, h("div", { class: "setting-text" }, h("label", null, "Model")), modelSelect),
        h("div", { class: "setting" }, h("div", { class: "setting-text" }, h("label", null, "Effort"), h("p", null, "Higher effort thinks longer before answering.")),
          segmented("Effort", [["low", "Low"], ["medium", "Medium"], ["high", "High"]], st.effort, v => actions.updateSettings({ effort: v })))),
      block("Behaviour", null,
        toggle("Include the current page by default", "The page chip is attached to new messages. Private pages are never shared.", st.includePageByDefault, v => { actions.updateSettings({ includePageByDefault: v }); actions.setIncludePage(v); }),
        toggle("Auto-approve read-only tools", "Searching and reading run without asking. Anything that changes something still asks.", st.autoApproveReadOnly, v => actions.updateSettings({ autoApproveReadOnly: v }))),
      block("Agents can use Zen", "Claude Code, Codex, Cursor and OpenCode reach Zen through the zen-browser tool once they're connected in Setup. Every action shows up in Activity. Private sites are always off-limits.",
        h("div", { class: "setting" }, h("div", { class: "setting-text" }, h("label", null, "External control"), h("p", null, "Read lets them see tabs and pages; Full also lets them click, type, open and close.")),
          segmented("External control", [["full", "Full"], ["read", "Read only"], ["off", "Off"]], st.externalControl ?? "full", v => actions.updateSettings({ externalControl: v }))),
        toggle("Mark the tab while an agent works", "Puts ✦ in front of the page title, so Zen's tab list shows which tabs an agent is using. The title is restored when it stops.", st.agentTitlePrefix !== false, v => actions.updateSettings({ agentTitlePrefix: v }))),
      block("Always allowed", always.length ? "These tools run without asking. Remove one to be asked again." : "Tools you “Always allow” appear here.",
        always.length ? h("ul", { class: "tool-list" }, always.map(name => h("li", null, h("code", null, name), iconButton("x", `Stop always allowing ${name}`, () => actions.updateSettings({ alwaysAllowedTools: always.filter(t => t !== name) }), { class: "small" })))) : null),
      block("Home", null,
        h("div", { class: "setting" }, h("div", { class: "setting-text" }, h("label", null, "Refresh the briefing"), h("p", null, `${s.dashboard.data?.generatedAt ? `Last updated ${relTime(s.dashboard.data.generatedAt)}.` : "Not updated yet."} Each refresh sends your profile, memory and what your read-only tools return to Anthropic. Off: only when you press refresh.`)), refreshSelect)));
  }

  function normalizeOrigin(raw) {
    const t = String(raw ?? "").trim();
    if (!t) return null;
    try {
      const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
      return /^https?:$/.test(u.protocol) ? u.origin : null;
    } catch { return null; }
  }

  function renderDeveloper() {
    const st = s.settings;
    if (!st) { clear(developer); return; }
    const access = st.sessionAccess ?? {};
    const sites = Object.entries(access).sort(([a], [b]) => a.localeCompare(b));
    const setAccess = next => actions.updateSettings({ sessionAccess: next });
    const input = h("input", { type: "text", class: "input", placeholder: "e.g. github.com", aria: { label: "Site to allow" } });
    const err = h("p", { class: "form-error", role: "alert", hidden: true });
    const add = () => {
      const origin = normalizeOrigin(input.value);
      if (!origin) { err.textContent = "Enter a site like github.com or https://app.example.com."; err.hidden = false; return; }
      if ((s.sensitiveHosts ?? []).some(p => { const g = q => q.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"); return new RegExp(p.startsWith("*.") ? `^(.*\\.)?${g(p.slice(2))}$` : `^${g(p)}$`, "i").test(new URL(origin).hostname); })) { err.textContent = "Private sites (banking, health, tax and similar) can't be allowed."; err.hidden = false; return; }
      setAccess({ ...access, [origin]: "allow" });
    };
    clear(developer, block("Developer", "Tools for debugging web pages, using your signed-in sessions, and a headless Zen. Claude in Ensō and Claude Code (zen-browser) share them; every action appears in Activity. Private sites are always off-limits; cookie values and auth headers are never shown to Claude.",
      toggle("Developer tools", "Console, network requests, JavaScript on the page and storage keys of your tabs. Running JavaScript or reading storage values asks first unless you asked for it.", st.developerTools !== false, v => actions.updateSettings({ developerTools: v })),
      toggle("Headless mode", "Claude can start a separate, invisible Zen with a throwaway profile to test pages without touching your windows. It stops after 10 minutes idle and its profile is deleted.", st.headless !== false, v => actions.updateSettings({ headless: v })),
      h("div", { class: "setting stacked" },
        h("div", { class: "setting-text" }, h("label", null, "Session access"), h("p", null, "Sites where Claude may make requests with your signed-in session, or copy it to the headless browser. Other sites ask each time in Ensō; Claude Code is refused there. Allowing a site also covers its subdomains.")),
        sites.length ? h("ul", { class: "tool-list" }, sites.map(([origin, value]) => h("li", null,
          h("code", null, origin),
          h("span", { class: ["tag", value === "allow" && "accent"] }, value === "allow" ? "Allowed" : "Ask"),
          iconButton("x", `Remove ${origin}`, () => { const next = { ...access }; delete next[origin]; setAccess(next); }, { class: "small" })))) : h("p", { class: "hint" }, "No sites yet. Choose “Always allow on this site” when Claude asks, or add one here."),
        h("form", { class: "form-actions", onsubmit: e => { e.preventDefault(); add(); } }, input, h("button", { type: "submit", class: "btn" }, icon("plus"), "Allow site")),
        err)));
  }

  // Send screenshots: T3 Code connection, connected agents, linked threads.
  function renderSend() {
    const st = s.settings;
    if (!st) { clear(sendBlock); return; }
    const t3 = s.t3.status;
    const busy = s.t3.busy;
    const done = s.t3.done;
    const t3State = !t3 ? ["", "Checking…"]
      : !t3.connected ? ["", t3.cli === false ? "Not connected. T3 Code's command (~/.t3/bin/t3) wasn't found: open T3 Code once." : "Not connected."]
      : !t3.reachable ? ["warn", "Connected, but T3 Code isn't running."]
      : t3.tokenValid === false ? ["bad", t3.error ?? "The token was revoked or expired. Connect again."]
      : ["good", `Connected${t3.serverVersion ? ` to ${t3.serverVersion}` : ""}. ${t3.route === "attachment" ? "Screenshots go as image attachments." : "Screenshots go as a saved PNG's path."}`];
    const t3Buttons = h("div", { class: "form-actions" },
      !t3?.connected || t3.tokenValid === false ? h("button", { type: "button", class: "btn primary", disabled: !!busy, onclick: () => actions.t3Connect() }, busy === "connect" ? [h("span", { class: "spinner" }), "Connecting…"] : [icon("link"), t3?.connected ? "Reconnect T3" : "Connect T3"]) : null,
      t3?.connected ? h("button", { type: "button", class: "btn ghost", disabled: !!busy, onclick: () => actions.t3Disconnect() }, busy === "disconnect" ? "Disconnecting…" : "Disconnect") : null,
      iconButton("refresh", "Check again", () => actions.t3Status(), { class: "small" }));
    const links = st.sendLinks ?? { tabs: [], hosts: {} };
    const tabLinks = links.tabs ?? [];
    const hostLinks = Object.entries(links.hosts ?? {});
    const agents = s.connectedAgents ?? [];
    clear(sendBlock, block("Send screenshots", `Take a screenshot with ${SCREENSHOT_SHORTCUT} or the camera button and send it to a T3 Code thread, to an agent connected through enso mcp (Claude Code, Codex, OpenCode, Cursor…), or copy it for any terminal agent. Screenshots stay on this Mac.`,
      h("div", { class: "setting stacked" },
        h("div", { class: "setting-text" }, h("label", null, "T3 Code"),
          h("p", null, `Connecting gives Ensō a token that can read and message your T3 threads (orchestration read and operate, nothing else) for 30 days. It is kept in ${s.setup?.status?.secrets?.location ?? secretStoreName(s.platform)}.`)),
        h("p", { class: ["t3-state", t3State[0]], role: "status" }, h("i"), t3State[1]),
        done && !done.ok ? h("p", { class: "form-error", role: "alert" }, done.error) : null,
        t3Buttons),
      h("div", { class: "setting stacked" },
        h("div", { class: "setting-text" }, h("label", null, "Agents"),
          h("p", null, agents.length ? `${agents.length} connected now: ${agents.map(a => a.client).join(", ")}. A screenshot reaches them with their next step in Zen, or when they call inbox_read.` : "None connected right now. Agents appear here once they start with zen-browser (enso mcp install)."),
          h("p", null, "Connect agents, and let an idle Claude Code get screenshots with your next message, in ", h("button", { type: "button", class: "link-btn", onclick: () => actions.go("setup") }, "Setup"), "."))),
      h("div", { class: "setting stacked" },
        h("div", { class: "setting-text" }, h("label", null, "Linked threads"),
          h("p", null, "Where a tab's screenshots go without asking. Tab links end when the tab closes; a site linked to a T3 project stays until you remove it.")),
        tabLinks.length || hostLinks.length ? h("ul", { class: "tool-list link-list" },
          tabLinks.map(l => h("li", null,
            h("span", { class: "tag" }, "Tab"),
            h("span", { class: "link-main" }, h("strong", null, l.pageTitle || l.host || `Tab ${l.tabId}`), h("span", { class: "muted" }, ` → ${l.kind === "agent" ? "agent " : ""}${l.title || l.id}`)),
            iconButton("x", `Remove the link for ${l.pageTitle || "this tab"}`, () => actions.unlink({ type: "tab", tabId: l.tabId }), { class: "small" }))),
          hostLinks.map(([host, v]) => h("li", null,
            h("span", { class: "tag accent" }, "Site"),
            h("span", { class: "link-main" }, h("strong", null, host), h("span", { class: "muted" }, ` → T3 project ${v.projectTitle || v.projectId}`)),
            iconButton("x", `Remove the link for ${host}`, () => actions.unlink({ type: "host", host }), { class: "small" })))) : h("p", { class: "hint" }, "No links yet. Tick “Always send this tab here” when you send, or link a site to its T3 project from the send sheet."))));
  }

  function renderServers() {
    if (!s.ready) { clear(servers); return; } // "Loading settings…" above covers it
    const list = sortTools(s.servers ?? []);
    const on = list.filter(x => x.enabled !== false);
    const auth = list.filter(x => x.status === "needs-auth" && x.enabled !== false);
    clear(servers, block("Tools", `${on.length} of ${list.length} on${auth.length ? ` · ${auth.length} need${auth.length === 1 ? "s" : ""} sign-in` : ""}. Connectors from claude.ai and your MCP servers.`,
      h("div", { class: "tools-summary" },
        h("span", { class: "tools-summary-icons" }, list.slice(0, 10).map(sv => h("button", { type: "button", class: ["tool-icon", sv.enabled === false && "off", sv.status === "needs-auth" && "dim"], title: labelOf(sv), aria: { label: `${labelOf(sv)}: ${statusOf(sv).text}`, haspopup: "dialog", expanded: "false" }, onclick: e => openToolPopover(store, sv, e.currentTarget, ctx) }, toolGlyph(sv)))),
        h("button", { type: "button", class: "btn", onclick: () => actions.go("tools") }, "Manage tools", icon("chevronRight")))));
  }

  function skillForm(skill) {
    const name = h("input", { type: "text", class: "input", value: skill?.name ?? "", placeholder: "summarize-paper", pattern: "[a-z0-9][a-z0-9\\-]*", aria: { label: "Command name" }, disabled: !!skill });
    const desc = h("input", { type: "text", class: "input", value: skill?.description ?? "", placeholder: "Summarise a paper for my study notes", aria: { label: "Description" } });
    const prompt = h("textarea", { class: "input mono", rows: 5, placeholder: "Summarise this paper in my study-note format. Focus on {input}.", aria: { label: "Prompt" } });
    prompt.value = skill?.prompt ?? "";
    const save = () => {
      const n = name.value.trim().replace(/^\//, "").toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(n)) { skillUi.error = "Use lowercase letters, digits and dashes for the name."; renderSkills(); return; }
      if (!prompt.value.trim()) { skillUi.error = "The prompt can't be empty."; renderSkills(); return; }
      if (!skill && s.skills.some(k => k.name === n)) { skillUi.error = `/${n} already exists.`; renderSkills(); return; }
      actions.saveSkill({ name: n, description: desc.value.trim(), prompt: prompt.value });
      skillUi.editing = null; skillUi.error = null; renderSkills();
    };
    return h("form", { class: "skill-form", onsubmit: e => { e.preventDefault(); save(); } },
      h("label", { class: "field" }, h("span", null, "Command"), h("span", { class: "with-prefix" }, h("span", { class: "prefix" }, "/"), name)),
      h("label", { class: "field" }, h("span", null, "Description"), desc),
      h("label", { class: "field" }, h("span", null, "Prompt"), prompt, h("small", { class: "muted" }, "Use {input} where the text typed after the command goes.")),
      skillUi.error ? h("p", { class: "form-error", role: "alert" }, skillUi.error) : null,
      h("div", { class: "form-actions" }, h("button", { type: "submit", class: "btn primary" }, "Save skill"), h("button", { type: "button", class: "btn ghost", onclick: () => { skillUi.editing = null; skillUi.error = null; renderSkills(); } }, "Cancel")));
  }

  function renderSkills() {
    if (!s.ready) { clear(skills); return; }
    const list = s.skills ?? [];
    clear(skills, block("Skills", "Slash commands for the composer. Type / at the start of a message.",
      h("ul", { class: "skill-list" }, list.map(k => skillUi.editing === k.name ? h("li", { class: "editing" }, skillForm(k)) : h("li", null,
        h("span", { class: "skill-name" }, `/${k.name}`),
        h("span", { class: "skill-desc" }, k.description ?? ""),
        k.builtIn ? h("span", { class: "tag" }, "Built-in") : h("span", { class: "row-actions visible" },
          iconButton("pencil", `Edit /${k.name}`, () => { skillUi.editing = k.name; skillUi.error = null; renderSkills(); }, { class: "small" }),
          iconButton("trash", `Delete /${k.name}`, () => actions.deleteSkill(k.name), { class: "small" }))))),
      skillUi.editing === "new" ? skillForm(null) : h("button", { type: "button", class: "btn", onclick: () => { skillUi.editing = "new"; skillUi.error = null; renderSkills(); } }, icon("plus"), "New skill")));
  }

  function renderMemory() {
    const space = s.space;
    if (mem.scope === "space" && !space) mem.scope = "global";
    const scoped = mem.scope === "space";
    const src = scoped ? s.spaceMemory : s.memory;
    const tabs = space ? h("div", { class: "memory-tabs" }, segmented("Which memory", [["global", "Everywhere"], ["space", space.name]], mem.scope, v => {
      if (mem.dirty && !confirm("Discard unsaved memory changes?")) return;
      mem.dirty = false; mem.scope = v;
      if (v === "space" && !s.spaceMemory.loaded) actions.loadMemory(space.id);
      renderMemory();
    })) : null;
    const desc = scoped ? `What the assistant knows only in ${space.name}, added to the global memory there.` : "What the assistant knows about you everywhere, in Markdown. It reads this at the start of every conversation.";
    if (!src.loaded) { clear(memory, block("Memory", desc, tabs, loadingOr(store, scoped ? `memory:${space.id}` : "memory", "Loading memory…"))); return; }
    if (!mem.dirty) mem.draft = src.text;
    const area = h("textarea", { class: "memory-editor", spellcheck: "true", aria: { label: scoped ? `Memory for ${space.name} (Markdown)` : "Memory (Markdown)" }, hidden: mem.preview, placeholder: scoped ? `Notes for ${space.name}: projects, people, preferences…` : "" });
    area.value = mem.draft;
    const status = h("span", { class: "muted small", aria: { live: "polite" } }, src.saving ? "Saving…" : mem.dirty ? "Unsaved changes" : src.savedAt ? `Saved ${relTime(src.savedAt)}` : "");
    const saveBtn = h("button", { type: "button", class: "btn primary", disabled: !mem.dirty || src.saving, onclick: () => { actions.saveMemory(mem.draft, scoped ? space.id : null); mem.dirty = false; } }, "Save memory");
    const revert = h("button", { type: "button", class: "btn ghost", disabled: !mem.dirty, onclick: () => { mem.dirty = false; renderMemory(); } }, "Revert");
    area.addEventListener("input", () => {
      mem.draft = area.value;
      if (!mem.dirty) { mem.dirty = true; saveBtn.disabled = false; revert.disabled = false; status.textContent = "Unsaved changes"; }
    });
    area.addEventListener("keydown", e => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveBtn.click(); } });
    clear(memory, block("Memory", desc,
      tabs,
      h("div", { class: "memory-tabs" }, segmented("Memory view", [[false, "Edit"], [true, "Preview"]], mem.preview, v => { mem.preview = v; renderMemory(); })),
      area,
      mem.preview ? h("div", { class: "memory-preview md" }, renderMarkdown(mem.draft)) : null,
      h("div", { class: "form-actions" }, saveBtn, revert, status)));
  }

  function renderAll() { renderSetup(); renderProfile(); renderGeneral(); renderSend(); renderDeveloper(); renderServers(); renderSkills(); renderMemory(); }
  renderAll();

  return {
    el,
    update(topics) {
      if (topics.has("setup") || topics.has("settings") || topics.has("state")) renderSetup();
      if (topics.has("profile") || topics.has("state") || (topics.has("space") && !prof.dirty)) renderProfile();
      const waiting = topics.has("waits") || topics.has("helper");
      if (topics.has("settings") || topics.has("state") || topics.has("dashboard") || (waiting && !s.settings)) renderGeneral();
      if (topics.has("settings") || topics.has("state")) renderDeveloper();
      if (topics.has("settings") || topics.has("state") || topics.has("t3") || topics.has("agents")) renderSend();
      if (topics.has("servers") || topics.has("state")) renderServers();
      if (topics.has("skills") || topics.has("state")) renderSkills();
      if (topics.has("memory") || topics.has("space") || (waiting && !(mem.scope === "space" ? s.spaceMemory : s.memory).loaded)) renderMemory();
    },
    show() { if (!s.memory.loaded) actions.loadMemory(); actions.t3Status(); actions.setupStatus(); renderAll(); },
    focusMemory() { memory.scrollIntoView({ block: "start" }); memory.querySelector("textarea")?.focus({ preventScroll: true }); },
  };
}
