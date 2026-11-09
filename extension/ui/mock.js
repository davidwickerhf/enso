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
    t("6f1c2a10-0000-4000-8000-000000000002", "Send the Q4 survey results to Priya", dayIn(1)),
    t("6f1c2a10-0000-4000-8000-000000000003", "Draft the onboarding copy for Atlas 2.0", dayIn(3)),
    t("6f1c2a10-0000-4000-8000-000000000004", "Order seeds for the spring beds", null),
    t("6f1c2a10-0000-4000-8000-000000000005", "Read Jonas's beta checklist", null),
  ];
}

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
  const PATHS = { data: "/Users/maya/Library/Application Support/Enso", localConfig: "/Users/maya/Library/Application Support/Enso/config.local.json" };
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

  function handle(msg) {
    switch (msg.type) {
      case "hello":
        out({ type: "state", settings, engines, servers, connections: connectionsList(), conversations: summaries(), activeConversationId: [...turns.keys()][0] ?? null, dashboard: onboarding && !onboardingDone ? null : dashboard, profile: profileState(), paths: PATHS, skills: SKILLS, reports: REPORTS.map(({ id, title, createdAt }) => ({ id, title, createdAt })), spaces: SPACES, sensitiveHosts: ["*bank*", "*health*", "*patient*", "*.paypal.com"] });
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
    // Preset widget layouts for the new tab: "four", "all", "tasks", "tasksSmall", "github", or [] to clear.
    presetWidgets(name) {
      const presets = {
        four: [{ id: "w-next", type: "next", size: "M" }, { id: "w-due", type: "due", size: "M" }, { id: "w-clock", type: "clock", size: "S" }, { id: "w-mail", type: "mail", size: "S" }],
        all: ["next", "due", "tasks", "mail", "language", "github", "clock", "chats", "links", "note", "ask"].map(t => ({ id: `w-${t}`, type: t, size: ["clock", "mail", "note"].includes(t) ? "S" : "M" })),
        tasks: [{ id: "w-next", type: "next", size: "M" }, { id: "w-due", type: "due", size: "M" }, { id: "w-tasks", type: "tasks", size: "M" }, { id: "w-clock", type: "clock", size: "S" }, { id: "w-mail", type: "mail", size: "S" }],
        tasksSmall: [{ id: "w-tasks", type: "tasks", size: "S" }, { id: "w-next", type: "next", size: "M" }, { id: "w-clock", type: "clock", size: "S" }, { id: "w-due", type: "due", size: "M" }, { id: "w-mail", type: "mail", size: "S" }],
        github: [{ id: "w-github", type: "github", size: "M" }, { id: "w-next", type: "next", size: "M" }, { id: "w-clock", type: "clock", size: "S" }, { id: "w-github-s", type: "github", size: "S" }],
      };
      settings.homeWidgets = Array.isArray(name) ? name : presets[name] ?? [];
      out({ type: "settings", settings });
    },
    prefill(text) { out({ type: "composer.prefill", text }); },
    // GitHub's tools-panel state: githubConnected(false) shows the token box.
    githubConnected(on) { servers.splice(servers.findIndex(x => x.name === "github"), 1, githubEntry(!!on)); out({ type: "servers", servers }); },
    disconnect() { out({ type: "event", conversationId: null, event: { kind: "error", code: "host_disconnected", text: "Lost Ensō's helper: the native host exited. Run the installer again if this persists.", at: iso(now()) } }); },
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
