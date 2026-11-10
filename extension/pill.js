// The click target over the page pill (see pageagent.js). Opening the sidebar
// needs a user action in an extension page, so it happens here, synchronously
// in the click handler; background.js then points the sidebar at the agent card.

const tell = msg => browser.runtime.sendMessage({ ensoPill: msg.kind, ...msg }).catch(() => {});

document.querySelector("button").addEventListener("click", e => {
  let opening;
  try {
    opening = browser.sidebarAction.open(); // must be the first thing in the handler
  } catch (err) {
    opening = Promise.reject(err);
  }
  opening.then(
    () => tell({ kind: "click", opened: true, y: e.clientY }), // y: which agent's row, when the pill is expanded
    () => tell({ kind: "click", opened: false, y: e.clientY }),
  );
});

tell({ kind: "ready" });
