// Environments for helpers and CLIs started by the tests: everything that
// decides where Ensō reads and writes (HOME, and on Windows USERPROFILE,
// APPDATA, LOCALAPPDATA) points into the test's temporary folder, so no test
// touches the real data, log or config folders on any OS.

import { tmpdir } from "node:os";
import path from "node:path";
import { dataDir, logDir } from "../lib/platform.mjs";

export const WIN = process.platform === "win32";
export const MAC = process.platform === "darwin";

/** An isolated env for `home` (extra keys win). Secrets go to a file in the test's data folder off macOS. */
export function isolatedEnv(home, extra = {}) {
  const base = WIN
    ? {
        SystemRoot: process.env.SystemRoot,
        windir: process.env.windir,
        ComSpec: process.env.ComSpec,
        PATHEXT: process.env.PATHEXT,
        PATH: process.env.PATH,
        TEMP: tmpdir(),
        TMP: tmpdir(),
        USERPROFILE: home,
        APPDATA: path.join(home, "AppData", "Roaming"),
        LOCALAPPDATA: path.join(home, "AppData", "Local"),
      }
    : { PATH: "/usr/bin:/bin" };
  return { ...base, HOME: home, TMPDIR: tmpdir(), ...(MAC ? {} : { ENSO_SECRETS: "file" }), ...extra };
}

/** The data / log folder a helper started with isolatedEnv(home) uses. */
export const dataDirFor = home => dataDir({ home, env: WIN ? { APPDATA: path.join(home, "AppData", "Roaming") } : {} });
export const logDirFor = home => logDir({ home, env: WIN ? { LOCALAPPDATA: path.join(home, "AppData", "Local") } : {} });
