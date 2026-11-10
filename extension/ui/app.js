// Ensō UI entry point. One app, four layouts:
//   sidebar  (≈340–480px, right of the browser): compact home + chat
//   newtab   (every new tab): dashboard first, chat one keystroke away
//   full     (pinned page): conversations | chat | context
//   report   (report.html?id=…): printable report document
// Mode: <html data-mode>, then ?mode=, then "sidebar".

import { h, icon, clear, iconButton, spaceIcon } from "./dom.js";
import { createStore } from "./store.js";
import { connect, openFullPage, inExtension } from "./transport.js";
import { createComposer, MOD } from "./views/composer.js";
import { createChatView } from "./views/chat.js";
import { createDashboard } from "./views/dashboard.js";
import { createNewtabHome } from "./views/newtab.js";
import { createHistory, createActivity } from "./views/history.js";
import { createSettings, sectionLabel, needsAttention, settingsAttention } from "./views/settings.js";
import { createNav, createContext } from "./views/panels.js";
import { createReport } from "./views/report.js";
import { createToolsPage } from "./views/tools.js";
import { createOnboarding } from "./views/onboarding.js";
import { createAgentsPanel } from "./views/agents.js";
import { createSendSheet, SCREENSHOT_SHORTCUT } from "./views/send.js";
import { createHelperGuide } from "./views/setup.js";
import { helperDownCard } from "./views/helperstate.js";
import { createUrlbarArrival } from "./views/addressbar.js";
import { readUrlbarHash } from "./addressbar.js";

const root = document.documentElement;
const MODES = ["sidebar", "newtab", "full", "report"];
const mode = [root.dataset.mode, new URLSearchParams(location.search).get("mode"), "sidebar"].find(m => MODES.includes(m));
root.dataset.mode = mode;
// "#f" marks a new tab that background.js swapped in for keyboard focus; drop it before routing.
if (location.hash === "#f") history.replaceState(null, "", location.pathname + location.search);
// "#urlbar": background.js opened this page for a query typed in Zen's address bar (views/addressbar.js).
const urlbarHash = mode === "newtab" ? readUrlbarHash() : null;

// The new-tab focus fix lives in background.js (tabs.onCreated).

const store = createStore();
const { state: s, actions } = store;

if (mode === "report") bootReport();
else bootApp();

async function start() {
  const transport = await connect({ onMessage: store.receive, onStatus: st => actions.setConnection(st) });
  actions.attach(transport);
  root.dataset.transport = transport.kind;
  // Install command, paths and shortcuts follow the system (ui/platform.js); the mock fakes one with ?platform=linux|win|cros.
  actions.detectPlatform(transport.kind === "mock" ? new URLSearchParams(location.search).get("platform") || "mac" : undefined);
  actions.hello();
}

// ---- report page --------------------------------------------------------

function bootReport() {
  const view = createReport(store);
  document.body.append(view.el);
  store.subscribe(view.update);
  start();
}

// ---- app ----------------------------------------------------------------

