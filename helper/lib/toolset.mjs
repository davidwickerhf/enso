// Every tool that works on the browser (the user's live Zen tabs, developer
// tools, signed-in requests, the headless Zen) plus GitHub, in one list for Ensō's
// in-process "browser" server, the API engine and the zen-browser MCP server.

import { BROWSER_TOOLS } from "./browsertools.mjs";
import { DEV_TOOLS } from "./devtools.mjs";
import { GITHUB_TOOLS } from "./github.mjs";
import { HEADLESS_TOOLS } from "./headless.mjs";
import { PAGE_TOOLS } from "./pagetools.mjs";

export const ALL_BROWSER_TOOLS = [...PAGE_TOOLS, ...BROWSER_TOOLS, ...DEV_TOOLS, ...HEADLESS_TOOLS, ...GITHUB_TOOLS];
export const browserSideToolByName = new Map(ALL_BROWSER_TOOLS.map(t => [t.name, t]));
