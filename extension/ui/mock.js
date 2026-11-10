// In-page fake host for developing the UI without Zen, background.js or the
// native host. It speaks the protocol in docs/PROTOCOL.md with realistic data
// about a fictional person (Maya, a product designer at Northwind):
// a dashboard, past conversations with tool calls, page actions and approvals,
// and a streamed answer (thinking → tools → Markdown table) for every message.
//
// Try these messages: anything (Gmail + calendar answer with a table),
// "fill in the form on this page" (page actions + approval), "error"
// (no_api_key error), and Stop while an answer streams.
// ?onboarding=1 starts without a profile (the first-run card).
// ?agents=running | paused | delivered | idle | stopped | list | t3 shows external
// agents (Claude Code, Codex) working in tabs: the agent card and the Agents row
// (t3: Claude Code running inside a T3 Code thread).
// Send screenshot: ?shot=sheet | picker | agent | fallback opens the send sheet with a
// fake capture; ?t3=off | down | revoked | fallback sets the T3 Code connection;
// ?links=1 adds linked threads (Settings → Send screenshots).
// ?monday=ok | down | off: monday.com signed in and working (default), signed in
// but its server failing (HTTP 500), or not connected.
// ?helper=missing | failed: no helper yet (the first-run install guide) or one that
// can't start; &connectAfter=6 connects it after 6 seconds (or __ensoMock.connectHelper()).
// ?helper=crashed: it ran, then exited (the helper-not-running banner, every section
// shows it instead of "Loading…"); ?helper=noanswer: connected, but memory and Setup
// requests go unanswered ("Couldn't load" + Retry after 8 s).
// ?platform=linux | win: that system's install guide, paths, secret store and shortcuts
// (add &helper=missing for the first-run guide); ?platform=cros: a system the helper
// doesn't run on.
// ?setup=ready | mixed | fresh: the Settings → Setup checklist (default ready); #setup opens it.

const MIN = 60_000;
const HOUR = 60 * MIN;

const iso = ms => new Date(ms).toISOString();
const now = () => Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function today(h, m = 0) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}
/** A local calendar date n days from today, as task apps send it (YYYY-MM-DD). */
const dayIn = n => new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA");
function inDays(n, h = 23, m = 59) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

// Favicons are tiny inline SVG data URLs so the mock works offline.
const fav = (bg, letter, fg = "#fff") =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${bg}"/><text x="16" y="22" font-family="Helvetica,Arial" font-size="17" font-weight="700" text-anchor="middle" fill="${fg}">${letter}</text></svg>`)}`;

const SPACES = [
  { id: "{sp-personal}", name: "Personal", icon: "grid-2x2", containerId: 0, urls: [] },
  { id: "{sp-work}", name: "Northwind", icon: "briefcase", containerId: 6, urls: ["northwind.example.com"] },
  { id: "{sp-garden}", name: "Garden club", icon: "heart", containerId: 7, urls: ["harborgarden.example.org"] },
  { id: "{sp-travel}", name: "Travel", icon: "star", containerId: 8, urls: [] },
];
const spaceRef = id => { const sp = SPACES.find(x => x.id === id); return sp ? { id: sp.id, name: sp.name, icon: sp.icon } : null; };