function bootApp() {
  const composer = createComposer(store);
  const views = {};
  const ctx = {
    scroller: () => scroller,
    composerEl: () => composer.textarea,
    onHomeChange: () => renderTopbar(),
    ask(text) { actions.newChat(); actions.send(text); },
    focusComposer,
    newChat,
    heroSlot: () => (mode === "newtab" ? view("home").heroSlot : null),
    composerText(text) { composer.setText(text); },
    historySearch(q) { actions.search(q); },
    editMemory() { actions.go("settings", { section: "memory" }); requestAnimationFrame(() => view("settings").focusMemory()); },
    tryTip(id) {
      const text = { mention: "@", act: "Fill this form for me", tools: "What's new in my mail today?", skills: "/" }[id];
      if (text) { composer.setText(text); composer.textarea.dispatchEvent(new Event("input")); }
      else composer.focus();
    },
  };

  function view(name) {
    if (!views[name]) {
      views[name] = {
        home: () => (mode === "newtab" ? createNewtabHome(store, ctx) : createDashboard(store, ctx, { variant: mode === "sidebar" ? "compact" : "full" })),
        chat: () => createChatView(store, ctx),
        history: () => createHistory(store, ctx),
        activity: () => createActivity(store),
        settings: () => createSettings(store, ctx),
        tools: () => createToolsPage(store, ctx),
      }[name]();
    }
    return views[name];
  }

  // Shell
  const topbar = h("header", { class: "topbar" });
  const banner = h("div", { class: "banner-slot", aria: { live: "assertive" } });
  const viewHost = h("div", { class: "view-host" });
  const scroller = h("div", { class: "scroller", tabindex: "-1" }, viewHost);
  const dock = h("div", { class: "dock" });
  // External agents (Claude Code, Codex…) on the active tab and elsewhere: above the content, sidebar and full page.
  const agents = mode === "sidebar" || mode === "full" ? createAgentsPanel(store) : null;
  const urlbar = mode === "newtab" ? createUrlbarArrival(store, ctx) : null;
  const main = h("main", { class: "main" }, topbar, banner, urlbar?.el, agents?.el, scroller, dock);
  const nav = mode === "full" ? createNav(store, ctx) : null;
  const context = mode === "full" ? createContext(store, ctx) : null;
  const app = h("div", { class: "app" }, nav?.el, main, context?.el);
  document.body.append(app);
  // Send screenshot (⌘⇧2 or the camera button): the send sheet over the app, and its toast.
  const sendSheet = mode === "sidebar" || mode === "full" ? createSendSheet(store) : null;
  if (sendSheet) document.body.append(sendSheet.el, sendSheet.toastEl);
  if (mode === "full" && localStorage.getItem("enso.context") === "hidden") app.classList.add("no-context");

  let shown = null;

  // No helper yet (or it can't start): the one-step install guide covers the app
  // and moves on by itself once background.js reaches the helper.
  const guide = createHelperGuide(store);
  let firstRun = false; // the guide or onboarding was shown in this page: end on Setup
  function renderGuide() {
    // Not on Linux or Windows: the install command can't help there (the banner says why instead).
    const due = (s.helper.state === "missing" || s.helper.state === "failed") && !store.unsupported();
    if (store.unsupported() && guide.el.isConnected && !guide.closing) {
      guide.el.remove();
      app.inert = false;
      renderOnboarding();
      return;
    }
    if (due && !guide.el.isConnected) {
      firstRun = true;
      onboarding.el.remove();
      document.body.append(guide.el);
      app.inert = true;
      guide.show();
    } else if (!due && guide.el.isConnected && !guide.closing && s.helper.state === "connected") {
      guide.closing = true;
      guide.connected(() => { guide.el.remove(); guide.closing = false; app.inert = false; renderOnboarding(); });
    }
  }

  // First run: the onboarding card covers the app until a profile is saved or skipped.
  const onboarding = createOnboarding(store);
  function renderOnboarding() {
    if (guide.el.isConnected) return;
    const due = !!s.profile?.onboarding;
    if (due && !onboarding.el.isConnected) { firstRun = true; document.body.append(onboarding.el); app.inert = true; onboarding.show(); }
    else if (!due && onboarding.el.isConnected) {
      onboarding.el.remove();
      app.inert = false;
      // A new install ends on Setup (Claude, agents, T3…); otherwise back to chat.
      if (firstRun) { firstRun = false; actions.go("setup"); }
      else if (mode !== "full") focusComposer();
    }
  }

  function newChat() {
    actions.newChat();
    focusComposer();
  }

  function focusComposer() {
    if (!["home", "chat"].includes(s.ui.view)) actions.go("home");
    requestAnimationFrame(() => composer.focus());
  }

  function placeComposer() {
    const v = s.ui.view;
    const hero = mode === "newtab" && v === "home";
    const docked = v === "chat" || (v === "home" && !hero);
    // Only move the composer when its slot changes: re-appending restarts animations and drops focus.
    if (hero) {
      const slot = view("home").heroSlot;
      if (composer.el.parentNode !== slot) { slot.append(composer.el); composer.setVariant("hero"); }
    } else if (docked) {
      if (composer.el.parentNode !== dock) { dock.append(composer.el); composer.setVariant("docked"); }
    } else composer.el.remove();
    dock.hidden = !docked;
    const c = v === "chat" && s.ui.currentId ? store.conv(s.ui.currentId) : null;
    composer.setSuggestions(!hero && (v === "home" || !c || c.events.length === 0));
  }

  function renderView() {
    const v = s.ui.view;
    const instance = view(v);
    if (shown !== v || !viewHost.contains(instance.el)) {
      if (shown && shown !== v) views[shown]?.hide?.();
      clear(viewHost, instance.el);
      viewHost.dataset.view = v;
      app.dataset.view = v;
      instance.show?.();
      if (shown !== v) scroller.scrollTop = 0;
      if (v !== "chat" && shown !== null) viewHost.classList.remove("enter"), void viewHost.offsetWidth, viewHost.classList.add("enter");
      shown = v;
    }
    placeComposer();
  }

  function pendingApprovals() {
    return [...s.approvals.values()].filter(a => !a.sent);
  }

  function renderTopbar() {
    const v = s.ui.view;
    const sum = v === "chat" && s.ui.currentId ? store.summary(s.ui.currentId) : null;
    // Sidebar Settings drills into one section: the title is the section, and back goes up one level.
    const section = v === "settings" && mode === "sidebar" ? s.ui.settingsSection : null;
    const title = section ? sectionLabel(section) : { history: "History", activity: "Activity", settings: "Settings", tools: "Tools" }[v] ?? (v === "chat" ? sum?.title || "New conversation" : null);
    const up = backTarget();
    const back = (mode !== "full" && v !== "home") ? iconButton("arrowLeft", up.label, up.go, { class: "back" }) : null;
    const attn = pendingApprovals();
    const pill = attn.length ? h("button", { type: "button", class: "attn-pill", onclick: () => jumpToApproval(attn[0]) },
      h("span", { class: "attn-pulse", aria: { hidden: "true" } }), icon("shield"),
      h("span", { class: "attn-long" }, attn.length > 1 ? `${attn.length} approvals needed` : "Approval needed"),
      h("span", { class: "attn-short" }, attn.length > 1 ? `Approve ${attn.length}` : "Approve")) : null;
    const running = v === "chat" && s.ui.currentId && s.running.has(s.ui.currentId);
    const left = h("div", { class: "topbar-left" },
      back,
      v === "home" && mode === "sidebar" ? h("span", { class: "brand" }, h("span", { class: "brand-mark", aria: { hidden: "true" } }), h("span", { class: "brand-name" }, "Ensō")) : null,
      title ? h("h2", { class: "topbar-title", title }, title) : null,
      running ? h("span", { class: "live-dot", title: "Answering…" }) : null);
    const spaceChip = s.space ? h("span", { class: "space-chip", title: `Space: ${s.space.name}` }, spaceIcon(s.space), h("span", { class: "space-name" }, s.space.name)) : null;
    const right = h("div", { class: "topbar-right" }, pill, spaceChip);
    const shotBtn = iconButton("camera", `Send a screenshot to an agent (${SCREENSHOT_SHORTCUT})`, () => actions.captureScreenshot("region"), { disabled: !s.tab || s.tab.sensitive });
    if (mode === "sidebar") {
      right.append(
        shotBtn,
        iconButton("plus", `New chat (${MOD}N)`, newChat),
        iconButton("history", "History", () => actions.go("history"), { aria: { pressed: String(v === "history") } }),
        settingsButton(v),
        // (Element.append would print a null as the text "null".)
        inExtension || s.transportKind === "mock" ? iconButton("expand", "Open as full page", () => openFullPage(v === "chat" && s.ui.currentId ? `#conversation=${encodeURIComponent(s.ui.currentId)}` : "")) : "");
    } else if (mode === "newtab") {
      if (v !== "home") right.append(iconButton("plus", `New chat (${MOD}N)`, newChat));
      if (v === "home") {
        const editing = view("home").editing;
        right.append(iconButton("layout", editing ? "Done editing widgets" : "Edit widgets", () => view("home").customize(), { aria: { pressed: String(!!editing) } }));
      }
      right.append(
        iconButton("history", "History", () => actions.go("history")),
        settingsButton(v));
    } else {
      right.append(shotBtn);
      if (v === "chat" && sum) right.append(iconButton("pencil", "Rename", () => renameInline(sum)));
      right.append(iconButton("panelRight", app.classList.contains("no-context") ? "Show context panel" : "Hide context panel", () => {
        app.classList.toggle("no-context");
        localStorage.setItem("enso.context", app.classList.contains("no-context") ? "hidden" : "shown");
        renderTopbar();
      }));
    }
    clear(topbar, left, right);
    topbar.classList.toggle("bare", mode === "newtab" && v === "home");
    document.title = mode === "newtab" ? (v === "home" ? "New Tab" : `${title} · Ensō`) : title ? `${title} · Ensō` : "Ensō";
  }

  /** Where the top bar's back button (and Escape) go from the current view. */
  function backTarget() {
    const v = s.ui.view;
    if (v === "settings" && mode === "sidebar" && s.ui.settingsSection) return { label: "Back to Settings", go: () => actions.go("settings") };
    if (v === "tools") return { label: "Back to Settings", go: () => actions.go("settings", { section: mode === "sidebar" ? "connections" : null }) };
    return { label: "Back to home", go: () => actions.go("home") };
  }

  /** The Settings button, with a dot when something there needs the user. */
  function settingsButton(v) {
    const attn = needsAttention(s);
    const first = attn ? Object.values(settingsAttention(s)).find(Boolean) : null;
    const btn = iconButton("sliders", attn ? `Settings: ${first}` : "Settings", () => actions.go("settings"), { aria: { pressed: String(v === "settings") }, class: attn && "has-attn" });
    if (attn) btn.append(h("span", { class: "attn-badge", aria: { hidden: "true" } }));
    return btn;
  }

  function renameInline(sum) {
    const h2 = topbar.querySelector(".topbar-title");
    if (!h2) return;
    const field = h("input", { type: "text", class: "rename-input", value: sum.title ?? "", aria: { label: "Conversation title" } });
    let done = false;
    const finish = save => { if (done) return; done = true; if (save) actions.rename(sum.id, field.value); renderTopbar(); };
    field.addEventListener("keydown", e => { if (e.key === "Enter") finish(true); if (e.key === "Escape") { e.stopPropagation(); finish(false); } });
    field.addEventListener("blur", () => finish(true));
    h2.replaceWith(field);
    field.focus();
    field.select();
  }

  function jumpToApproval(a) {
    if (s.ui.view !== "chat" || s.ui.currentId !== a.conversationId) actions.open(a.conversationId);
    setTimeout(() => view("chat").scrollToApproval(a.event.toolUseId), 250);
  }

  function renderBanner() {
    const items = [];
    if (s.connection === "reconnecting") items.push(h("div", { class: "banner warn" }, h("span", { class: "spinner" }), h("span", null, "Reconnecting to Ensō…")));
    if (s.helper.state === "restarting") items.push(h("div", { class: "banner info", role: "status" }, h("span", { class: "spinner" }), h("span", null, "Restarting the helper after the update…")));
    // The helper stopped (or can't start, behind the first-run guide): why, and what to do.
    const down = store.helperDown();
    if (down) items.push(helperDownCard(store));
    const g = s.helper.state === "restarting" || (down && s.globalError?.code === "host_disconnected") ? null : s.globalError;
    if (g) {
      const disconnected = g.code === "host_disconnected";
      items.push(h("div", { class: `banner ${g.kind === "error" ? "bad" : "info"}`, role: "alert" },
        icon(g.kind === "error" ? "alert" : "info"),
        h("div", { class: "banner-text" },
          h("strong", null, disconnected ? "The chat helper stopped" : g.kind === "error" ? "Something went wrong" : "Note"),
          h("span", null, g.text)),
        disconnected ? h("button", { type: "button", class: "btn small", onclick: () => { actions.dismissBanner(); actions.helperRetry(); actions.hello(); } }, "Reconnect") : null,
        iconButton("x", "Dismiss", () => actions.dismissBanner(), { class: "small" })));
    }
    clear(banner, items);
  }

  // Keyboard shortcuts inside the UI. ⌘E (open chat) is the manifest's.
  document.addEventListener("keydown", e => {
    const mod = e.metaKey || e.ctrlKey;
    const inField = e.target.closest?.("input, textarea, select, [contenteditable]");
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") { e.preventDefault(); focusComposer(); return; }
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") { e.preventDefault(); newChat(); return; }
    if (e.key === "Escape" && !inField && ["history", "activity", "settings", "tools"].includes(s.ui.view) && mode !== "full") { backTarget().go(); return; }
    // New tab: ↓ in the empty box opens the day's brief.
    if (e.key === "Escape" && !inField && s.ui.view === "chat" && s.ui.currentId && s.running.has(s.ui.currentId)) { actions.stop(); return; }
    // Type anywhere on Home to start writing.
    if (!inField && !mod && !e.altKey && e.key.length === 1 && ["home", "chat"].includes(s.ui.view) && !e.target.closest?.("button, a")) composer.focus();
    if (!inField && !mod && e.key === "/" && s.ui.view === "settings") { e.preventDefault(); view("settings").focusSearch(); return; }
    if (!inField && !mod && e.key === "/" && !["home", "chat"].includes(s.ui.view)) { e.preventDefault(); focusComposer(); }
  });

  // Dashboard auto-refresh (the host dedupes refreshes from several pages).
  let lastRefreshAsk = 0;
  function maybeRefreshDashboard() {
    const minutes = s.settings?.dashboard?.autoRefreshMinutes ?? 60;
    if (!s.ready || document.hidden || s.dashboard.loading || s.ui.view !== "home") return;
    const at = s.dashboard.data?.generatedAt ? new Date(s.dashboard.data.generatedAt).getTime() : 0;
    const stale = !at || (minutes > 0 && Date.now() - at > minutes * 60_000);
    // "Off" (0) means no automatic brief at all, not even the first one.
    if (stale && minutes > 0 && Date.now() - lastRefreshAsk > 5 * 60_000) {
      lastRefreshAsk = Date.now();
      actions.refreshDashboard();
    }
  }
  setInterval(maybeRefreshDashboard, 60_000);
  document.addEventListener("visibilitychange", maybeRefreshDashboard);

  let firstState = true;
  let runningCount = 0;
  store.subscribe(topics => {
    if (topics.has("state") && firstState) {
      firstState = false;
      actions.listActions(null, "recent");
      if (mode === "full") actions.loadMemory();
      // The sidebar picks up a turn that's running when it opens.
      if (location.hash) actions.restoreFromHash();
      else if (mode === "sidebar" && s.activeConversationId) actions.open(s.activeConversationId);
      setTimeout(maybeRefreshDashboard, 300);
    }
    if (s.running.size < runningCount) actions.listActions(null, "recent");
    runningCount = s.running.size;
    if (topics.has("prefill") && s.prefill != null) {
      if (!["home", "chat"].includes(s.ui.view)) actions.go("home");
      composer.setText(actions.takePrefill());
    }
    if (topics.has("ui")) renderView();
    for (const v of Object.values(views)) v.update?.(topics);
    nav?.update(topics);
    context?.update(topics);
    agents?.update(topics);
    sendSheet?.update(topics);
    urlbar?.update(topics);
    if (["ui", "approvals", "conversations", "settings", "state", "space", "tab", "setup", "servers", "t3"].some(t => topics.has(t)) || [...topics].some(t => t.startsWith("conv:"))) renderTopbar();
    if (topics.has("ui") || [...topics].some(t => t.startsWith("conv:"))) placeComposer();
    if (topics.has("banner") || topics.has("connection") || topics.has("helper")) renderBanner();
    if (topics.has("helper")) renderGuide();
    if (topics.has("profile") || topics.has("state")) renderOnboarding();
    if (onboarding.el.isConnected) onboarding.update(topics);
    if (guide.el.isConnected) guide.update(topics);
  });

  window.addEventListener("hashchange", () => actions.restoreFromHash());

  renderView();
  renderTopbar();
  start().then(() => urlbar?.start(urlbarHash));
  if (mode === "newtab") requestAnimationFrame(() => composer.focus());
}

