// Runs before first paint on the new tab (a classic script in <head>, since
// extension pages can't run inline scripts). The static first frame in
// newtab.html (#boot) has to sit exactly where the app will draw the mark and
// the box, and the app moves them up when there are widgets
// (.nt-home.has-widgets in app.css). Mark the page so #boot matches.
try {
  const layout = JSON.parse(localStorage.getItem("enso.homeWidgets") || "null");
  if (Array.isArray(layout) && layout.length) document.documentElement.classList.add("boot-widgets");
} catch { /* private mode or bad JSON: draw the frame without widgets */ }

// The first frame already shows the mark, the box and the tools, so the app's
// entrance animations would make them blink out and fade back in. app.js
// removes this class a couple of frames after it replaces #boot.
document.documentElement.classList.add("booting");
