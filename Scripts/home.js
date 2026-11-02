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

  /* ---- Online-doctor illustration rotation -------------------- */
  function initDoctorIllustrationRotation() {
    const illustration = $(".lp-story__image");
    if (!illustration || typeof illustration.animate !== "function") return;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let rotation = null;

    function syncRotation() {
      if (motionPreference.matches) {
        if (rotation) {
          rotation.cancel();
          rotation = null;
        }
        return;
      }

      if (!rotation) {
        rotation = illustration.animate(
          [
            { transform: "rotate(0deg)" },
            { transform: "rotate(360deg)" }
          ],
          {
            duration: 60000,
            iterations: Infinity,
            easing: "linear"
          }
        );
      }
    }

    syncRotation();

    if (typeof motionPreference.addEventListener === "function") {
      motionPreference.addEventListener("change", syncRotation);
    } else if (typeof motionPreference.addListener === "function") {
      motionPreference.addListener(syncRotation);
    }

    // Pause while the tab is hidden to avoid unnecessary background animation.
    document.addEventListener("visibilitychange", () => {
      if (!rotation) return;
      if (document.hidden) rotation.pause();
      else rotation.play();
    });
  }

  function init() {
    initTabGroups();
    initDoctorIllustrationRotation();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
