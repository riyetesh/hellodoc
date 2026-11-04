/* ============================================================
   HelloDoc - "The Story Behind the Project" page behaviour
   Loaded only by story.html. Follows the same conventions as
   Scripts/nav.js (single IIFE, strict mode, DOMContentLoaded).

   Fail-safe design: every conditional class that hides content
   (.hs-anim for scroll reveals, .hs-tabs for the timeline panels)
   is added by this script *after* the corresponding behaviour has
   been wired up. If this file fails to load or throws, nothing is
   hidden and the whole story stays readable. Motion is skipped
   entirely when the visitor prefers reduced motion.
   ============================================================ */

(function () {
  "use strict";

  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------- */
  /* Reading progress (decorative)                              */
  /* ---------------------------------------------------------- */
  function initProgress() {
    var bar = $("[data-progress]");
    if (!bar) return;

    var ticking = false;

    function update() {
      var doc = document.documentElement;
      var scrollable = doc.scrollHeight - window.innerHeight;
      var percent = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
      bar.style.width = Math.min(100, Math.max(0, percent)).toFixed(2) + "%";
      ticking = false;
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  /* ---------------------------------------------------------- */
  /* Timeline: tabs on desktop, vertical steps on mobile        */
  /* ---------------------------------------------------------- */
  function initTimeline() {
    var timeline = $("[data-timeline]");
    if (!timeline) return false;
    var tabs = $$("[data-timeline-tab]", timeline);
    if (!tabs.length) return false;
    var panels = tabs.map(function (tab) {
      var id = tab.getAttribute("aria-controls");
      return id ? document.getElementById(id) : null;
    });
    if (panels.some(function (panel) { return !panel; })) return false;

    // Hide all but the selected panel only after every matching panel is found.
    function select(index, moveFocus) {
      tabs.forEach(function (tab, i) {
        var active = i === index;
        tab.setAttribute("aria-selected", active ? "true" : "false");
        tab.tabIndex = active ? 0 : -1;
        tab.classList.toggle("is-selected", active);
        panels[i].classList.toggle("is-active", active);
        panels[i].hidden = !active;
      });
      if (moveFocus) tabs[index].focus();
    }
    tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () { select(index, false); });
      tab.addEventListener("keydown", function (event) {
        var next = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        if (next === null) return;
        event.preventDefault();
        select(next, true);
      });
    });
    var initial = tabs.findIndex(function (tab) { return tab.getAttribute("aria-selected") === "true"; });
    timeline.classList.add("hs-tabs");
    select(initial < 0 ? 0 : initial, false);
    return true;
  }

  /* ---------------------------------------------------------- */
  /* Scroll reveals                                             */
  /* ---------------------------------------------------------- */
  function initReveals() {
    var items = $$("[data-reveal]");
    if (!items.length) return false;
    if (reduceMotion || typeof window.IntersectionObserver !== "function") return false;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 }
    );

    // Mark anything already on screen before the hiding class is applied,
    // so nothing flashes and nothing below the fold is ever stuck hidden.
    items.forEach(function (el) {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) {
        el.classList.add("is-visible");
      }
      observer.observe(el);
    });

    // Content inside a closed <details> never intersects; reveal it on open.
    $$("details").forEach(function (details) {
      details.addEventListener("toggle", function () {
        if (!details.open) return;
        $$("[data-reveal]", details).forEach(function (el) {
          el.classList.add("is-visible");
        });
      });
    });

    return true;
  }

  /* ---------------------------------------------------------- */
  /* Architecture diagram                                       */
  /* ---------------------------------------------------------- */
  function initDiagram() {
    const diagram = document.querySelector('[data-diagram]');
    if (!diagram) return;
    const nodes = Array.from(diagram.querySelectorAll('[data-flow-step]'));
    const detail = diagram.querySelector('[data-node-detail]');
    const source = diagram.querySelector('[data-detail-source]');
    if (!nodes.length || !detail || !source) return;

    function select(index) {
      const item = source.querySelector('#' + nodes[index].dataset.detail);
      if (!item) return;
      nodes.forEach((node, i) => {
        node.classList.toggle('is-active', i === index);
        node.setAttribute('aria-current', i === index ? 'step' : 'false');
      });
      const label = document.createElement('span');
      label.className = 'hs-detail-kicker';
      label.textContent = 'Inside step ' + String(index + 1).padStart(2, '0');
      detail.replaceChildren(label, ...Array.from(item.childNodes, child => child.cloneNode(true)));
    }

    detail.id = 'hs-flow-detail';
    nodes.forEach((node, index) => {
      node.setAttribute('aria-controls', detail.id);
      node.addEventListener('click', () => select(index));
      node.addEventListener('keydown', event => {
        const columns = getComputedStyle(nodes[0].closest('ol')).gridTemplateColumns.split(' ').length;
        let next = index;
        if (event.key === 'ArrowRight') next++;
        else if (event.key === 'ArrowLeft') next--;
        else if (event.key === 'ArrowDown') next += columns;
        else if (event.key === 'ArrowUp') next -= columns;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = nodes.length - 1;
        else return;
        event.preventDefault();
        next = Math.max(0, Math.min(nodes.length - 1, next));
        nodes[next].focus();
        select(next);
      });
    });
    select(0);
  }

  /* ---------------------------------------------------------- */
  /* Algorithm demo stepper                                     */
  /* ---------------------------------------------------------- */
  function initDemo() {
    var demo = $("[data-svc-demo]");
    if (!demo) return;
    var stages = $$("[data-demo-stage]", demo);
    if (!stages.length) return;
    var next = $("[data-demo-next]", demo);
    var reset = $("[data-demo-reset]", demo);
    var status = $("[data-demo-status]", demo);
    var progress = $("[data-demo-progress]", demo);
    var indicators = $$("[data-demo-indicator]", demo);
    var labels = ["Symptoms", "Feature vector", "Model comparison", "Guidance lookup"];
    var current = 0;
    function render() {
      stages.forEach(function (stage, i) {
        var active = i === current;
        stage.classList.toggle("is-active", active);
        stage.hidden = !active;
        stage.setAttribute("aria-hidden", active ? "false" : "true");
      });
      indicators.forEach(function (item, i) {
        item.classList.toggle("is-current", i === current);
        item.classList.toggle("is-done", i < current);
      });
      if (progress) progress.style.width = ((current + 1) / stages.length * 100) + "%";
      if (status) status.textContent = "Step " + (current + 1) + " of " + stages.length + " · " + (labels[current] || "Step");
      if (next) next.innerHTML = current === stages.length - 1 ? '<i class="fa-solid fa-rotate" aria-hidden="true"></i> Start again' : '<i class="fa-solid fa-arrow-right" aria-hidden="true"></i> Next step';
    }
    if (next) next.addEventListener("click", function () { current = current === stages.length - 1 ? 0 : current + 1; render(); });
    if (reset) reset.addEventListener("click", function () { current = 0; render(); });
    render();
  }

  /* ---------------------------------------------------------- */
  /* Subtle hero image movement (desktop, motion allowed)       */
  /* ---------------------------------------------------------- */
  function initParallax() {
    var figure = $("[data-parallax]");
    if (!figure || reduceMotion) return;
    if (window.innerWidth < 1024) return;

    var ticking = false;

    function apply() {
      var rect = figure.getBoundingClientRect();
      // Progress of the figure through the viewport, roughly -1..1
      var progress = (rect.top + rect.height / 2 - window.innerHeight / 2) / window.innerHeight;
      var shift = Math.max(-24, Math.min(24, -progress * 24));
      figure.style.setProperty("--hs-parallax", shift.toFixed(1) + "px");
      ticking = false;
    }

    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(apply);
    }

    figure.classList.add("is-parallax");
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    apply();
  }

  /* ---------------------------------------------------------- */
  /* Boot                                                       */
  /* ---------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", function () {
    initProgress();
    initDiagram();
    initDemo();
    initParallax();

    var tabsReady = false;
    var revealsReady = false;

    try {
      tabsReady = initTimeline();
      revealsReady = initReveals();
    } catch (error) {
      // Never let a failure here hide content.
      tabsReady = false;
      revealsReady = false;
      if (window.console && console.error) console.error("Story page enhancement failed:", error);
    }

    var root = document.documentElement;
    if (tabsReady) root.classList.add("hs-tabs");
    if (revealsReady) root.classList.add("hs-anim");
  });
})();
