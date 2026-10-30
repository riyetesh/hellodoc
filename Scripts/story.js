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
    var diagram = $("[data-diagram]");
    if (!diagram) return;
    var nodes = $$("[data-node]", diagram);
    var flowNodes = $$("[data-flow-step]", diagram);
    var detail = $("[data-node-detail]", diagram);
    var source = $("[data-detail-source]", diagram);
    var status = $("[data-flow-status]", diagram);
    var playButton = $("[data-flow-play]", diagram);
    var resetButton = $("[data-flow-reset]", diagram);
    var speedInput = $("[data-flow-speed]", diagram);
    var speedValue = $("[data-flow-speed-value]", diagram);
    var playbackRate = 1;
    var initialDetail = detail ? detail.innerHTML : "";
    var initialStatus = status ? status.textContent : "";
    var timer = null, index = 0, complete = false;

    function stop() { if (timer !== null) { window.clearTimeout(timer); timer = null; } }
    function clear() {
      nodes.forEach(function (node) {
        node.classList.remove("is-active");
        var li = node.closest("li");
        if (li) li.classList.remove("is-current", "is-done");
      });
    }
    function detailFor(node) {
      var id = node && node.getAttribute("data-detail");
      var item = id && source ? source.querySelector("#" + id) : null;
      if (detail && item) {
        detail.innerHTML = '<span class="hs-detail-kicker">STEP DETAILS</span>' + item.innerHTML;
      }
    }
    function mark(i) {
      clear();
      flowNodes.forEach(function (node, n) {
        var li = node.closest("li");
        if (li) {
          li.classList.toggle("is-done", n < i);
          li.classList.toggle("is-current", n === i);
        }
      });
      var active = flowNodes[i];
      if (!active) return;
      active.classList.add("is-active");
      detailFor(active);
      if (status) status.textContent = "Step " + (i + 1) + " of " + flowNodes.length + ": " + ($(".hs-node__name", active) || active).textContent.trim();
      index = i + 1;
    }
    function choose(node) {
      stop(); complete = false; clear();
      var n = flowNodes.indexOf(node);
      index = n >= 0 ? n + 1 : 0;
      node.classList.add("is-active");
      var li = node.closest("li");
      if (li) li.classList.add("is-current");
      detailFor(node);
      if (status) status.textContent = "Selected: " + ($(".hs-node__name", node) || node).textContent.trim();
    }
    function play() {
      if (!flowNodes.length) return;
      stop();
      if (complete || index >= flowNodes.length) index = 0;
      function advance() {
        if (index >= flowNodes.length) {
          timer = null; complete = true;
          if (status) status.textContent = "Flow complete: 8 steps from symptom input to the assessment record.";
          return;
        }
        mark(index);
        timer = window.setTimeout(advance, reduceMotion ? 100 : 2400 / playbackRate);
      }
      advance();
    }
    function reset() {
      stop(); clear(); index = 0; complete = false;
      if (detail) detail.innerHTML = initialDetail;
      if (status) status.textContent = initialStatus;
    }
    nodes.forEach(function (node) {
      node.addEventListener("click", function () { choose(node); });
    });
    if (speedInput) {
      function updateSpeed() {
        playbackRate = Number(speedInput.value) || 1;
        if (speedValue) speedValue.textContent = playbackRate.toFixed(2).replace(/0+$/, "").replace(/\\.$/, "") + "×";
      }
      speedInput.addEventListener("input", updateSpeed);
      updateSpeed();
    }
    if (playButton) playButton.addEventListener("click", play);
    if (resetButton) resetButton.addEventListener("click", reset);
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
