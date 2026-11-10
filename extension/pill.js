// The click target over the page pill (see pageagent.js). Opening the sidebar
// needs a user action in an extension page, so it happens here, synchronously
// in the click handler; background.js then points the sidebar at the agent card.
//
// Session-access requests: the pill can show "<Client> wants to use your login
// on <site>" with Allow / Not now. Those clicks also land here (this frame
// covers the whole pill), and this is the only place in the page they count:
// the site's scripts can't run code in or click into this extension page, and
// clicks that aren't real (event.isTrusted false) are ignored. background.js
// asks the content script which button was under (x, y), checks the request is
// for the tab's site and tells the helper.

const tell = msg => browser.runtime.sendMessage({ ensoPill: msg.kind, ...msg }).catch(() => {});

// Where the request rows are (frame pixels), from pageagent.js: a click there
// doesn't open the sidebar. Only that: a page faking this message can at most
// keep the sidebar from opening; whether a click allows anything is decided by
// background.js and the content script.
let quiet = [];
window.addEventListener("message", e => {
  if (e.source !== window.parent || !Array.isArray(e.data?.ensoPillZones)) return;
  quiet = e.data.ensoPillZones.slice(0, 10).map(r => ({ top: Number(r.top) || 0, bottom: Number(r.bottom) || 0 }));
});

document.querySelector("button").addEventListener("click", e => {
  if (!e.isTrusted) return; // only the user's own clicks
  const x = e.clientX;
  const y = e.clientY;
  if (quiet.some(r => y >= r.top && y <= r.bottom)) return void tell({ kind: "click", opened: false, x, y, trusted: true });
  let opening;
  try {
    opening = browser.sidebarAction.open(); // must be the first thing in the handler
  } catch (err) {
    opening = Promise.reject(err);
  }
  opening.then(
    () => tell({ kind: "click", opened: true, x, y, trusted: true }), // y: which agent's row, when the pill is expanded
    () => tell({ kind: "click", opened: false, x, y, trusted: true }),
  );
});

tell({ kind: "ready" });
