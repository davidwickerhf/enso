// Human labels for tool names, and the read-only heuristic used to decide
// which MCP tools run without asking (the Agent SDK does not pass MCP
// annotations to the permission callback).

import { config } from "./config.mjs";
import { browserSideToolByName } from "./toolset.mjs";

const READ = /(^|_)(get|list|search|read|find|query|fetch|recall|lookup|view|show|describe|status|count|download|whoami|overview|guidance|due|progress|insights|history|sources|sections|text|entry|outline|module|vocab|grammar|briefing|readiness|calendar|state|memory|reviews|decks|words|suggest|check|inspect|explain|compare|preview|export)(_|$)/i;
const WRITE = /(^|_)(create|update|delete|send|trash|remove|write|set|add|move|share|mark|label|unlabel|reply|forward|apply|edit|submit|post|rename|copy|upload|cancel|sync|respond|connect|disconnect|mutate|run|deploy|restore|reset|rotate|revoke|install|record|forget|remember|generate|import|publish|purchase|buy|approve|accept|pause|start|stop|enable|disable|provision|transfer|invalidate|patch|put|replace|complete|draft)(_|$)/i;

export function isReadOnlyTool(toolName) {
  const name = toolName.split("__").pop();
  return READ.test(name) && !WRITE.test(name);
}

const SERVER_LABELS = {
  claude_ai_Gmail: "Gmail",
  claude_ai_Google_Calendar: "Calendar",
  claude_ai_Google_Drive: "Drive",
  claude_ai_Google_Docs: "Google Docs",
  browser: "Browser",
  zen: "Memory",
  // Labels for your own servers: config.local.json → catalog → { "<server>": { "label": "…" } }
  ...Object.fromEntries(Object.entries(config.catalog ?? {}).filter(([, v]) => v?.label).map(([k, v]) => [k.replace(/[^a-zA-Z0-9_-]/g, "_"), v.label])),
};

const humanize = s => s.replace(/[_-]+/g, " ").replace(/^\w/, c => c.toUpperCase());

export function describeTool(toolName) {
  if (!toolName.startsWith("mcp__")) {
    return { category: "web", server: "web", tool: toolName, title: toolName === "WebSearch" ? "Search the web" : toolName === "WebFetch" ? "Fetch a page" : humanize(toolName) };
  }
  const [, server, ...rest] = toolName.split("__");
  const tool = rest.join("__");
  const label = SERVER_LABELS[server] ?? humanize(server);
  if (server === "browser") return { category: "page", server: tool.startsWith("github_") ? "GitHub" : label, tool, title: browserSideToolByName.get(tool)?.title ?? humanize(tool) };
  if (server === "zen") return { category: "memory", server: label, tool, title: humanize(tool) };
  return { category: "mcp", server: label, tool, title: `${label}: ${humanize(tool).toLowerCase()}` };
}
