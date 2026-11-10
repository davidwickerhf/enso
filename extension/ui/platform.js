// What the UI says differently per operating system. Data, not branches in
// every view: which systems the helper runs on, the install command and how to
// open the terminal it goes in, where the helper's files are by default (the
// helper sends the real paths once it runs), and how keyboard shortcuts read.
//
// `os` is runtime.getPlatformInfo().os: "mac" | "linux" | "win" | "android" |
// "cros" | "openbsd" | "fuchsia" (the mock fakes it with ?platform=).

const SITE = "https://enso.wicker.life";

/** The systems Ensō's helper runs on (helper/lib/platform.mjs SUPPORTED_PLATFORMS, in the browser's names). */
export const SUPPORTED_OSES = ["mac", "linux", "win"];
export const OS_NAMES = { mac: "macOS", linux: "Linux", win: "Windows", cros: "ChromeOS", android: "Android", openbsd: "OpenBSD", fuchsia: "Fuchsia" };

export const isSupportedOs = os => !os || SUPPORTED_OSES.includes(os);
const list = names => names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
export const supportedText = () => list(SUPPORTED_OSES.map(o => OS_NAMES[o]));
export const unsupportedText = os => `Ensō's helper runs on ${supportedText()}${os ? `; ${OS_NAMES[os] ?? os} isn't supported` : ""}.`;

/** Before getPlatformInfo answers: a guess from the user agent. */
export function guessOs(nav = globalThis.navigator) {
  const p = `${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`;
  return /Mac/.test(p) ? "mac" : /Win/.test(p) ? "win" : /Linux|X11/.test(p) ? "linux" : null;
}

/**
 * How to install on this system: the command, the shell it runs in, and the
 * steps to open that shell and paste (keys as arrays for <kbd>).
 */
export function installInfo(os) {
  if (os === "win") {
    return {
      shell: "powershell",
      command: `irm ${SITE}/install.ps1 | iex`,
      script: `${SITE}/install.ps1`,
      terminal: "PowerShell",
      open: ["Press ", ["Win"], ", type ", { em: "PowerShell" }, " and press ", ["Enter"], "."],
      paste: [["Ctrl"], " ", ["V"], ", then ", ["Enter"], ". It takes under a minute and asks no questions."],
      pasteTitle: "Paste it and press Enter",
      folder: "%APPDATA%\\Enso",
      nodeNote: "Its own copy of Node.js (about 30 MB to download) only if Windows doesn't have Node 18 or newer.",
      noAdmin: "Nothing outside your user profile, no administrator rights. Safe to run again: it's also how you update.",
      where: "a registry entry that tells Zen where it is",
    };
  }
  const linux = os === "linux";
  return {
    shell: "bash",
    command: `curl -fsSL ${SITE}/install.sh | bash`,
    script: `${SITE}/install.sh`,
    terminal: linux ? "a terminal" : "Terminal",
    open: linux
      ? ["Open your terminal app (often ", ["Ctrl"], " ", ["Alt"], " ", ["T"], ")."]
      : ["Press ", ["⌘"], " ", ["Space"], ", type ", { em: "Terminal" }, " and press ", ["Return"], "."],
    paste: linux
      ? [["Ctrl"], " ", ["Shift"], " ", ["V"], ", then ", ["Enter"], ". It takes under a minute and asks no questions."]
      : [["⌘"], " ", ["V"], ", then ", ["Return"], ". It takes under a minute and asks no questions."],
    pasteTitle: linux ? "Paste it and press Enter" : "Paste it and press Return",
    folder: linux ? "~/.local/share/enso" : "~/Library/Application Support/Enso",
    nodeNote: `Its own copy of Node.js (about 27 MB to download) only if your ${linux ? "computer" : "Mac"} doesn't have Node 18 or newer.`,
    noAdmin: `Nothing outside your home folder, no ${linux ? "sudo" : "administrator password"}. Safe to run again: it's also how you update.`,
    where: "a file that tells Zen where it is",
  };
}

/** Default helper.log path (the helper reports the real one in `helper.log` / Setup). */
export function logPath(os) {
  return os === "win" ? "%LOCALAPPDATA%\\Enso\\Logs\\helper.log" : os === "linux" ? "~/.local/state/enso/helper.log" : "~/Library/Logs/Enso/helper.log";
}

/** How to get to that file in the system's file manager. */
export function openFolderHint(os) {
  return os === "win" ? "in File Explorer: paste the path into the address bar" : os === "linux" ? "in your file manager: Ctrl+L, paste the path" : "in Finder: Go → Go to Folder…, paste the path";
}

/** Where secrets go, when the helper hasn't said (it reports secrets.location in Setup). */
export function secretStoreName(os) {
  return os === "win" ? "the Windows Credential Manager" : os === "linux" ? "your desktop keyring" : "your macOS Keychain";
}

/** Modifier keys as shown in hints. */
export function keys(os) {
  const mac = os === "mac" || (!os && guessOs() === "mac");
  return mac
    ? { mod: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃", join: "", open: "⌘E", shot: "⌘⇧2", paste: "⌘V" }
    : { mod: "Ctrl", shift: "Shift", alt: "Alt", ctrl: "Ctrl", join: "+", open: "Ctrl+E", shot: "Ctrl+Shift+2", paste: "Ctrl+V" };
}