const TABS = [
  { tabId: 11, spaceId: "{sp-personal}", title: "Designing with data: small multiples (conference talk)", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", favIconUrl: fav("#e62117", "▶"), active: true, sensitive: false },
  { tabId: 12, spaceId: "{sp-personal}", title: "Inbox (12) · maya.lindqvist@example.com · Gmail", url: "https://mail.google.com/mail/u/0/#inbox", favIconUrl: fav("#ea4335", "M"), active: false, sensitive: false },
  { tabId: 13, spaceId: "{sp-work}", title: "Settings: keyboard shortcuts panel by maya-l · Pull Request #431 · northwind-labs/atlas-web", url: "https://github.com/northwind-labs/atlas-web/pull/431", favIconUrl: fav("#24292f", "G"), active: false, sensitive: false },
  { tabId: 14, spaceId: "{sp-personal}", title: "Data Visualisation · Riverside Academy", url: "https://learn.example.edu/courses/data-visualisation", favIconUrl: fav("#2f6f8f", "R"), active: false, sensitive: false },
  { tabId: 15, spaceId: "{sp-work}", title: "Atlas 2.0 launch · Linear", url: "https://linear.app/northwind/project/atlas-2", favIconUrl: fav("#5e6ad2", "L"), active: false, sensitive: false },
  { tabId: 16, spaceId: "{sp-personal}", title: "Assignment 3 brief: small multiples · Google Docs", url: "https://docs.google.com/document/d/1x9/edit", favIconUrl: fav("#4285f4", "D"), active: false, sensitive: false },
  { tabId: 17, spaceId: "{sp-personal}", title: "Northbank Online Banking", url: "https://online.northbank.example.com/", favIconUrl: fav("#0b6e4f", "N"), active: false, sensitive: true },
];
TABS.push(
  { tabId: 18, spaceId: "{sp-work}", title: "atlas-web · Deployments · Vercel", url: "https://vercel.com/northwind/atlas-web/deployments", favIconUrl: fav("#111", "▲"), active: false, sensitive: false },
  { tabId: 19, spaceId: "{sp-garden}", title: "Spring planting plan · Google Slides", url: "https://docs.google.com/presentation/d/garden1/edit", favIconUrl: fav("#f4b400", "S"), active: false, sensitive: false },
  { tabId: 20, spaceId: "{sp-travel}", title: "Weekend in Porto · Airbnb", url: "https://www.airbnb.com/rooms/porto", favIconUrl: fav("#ff5a5f", "A"), active: false, sensitive: false },
);
let activeTabId = 11;
const activeTab = () => TABS.find(t => t.tabId === activeTabId) ?? null;
const currentSpaceId = () => activeTab()?.spaceId ?? SPACES[0].id;

const SKILLS = [
  { name: "summarize", description: "Summarise this page in five bullets", prompt: "Summarise the current page in five short bullets. {input}", builtIn: true },
  { name: "explain", description: "Explain the selected idea like a tutor", prompt: "Explain this clearly, step by step, as a patient tutor: {input}", builtIn: true },
  { name: "translate", description: "Translate to English, Portuguese or Swedish", prompt: "Translate the following: {input}", builtIn: true },
  { name: "report", description: "Research and write a report with charts", prompt: "Research {input} and write a structured report.", builtIn: true },
  { name: "pt-quiz", description: "Quiz me on Portuguese vocabulary", prompt: "Quiz me on 10 Portuguese words from my due cards. {input}", builtIn: false },
  { name: "standup", description: "Draft my Northwind stand-up update", prompt: "Draft a three-line stand-up update from my mail, calendar and recent work. {input}", builtIn: false },
];

const REPORTS = [
  {
    id: "r-multiples",
    title: "Small multiples vs. overlaid lines",
    createdAt: new Date(Date.now() - 5 * 24 * 3_600_000).toISOString(),
    conversationId: "c-viz",
    markdown: `# Small multiples vs. overlaid lines

Prepared for Assignment 3 of the Data Visualisation course. Sources: the week 4 lecture, Tufte's *Envisioning Information* and two usability studies on chart reading.

## Summary

- **Overlaid lines** work up to about four series; beyond that, colours and crossings make lines hard to follow.
- **Small multiples** repeat one simple chart per series on a shared scale, so the eye compares shapes instead of decoding a legend.
- A **highlighted line** (one series in colour, the rest grey) is a good middle ground when one series matters most.

## Time to answer a comparison question

\`\`\`chart
{ "type": "bar", "title": "Median seconds to answer (lower is better)", "labels": ["3 series", "6 series", "9 series", "12 series"], "series": [ { "name": "Overlaid", "values": [6, 11, 19, 27] }, { "name": "Small multiples", "values": [7, 8, 10, 12] }, { "name": "Highlighted", "values": [6, 8, 12, 15] } ] }
\`\`\`

## Errors as the number of series grows

\`\`\`chart
{ "type": "line", "title": "Wrong answers (%)", "labels": ["2", "4", "6", "8", "10", "12"], "series": [ { "name": "Overlaid", "values": [3, 6, 14, 22, 29, 35] }, { "name": "Small multiples", "values": [4, 5, 6, 7, 8, 9] } ] }
\`\`\`

## Comparison

| | Overlaid | Small multiples | Highlighted |
|---|---|---|---|
| Best for | 2–4 series | many series, shapes | one series vs. the rest |
| Shared scale | yes | must be enforced | yes |
| Needs a legend | yes | no (titles) | short |
| Space | small | large | small |

> For the assignment, use a 3 × 4 grid with a shared y-axis and label each panel directly.

## Next steps

1. Rebuild figure 2 as small multiples with a shared scale.
2. Add a highlighted-line version for the summary slide.
3. Explain the choice in section 3 of the write-up.
`,
  },
  { id: "r-week", title: "Week 45 overview: deadlines, launch and garden club", createdAt: new Date(Date.now() - 2 * 24 * 3_600_000).toISOString(), conversationId: "c-jonas", markdown: `# Week 45 overview

## Deadlines

| Course | Item | Due |
|---|---|---|
| Data Visualisation | Assignment 3 | Thursday |
| UX Research Methods | Quiz 5 | Tuesday |

\`\`\`chart
{ "type": "bar", "title": "Hours planned per area", "labels": ["Northwind", "Course", "Garden club", "Portuguese"], "series": [ { "name": "Hours", "values": [32, 8, 3, 3] } ] }
\`\`\`
` },
];

function greetingWord() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function makeDashboard() {
  return {
    generatedAt: iso(now()),
    greeting: `${greetingWord()}, Maya`,
    headline: "Assignment 3 is due Thursday, and Jonas replied about the Atlas beta date.",
    calendar: [
      { time: today(9, 30), title: "Design critique: onboarding flows", location: "Room 3 · Harbour office", url: "https://calendar.google.com/" },
      { time: today(13, 0), title: "Northwind stand-up", location: "Google Meet", url: "https://meet.google.com/" },
      { time: today(16, 0), title: "Garden club planning call", location: "Zoom" },
      { time: today(19, 30), title: "Portuguese conversation practice" },
    ],
    mail: [
      { from: "Jonas Berg", subject: "Re: Atlas 2.0 beta date", why: "Answers your question; asks you to confirm by Wednesday.", url: "https://mail.google.com/" },
      { from: "Vercel", subject: "Deployment failed: atlas-web on production", why: "The marketing site build is red since 07:12.", url: "https://mail.google.com/" },
      { from: "Harbor Garden Club", subject: "Volunteer rota for December", why: "Form closes Friday; you haven't filled it in yet.", url: "https://mail.google.com/" },
    ],
    study: [
      { course: "Data Visualisation", item: "Assignment 3: small multiples", due: inDays(3, 23, 59), url: "https://learn.example.edu/" },
      { course: "UX Research Methods", item: "Quiz 5 on interview techniques", due: inDays(1, 12, 0) },
      { course: "Data Visualisation", item: "Reading: Tufte, chapter 4", due: inDays(6, 17, 0) },
    ],
    tasks: [
      { title: "Confirm the beta date with Jonas", due: inDays(2, 18, 0), source: "Gmail", kind: "follow-up" },
      { title: "Fix the atlas-web build (missing env var)", source: "Northwind", url: "https://vercel.com/", kind: "follow-up" },
      { title: "Finish the planting plan slides for the garden call", due: inDays(0, 16, 0), source: "Garden club", kind: "follow-up" },
      // Task-app tasks the dashboard run found (claude.ai connectors the helper can't call itself).
      { title: "Renew the Figma plugin token", due: inDays(9, 12, 0), source: "Todoist", kind: "app", url: "https://todoist.com/app/today" },
      { title: "Book the dentist", source: "Todoist", kind: "app" },
      // Also in the direct Fieldnotes list below: the Tasks widget shows it once.
      { title: "Send the Q4 survey results to Priya", due: dayIn(1), source: "Fieldnotes", kind: "app" },
    ],
    language: { summary: "12 cards due in your Portuguese deck. Last session: preterite of irregular verbs (82% correct). Streak: 6 days.", url: "https://lingo.example.com/" },
    suggestions: [
      "Ask: summarise my unread Northwind mail",
      "Ask: what should I work on tonight for Assignment 3?",
      "Ask: draft a reply to Jonas confirming the beta date",
      "Ask: quiz me on 10 Portuguese verbs",
    ],
  };
}

// Open tasks from a task app the helper calls directly (tasks.widget; Fieldnotes stands in for Commonfold).
function makeTasks() {
  const t = (id, title, due, extra = {}) => ({ id, title, ...(due ? { due } : {}), url: `https://fieldnotes.example.com/notes/${id}`, source: "Fieldnotes", server: "fieldnotes", space: "personal", completable: true, ...extra });
  return [
    t("6f1c2a10-0000-4000-8000-000000000001", "Pay the studio rent", dayIn(-1)),
    t("6f1c2a10-0000-4000-8000-000000000006", "Return the library books", dayIn(0), { remindAt: today(18, 0) }),
    t("6f1c2a10-0000-4000-8000-000000000002", "Send the Q4 survey results to Priya", dayIn(1)),
    t("6f1c2a10-0000-4000-8000-000000000003", "Draft the onboarding copy for Atlas 2.0", dayIn(3)),
    t("6f1c2a10-0000-4000-8000-000000000004", "Order seeds for the spring beds", null),
    t("6f1c2a10-0000-4000-8000-000000000005", "Read Jonas's beta checklist", null),
  ];
}

// monday.com items assigned to Maya (monday.widget), in the helper's normalised shape.
function makeMonday() {
  const item = (id, title, board, status, due, group, mins) => ({ id, title, board: board.name, boardId: board.id, url: `https://northwind.monday.com/boards/${board.id}/pulses/${id}`, ...(status ? { status } : {}), ...(due ? { due } : {}), group, updatedAt: iso(now() - mins * MIN) });
  const atlas = { id: "4810000001", name: "Atlas 2.0 launch" };
  const design = { id: "4810000002", name: "Design team" };
  const items = [
    item("4811000101", "Onboarding flow: final copy review", atlas, "Stuck", dayIn(-1), "This sprint", 25),
    item("4811000102", "Hand off empty states to engineering", atlas, "Working on it", dayIn(0), "This sprint", 90),
    item("4811000103", "Keyboard shortcuts panel QA", atlas, "Waiting for review", dayIn(2), "This sprint", 300),
    item("4811000104", "Icon set refresh", design, "Working on it", dayIn(6), "Q4", 1440),
    item("4811000105", "Research synthesis: beta interviews", design, null, null, "Backlog", 4000),
  ];
  return {
    state: "ok",
    user: { id: "71000001", name: "Maya Lindqvist" },
    items,
    updates: [{ id: "u1", itemId: "4811000101", item: items[0].title, url: items[0].url, author: "Jonas Berg", text: "@Maya Lindqvist legal signed off on the consent wording, can you update the last screen today?", at: iso(now() - 25 * MIN), mention: true }],
    boards: [atlas, design],
  };
}
const MONDAY_TOOLS = ["get_user_context", "get_board_schema", "get_board_info", "get_board_items_page", "get_updates", "get_board_activity", "search", "list_users_and_teams", "create_item", "change_item_column_values", "create_update", "move_item_to_group", "delete_item"];

// ---- seed conversations ---------------------------------------------------

let seq = 1000;
const nid = p => `${p}${++seq}`;

function buildSeed() {
  const convs = [];
  const t0 = now() - 2 * HOUR;
  {
    let t = t0;
    const at = (d = 4000) => iso((t += d));
    const events = [
      { kind: "turn.start", id: nid("e"), at: at(0) },
      { kind: "user", id: nid("e"), at: at(), text: "Jonas answered about the Atlas beta date. What did he say, and can you draft a reply confirming we'll ship the onboarding redesign in the beta?", page: { url: "https://mail.google.com/mail/u/0/#inbox", title: "Inbox (12) · Gmail" } },
      { kind: "thinking", id: nid("e"), at: at(), text: "Maya wants the content of Jonas' reply and a draft confirming the onboarding redesign for the beta. I'll search Gmail for the thread, read it, then create a draft (that needs approval)." },
      { kind: "tool.call", id: nid("e"), at: at(), toolUseId: "tu1", category: "mcp", server: "gmail", tool: "search_threads", title: "Search Gmail", input: { query: "from:jonas atlas beta", maxResults: 5 } },
      { kind: "tool.result", id: nid("e"), at: at(900), toolUseId: "tu1", ok: true, preview: "3 threads\n1. Re: Atlas 2.0 beta date (today 08:14)\n2. Atlas 2.0 launch checklist (Oct 28)\n3. Design review notes (Oct 21)", durationMs: 880 },
      { kind: "tool.call", id: nid("e"), at: at(), toolUseId: "tu2", category: "mcp", server: "gmail", tool: "get_thread", title: "Read email thread", input: { threadId: "18c2f9a01b" } },
      { kind: "tool.result", id: nid("e"), at: at(600), toolUseId: "tu2", ok: true, preview: "From: Jonas Berg <jonas@northwind.example.com>\nSubject: Re: Atlas 2.0 beta date\n\nHi Maya,\nThe beta moves to the 20th. There's room for one more feature if design is ready. Please confirm by Wednesday so I can update the plan.\nJonas", durationMs: 540 },
      { kind: "approval.request", id: nid("e"), at: at(), toolUseId: "tu3", server: "gmail", tool: "create_draft", title: "Create Gmail draft", input: { to: "jonas@northwind.example.com", subject: "Re: Atlas 2.0 beta date", body: "Hi Jonas,\n\nThanks, confirmed: the onboarding redesign will be ready for the beta on the 20th.\n\nMaya" }, reason: "Creates a draft in your mailbox." },
      { kind: "approval.resolved", id: nid("e"), at: at(5000), toolUseId: "tu3", decision: "allow" },
      { kind: "tool.call", id: nid("e"), at: at(100), toolUseId: "tu3", category: "mcp", server: "gmail", tool: "create_draft", title: "Create Gmail draft", input: { to: "jonas@northwind.example.com", subject: "Re: Atlas 2.0 beta date" } },
      { kind: "tool.result", id: nid("e"), at: at(700), toolUseId: "tu3", ok: true, preview: "Draft created (id r-4417203)", durationMs: 690 },
      { kind: "assistant", id: nid("e"), at: at(), text: "Jonas moved the beta to **the 20th** and says **there's room for one more feature** if design is ready. He asks you to confirm **by Wednesday**.\n\nI've saved a draft reply in Gmail:\n\n> Hi Jonas,\n> Thanks, confirmed: the onboarding redesign will be ready for the beta on the 20th.\n> Maya\n\nOpen [Gmail drafts](https://mail.google.com/mail/u/0/#drafts) to review and send it." },
      { kind: "turn.end", id: nid("e"), at: at(200), usage: { inputTokens: 18420, outputTokens: 612, costUsd: 0.11 } },
    ];
    convs.push({ summary: { id: "c-jonas", title: "Reply to Jonas about the beta date", createdAt: iso(t0), updatedAt: iso(t), engine: "subscription", messageCount: 2, actionCount: 0, pages: [{ url: "https://mail.google.com/mail/u/0/#inbox", title: "Inbox (12) · Gmail" }], preview: "Jonas moved the beta to the 20th and says there's room for one more feature." }, events });
  }
  {
    const start = now() - 26 * HOUR;
    let t = start;
    const at = (d = 3000) => iso((t += d));
    const events = [
      { kind: "turn.start", id: nid("e"), at: at(0) },
      { kind: "user", id: nid("e"), at: at(), text: "How do I say \"I went to the market yesterday\" in Portuguese? Show me the past tense of ir.", page: null },
      { kind: "tool.call", id: nid("e"), at: at(), toolUseId: "tu10", category: "mcp", server: "lingo", tool: "search_dictionary", title: "Look up ir in the dictionary", input: { query: "ir" } },
      { kind: "tool.result", id: nid("e"), at: at(400), toolUseId: "tu10", ok: true, preview: "1 entry\nir: to go. Irregular. Preterite: fui, foste, foi, fomos, fostes, foram (same forms as ser).", durationMs: 410 },
      { kind: "tool.call", id: nid("e"), at: at(), toolUseId: "tu11", category: "mcp", server: "lingo", tool: "learner_recent_reviews", title: "Check your recent reviews", input: { limit: 20 } },
      { kind: "tool.result", id: nid("e"), at: at(500), toolUseId: "tu11", ok: true, preview: "20 reviews: 16 correct. Weak: preterite of irregular verbs (ir, ter, fazer).", durationMs: 480 },
      { kind: "assistant", id: nid("e"), at: at(), text: "**Ontem eu fui ao mercado.**\n\nThe preterite of **ir** is irregular, and it shares its forms with **ser**, so context tells you which verb is meant.\n\n| Person | Portuguese |\n|---|---|\n| eu | fui |\n| tu | foste |\n| ele/ela/você | foi |\n| nós | fomos |\n| vós | fostes |\n| eles/elas/vocês | foram |\n\nYour recent reviews show the irregular preterites are the weak spot, so I'd add **ter → tive** and **fazer → fiz** to today's practice." },
      { kind: "turn.end", id: nid("e"), at: at(100), usage: { inputTokens: 6210, outputTokens: 402 } },
    ];
    convs.push({ summary: { id: "c-portuguese", title: "Portuguese: past tense of ir", createdAt: iso(start), updatedAt: iso(t), engine: "subscription", messageCount: 2, actionCount: 0, pages: [], preview: "Ontem eu fui ao mercado. The preterite of ir is irregular." }, events });
  }
  {
    const start = now() - 3 * 24 * HOUR;
    let t = start;
    const at = (d = 3000) => iso((t += d));
    const url = "https://harborgarden.example.org/volunteer/rota";
    const title = "Volunteer rota · Harbor Garden Club";
    const events = [
      { kind: "turn.start", id: nid("e"), at: at(0) },
      { kind: "user", id: nid("e"), at: at(), text: "Fill in this rota form: Saturdays 10:00 to 12:00, watering and seedlings. Then submit it.", page: { url, title } },
      { kind: "tool.call", id: nid("e"), at: at(), toolUseId: "tu20", category: "page", server: "page", tool: "snapshot", title: "Read the page", input: {} },
      { kind: "tool.result", id: nid("e"), at: at(300), toolUseId: "tu20", ok: true, preview: "Form with 5 fields: Name (filled), Email (filled), Day (select), Time slot (select), Tasks (text), Submit button.", durationMs: 260 },
      { kind: "tool.call", id: nid("e"), at: at(), toolUseId: "tu21", category: "page", server: "page", tool: "select", title: "Select “Saturday”", input: { ref: "e14", value: "Saturday" } },
      { kind: "page.action", id: nid("e"), at: at(200), toolUseId: "tu21", url, title, action: "select", target: "Day: Saturday", ok: true },
      { kind: "tool.result", id: nid("e"), at: at(10), toolUseId: "tu21", ok: true, preview: "Selected Saturday in “Day”.", durationMs: 140 },
      { kind: "tool.call", id: nid("e"), at: at(), toolUseId: "tu22", category: "page", server: "page", tool: "type", title: "Type into “Tasks”", input: { ref: "e19", text: "Watering, seedlings" } },
      { kind: "page.action", id: nid("e"), at: at(200), toolUseId: "tu22", url, title, action: "type", target: "Tasks", ok: true },
      { kind: "tool.result", id: nid("e"), at: at(10), toolUseId: "tu22", ok: true, preview: "Typed 19 characters into “Tasks”.", durationMs: 180 },
      { kind: "approval.request", id: nid("e"), at: at(), toolUseId: "tu23", server: "page", tool: "click", title: "Click “Submit”", input: { ref: "e22" }, reason: "Submits a form on harborgarden.example.org." },
      { kind: "approval.resolved", id: nid("e"), at: at(4000), toolUseId: "tu23", decision: "allow" },
      { kind: "tool.call", id: nid("e"), at: at(10), toolUseId: "tu23", category: "page", server: "page", tool: "click", title: "Click “Submit”", input: { ref: "e22" } },
      { kind: "page.action", id: nid("e"), at: at(300), toolUseId: "tu23", url, title, action: "click", target: "Submit", ok: true },
      { kind: "tool.result", id: nid("e"), at: at(10), toolUseId: "tu23", ok: true, preview: "Clicked “Submit”. Page now shows “Thanks, you're on the rota.”", durationMs: 310 },
      { kind: "assistant", id: nid("e"), at: at(), text: "Done. I set **Day** to Saturday, the time slot to **10:00–12:00**, filled in *Watering, seedlings* and submitted. The page confirms: “Thanks, you're on the rota.”" },
      { kind: "turn.end", id: nid("e"), at: at(100), usage: { inputTokens: 9100, outputTokens: 220 } },
    ];
    convs.push({ summary: { id: "c-garden", title: "Fill in the garden club rota", createdAt: iso(start), updatedAt: iso(t), engine: "subscription", messageCount: 2, actionCount: 3, pages: [{ url, title }], preview: "Done. I set Day to Saturday and submitted the form." }, events });
  }
  const simple = [
    ["c-deploy", "Why is the atlas-web deploy failing?", 5, "https://vercel.com/northwind/atlas-web/deployments", "Deployments · Vercel", "The build can't find NEXT_PUBLIC_API_URL: it was added to Preview but not to Production."],
    ["c-viz", "Explain small multiples for the assignment", 8, "https://en.wikipedia.org/wiki/Small_multiple", "Small multiple - Wikipedia", "Small multiples repeat one simple chart per series on a shared scale, so you compare shapes instead of reading a legend."],
    ["c-flash", "Make flashcards from the interview-methods slides", 15, "https://learn.example.edu/courses/ux-research/files", "Files · UX Research Methods", "Here are 12 flashcards covering open questions, laddering and the five-whys."],
  ];
  for (const [id, title, daysAgo, url, ptitle, answer] of simple) {
    const start = now() - daysAgo * 24 * HOUR;
    const events = [
      { kind: "turn.start", id: nid("e"), at: iso(start) },
      { kind: "user", id: nid("e"), at: iso(start + 1000), text: title, page: { url, title: ptitle } },
      { kind: "assistant", id: nid("e"), at: iso(start + 9000), text: answer },
      { kind: "turn.end", id: nid("e"), at: iso(start + 9100) },
    ];
    convs.push({ summary: { id, title, createdAt: iso(start), updatedAt: iso(start + 9100), engine: "subscription", messageCount: 2, actionCount: 0, pages: [{ url, title: ptitle }], preview: answer }, events });
  }
  return convs;
}

const MEMORY = `# About Maya

- Product designer at **Northwind**, on the Atlas product. Based in Lisbon.
- Taking an evening course in **Data Visualisation** at Riverside Academy.
- Volunteers with the **Harbor Garden Club** on Saturdays.
- Learning **Portuguese**, about A2.

## Preferences
- Short, direct answers. British spelling. No emoji.
- Ask before sending email or submitting forms.
`;

const PROFILE = {
  name: "Maya",
  about: "- Product designer at Northwind (Atlas), based in Lisbon\n- Evening course in Data Visualisation\n- Mail in Gmail, work chat in Slack\n- Short answers; tables when comparing things",
  spaceHints: {
    "{sp-personal}": "Personal: my course, Portuguese, life admin.",
    "{sp-work}": "Northwind work: Atlas, Figma, Linear, Vercel. Use my work accounts.",
    "{sp-garden}": "Harbor Garden Club volunteering.",
  },
};

// ---- fake browser for the new-tab search box ---------------------------------

const BOOKMARKS = [
  { title: "Google", url: "https://www.google.com/" },
  { title: "Riverside Academy", url: "https://learn.example.edu/" },
  { title: "Vercel · Northwind", url: "https://vercel.com/northwind" },
  { title: "Portuguese practice", url: "https://lingo.example.com/" },
];
const HISTORY = [
  { title: "Google", url: "https://www.google.com/", visitCount: 120 },
  { title: "Google URL Shortener", url: "https://goo.gl/", visitCount: 3 },
  { title: "Goodreads", url: "https://www.goodreads.com/", visitCount: 12 },
  { title: "Photos - Google Photos", url: "https://photos.google.com/", visitCount: 14 },
  { title: "Google Maps", url: "https://www.google.com/maps", visitCount: 22 },
  { title: "Gmail", url: "https://mail.google.com/mail/u/0/#inbox", visitCount: 300 },
  { title: "GitHub · northwind-labs/atlas-web", url: "https://github.com/northwind-labs/atlas-web", visitCount: 40 },
  { title: "Small multiple - Wikipedia", url: "https://en.wikipedia.org/wiki/Small_multiple", visitCount: 6 },
  { title: "Data Visualisation · Riverside Academy", url: "https://learn.example.edu/courses/data-visualisation", visitCount: 9 },
  { title: "Northbank Online Banking", url: "https://online.northbank.example.com/", visitCount: 30 },
];

/** Records what the page asked the browser to do: __ensoMockNav */
export const mockBrowser = {
  async tabs() { return TABS.map(t => ({ tabId: t.tabId, windowId: 1, title: t.title, url: t.url, favIconUrl: t.favIconUrl })); },
  async bookmarks(q) { const l = q.toLowerCase(); return BOOKMARKS.filter(b => `${b.title} ${b.url}`.toLowerCase().includes(l)); },
  async history(q) { const l = q.toLowerCase(); return HISTORY.filter(h => `${h.title} ${h.url}`.toLowerCase().includes(l)); },
  async engine() { return "Google"; },
  async suggestions(q, kind, signal) {
    await new Promise((resolve, reject) => { const t = setTimeout(resolve, 140); signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); }); });
    const l = q.toLowerCase();
    const bank = ["what to do in lisbon this weekend", "what is a small multiple", "what time is it in tokyo", "what to plant in november", "small multiples vs facets", "small multiples tufte", "small multiples d3", "google maps", "google translate", "google scholar"];
    const hits = bank.filter(x => x.startsWith(l.split(" ")[0]));
    return hits.length ? hits.slice(0, 4) : [`${l} meaning`, `${l} example`, `${l} reddit`];
  },
  async open(url) { record({ action: "open", url }); },
  async search(query) { record({ action: "search", query }); },
  async switchTo(tabId) { record({ action: "switch", tabId }); },
};
function record(entry) {
  (globalThis.__ensoMockNav ??= []).push(entry);
  console.info("[mock browser]", entry);
}