// New tab: put the cursor in the box as soon as the page has focus.
if (mode === "newtab") {
  const focusBox = () => {
    if (document.querySelector(".ub-chooser")) return; // the address-bar chooser has the keyboard
    const box = document.querySelector(".nt-home .composer-input, .composer-input, textarea");
    if (box && document.activeElement !== box) box.focus({ preventScroll: true });
  };
  // Keep trying for a moment: the page only gets keyboard focus once the tab is shown.
  let tries = 0;
  const timer = setInterval(() => { focusBox(); if (++tries > 15 || (document.hasFocus() && document.activeElement?.tagName === "TEXTAREA")) clearInterval(timer); }, 80);
  window.addEventListener("focus", focusBox);
}

// The new tab's static first frame (newtab.html #boot) has done its job.
requestAnimationFrame(() => {
  document.getElementById("boot")?.remove();
  // Let entrance animations run again once the real page is on screen (ui/boot.js).
  // Removing the class would start them on what is already showing, so finish those at once.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.classList.remove("booting");
    for (const a of document.getAnimations()) try { a.finish(); } catch { /* infinite: leave it */ }
  }));
});

// While the screenshot overlay is up in the page, keyboard focus is often still
// here (the shortcut opens the sidebar). Hand Enter / F / Esc on to the page.
window.addEventListener("keydown", e => {
  if (!store?.state?.capturing) return;
  if (!["Enter", "Escape", "f", "F"].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  e.stopPropagation();
  store.actions.captureKey(e.key);
}, true);
