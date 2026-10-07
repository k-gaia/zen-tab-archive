// dryrun/probe-zen-library.js — read-only probe of Zen 1.23b's new Library
// feature, to find out where <zen-library> actually lives in the DOM, how
// it's mounted (always present vs created on open), and the real shape of
// zenLibrarySections, before attempting to inject our own section.
//
// Open the Library first (look for a library/shelf icon in the sidebar's
// bottom toolbar, or try Ctrl+Shift+B / the "cmd_zenToggleLibrary" command),
// THEN run this. Run: Ctrl+Shift+J -> paste -> Enter.

(() => {
  const lib = document.querySelector("zen-library");
  if (!lib) {
    console.log("%cno <zen-library> element found -- is it open? Try opening it first.", "color:#f7768e;font-weight:bold");
    // Still useful: is the custom element even registered?
    console.log("customElements.get('zen-library'):", customElements.get("zen-library"));
    return;
  }

  console.log("%cfound <zen-library>:", "font-weight:bold;color:#7aa2f7", lib);
  console.log("parentElement chain:", (() => {
    const chain = [];
    let el = lib;
    while (el && chain.length < 8) {
      chain.push(`${el.tagName}${el.id ? "#" + el.id : ""}`);
      el = el.parentElement;
    }
    return chain.join(" < ");
  })());

  console.log("connected to document:", lib.isConnected);
  console.log("hidden attribute:", lib.hidden, "| display:", getComputedStyle(lib).display);

  const sections = lib.zenLibrarySections;
  console.log("zenLibrarySections keys:", sections ? Object.keys(sections) : sections);
  if (sections) {
    for (const [key, Section] of Object.entries(sections)) {
      console.log(`  ${key}:`, { id: Section.id, label: Section.label, tabLabel: Section.tabLabel, hasRender: typeof Section.render === "function" });
    }
  }

  console.log("activeTab:", lib.activeTab);
  console.log("is a LitElement (has requestUpdate):", typeof lib.requestUpdate === "function");

  // Check whether mutating + requestUpdate actually works, non-destructively:
  // just read, don't add anything yet.
  console.log("%cshadowRoot present:", "color:#9ece6a", !!lib.shadowRoot);
})();
