// First run: Ensō asks who you are before the first conversation. Two short
// steps (you, then optionally what each Zen space is for), saved to the
// helper with `profile.save` (profile.md and settings.spaceHints in the data
// folder). Everything can be changed later in Settings → You & memory; "Skip for
// now" just marks onboarding as done.

import { h, clear, spaceIcon } from "../dom.js";

const ABOUT_PLACEHOLDER = "What you do, where you're based, the projects and tools you use, and how you like answers. For example:\n- Product designer at a small studio, based in Lisbon\n- Mail in Gmail, work chat in Slack\n- Short answers; tables when comparing things";

/** Profile fields shared by onboarding and Settings → You & memory. */
export function profileFields(store, draft, { idPrefix = "pf", onInput = () => {} } = {}) {
  const name = h("input", { type: "text", class: "input", id: `${idPrefix}-name`, value: draft.name ?? "", maxlength: 80, autocomplete: "given-name", placeholder: "Your first name", aria: { required: "true" } });
  const about = h("textarea", { class: "input", id: `${idPrefix}-about`, rows: 6, placeholder: ABOUT_PLACEHOLDER, maxlength: 4000 });
  about.value = draft.about ?? "";
  name.addEventListener("input", () => { draft.name = name.value; onInput(); });
  about.addEventListener("input", () => { draft.about = about.value; onInput(); });
  return {
    name,
    about,
    el: h("div", { class: "pf-fields" },
      h("label", { class: "field", for: `${idPrefix}-name` }, h("span", null, "Name"), name),
      h("label", { class: "field", for: `${idPrefix}-about` }, h("span", null, "About you"), about,
        h("small", { class: "muted" }, "A few lines is plenty. Ensō reads this at the start of every conversation."))),
  };
}

/** One row per Zen space: its icon and name, and what it is for. */
export function spaceHintFields(spaces, draft, { idPrefix = "sh", onInput = () => {} } = {}) {
  return h("ul", { class: "sh-list" }, spaces.map((sp, i) => {
    const id = `${idPrefix}-${i}`;
    const input = h("input", { type: "text", class: "input", id, value: draft.spaceHints?.[sp.id] ?? "", maxlength: 600, placeholder: i === 0 ? "e.g. Personal: life admin, side projects, my own accounts" : "e.g. Work at Northwind: Figma, Linear; use my work accounts" });
    input.addEventListener("input", () => { draft.spaceHints = { ...draft.spaceHints, [sp.id]: input.value }; onInput(); });
    return h("li", { class: "sh-row" },
      h("label", { class: "sh-name", for: id }, spaceIcon(sp), h("span", null, sp.name || "Unnamed space")),
      input);
  }));
}

export function createOnboarding(store) {
  const { state: s, actions } = store;
  const el = h("div", { class: "onboarding", role: "dialog", aria: { modal: "true", labelledby: "ob-title" } });
  const draft = { name: "", about: "", spaceHints: {} };
  let step = 0;
  let error = "";
  let seeded = false;

  const steps = () => (s.spaces?.length ? ["you", "spaces"] : ["you"]);

  function next() {
    if (steps()[step] === "you" && !draft.name.trim()) {
      error = "Add your name so Ensō knows what to call you.";
      render();
      el.querySelector("#ob-name")?.focus();
      return;
    }
    error = "";
    if (step < steps().length - 1) { step++; render(); focusFirst(); return; }
    actions.saveProfile({ name: draft.name, about: draft.about, spaceHints: draft.spaceHints });
  }

  function focusFirst() {
    requestAnimationFrame(() => el.querySelector("input, textarea")?.focus({ preventScroll: true }));
  }

  function render() {
    if (!seeded && s.profile) {
      // Someone who skipped once, or a profile written by hand, starts from what is there.
      draft.name = s.profile.name ?? "";
      draft.about = s.profile.about ?? "";
      draft.spaceHints = { ...(s.profile.spaceHints ?? {}) };
      seeded = true;
    }
    const all = steps();
    const which = all[Math.min(step, all.length - 1)];
    const dots = all.length > 1 ? h("ol", { class: "ob-steps", aria: { label: `Step ${step + 1} of ${all.length}` } }, all.map((_, i) => h("li", { class: [i === step && "on", i < step && "done"] }))) : null;
    const body = which === "you"
      ? [
          h("h1", { id: "ob-title", class: "ob-title" }, "Welcome to Ensō"),
          h("p", { class: "ob-lede" }, "Tell Ensō a little about yourself, so its answers fit you. This stays on your Mac, and you can change it any time in Settings → You & memory."),
          profileFields(store, draft, { idPrefix: "ob" }).el,
        ]
      : [
          h("h1", { id: "ob-title", class: "ob-title" }, "Your Zen spaces"),
          h("p", { class: "ob-lede" }, "Optional: say what each space is for. Ensō keeps a conversation to the space it started in, and uses these notes there."),
          spaceHintFields(s.spaces, draft, { idPrefix: "ob-sh" }),
        ];
    const last = step === all.length - 1;
    clear(el, h("div", { class: "ob-card" },
      h("div", { class: "ob-head" }, h("img", { class: "ob-mark", src: "icons/enso.svg", alt: "", width: 36, height: 36 }), dots),
      h("form", { class: "ob-form", novalidate: true, onsubmit: e => { e.preventDefault(); next(); } },
        ...body,
        error ? h("p", { class: "form-error", role: "alert" }, error) : null,
        h("div", { class: "ob-actions" },
          step > 0 ? h("button", { type: "button", class: "btn ghost", onclick: () => { step--; error = ""; render(); focusFirst(); } }, "Back") : h("button", { type: "button", class: "btn ghost", onclick: () => actions.skipOnboarding() }, "Skip for now"),
          h("button", { type: "submit", class: "btn primary", disabled: !!s.profileSaving }, s.profileSaving ? "Saving…" : last ? "Start using Ensō" : "Continue")))));
  }

  return {
    el,
    show() { step = 0; error = ""; render(); focusFirst(); },
    update(topics) { if (topics.has("space") || topics.has("profile")) render(); },
  };
}
