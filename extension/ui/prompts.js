// Site-adaptive suggestions: from the active tab's URL, a placeholder and
// two or three prompts that fit the page. Host/path rules only.

const RULES = [
  { test: u => /(^|\.)youtube\.com$/.test(u.hostname) && u.pathname === "/watch", placeholder: "Ask about this video…", chips: ["Summarise this video", "What are the key moments?", "Make study notes from this"] },
  { test: u => /(^|\.)youtube\.com$/.test(u.hostname), placeholder: "Ask about YouTube…", chips: ["Find a good lecture on this topic"] },
  { test: u => u.hostname === "github.com" && /\/pull\/\d+/.test(u.pathname), placeholder: "Ask about this pull request…", chips: ["Review this PR", "Explain these changes", "What could break?"] },
  { test: u => u.hostname === "github.com" && /\/issues\/\d+/.test(u.pathname), placeholder: "Ask about this issue…", chips: ["Summarise this issue", "Suggest a fix"] },
  { test: u => u.hostname === "github.com" && u.pathname.split("/").filter(Boolean).length >= 2, placeholder: "Ask about this repository…", chips: ["What does this repo do?", "How do I run it locally?"] },
  { test: u => /gitlab\./.test(u.hostname) && /merge_requests\/\d+/.test(u.pathname), placeholder: "Ask about this merge request…", chips: ["Review this merge request", "Explain these changes"] },
  { test: u => u.hostname === "mail.google.com" || /outlook\.(office|live)\.com$/.test(u.hostname) || u.hostname === "outlook.office365.com", placeholder: "Ask about your mail…", chips: ["Summarise this thread", "Draft a reply", "What needs my answer?"] },
  { test: u => u.hostname === "docs.google.com" && u.pathname.startsWith("/document"), placeholder: "Ask about this document…", chips: ["Tighten this document", "Summarise it in five bullets", "Check the argument"] },
  { test: u => u.hostname === "docs.google.com" && u.pathname.startsWith("/spreadsheets"), placeholder: "Ask about this sheet…", chips: ["Explain this sheet", "Suggest a formula"] },
  { test: u => u.hostname === "docs.google.com" && u.pathname.startsWith("/presentation"), placeholder: "Ask about these slides…", chips: ["Summarise these slides", "Quiz me on this deck"] },
  { test: u => u.hostname === "calendar.google.com", placeholder: "Ask about your calendar…", chips: ["What's my week like?", "Find a free hour tomorrow"] },
  { test: u => /canvas\.|instructure\.com$|moodle|blackboard/.test(u.hostname), placeholder: "Ask about this course page…", chips: ["Summarise this page", "What's due and when?", "Make a study plan"] },
  { test: u => /(^|\.)wikipedia\.org$/.test(u.hostname), placeholder: "Ask about this article…", chips: ["Summarise", "Explain it simply", "Quiz me on this"] },
  { test: u => /(^|\.)arxiv\.org$/.test(u.hostname) || /\.pdf$/i.test(u.pathname), placeholder: "Ask about this paper…", chips: ["Summarise the paper", "What's the main contribution?", "Explain the method"] },
  { test: u => /(^|\.)(stackoverflow|stackexchange)\.com$/.test(u.hostname), placeholder: "Ask about this answer…", chips: ["Which answer is right?", "Explain the accepted answer"] },
  { test: u => /(amazon|bol|coolblue)\./.test(u.hostname), placeholder: "Ask about this product…", chips: ["Summarise the reviews", "Is this a good deal?"] },
  { test: u => /coolify\./.test(u.hostname) || /vercel\.com$/.test(u.hostname), placeholder: "Ask about this deployment…", chips: ["Why did this deploy fail?", "Explain these logs"] },
  { test: u => /\/(news|article|blog|posts?|story|\d{4}\/\d{2})\//.test(u.pathname) || /(nytimes|theguardian|bbc|nos|nrc|medium|substack)\./.test(u.hostname), placeholder: "Ask about this article…", chips: ["Summarise", "Fact-check the main claims", "What's the counter-argument?"] },
];

const GENERIC = { placeholder: "Ask a question about this page…", chips: ["Summarise this page", "Explain this simply"] };

export function promptsFor(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  return RULES.find(r => r.test(u)) ?? GENERIC;
}