function tabOut(t) {
  if (!t) return null;
  const { spaceId, ...rest } = t;
  return rest;
}

// ---- host ---------------------------------------------------------------

// GitHub (built in): fictional accounts, orgs and repos only.
const GH_TOOLS = ["github_my_work", "github_search", "github_notifications", "github_pr", "github_issue", "github_repo", "github_comment", "github_review", "github_set_labels", "github_set_assignees", "github_close_reopen", "github_mark_notifications_read"];
function githubEntry(connected) {
  return { name: "github", label: "GitHub", status: connected ? "connected" : "needs-auth", enabled: true, tools: GH_TOOLS.length, toolNames: GH_TOOLS, source: "built in", connectUrl: "https://github.com/settings/tokens",
    detail: connected ? "Connected through GitHub CLI as sample-user" : "Not connected: run `gh auth login` or paste a token", tokenEntry: !connected,
    about: "Your pull requests, reviews, issues and notifications across all your orgs and repos (through the GitHub CLI's sign-in). Comments, reviews, labels and closing ask first unless you asked.",
    examples: ["What's waiting on me on GitHub?", "Why is CI failing on my Northwind PR?", "Which of my PRs have changes requested?"] };
}
function githubWidget() {
  const pr = (repo, number, title, mins, extra = {}) => ({ kind: "pr", repo, number, title, url: `https://github.com/${repo}/pull/${number}`, updatedAt: iso(now() - mins * MIN), ci: "SUCCESS", review: null, conflict: false, draft: false, ...extra });
  const issue = (repo, number, title, mins) => ({ kind: "issue", repo, number, title, url: `https://github.com/${repo}/issues/${number}`, updatedAt: iso(now() - mins * MIN), ci: null, review: null, conflict: false, draft: false });
  const review = [pr("northwind-labs/atlas-api", 212, "Rate-limit the export endpoint per workspace", 40), pr("acme-garden/greenhouse", 88, "Move sensor polling to a background queue", 190)];
  const mine = [
    pr("northwind-labs/atlas-web", 431, "Settings: keyboard shortcuts panel", 25, { ci: "FAILURE" }),
    pr("acme-garden/greenhouse", 91, "Seed data for the demo greenhouse", 300, { review: "CHANGES_REQUESTED" }),
    pr("sample-user/dotfiles", 14, "Switch the shell prompt to a two-line layout", 1500, { conflict: true }),
  ];
  const assigned = [issue("northwind-labs/atlas-api", 207, "Exports time out for workspaces over 10k rows", 600), issue("acme-garden/greenhouse", 76, "Humidity chart skips readings after midnight", 2900), issue("northwind-labs/atlas-web", 402, "Dark mode: table borders too faint", 4300)];
  return { login: "sample-user", review, mine, assigned, counts: { review: review.length, mine: mine.length, authored: 9, assigned: 7 }, fetchedAt: iso(now() - 2 * MIN) };
}

