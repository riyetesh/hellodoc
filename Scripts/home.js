/* HelloDoc homepage interactions: accessible tab groups only. */

(function () {
  "use strict";

  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));

  /* ---- Tabs ---------------------------------------------------- */
  function initTabGroups() {
    $$("[data-tabs]").forEach((group) => {
      const list = $("[role='tablist']", group);
      if (!list) return;
      const tabs = $$("[role='tab']", list);
      const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));
      if (!tabs.length || panels.some((panel) => !panel)) return;

      // Without JavaScript every panel stays visible, so the page still
      // explains itself. Only now do the inactive panels get hidden.
      function select(index, focus) {
        tabs.forEach((tab, i) => {
          const active = i === index;
          tab.classList.toggle("is-active", active);
          tab.setAttribute("aria-selected", active ? "true" : "false");
          tab.tabIndex = active ? 0 : -1;
          panels[i].hidden = !active;
          panels[i].classList.toggle("is-active", active);
        });
        if (focus && tabs[index]) tabs[index].focus();
      }

      tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => select(index, false));
        tab.addEventListener("keydown", (event) => {
          const last = tabs.length - 1;
          let next = null;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
          else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = last;
          if (next === null) return;
          event.preventDefault();
          select(next, true);
        });
      });

      const initial = Math.max(0, tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true"));
      select(initial, false);
    });
  }

  function init() {
    initTabGroups();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
