// Imported first by host.mjs: ES modules evaluate in import order, so the log
// and its crash handlers are in place before any other module of the helper
// runs (a throw while another module loads is logged too). See logfile.mjs.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHelperLog } from "./logfile.mjs";

startHelperLog({ helperDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") });