export function createMockHost() {
  const listeners = new Set();
  const out = msg => setTimeout(() => listeners.forEach(fn => fn(structuredClone(msg))), 0);

  const settings = {
    engine: "subscription",
    model: "claude-opus-5-5",
    effort: "medium",
    includePageByDefault: true,
    autoApproveReadOnly: true,
    alwaysAllowedTools: ["mcp__lingo__search_dictionary", "mcp__learn__search_guide", "mcp__claude_ai_Gmail__search_threads"],
    dashboard: { autoRefreshMinutes: 60 },
    developerTools: true,
    headless: true,
    sessionAccess: { "https://github.com": "allow", "http://localhost:3000": "allow" },
  };
  const engines = {
    subscription: { available: true, label: "Claude subscription (Claude Code)", path: "/Users/maya/.local/bin/claude", version: "2.1.321 (Claude Code)" },
    api: { available: false, label: "Anthropic API key (none in Keychain)" },
  };
  const CONNECT = "https://claude.ai/customize/connectors";
  const servers = [
    { name: "claude.ai Gmail", label: "Gmail", status: "connected", enabled: true, tools: 12, source: "claude.ai connector", connectUrl: CONNECT,
      toolNames: ["search_threads", "get_thread", "get_message", "create_draft", "update_draft", "list_drafts", "list_labels", "label_thread", "reply", "forward", "trash_thread", "send_message"],
      about: "Search, read and draft email in your Google account.", examples: ["What needs a reply from me today?", "Draft a reply to the last mail from Jonas"] },
    { name: "claude.ai Google Calendar", label: "Calendar", status: "connected", enabled: true, tools: 9, source: "claude.ai connector", connectUrl: CONNECT,
      toolNames: ["list_events", "get_event", "create_event", "update_event", "delete_event", "respond_to_event", "search_events", "suggest_time", "list_calendars"],
      about: "Your Google Calendar: events, free time, scheduling.", examples: ["What's on tomorrow?", "Find an hour for deep work this week"] },
    { name: "claude.ai Google Drive", label: "Drive", status: "connected", enabled: true, tools: 15, source: "claude.ai connector", connectUrl: CONNECT,
      toolNames: ["search_files", "read_file_content", "get_file_metadata", "list_recent_files", "download_file_content", "create_file", "update_file", "copy_file", "share_file", "trash_file"],
      about: "Find and read files in Google Drive.", examples: ["Find my notes from the design critique", "Summarise the latest launch budget sheet"] },
    { name: "claude.ai Google Docs", label: "Docs", status: "connected", enabled: true, tools: 2, source: "claude.ai connector", connectUrl: CONNECT,
      toolNames: ["read_doc", "update_doc"], about: "Read and edit Google Docs.", examples: ["Tighten the intro of my assignment write-up"] },
    { name: "claude.ai Notion", label: "Notion", status: "needs-auth", enabled: true, tools: 0, source: "claude.ai connector", connectUrl: CONNECT, toolNames: [],
      about: "Search and edit Notion pages.", examples: [] },
    { name: "learn", label: "Course hub", status: "connected", enabled: true, tools: 14, source: "MCP server", connectUrl: "https://learn.example.edu/settings",
      toolNames: ["course_overview", "list_assignments", "search_guide", "get_material", "get_progress", "due_reviews", "plan_week", "list_past_quizzes", "recall", "remember"],
      about: "Your Riverside Academy courses: assignments, deadlines, materials.", examples: ["What's due this week?", "Quiz me on interview techniques"] },
    { name: "lingo", label: "Portuguese tutor", status: "connected", enabled: true, tools: 8, source: "MCP server", connectUrl: null,
      toolNames: ["search_dictionary", "dictionary_entry", "learner_decks", "learner_recent_reviews", "learner_practice_insights", "course_vocab", "course_grammar", "textbook_search"],
      about: "Your Portuguese decks, reviews and dictionary.", examples: ["Start a short review", "What does saudade mean?"] },
    githubEntry(true),
    { name: "fieldnotes", label: "Fieldnotes", status: "needs-auth", enabled: true, tools: 0, source: "MCP server", connectUrl: null, toolNames: [],
      about: "Your Fieldnotes workspace: search and read notes, see tasks; create and update notes and tasks, save to your Inbox.",
      examples: ["What's in my Fieldnotes inbox?", "Which tasks are due this week?"],
      auth: { type: "oauth", state: "disconnected", custom: false, url: "https://fieldnotes.example.com/mcp" } },
  ];
  const mondayMode = new URLSearchParams(globalThis.location?.search ?? "").get("monday") ?? "ok";
  servers.push({ name: "monday", label: "monday.com", status: mondayMode === "ok" ? "connected" : mondayMode === "down" ? "failed" : "needs-auth", enabled: true,
    tools: mondayMode === "ok" ? MONDAY_TOOLS.length : 0, toolNames: mondayMode === "ok" ? MONDAY_TOOLS : [], source: "MCP server", connectUrl: null,
    about: "Your monday.com boards, items, updates and docs (monday's own MCP server; you sign in with your monday account).", examples: ["What's assigned to me on monday.com this week?"],
    ...(mondayMode === "down" ? { error: "The server returned a server error (HTTP 500)." } : {}),
    auth: { type: "oauth", state: mondayMode === "off" ? "disconnected" : "connected", custom: true, url: "https://mcp.monday.com/mcp" } });
  const mondayData = () => {
    const sv = servers.find(x => x.name === "monday");
    if (!sv || sv.auth.state !== "connected") return { state: "not-connected", reason: sv ? sv.auth.state : "missing", fetchedAt: iso(now()) };
    if (sv.status === "failed") return { state: "error", kind: "server", error: "monday.com isn't responding (server error).", fetchedAt: iso(now()) };
    return { ...mondayItems, fetchedAt: iso(now()) };
  };
  let mondayItems = makeMonday();
  // Servers Ensō signs in to itself (connections.*): a pretend sign-in that "finishes" after a moment.
  // ?connect=connected | expired | error | connecting in the page URL starts Fieldnotes in that state.
  const MOCK_TOOLS = ["search_notes", "get_note", "create_note", "update_note", "list_tasks", "create_task", "update_task", "save_to_inbox"];
  const preset = new URLSearchParams(globalThis.location?.search ?? "").get("connect");
  if (preset) {
    const cf = servers.find(x => x.name === "fieldnotes");
    cf.auth = { ...cf.auth, state: preset, ...(preset === "error" ? { error: "The server rejected the sign-in (invalid_client)." } : {}), ...(preset === "connecting" ? { authUrl: "https://auth.example.com/authorize?client_id=demo" } : {}) };
    if (preset === "connected") Object.assign(cf, { status: "connected", tools: MOCK_TOOLS.length, toolNames: MOCK_TOOLS });
  }
  const connectionsList = () => servers.filter(x => x.auth).map(x => ({ server: x.name, label: x.label, url: x.auth.url, custom: x.auth.custom, state: x.auth.state, ...(x.auth.error ? { error: x.auth.error } : {}), ...(x.auth.authUrl ? { authUrl: x.auth.authUrl } : {}) }));
  const sendConnections = done => {
    out({ type: "servers", servers });
    out({ type: "connections", connections: connectionsList(), ...(done ? { done } : {}) });
  };
  function mockConnect(sv) {
    sv.auth = { ...sv.auth, state: "connecting", authUrl: "https://auth.example.com/authorize?client_id=demo" };
    delete sv.auth.error;
    sv.status = "pending";
    sendConnections();
    setTimeout(() => {
      sv.auth = { ...sv.auth, state: "connected" };
      delete sv.auth.authUrl;
      Object.assign(sv, { status: "connected", tools: MOCK_TOOLS.length, toolNames: sv.auth.custom ? ["echo"] : MOCK_TOOLS });
      sendConnections({ server: sv.name, ok: true });
    }, 1600);
  }

  let openTasks = makeTasks();
  const tasksData = () => {
    const fn = servers.find(x => x.name === "fieldnotes");
    const on = fn?.status === "connected";
    return { tasks: on ? openTasks : [], servers: on ? [{ name: "fieldnotes", label: "Fieldnotes", ok: true }] : [], fetchedAt: iso(now()) };
  };

  const data = buildSeed();
  const SEED_SPACES = { "c-jonas": "{sp-work}", "c-portuguese": "{sp-personal}", "c-garden": "{sp-garden}", "c-deploy": "{sp-work}", "c-viz": "{sp-personal}", "c-flash": "{sp-personal}" };
  for (const c of data) c.summary.space = spaceRef(SEED_SPACES[c.summary.id] ?? SPACES[0].id);
  const convs = new Map(data.map(c => [c.summary.id, c]));
  let memory = MEMORY;
  const spaceMemory = {
    "{sp-work}": "# Northwind\n\n- Atlas 2.0 beta on the 20th; onboarding redesign is mine.\n- Stand-up at 13:00 on weekdays.\n- Deploys go through Vercel; envs: Preview and Production.\n",
    "{sp-garden}": "# Garden club\n\n- Saturdays 10:00–12:00.\n- Planning the spring planting plan.\n",
    "{sp-personal}": "# Personal\n\n- Courses: Data Visualisation, UX Research Methods.\n",
    "{sp-travel}": "",
  };
  const onboarding = new URLSearchParams(globalThis.location?.search ?? "").has("onboarding");
  let profile = onboarding ? { name: "", about: "", spaceHints: {} } : { ...PROFILE };
  let onboardingDone = !onboarding;
  const profileState = () => ({
    ...profile,
    summary: profile.about.split("\n").map(l => l.replace(/^[-*]\s+/, "").trim()).find(Boolean) ?? "",
    set: !!profile.name,
    onboarding: !profile.name && !onboardingDone,
  });
  // What the helper reports per system (lib/platform.mjs); ?platform= picks one.
  const MOCK_OS = new URLSearchParams(globalThis.location?.search ?? "").get("platform") || "mac";
  const OS_FACTS = {
    mac: { data: "/Users/maya/Library/Application Support/Enso", logs: "/Users/maya/Library/Logs/Enso", sep: "/", secrets: { backend: "keychain", location: "your macOS login Keychain", secure: true, warning: null }, claude: "/Users/maya/.local/bin/claude", node: "/opt/homebrew/bin/node", platform: "darwin arm64", launcher: "bin/enso" },
    linux: { data: "/home/maya/.local/share/enso", logs: "/home/maya/.local/state/enso", sep: "/", secrets: { backend: "libsecret", location: "your desktop keyring (libsecret)", secure: true, warning: null }, claude: "/home/maya/.local/bin/claude", node: "/usr/bin/node", platform: "linux x64", launcher: "bin/enso" },
    win: { data: "C:\\Users\\Maya\\AppData\\Roaming\\Enso", logs: "C:\\Users\\Maya\\AppData\\Local\\Enso\\Logs", sep: "\\", secrets: { backend: "credman", location: "the Windows Credential Manager", secure: true, warning: null }, claude: "C:\\Users\\Maya\\.local\\bin\\claude.exe", node: "C:\\Users\\Maya\\AppData\\Roaming\\Enso\\runtime\\node-v24.22.2-win-x64\\node.exe", platform: "win32 x64", launcher: "bin\\enso.cmd" },
  };
  // ?secrets=file: Linux without a keyring (the file fallback and its warning).
  if (MOCK_OS === "linux" && new URLSearchParams(globalThis.location?.search ?? "").get("secrets") === "file") {
    OS_FACTS.linux.secrets = { backend: "file", location: "/home/maya/.local/share/enso/secrets.json", secure: false, warning: "No system keyring: secret-tool isn't installed (it comes with libsecret-tools / libsecret). Sign-ins and keys are kept in /home/maya/.local/share/enso/secrets.json (readable only by you). Install libsecret-tools and run a keyring (GNOME Keyring, KWallet, KeePassXC) for better protection, then save them again." };
  }
  const OSF = OS_FACTS[MOCK_OS] ?? OS_FACTS.linux;
  const PATHS = { data: OSF.data, localConfig: `${OSF.data}${OSF.sep}config.local.json` };
  let dashboard = makeDashboard();
  const turns = new Map(); // conversationId → { cancelled, finish }
  const approvalWaiters = new Map();


  const summaries = () => [...convs.values()].map(c => c.summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  function allActions() {
    const list = [];
    for (const c of convs.values()) {
      for (const e of c.events) {
        if (e.kind === "page.action") list.push({ id: e.id, at: e.at, conversationId: c.summary.id, url: e.url, title: e.title, host: new URL(e.url).hostname, action: e.action, target: e.target, ok: e.ok });
      }
    }
    // a few older ones for a fuller log
    list.push(
      { id: "a-old1", at: iso(now() - 6 * 24 * HOUR), conversationId: "c-deploy", url: "https://vercel.com/northwind/atlas-web/deployments", title: "Deployments · Vercel", host: "vercel.com", action: "navigate", target: "Deployments tab", ok: true },
      { id: "a-old2", at: iso(now() - 6 * 24 * HOUR + 4000), conversationId: "c-deploy", url: "https://vercel.com/northwind/atlas-web/deployments", title: "Deployments · Vercel", host: "vercel.com", action: "click", target: "Show build log", ok: true },
      { id: "a-old3", at: iso(now() - 15 * 24 * HOUR), conversationId: "c-flash", url: "https://learn.example.edu/courses/ux-research/files", title: "Files · UX Research Methods", host: "learn.example.edu", action: "click", target: "Week 5 – Interviews.pdf", ok: false },
    );
    return list.sort((a, b) => b.at.localeCompare(a.at));
  }

  function emitEvent(conversationId, event) {
    const c = convs.get(conversationId);
    const full = { id: nid("e"), at: iso(now()), ...event };
    if (!full.kind.endsWith(".delta")) c?.events.push(full);
    out({ type: "event", conversationId, event: full });
    return full;
  }

  async function runTurn(conversationId, msg) {
    const { includePage, skill } = msg;
    const text = skill ? `/${skill}${msg.text ? ` ${msg.text}` : ""}` : msg.text;
    const c = convs.get(conversationId);
    const turn = { cancelled: false };
    turns.set(conversationId, turn);
    const alive = () => !turn.cancelled;
    const tab = activeTab();
    const page = includePage && tab && !tab.sensitive ? { url: tab.url, title: tab.title } : null;
    const MOCK_TAB = tab ?? TABS[3];
    const mentioned = (msg.mentionedTabIds ?? []).map(id => TABS.find(t => t.tabId === id)).filter(Boolean).map(t => ({ url: t.url, title: t.title }));

    emitEvent(conversationId, { kind: "turn.start" });
    emitEvent(conversationId, {
      kind: "user", text, page,
      ...(mentioned.length && { tabs: mentioned }),
      ...(msg.attachments?.length && { attachments: msg.attachments.map(a => ({ name: a.name, mimeType: a.mimeType })) }),
      ...(msg.attachScreenshot && { screenshot: true }),
    });
    if (c.summary.title === "New conversation") {
      c.summary.title = text.length > 48 ? `${text.slice(0, 46).trim()}…` : text;
    }
    if (page && !c.summary.pages.some(p => p.url === page.url)) c.summary.pages.push(page);
    c.summary.messageCount++;
    c.summary.updatedAt = iso(now());
    out({ type: "conversation.updated", conversation: c.summary });

    let assistantText = "";
    const streamThinking = async t => {
      const mid = nid("m");
      for (const chunk of t.match(/\S+\s*/g)) {
        if (!alive()) return;
        out({ type: "event", conversationId, event: { kind: "thinking.delta", messageId: mid, text: chunk, at: iso(now()) } });
        await sleep(18);
      }
      if (alive()) emitEvent(conversationId, { kind: "thinking", messageId: mid, text: t });
    };
    const streamAnswer = async t => {
      const mid = nid("m");
      const parts = t.match(/\S+\s*|\n/g) ?? [];
      for (const chunk of parts) {
        if (!alive()) break;
        assistantText += chunk;
        out({ type: "event", conversationId, event: { kind: "assistant.delta", messageId: mid, text: chunk, at: iso(now()) } });
        await sleep(chunk.includes("\n") ? 40 : 22);
      }
      if (alive()) emitEvent(conversationId, { kind: "assistant", messageId: mid, text: t });
    };
    const tool = async (call, result, ms = 700) => {
      const toolUseId = nid("tu");
      emitEvent(conversationId, { kind: "tool.call", toolUseId, ...call });
      await sleep(ms);
      if (!alive()) return toolUseId;
      emitEvent(conversationId, { kind: "tool.result", toolUseId, ok: true, durationMs: ms, ...result });
      return toolUseId;
    };
    const end = (extra = {}) => {
      turns.delete(conversationId);
      emitEvent(conversationId, { kind: "turn.end", ...extra });
      c.summary.updatedAt = iso(now());
      c.summary.messageCount++;
      if (assistantText) c.summary.preview = assistantText.split("\n").find(l => l.trim())?.replace(/[*#>|]/g, "").trim().slice(0, 140) ?? "";
      out({ type: "conversation.updated", conversation: c.summary });
    };
    turn.finish = () => {
      if (assistantText) emitEvent(conversationId, { kind: "assistant", text: assistantText });
      else {
        // a thinking stream that was cut off still gets folded
      }
      emitEvent(conversationId, { kind: "notice", text: "Stopped. The answer above is incomplete." });
      end({ stopped: true });
    };

    await sleep(250);
    if (/\berror\b|api key/i.test(text) || settings.engine === "api") {
      emitEvent(conversationId, { kind: "error", code: "no_api_key", text: "No Anthropic API key found in the Keychain (service enso-anthropic)." });
      end();
      return;
    }

    if (/session|signed.?in|api/i.test(text)) {
      const id = nid("tu");
      const input = { url: "https://vercel.com/api/v2/user", method: "GET" };
      emitEvent(conversationId, { kind: "tool.call", toolUseId: id, category: "page", server: "Browser", tool: "session_fetch", title: "Request with the user's session", input });
      emitEvent(conversationId, { kind: "approval.request", toolUseId: id, server: "Browser", tool: "session_fetch", title: "GET https://vercel.com with your session", input, reason: "Claude wants to use your signed-in session on vercel.com.", alwaysLabel: "Always allow on this site" });
      const decision = await new Promise(resolve => approvalWaiters.set(id, resolve));
      if (!alive()) return;
      emitEvent(conversationId, { kind: "approval.resolved", toolUseId: id, decision });
      if (decision === "always") settings.sessionAccess = { ...settings.sessionAccess, "https://vercel.com": "allow" };
      emitEvent(conversationId, { kind: "tool.result", toolUseId: id, ok: decision !== "deny", preview: decision === "deny" ? "Declined by the user." : "GET https://vercel.com/api/v2/user → 200 OK", durationMs: 300 });
      await streamAnswer(decision === "deny" ? "Okay, I won't use your session there." : "You're signed in to Vercel as **maya-lindqvist**.");
      if (alive()) end({ usage: { inputTokens: 9000, outputTokens: 40 } });
      return;
    }

    if (/form|click|fill|submit|page/i.test(text)) {
      await streamThinking("The user wants me to act on the current page. I'll take a snapshot first, fill the fields, and ask before clicking Register since that submits the form.");
      if (!alive()) return;
      await tool({ category: "page", server: "page", tool: "snapshot", title: "Read the page", input: {} }, { preview: "Event page with 'Register for the workshop' form: Email, Session (select), Notes (textarea), Register button." }, 500);
      if (!alive()) return;
      const typeId = nid("tu");
      emitEvent(conversationId, { kind: "tool.call", toolUseId: typeId, category: "page", server: "page", tool: "type", title: "Type into “Email”", input: { ref: "e7", text: "maya@example.com" } });
      await sleep(350);
      if (!alive()) return;
      emitEvent(conversationId, { kind: "page.action", toolUseId: typeId, url: MOCK_TAB.url, title: MOCK_TAB.title, action: "type", target: "Email", ok: true });
      emitEvent(conversationId, { kind: "tool.result", toolUseId: typeId, ok: true, preview: "Typed 16 characters into “Email”.", durationMs: 350 });
      c.summary.actionCount++;
      const clickId = nid("tu");
      const input = { ref: "e12", element: "button “Register”" };
      emitEvent(conversationId, { kind: "tool.call", toolUseId: clickId, category: "page", server: "page", tool: "click", title: "Click “Register”", input });
      emitEvent(conversationId, { kind: "approval.request", toolUseId: clickId, server: "page", tool: "click", title: "Click “Register”", input, reason: "Submits a form on events.example.com." });
      const decision = await new Promise(resolve => approvalWaiters.set(clickId, resolve));
      if (!alive()) return;
      emitEvent(conversationId, { kind: "approval.resolved", toolUseId: clickId, decision });
      if (decision === "always") settings.alwaysAllowedTools = [...new Set([...settings.alwaysAllowedTools, "page__click"])];
      if (decision === "deny") {
        emitEvent(conversationId, { kind: "tool.result", toolUseId: clickId, ok: false, preview: "Declined by the user.", durationMs: 0 });
        await streamAnswer("Okay, I didn't submit anything. The **Email** field is filled in; you can review the form and press *Register* yourself.");
      } else {
        await sleep(400);
        emitEvent(conversationId, { kind: "page.action", toolUseId: clickId, url: MOCK_TAB.url, title: MOCK_TAB.title, action: "click", target: "Register", ok: true });
        emitEvent(conversationId, { kind: "tool.result", toolUseId: clickId, ok: true, preview: "Clicked “Register”. Page shows “Registration received”.", durationMs: 420 });
        c.summary.actionCount++;
        await streamAnswer("Done: I filled in your **email** and pressed **Register**. The page now says *Registration received*.\n\nA confirmation email should arrive within a day.");
      }
      if (alive()) end({ usage: { inputTokens: 11200, outputTokens: 180 } });
      return;
    }

    await streamThinking("Maya is asking about her day. I'll check Gmail for anything urgent and today's calendar, then summarise with a small table so it's scannable. Keep it short, British spelling.");
    if (!alive()) return;
    await tool({ category: "mcp", server: "gmail", tool: "search_threads", title: "Search Gmail", input: { query: "is:unread newer_than:2d", maxResults: 10 } }, { preview: "3 threads\n1. Jonas Berg: Re: Atlas 2.0 beta date\n2. Vercel: Deployment failed: atlas-web on production\n3. Harbor Garden Club: Volunteer rota for December" }, 900);
    if (!alive()) return;
    await tool({ category: "mcp", server: "google-calendar", tool: "list_events", title: "List today's events", input: { timeMin: today(0), timeMax: today(23, 59) } }, { preview: "4 events: 09:30 Design critique; 13:00 Northwind stand-up; 16:00 Garden club planning call; 19:30 Portuguese practice" }, 600);
    if (!alive()) return;
    await streamAnswer(`Here's what matters today:

| When | What | Note |
|---|---|---|
| 09:30 | Design critique: onboarding flows | Room 3 |
| 13:00 | Northwind stand-up | mention the **atlas-web** build |
| 16:00 | Garden club planning call | planting plan slides not finished |
| 19:30 | Portuguese practice | 12 cards due |

**Mail that needs you**
1. **Jonas** wants a confirmation about the beta date by Wednesday.
2. **Vercel**: the atlas-web deploy failed at 07:12. The log points at a missing \`NEXT_PUBLIC_API_URL\` in Production.
3. **Harbor Garden Club**: the December rota form closes Friday.

Want me to draft the reply to Jonas, or open the [Vercel deployment](https://vercel.com/)?`);
    if (alive()) end({ usage: { inputTokens: 14873, outputTokens: 356, costUsd: 0.09 } });
  }

  // ---- external agents (agent card, Agents row) ----
  const agentPreset = new URLSearchParams(globalThis.location?.search ?? "").get("agents");
  const ago = sec => iso(now() - sec * 1000);
  const step = (sec, tool, title, target, extra = {}) => ({ id: nid("st"), at: ago(sec), tool, title, target, ok: true, irreversible: false, ...extra });
  let agents = [];
  if (agentPreset) {
    if (agentPreset !== "list") activeTabId = 16;
    const docs = {
      id: "ag-docs", client: "Claude Code", clientName: "claude-code", task: "Draft the methods section of the Assignment 3 brief", tabId: 16,
      url: "https://docs.google.com/document/d/1x9/edit", title: "Assignment 3 brief: small multiples · Google Docs",
      startedAt: ago(194), lastAt: ago(2), endsAt: iso(now() + 118_000), running: true, paused: false, stopped: false, explicit: true, idleMs: 2000,
      actions: [
        step(190, "session_start", "Start a session", ""),
        step(184, "page_read", "Read the page", ""),
        step(150, "page_click", "Click", 'textbox "Document body"'),
        step(96, "page_type", "Type", "Google Docs document body (at the cursor)", { typed: "Methods. We compared six small-multiple…" }),
        step(41, "page_eval", "Run JavaScript", "JavaScript: document.querySelectorAll('.kix-paragraphrenderer').length"),
        step(12, "page_click", "Click", 'button "Share"', { irreversible: false }),
        step(2, "page_click", "Click", 'button "Send"', { irreversible: true }),
      ],
      notes: [],
    };
    const codex = {
      id: "ag-ci", client: "Codex", clientName: "codex-mcp-client", task: "Find why CI fails on PR #431", tabId: 13,
      url: "https://github.com/northwind-labs/atlas-web/pull/431", title: "Settings: keyboard shortcuts panel · Pull Request #431",
      startedAt: ago(420), lastAt: ago(25), endsAt: iso(now() + 95_000), running: false, paused: false, stopped: false, explicit: true, idleMs: 25000,
      actions: [step(400, "page_read", "Read the page", ""), step(25, "devtools_network", "Network requests", "")], notes: [],
    };
    const cursor = {
      id: "ag-travel", client: "Cursor", clientName: "cursor-vscode", task: "", tabId: 20,
      url: "https://www.airbnb.com/rooms/porto", title: "Weekend in Porto · Airbnb",
      startedAt: ago(70), lastAt: ago(8), endsAt: iso(now() + 112_000), running: true, paused: false, stopped: false, explicit: false, idleMs: 8000,
      actions: [step(8, "page_scroll", "Scroll", "")], notes: [],
    };
    if (agentPreset === "paused") Object.assign(docs, { paused: true, running: false, notes: [{ id: "n1", text: "Use the second dataset, not the pilot one.", at: ago(20), deliveredAt: null }] });
    if (agentPreset === "delivered") docs.notes = [{ id: "n1", text: "Use the second dataset, not the pilot one.", at: ago(60), deliveredAt: ago(41) }, { id: "n2", text: "Keep it under 300 words.", at: ago(6), deliveredAt: null }];
    if (agentPreset === "idle") Object.assign(docs, { running: false, actions: [step(5, "session_start", "Start a session", "")], startedAt: ago(5), lastAt: ago(5) });
    if (agentPreset === "stopped") Object.assign(docs, { running: false, stopped: true });
    if (agentPreset === "t3") Object.assign(docs, { client: "Claude Code", task: "Fix the chart legend overlap on the launch dashboard", t3ThreadId: "th-legend", t3: { threadId: "th-legend", title: "Launch dashboard: legend overlaps the chart", projectTitle: "atlas-web", openable: true } });
    agents = agentPreset === "list" ? [docs, codex, cursor] : agentPreset === "idle" || agentPreset === "t3" ? [docs] : [docs, codex];
  }
  // ---- send screenshot: T3 Code threads, connected agents, links ----
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  const t3Preset = params.get("t3");
  const shotPreset = params.get("shot");
  const t3Status = () => ({ cli: true, origin: "http://127.0.0.1:3773", reachable: t3Preset !== "down", connected: t3Preset !== "off", tokenValid: t3Preset === "revoked" ? false : t3Preset === "off" ? null : true, environmentId: "env-maya", serverVersion: "0.1.9-nightly", label: "Maya’s MacBook Pro", route: t3Preset === "fallback" ? "path" : "attachment", attachments: t3Preset !== "fallback", expiresAt: iso(now() + 29 * 86_400_000), error: t3Preset === "revoked" ? "T3 Code no longer accepts Ensō's token (it expired or was revoked). Connect again in Settings → T3 Code." : t3Preset === "down" ? "T3 Code isn't running. Open T3 Code and try again." : null });
  let t3State = t3Status();
  const T3_THREADS = [
    { id: "th-legend", title: "Launch dashboard: legend overlaps the chart", projectId: "p-atlas", projectTitle: "atlas-web", status: "running", running: true, waiting: false, activeAt: ago(40) },
    { id: "th-onboard", title: "Onboarding step 3 copy and empty state", projectId: "p-atlas", projectTitle: "atlas-web", status: "waiting", running: false, waiting: true, activeAt: ago(300) },
    { id: "th-a11y", title: "Keyboard shortcuts panel: focus order", projectId: "p-atlas", projectTitle: "atlas-web", status: "completed", running: false, waiting: false, activeAt: ago(3600) },
    { id: "th-viz", title: "Small multiples for Assignment 3", projectId: "p-course", projectTitle: "data-vis-course", status: "idle", running: false, waiting: false, activeAt: ago(7200) },
    { id: "th-garden", title: "Planting plan slides: export as PDF", projectId: "p-garden", projectTitle: "garden-club", status: "completed", running: false, waiting: false, activeAt: ago(26 * 3600) },
    { id: "th-ci", title: "CI flakes on the settings e2e suite", projectId: "p-atlas", projectTitle: "atlas-web", status: "idle", running: false, waiting: false, activeAt: ago(30 * 3600) },
  ];
  const T3_PROJECTS = [{ id: "p-atlas", title: "atlas-web", repo: "github.com/northwind-labs/atlas-web" }, { id: "p-course", title: "data-vis-course", repo: "" }, { id: "p-garden", title: "garden-club", repo: "" }];
  const connectedAgents = () => [
    { id: "ag-claude", client: "Claude Code", clientName: "claude-code", task: agents.find(a => a.client === "Claude Code")?.task ?? "Refactor the chart tooltip", tabIds: agents.filter(a => a.client === "Claude Code").map(a => a.tabId), sessionIds: [], active: true, t3ThreadId: null, lastAt: ago(4), pending: 0 },
    { id: "ag-opencode", client: "OpenCode", clientName: "opencode", task: "", tabIds: [], sessionIds: [], active: false, t3ThreadId: null, lastAt: ago(900), pending: 0 },
  ];
  if (params.get("links")) settings.sendLinks = { tabs: [{ tabId: 13, host: "github.com", kind: "t3", id: "th-a11y", title: "Keyboard shortcuts panel: focus order", pageTitle: "Settings: keyboard shortcuts panel · Pull Request #431", at: ago(600) }, { tabId: 16, host: "docs.google.com", kind: "agent", id: "ag-claude", title: "Claude Code", pageTitle: "Assignment 3 brief: small multiples · Google Docs", at: ago(1200) }], hosts: { "localhost:5173": { projectId: "p-atlas", projectTitle: "atlas-web", at: ago(86400) }, "atlas.northwind.example.com": { projectId: "p-atlas", projectTitle: "atlas-web", at: ago(3 * 86400) } } };

  function fakeScreenshot(tab) {
    const c = document.createElement("canvas");
    c.width = 1280; c.height = 760;
    const g = c.getContext("2d");
    g.fillStyle = "#f6f7f9"; g.fillRect(0, 0, 1280, 760);
    g.fillStyle = "#1f2430"; g.fillRect(0, 0, 1280, 56);
    g.fillStyle = "#fff"; g.font = "600 20px -apple-system, Helvetica"; g.fillText("Atlas · Launch dashboard", 28, 36);
    g.fillStyle = "#fff"; g.fillRect(28, 84, 820, 420); g.strokeStyle = "#e3e6ea"; g.strokeRect(28.5, 84.5, 820, 420);
    g.fillStyle = "#1f2430"; g.font = "600 16px -apple-system, Helvetica"; g.fillText("Weekly sign-ups", 52, 118);
    const series = [["#d9643a", [60, 90, 120, 150, 210, 260, 300]], ["#5b7a8c", [40, 70, 80, 120, 140, 170, 230]], ["#8a9a5b", [20, 30, 60, 70, 90, 120, 150]]];
    for (const [col, vals] of series) { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); vals.forEach((v, i) => { const x = 70 + i * 120, y = 470 - v; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
    g.fillStyle = "rgba(255,255,255,.92)"; g.fillRect(600, 150, 220, 96); g.strokeStyle = "#c0412c"; g.setLineDash([6, 4]); g.strokeRect(600.5, 150.5, 220, 96); g.setLineDash([]);
    g.font = "13px -apple-system, Helvetica"; series.forEach(([col], i) => { g.fillStyle = col; g.fillRect(616, 168 + i * 26, 14, 14); g.fillStyle = "#333"; g.fillText(["Organic", "Referral", "Paid"][i], 640, 180 + i * 26); });
    g.fillStyle = "#fff"; g.fillRect(876, 84, 376, 200); g.strokeStyle = "#e3e6ea"; g.strokeRect(876.5, 84.5, 376, 200);
    g.fillStyle = "#1f2430"; g.font = "600 16px -apple-system, Helvetica"; g.fillText("Conversion", 900, 118); g.font = "700 44px -apple-system, Helvetica"; g.fillText("4.8%", 900, 190);
    g.fillStyle = "#fff"; g.fillRect(876, 304, 376, 200); g.strokeStyle = "#e3e6ea"; g.strokeRect(876.5, 304.5, 376, 200);
    g.fillStyle = "#c0412c"; g.font = "13px ui-monospace, Menlo"; g.fillText("TypeError: legend.width is undefined", 900, 344);
    g.fillStyle = "#e9ecef"; for (let i = 0; i < 4; i++) g.fillRect(28, 530 + i * 52, 1224, 36);
    return c.toDataURL("image/png");
  }
  const DASH_TAB = { tabId: 21, title: "Atlas · Launch dashboard (localhost)", url: "http://localhost:5173/dashboard/launch", favIconUrl: fav("#1f2430", "A"), active: true, sensitive: false };
  function mockTargets(tabId, url) {
    const conn = t3State.connected && t3State.reachable && t3State.tokenValid !== false;
    const threads = conn ? T3_THREADS : [];
    const ag = connectedAgents();
    let target = null, source = "picker", client = null, projectId = null;
    const sess = agents.find(a => a.tabId === tabId && !a.stopped);
    const link = (settings.sendLinks?.tabs ?? []).find(l => l.tabId === tabId);
    let host = ""; try { host = new URL(url).host; } catch { /* no url */ }
    if (shotPreset === "agent") { target = { kind: "agent", id: "ag-claude" }; source = "agent"; client = "Claude Code"; }
    else if (sess?.t3ThreadId) { target = { kind: "t3", id: sess.t3ThreadId }; source = "agent"; client = sess.client; }
    else if (link) { target = { kind: link.kind, id: link.id }; source = "tab-link"; }
    else if (shotPreset !== "picker" && conn && host.startsWith("localhost")) { target = { kind: "t3", id: "th-legend" }; source = "host-link"; projectId = "p-atlas"; }
    return { type: "send.targets", tabId, url, host, t3: t3State, threads, projects: conn ? T3_PROJECTS : [], agents: ag, target, source, client, projectId: projectId ?? (host.startsWith("localhost") ? "p-atlas" : null), links: settings.sendLinks ?? { tabs: [], hosts: {} } };
  }
  function mockCapture(mode) {
    const tab = shotPreset ? DASH_TAB : tabOut(activeTab());
    setTimeout(() => out({ type: "screenshot.captured", image: fakeScreenshot(tab), mode: mode === "region" ? "region" : mode, tab, consoleErrors: [{ t: now() - 4000, text: "TypeError: legend.width is undefined (Legend.tsx:42)", source: "http://localhost:5173/src/Legend.tsx:42:17" }, { t: now() - 2000, text: "Failed to load resource: /api/metrics/weekly (500)", source: "" }] }), mode === "region" ? 500 : 150);
  }
  if (shotPreset) setTimeout(() => mockCapture("region"), 300);

  // ---- the native helper (first-run guide) and Settings → Setup ----
  const helperPreset = params.get("helper");
  let helperState = helperPreset === "missing" || helperPreset === "failed" ? helperPreset : helperPreset === "crashed" ? "stopped" : "connected";
  const crashError = { message: "An unexpected error occurred", state: "stopped", at: now() - 4000, ranMs: 2300 };
  const helperStatus = () => ({ type: "helper.status", state: helperState, reason: helperState === "failed" ? "exit code 127" : helperState === "stopped" ? crashError.message : helperState === "missing" ? "No such native application enso" : null, at: now() - 4000, failures: helperState === "stopped" ? 3 : 0, lastError: helperState === "stopped" ? crashError : null });
  out(helperStatus());
  if (helperPreset === "crashed") out({ type: "event", conversationId: null, event: { kind: "error", code: "host_disconnected", text: "Lost Ensō's helper: An unexpected error occurred. Reconnecting by itself…", at: iso(now()) } });
  function connectHelper() {
    if (helperState === "connected") return;
    helperState = "connected";
    out({ type: "helper.status", state: "connected", reason: null, at: now() });
  }
  if (helperState !== "connected" && Number(params.get("connectAfter")) > 0) setTimeout(connectHelper, Number(params.get("connectAfter")) * 1000);
  const setupPreset = params.get("setup") ?? "ready";
  const SETUP_DATA = OSF.data;
  const setupState = {
    version: "0.5.4",
    latest: setupPreset === "mixed" ? "0.5.5" : "0.5.4",
    claudeFound: setupPreset !== "fresh",
    loggedIn: setupPreset === "ready",
    apiStored: false,
    clients: setupPreset === "ready" ? { claude: "launcher", codex: "launcher", cursor: null, opencode: null } : setupPreset === "mixed" ? { claude: "launcher", codex: null, cursor: null, opencode: null } : { claude: null, codex: null, cursor: null, opencode: null },
    detected: setupPreset === "fresh" ? { claude: false, codex: true, cursor: false, opencode: false } : { claude: true, codex: true, cursor: true, opencode: false },
    hook: setupPreset === "ready",
    t3Installed: setupPreset !== "fresh",
    t3Connected: setupPreset === "ready",
    gh: setupPreset === "ready" ? { ghInstalled: true, connected: true, login: "maya-designs", via: "GitHub CLI" } : { ghInstalled: setupPreset === "mixed", connected: false, login: null, via: null },
  };
  const CLIENT_NAMES = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", opencode: "OpenCode" };
  function setupStatus() {
    const st = setupState;
    const reg = Object.values(st.clients).filter(Boolean);
    const on = servers.filter(x => x.enabled !== false);
    return {
      checkedAt: iso(now()),
      helper: { version: st.version, dev: false, latest: st.latest, updateAvailable: st.version !== st.latest, error: null, node: { path: MOCK_OS === "win" ? OSF.node : `${SETUP_DATA}/runtime/node/bin/node`, version: "24.22.2", source: "private" }, installedAt: iso(now() - 3 * 86_400_000) },
      engine: {
        selected: settings.engine,
        subscription: st.claudeFound ? { found: true, path: OSF.claude, version: "2.1.321 (Claude Code)", loggedIn: st.loggedIn, authMethod: st.loggedIn ? "claude.ai" : "none", subscriptionType: st.loggedIn ? "max" : null, email: st.loggedIn ? "maya@northwind.example" : null } : { found: false, reason: "Claude Code isn't installed.", installCommand: MOCK_OS === "win" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash" },
        api: { stored: st.apiStored, source: st.apiStored ? "keychain" : null },
      },
      agents: { launcher: `${SETUP_DATA}${OSF.sep}${OSF.launcher}`, clients: Object.keys(CLIENT_NAMES).map(id => ({ id, name: CLIENT_NAMES[id], detected: st.detected[id] || !!st.clients[id], registration: st.clients[id] })), readOnly: reg.length > 0 && reg.every(r => r === "launcher-read"), hook: st.hook },
      t3: { installed: st.t3Installed, connected: st.t3Connected, reachable: st.t3Connected, tokenValid: st.t3Connected ? true : null, serverVersion: st.t3Connected ? "0.1.9-nightly" : null, error: null },
      github: { ...st.gh, error: null },
      tools: { total: servers.length, on: on.length, needsAuth: on.filter(x => x.status === "needs-auth").length },
      mcp: { port: 47823, listening: true },
      platform: { os: { mac: "darwin", win: "win32" }[MOCK_OS] ?? MOCK_OS, arch: "x64", installCommand: MOCK_OS === "win" ? "irm https://enso.wicker.life/install.ps1 | iex" : "curl -fsSL https://enso.wicker.life/install.sh | bash" },
      secrets: OSF.secrets,
      paths: { data: SETUP_DATA, logs: OSF.logs },
    };
  }
  const setupDone = (step, ok, text, extra = {}) => out({ type: "setup", status: setupStatus(), done: { step, ok, ...(ok ? { message: text } : { error: text }), ...extra } });
  function setupRun(step, o = {}) {
    const st = setupState;
    const later = (ms, fn) => setTimeout(fn, ms);
    switch (step) {
      case "helper.update":
        return later(1600, () => {
          setupDone(step, true, `Updated to ${st.latest}. Restarting the helper…`, { restart: true });
          out({ type: "helper.restarting" });
          later(300, () => { out({ type: "helper.status", state: "restarting", at: now() }); });
          later(1800, () => { st.version = st.latest; out({ type: "helper.status", state: "connected", at: now() }); });
        });
      case "engine.login":
        later(500, () => setupDone(step, true, `${MOCK_OS === "win" ? "PowerShell" : MOCK_OS === "linux" ? "A terminal" : "Terminal"} is open: follow the sign-in there, then come back.`));
        return later(5000, () => { st.loggedIn = true; });
      case "engine.install":
        later(500, () => setupDone(step, true, `${MOCK_OS === "win" ? "PowerShell" : MOCK_OS === "linux" ? "A terminal" : "Terminal"} is open: it installs Claude Code, then asks you to sign in.`));
        return later(6000, () => { st.claudeFound = true; st.loggedIn = true; });
      case "engine.apiKey":
        return later(600, () => {
          if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(String(o.key ?? ""))) return setupDone(step, false, "That doesn't look like an Anthropic API key (it starts with sk-ant-).");
          st.apiStored = true;
          setupDone(step, true, `Saved to ${MOCK_OS === "mac" ? "your Keychain" : OSF.secrets.location}. The key works.`);
        });
      case "engine.forgetApiKey":
        st.apiStored = false;
        return later(300, () => setupDone(step, true, `Removed the key from ${MOCK_OS === "mac" ? "your Keychain" : OSF.secrets.location}.`));
      case "agents.register":
        return later(700, () => { st.clients[o.client] = o.readOnly ? "launcher-read" : "launcher"; setupDone(step, true, `${CLIENT_NAMES[o.client]} can use Zen${o.readOnly ? " (read only)" : ""}. Start a new session there to pick it up.`); });
      case "agents.unregister":
        return later(500, () => { st.clients[o.client] = null; if (o.client === "claude") st.hook = false; setupDone(step, true, `Removed zen-browser from ${CLIENT_NAMES[o.client]}.`); });
      case "agents.readOnly":
        return later(600, () => { for (const k of Object.keys(st.clients)) if (st.clients[k]) st.clients[k] = o.readOnly ? "launcher-read" : "launcher"; setupDone(step, true, `${o.readOnly ? "Read only" : "Full access"} for ${Object.keys(st.clients).filter(k => st.clients[k]).map(k => CLIENT_NAMES[k]).join(", ")}.`); });
      case "agents.hook":
        return later(400, () => { st.hook = !!o.on; setupDone(step, true, o.on ? "Claude Code gets screenshots and notes with your next message." : "Removed the Claude Code hook."); });
      case "t3.connect":
        return later(900, () => { st.t3Connected = true; setupDone(step, true, "Connected to T3 Code."); });
      case "t3.disconnect":
        return later(400, () => { st.t3Connected = false; setupDone(step, true, "Revoked Ensō's T3 session."); });
      case "github.login":
        later(500, () => setupDone(step, true, `${MOCK_OS === "win" ? "PowerShell" : MOCK_OS === "linux" ? "A terminal" : "Terminal"} is open: follow the GitHub sign-in there, then come back.`));
        return later(6000, () => { st.gh = { ghInstalled: true, connected: true, login: "maya-designs", via: "GitHub CLI" }; });
      case "github.token":
        return later(700, () => {
          if (!/^(ghp_|github_pat_|gho_)[A-Za-z0-9_]{16,}$/.test(String(o.token ?? ""))) return setupDone(step, false, "That doesn't look like a GitHub token (ghp_…, github_pat_… or gho_…).");
          st.gh = { ghInstalled: st.gh.ghInstalled, connected: true, login: "maya-designs", via: "Keychain" };
          setupDone(step, true, "Signed in to GitHub as maya-designs.");
        });
      case "github.forget":
        st.gh = { ...st.gh, connected: false, login: null, via: null };
        return later(300, () => setupDone(step, true, `Removed Ensō's GitHub token from ${MOCK_OS === "mac" ? "your Keychain" : OSF.secrets.location}.`));
      case "mcp.rotate":
        return later(300, () => setupDone(step, true, "New tokens written. Agents started with enso mcp keep working."));
      default:
        return later(100, () => setupDone(step, false, `Unknown setup step: ${step}`));
    }
  }

  const sendAgents = () => out({ type: "agents", sessions: agents, connected: connectedAgents() });
  const patchAgent = (id, patch) => { agents = agents.map(a => (a.id === id ? { ...a, ...patch } : a)); sendAgents(); };

  function handle(msg) {
    // No helper: background.js answers nothing but helper.retry.
    if (helperState !== "connected") {
      if (msg.type === "helper.retry") out({ ...helperStatus(), at: now() });
      return;
    }
    // Connected, but some requests never get an answer.
    if (helperPreset === "noanswer" && (msg.type === "memory.get" || msg.type === "setup.status")) return;
    switch (msg.type) {
      case "helper.retry":
        out({ type: "helper.status", state: "connected", at: now() });
        return;
      case "helper.log":
        out({ type: "helper.log", version: "0.5.5", node: { version: "v22.12.0", path: OSF.node }, platform: OSF.platform, file: `${OSF.logs}${OSF.sep}helper.log`, lines: [`${iso(now() - 60_000)} [4242] INFO  Ensō helper 0.5.5 starting (started by run.sh): Node v22.12.0 at /opt/homebrew/bin/node, darwin arm64, macOS 15.1`, `${iso(now() - 59_000)} [4242] INFO  MCP server on http://127.0.0.1:47823/mcp`] });
        return;
      case "setup.status":
        setTimeout(() => out({ type: "setup", status: setupStatus() }), msg.fresh ? 500 : 250);
        return;
      case "setup.run":
        setupRun(msg.step, msg.options ?? {});
        return;
      case "agents.list":
        sendAgents();
        return;
      case "screenshot.capture":
        mockCapture(msg.mode);
        return;
      case "send.targets":
        setTimeout(() => out(mockTargets(msg.tabId, msg.url)), 250);
        return;
      case "send.screenshot": {
        const tgt = msg.target ?? {};
        const th = T3_THREADS.find(t => t.id === tgt.id);
        const ag = connectedAgents().find(a => a.id === tgt.id);
        const fallback = tgt.kind === "t3" && t3State.route === "path";
        setTimeout(() => out({ type: "send.result", ok: true, kind: tgt.kind, title: tgt.kind === "agent" ? ag?.client ?? "the agent" : th?.title ?? "the thread", route: tgt.kind === "agent" ? "inbox" : fallback ? "path" : "attachment", queued: tgt.kind === "agent", ...(fallback || tgt.kind === "agent" ? { path: `${PATHS.data}/screenshots/20261110-104512-localhost-5173-x1y2.png` } : {}), ...(tgt.kind === "t3" ? { openUrl: `t3code://threads/env-maya/${tgt.id}` } : {}) }), 700);
        return;
      }
      case "screenshot.save":
        setTimeout(() => out({ type: "screenshot.saved", ok: true, path: `${PATHS.data}/screenshots/20261110-104512-localhost-5173-x1y2.png` }), 200);
        return;
      case "send.link": {
        const l = msg.link ?? {};
        const links = settings.sendLinks ?? { tabs: [], hosts: {} };
        if (l.type === "host") links.hosts = { ...links.hosts, [l.host]: { projectId: l.projectId, projectTitle: l.projectTitle, at: iso(now()) } };
        else links.tabs = [...links.tabs.filter(x => x.tabId !== l.tabId), { ...l, at: iso(now()) }];
        settings.sendLinks = links;
        out({ type: "settings", settings });
        return;
      }
      case "send.unlink": {
        const links = settings.sendLinks ?? { tabs: [], hosts: {} };
        const l = msg.link ?? {};
        if (l.type === "host") { const hs = { ...links.hosts }; delete hs[l.host]; links.hosts = hs; }
        else links.tabs = links.tabs.filter(x => x.tabId !== l.tabId);
        settings.sendLinks = links;
        out({ type: "settings", settings });
        return;
      }
      case "t3.status":
        out({ type: "t3", status: t3State });
        return;
      case "t3.connect":
        setTimeout(() => { t3State = { ...t3Status(), connected: true, tokenValid: true, reachable: true, error: null }; out({ type: "t3", status: t3State, done: { action: "connect", ok: true } }); }, 900);
        return;
      case "t3.disconnect":
        setTimeout(() => { t3State = { ...t3State, connected: false, tokenValid: null, route: null, error: null }; out({ type: "t3", status: t3State, done: { action: "disconnect", ok: true } }); }, 400);
        return;
      case "t3.open":
        console.info("[mock] open in T3", msg.threadId);
        return;
      case "agents.pause":
        patchAgent(msg.id, { paused: true, running: false });
        return;
      case "agents.resume":
        patchAgent(msg.id, { paused: false });
        return;
      case "agents.stop":
        patchAgent(msg.id, { stopped: true, paused: false, running: false });
        return;
      case "agents.dismiss":
        agents = agents.filter(a => a.id !== msg.id);
        sendAgents();
        return;
      case "agents.switch":
        activeTabId = msg.tabId;
        out({ type: "page.current", tab: tabOut(activeTab()), space: spaceRef(currentSpaceId()) });
        return;
      case "agents.note": {
        const a = agents.find(x => x.id === msg.id);
        if (!a) return;
        const note = { id: nid("n"), text: String(msg.text).trim().replace(/\s+/g, " ").slice(0, 1000), at: iso(now()), deliveredAt: null };
        patchAgent(a.id, { notes: [...a.notes, note] });
        if (!a.paused && !a.stopped) setTimeout(() => {
          // The agent's next tool call carries the note.
          const cur = agents.find(x => x.id === a.id);
          if (!cur) return;
          const read = step(0, "page_read", "Read the page", "");
          patchAgent(a.id, { notes: cur.notes.map(n => (n.deliveredAt ? n : { ...n, deliveredAt: iso(now()) })), actions: [...cur.actions, read], lastAt: iso(now()) });
        }, 1800);
        return;
      }
      case "hello":
        out({ type: "state", settings, engines, servers, connections: connectionsList(), conversations: summaries(), activeConversationId: [...turns.keys()][0] ?? null, dashboard: onboarding && !onboardingDone ? null : dashboard, profile: profileState(), paths: PATHS, skills: SKILLS, reports: REPORTS.map(({ id, title, createdAt }) => ({ id, title, createdAt })), spaces: SPACES, sensitiveHosts: ["*bank*", "*health*", "*patient*", "*.paypal.com"], agents, connectedAgents: connectedAgents() });
        return;
      case "tabs.list":
        out({ type: "tabs", tabs: TABS
          .map(({ sensitive, spaceId, ...t }) => ({ ...t, active: t.tabId === activeTabId, hidden: spaceId !== currentSpaceId(), space: spaceRef(spaceId)?.name ?? null }))
          .sort((a, b) => a.hidden - b.hidden) });
        return;
      case "page.current":
        // On the real new-tab page the active tab is the new tab itself: not a web page.
        out({ type: "page.current", tab: document.documentElement.dataset.mode === "newtab" ? null : tabOut(activeTab()), space: spaceRef(currentSpaceId()) });
        return;
      case "skills.save": {
        const i = SKILLS.findIndex(k => k.name === msg.skill.name);
        if (i >= 0 && SKILLS[i].builtIn) return;
        const skill = { ...msg.skill, builtIn: false };
        if (i >= 0) SKILLS[i] = skill; else SKILLS.push(skill);
        out({ type: "skills", skills: SKILLS });
        return;
      }
      case "skills.delete": {
        const i = SKILLS.findIndex(k => k.name === msg.name && !k.builtIn);
        if (i >= 0) SKILLS.splice(i, 1);
        out({ type: "skills", skills: SKILLS });
        return;
      }
      case "reports.list":
        out({ type: "reports", reports: REPORTS.map(({ id, title, createdAt }) => ({ id, title, createdAt })) });
        return;
      case "report.get": {
        const r = REPORTS.find(x => x.id === msg.id);
        setTimeout(() => out({ type: "report", report: r ?? null }), 80);
        return;
      }
      case "conversation.new": {
        const id = nid("c-");
        const summary = { space: spaceRef(currentSpaceId()), id, title: "New conversation", createdAt: iso(now()), updatedAt: iso(now()), engine: settings.engine, messageCount: 0, actionCount: 0, pages: [], preview: "" };
        convs.set(id, { summary, events: [] });
        out({ type: "conversation.created", conversation: summary });
        return;
      }
      case "conversation.open": {
        const c = convs.get(msg.id);
        setTimeout(() => out(c ? { type: "conversation.loaded", id: msg.id, conversation: c.summary, events: c.events } : { type: "conversation.loaded", id: msg.id, conversation: null, events: [{ kind: "error", id: nid("e"), at: iso(now()), text: "This conversation no longer exists." }] }), 120);
        return;
      }
      case "conversation.rename": {
        const c = convs.get(msg.id);
        if (c) { c.summary.title = msg.title; out({ type: "conversation.updated", conversation: c.summary }); }
        return;
      }
      case "conversation.delete":
        convs.delete(msg.id);
        out({ type: "conversation.deleted", id: msg.id });
        return;
      case "chat.send":
        if (!convs.has(msg.conversationId)) return;
        runTurn(msg.conversationId, msg);
        return;
      case "chat.stop": {
        const turn = turns.get(msg.conversationId);
        if (turn) { turn.cancelled = true; turn.finish(); }
        for (const [id, resolve] of approvalWaiters) { approvalWaiters.delete(id); resolve("deny"); }
        return;
      }
      case "approval.reply": {
        const resolve = approvalWaiters.get(msg.id);
        if (resolve) { approvalWaiters.delete(msg.id); setTimeout(() => resolve(msg.decision), 150); }
        if (msg.decision === "always") setTimeout(() => out({ type: "settings", settings }), 200);
        return;
      }
      case "history.search": {
        const q = msg.query.toLowerCase();
        const results = [];
        for (const c of convs.values()) {
          if (msg.spaceId && c.summary.space?.id !== msg.spaceId) continue;
          const texts = [c.summary.title, ...c.events.filter(e => e.text).map(e => e.text)];
          const hit = texts.find(t => t.toLowerCase().includes(q));
          if (!hit) continue;
          const i = hit.toLowerCase().indexOf(q);
          const snippet = (i > 40 ? "…" : "") + hit.slice(Math.max(0, i - 40), i + q.length + 80).replace(/\s+/g, " ") + (i + q.length + 80 < hit.length ? "…" : "");
          results.push({ conversationId: c.summary.id, title: c.summary.title, snippet, at: c.summary.updatedAt });
        }
        setTimeout(() => out({ type: "history.results", query: msg.query, results }), 150);
        return;
      }
      case "actions.list": {
        let list = allActions();
        if (msg.host) list = list.filter(a => a.host === msg.host || a.host.endsWith(`.${msg.host}`));
        if (msg.url) list = list.filter(a => a.url === msg.url);
        out({ type: "actions.results", actions: list.slice(0, msg.limit ?? 50) });
        return;
      }
      case "dashboard.refresh":
        out({ type: "dashboard", loading: true });
        setTimeout(() => {
          dashboard = makeDashboard();
          out({ type: "dashboard", data: dashboard });
        }, 1400);
        return;
      case "settings.update":
        Object.assign(settings, msg.patch, msg.patch.dashboard ? { dashboard: { ...settings.dashboard, ...msg.patch.dashboard } } : {});
        out({ type: "settings", settings });
        return;
      case "profile.save": {
        if (!msg.skip) profile = { ...profile, name: String(msg.name ?? "").trim(), about: String(msg.about ?? "").trim() };
        if (msg.spaceHints) {
          const hints = { ...profile.spaceHints };
          for (const [id, t] of Object.entries(msg.spaceHints)) { if (String(t).trim()) hints[id] = String(t).trim(); else delete hints[id]; }
          profile.spaceHints = hints;
        }
        onboardingDone = true;
        settings.onboardingDone = true;
        setTimeout(() => { out({ type: "settings", settings }); out({ type: "profile", profile: profileState() }); }, 350);
        return;
      }
      case "profile.get":
        out({ type: "profile", profile: profileState() });
        return;
      case "memory.get":
        out({ type: "memory", spaceId: msg.spaceId ?? null, text: msg.spaceId ? spaceMemory[msg.spaceId] ?? "" : memory });
        return;
      case "memory.set":
        if (msg.spaceId) spaceMemory[msg.spaceId] = msg.text;
        else memory = msg.text;
        setTimeout(() => out({ type: "memory", spaceId: msg.spaceId ?? null, text: msg.text }), 200);
        return;
      case "connections.status":
        sendConnections();
        return;
      case "connections.start": {
        const sv = servers.find(x => x.name === msg.server && x.auth);
        if (sv) mockConnect(sv);
        return;
      }
      case "connections.add": {
        const name = String(msg.name ?? "").trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(name) || servers.some(x => x.name === name)) {
          out({ type: "connections", connections: connectionsList(), done: { server: name, ok: false, add: true, error: servers.some(x => x.name === name) ? `There is already a server called ${name}.` : "Use a short name: letters, digits, - or _." } });
          return;
        }
        const sv = { name, label: msg.label || name, status: "needs-auth", enabled: true, tools: 0, source: "MCP server", connectUrl: null, toolNames: [], examples: [],
          about: `Added by you · ${String(msg.url).replace(/^https?:\/\//, "")}`, auth: { type: "oauth", state: "disconnected", custom: true, url: msg.url } };
        servers.push(sv);
        mockConnect(sv);
        return;
      }
      case "connections.disconnect": {
        const sv = servers.find(x => x.name === msg.server && x.auth);
        if (sv) Object.assign(sv, { status: "needs-auth", tools: 0, toolNames: [], auth: { ...sv.auth, state: "disconnected" } });
        sendConnections();
        return;
      }
      case "connections.remove": {
        const i = servers.findIndex(x => x.name === msg.server && x.auth?.custom);
        if (i >= 0) servers.splice(i, 1);
        sendConnections();
        return;
      }
      case "tools.toggle": {
        const sv = servers.find(x => x.name === msg.name);
        if (sv) sv.enabled = !!msg.enabled;
        out({ type: "servers", servers });
        out({ type: "settings", settings });
        return;
      }
      case "spaces.list":
        out({ type: "spaces", spaces: SPACES });
        return;
      case "github.widget": {
        const gh = servers.find(x => x.name === "github");
        setTimeout(() => out(gh?.status === "connected" ? { type: "github", data: githubWidget() } : { type: "github", error: "GitHub is not connected." }), 500);
        return;
      }
      case "tasks.widget":
        setTimeout(() => out({ type: "tasks", data: tasksData() }), 300);
        return;
      case "monday.widget":
        setTimeout(() => out({ type: "monday", data: mondayData() }), 400);
        return;
      case "connections.probe": {
        // Retry: monday stays down in ?monday=down (the error state), anything else comes back.
        const sv = servers.find(x => x.name === msg.server && x.auth);
        setTimeout(() => {
          if (sv && mondayMode !== "down") { Object.assign(sv, { status: "connected", tools: MONDAY_TOOLS.length, toolNames: MONDAY_TOOLS }); delete sv.error; }
          out({ type: "servers", servers });
          out({ type: "connections.probed", server: msg.server, ok: sv?.status === "connected", status: sv?.status ?? "failed", ...(sv?.error ? { error: sv.error } : {}) });
        }, 900);
        return;
      }
      case "tasks.complete": {
        // Like the helper: only tasks it listed; "fail" in the title shows the error state.
        const task = openTasks.find(t => t.server === msg.server && t.id === msg.id);
        setTimeout(() => {
          const ok = !!task && !/fail/i.test(task.title);
          if (ok) openTasks = openTasks.filter(t => t !== task);
          out({ type: "tasks.completed", server: msg.server, id: msg.id, ok, ...(ok ? {} : { error: task ? "Fieldnotes refused (403)." : "That task isn't in the current list." }) });
          out({ type: "tasks", data: tasksData() });
        }, 400);
        return;
      }
      case "github.token": {
        const ok = /^(ghp_|github_pat_|gho_)\w{10,}$/.test(String(msg.token ?? ""));
        setTimeout(() => {
          out(ok ? { type: "github.saved", ok: true, login: "sample-user" } : { type: "github.saved", ok: false, error: "That doesn't look like a GitHub token (ghp_…, github_pat_… or gho_…)." });
          if (ok) { servers.splice(servers.findIndex(x => x.name === "github"), 1, { ...githubEntry(true), detail: "Connected through a saved token as sample-user", tokenEntry: true }); out({ type: "servers", servers }); }
        }, 700);
        return;
      }
      case "github.forget":
        servers.splice(servers.findIndex(x => x.name === "github"), 1, githubEntry(false));
        out({ type: "servers", servers });
        return;
      default:
        console.warn("[mock] unhandled", msg);
    }
  }

  // Dev hooks for UI work:
  //   __ensoMock.setActiveTab(17)   sensitive page (lock chip)
  //   __ensoMock.prefill("text")    background's "Ask Ensō about this" menu
  //   __ensoMock.disconnect()       global host_disconnected banner
  globalThis.__ensoMock = {
    tabs: TABS,
    // Preset widget layouts for the new tab: "four", "all", "tasks", "tasksSmall", "monday", "github", or [] to clear.
    presetWidgets(name) {
      const presets = {
        four: [{ id: "w-next", type: "next", size: "M" }, { id: "w-due", type: "due", size: "M" }, { id: "w-clock", type: "clock", size: "S" }, { id: "w-mail", type: "mail", size: "S" }],
        all: ["next", "due", "tasks", "monday", "mail", "language", "github", "clock", "chats", "links", "note", "ask"].map(t => ({ id: `w-${t}`, type: t, size: ["clock", "mail", "note"].includes(t) ? "S" : "M" })),
        tasks: [{ id: "w-next", type: "next", size: "M" }, { id: "w-due", type: "due", size: "M" }, { id: "w-tasks", type: "tasks", size: "M" }, { id: "w-clock", type: "clock", size: "S" }, { id: "w-mail", type: "mail", size: "S" }],
        tasksSmall: [{ id: "w-tasks", type: "tasks", size: "S" }, { id: "w-next", type: "next", size: "M" }, { id: "w-clock", type: "clock", size: "S" }, { id: "w-due", type: "due", size: "M" }, { id: "w-mail", type: "mail", size: "S" }],
        monday: [{ id: "w-tasks", type: "tasks", size: "M" }, { id: "w-monday", type: "monday", size: "M" }, { id: "w-clock", type: "clock", size: "S" }, { id: "w-monday-s", type: "monday", size: "S" }],
        github: [{ id: "w-github", type: "github", size: "M" }, { id: "w-next", type: "next", size: "M" }, { id: "w-clock", type: "clock", size: "S" }, { id: "w-github-s", type: "github", size: "S" }],
      };
      settings.homeWidgets = Array.isArray(name) ? name : presets[name] ?? [];
      out({ type: "settings", settings });
    },
    prefill(text) { out({ type: "composer.prefill", text }); },
    // What the helper sends after Claude calls create_task in a chat: the fresh list, with the new task marked.
    //   __ensoMock.addTask("Buy souvenirs", 2, 17)  → due in 2 days, reminder 17:00
    addTask(title = "Buy souvenirs for the team", inDaysN = 2, remindHour = 17) {
      const id = `6f1c2a10-0000-4000-8000-${String(Date.now()).slice(-12)}`;
      const d = new Date(); d.setDate(d.getDate() + inDaysN); d.setHours(remindHour, 0, 0, 0);
      openTasks = [...openTasks, { id, title, due: dayIn(inDaysN), remindAt: d.toISOString(), url: `https://fieldnotes.example.com/notes/${id}`, source: "Fieldnotes", server: "fieldnotes", space: "personal", completable: true }];
      out({ type: "tasks", data: tasksData(), added: [`fieldnotes|${id}`] });
    },
    // GitHub's tools-panel state: githubConnected(false) shows the token box.
    githubConnected(on) { servers.splice(servers.findIndex(x => x.name === "github"), 1, githubEntry(!!on)); out({ type: "servers", servers }); },
    disconnect() { out({ type: "event", conversationId: null, event: { kind: "error", code: "host_disconnected", text: "Lost Ensō's helper: the native host exited. Reconnecting by itself…", at: iso(now()) } }); },
    // First-run guide: the helper appears (install.sh finished).
    connectHelper,
    setActiveTab(tabId) {
      activeTabId = tabId;
      out({ type: "page.current", tab: tabOut(activeTab()), space: spaceRef(currentSpaceId()) });
    },
  };

  return {
    postMessage: msg => setTimeout(() => handle(structuredClone(msg)), 20),
    onMessage: fn => listeners.add(fn),
  };
}
