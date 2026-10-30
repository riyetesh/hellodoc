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
      return document.getElementById(tab.getAttribute("aria-controls"));
    });

    function select(index, moveFocus) {
      tabs.forEach(function (tab, i) {
        var on = i === index;
        tab.setAttribute("aria-selected", on ? "true" : "false");
        tab.tabIndex = on ? 0 : -1;
        tab.classList.toggle("is-selected", on);
        if (panels[i]) panels[i].classList.toggle("is-active", on);
      });
      if (moveFocus) tabs[index].focus();
    }

    tabs.forEach(function (tab, index) {
      tab.addEventListener("click", function () {
        select(index, false);
      });

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

    // Start from whatever the markup says is selected, defaulting to the first step.
    var initial = tabs.findIndex(function (tab) {
      return tab.getAttribute("aria-selected") === "true";
    });
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
    if (!nodes.length) return;

    // The animated flow covers the prediction path only: the account lane is a
    // separate concern, and animating both in one sequence would imply a single
    // synchronous chain that does not exist.
    var flowNodes = $$("[data-flow-step]", diagram);
    if (!flowNodes.length) flowNodes = nodes;

    var detail = $("[data-node-detail]", diagram);
    var status = $("[data-flow-status]", diagram);
    var playButton = $("[data-flow-play]", diagram);
    var resetButton = $("[data-flow-reset]", diagram);
    var source = $("[data-detail-source]", diagram);
    var timer = null;
    var index = 0;
    var initialDetail = detail ? detail.cloneNode(true) : null;
    var defaultStatus = status ? status.textContent : "";

    function nodeName(node) {
      var name = $(".hs-node__name", node);
      return name ? name.textContent.trim() : "step";
    }

    function showDetail(id) {
      if (!detail || !source || !id) return;
      var copy = source.querySelector("#" + id);
      if (!copy) return;
      var clone = copy.cloneNode(true);
      clone.removeAttribute("id");
      detail.replaceChildren.apply(detail, Array.prototype.slice.call(clone.childNodes));
    }

    function restoreDetail() {
      if (!detail || !initialDetail) return;
      var clone = initialDetail.cloneNode(true);
      detail.replaceChildren.apply(detail, Array.prototype.slice.call(clone.childNodes));
    }

    function clearMarks() {
      nodes.forEach(function (node) {
        node.classList.remove("is-active");
        var item = node.closest("li");
        if (item) item.classList.remove("is-current", "is-done");
      });
    }

    function stopPlayback() {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function markStep(currentIndex) {
      flowNodes.forEach(function (node, i) {
        var item = node.closest("li");
        if (!item) return;
        item.classList.toggle("is-current", i === currentIndex);
        item.classList.toggle("is-done", i < currentIndex);
      });
      flowNodes[currentIndex].classList.add("is-active");
    }

    function play() {
      stopPlayback();
      clearMarks();
      index = 0;

      function advance() {
        if (index >= flowNodes.length) {
          timer = null;
          if (status) {
            status.textContent =
              "Flow complete: the prediction path, " +
              flowNodes.length +
              " steps from symptom input to the results page. The account lane is separate and not part of this sequence.";
          }
          return;
        }
        var current = index;
        markStep(current);
        showDetail(flowNodes[current].getAttribute("data-detail"));
        if (status) {
          status.textContent =
            "Step " + (current + 1) + " of " + flowNodes.length + ": " + nodeName(flowNodes[current]);
        }
        index += 1;
        // Reduced motion: step through instantly instead of animating.
        timer = window.setTimeout(advance, reduceMotion ? 0 : 2400);
      }

      advance();
    }

    function reset() {
      stopPlayback();
      clearMarks();
      index = 0;
      restoreDetail();
      if (status) status.textContent = defaultStatus;
    }

    nodes.forEach(function (node) {
      node.addEventListener("click", function () {
        stopPlayback();
        clearMarks();
        node.classList.add("is-active");
        showDetail(node.getAttribute("data-detail"));
        var item = node.closest("li");
        if (item) item.classList.add("is-current");
        if (status) status.textContent = "Selected: " + nodeName(node);
      });
    });

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
    var current = 0;

    function render() {
      stages.forEach(function (stage, i) {
        stage.classList.toggle("is-active", i === current);
      });
      if (status) status.textContent = "Step " + (current + 1) + " of " + stages.length;
      if (next) next.disabled = current === stages.length - 1;
    }

    if (next) {
      next.addEventListener("click", function () {
        if (current < stages.length - 1) current += 1;
        render();
      });
    }

    if (reset) {
      reset.addEventListener("click", function () {
        current = 0;
        render();
      });
    }

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
