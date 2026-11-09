// Slash commands: reusable prompts. Built-ins live here; the user's own are in
// ~/Library/Application Support/Enso/skills.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA } from "./store.mjs";

const FILE = path.join(DATA, "skills.json");

const BUILT_IN = [
  { name: "summarize", description: "Summarise this page or video in five bullets", prompt: "Summarise the attached page in five short bullets, then one line on why it matters to me. {input}" },
  { name: "tldr", description: "One-paragraph TL;DR", prompt: "Give me a one-paragraph TL;DR of the attached page. {input}" },
  { name: "factcheck", description: "Check the main claims against other sources", prompt: "List the main factual claims on the attached page and check each against reliable sources with web search. Mark each as supported, disputed or unverified, with links. {input}" },
  { name: "explain", description: "Explain it simply", prompt: "Explain the attached page (or what I select/mention) simply, as if I am new to the topic, then give one example. {input}" },
  { name: "translate", description: "Translate (default: English)", prompt: "Translate the attached page or the text below. Target language: English unless I name another. Keep formatting. {input}" },
  { name: "reply", description: "Draft a reply to this email or message", prompt: "Draft a reply to the email or message on the attached page, in my voice: concise and friendly. Ask me before sending anything. {input}" },
  { name: "brief", description: "My morning brief", prompt: "Give me my brief for today: calendar, mail that needs me, study deadlines, and anything else I should know. Use my tools. {input}" },
  { name: "tabs", description: "Tidy my open tabs into groups", prompt: "Look at my open tabs and propose a tidy grouping by topic; group them when I agree. {input}" },
];

const readUser = () => {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
  } catch {
    return [];
  }
};

export function listSkills() {
  const user = readUser();
  return [...BUILT_IN.filter(b => !user.some(u => u.name === b.name)).map(s => ({ ...s, builtIn: true })), ...user.map(s => ({ ...s, builtIn: false }))];
}

export function saveSkill({ name, description, prompt }) {
  const clean = String(name).replace(/^\//, "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!clean || !prompt) throw new Error("A skill needs a name and a prompt.");
  const user = readUser().filter(s => s.name !== clean);
  user.push({ name: clean, description: description ?? "", prompt });
  writeFileSync(FILE, JSON.stringify(user, null, 2));
  return listSkills();
}

export function deleteSkill(name) {
  writeFileSync(FILE, JSON.stringify(readUser().filter(s => s.name !== name), null, 2));
  return listSkills();
}

export function expandSkill(name, input) {
  const skill = listSkills().find(s => s.name === name);
  if (!skill) return input;
  return skill.prompt.includes("{input}") ? skill.prompt.replace("{input}", input ?? "").trim() : `${skill.prompt}\n\n${input ?? ""}`.trim();
}
