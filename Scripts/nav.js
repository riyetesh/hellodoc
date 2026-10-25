/* ============================================================
   HelloDoc - Shared navbar behavior
   Loaded by every page so the navbar acts the same everywhere:
   menu button, scroll shadow, live appointments badge,
   the logged-in user chip (fetched from the backend session), and the
   current-page highlight for the shared navbar.
   Requires app.css for markup/classes. Optionally uses
   appointments.js for the badge count.
   ============================================================ */

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  // Below the collapse breakpoint the canonical navbar becomes a menu behind a
  // conventional menu button, so the logo stays a plain home link at every
  // width. The breakpoint must match Styles/app.css (1200px).
  const mobileNav = window.matchMedia("(max-width: 1200px)");

  function initMenu() {
    const toggle = $(".nav-toggle");
    const links = $("#navLinks");
    const actions = $("#navActions");
    if (!toggle || !links || !actions) return;

    function isOpen() {
      return toggle.getAttribute("aria-expanded") === "true";
    }

    function setOpen(open) {
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute(
        "aria-label",
        open ? "Close navigation menu" : "Open navigation menu"
      );
      links.classList.toggle("open", open);
      actions.classList.toggle("open", open);
    }

    toggle.addEventListener("click", () => setOpen(!isOpen()));

    // A menu that is not a dialog still has to close in the usual ways:
    // a click outside it, Escape (returning focus to the button), or leaving
    // the breakpoint entirely.
    document.addEventListener("click", (event) => {
      if (!isOpen()) return;
      const inside =
        toggle.contains(event.target) ||
        links.contains(event.target) ||
        actions.contains(event.target);
      if (!inside) setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen()) {
        setOpen(false);
        toggle.focus();
      }
    });

    // Above the breakpoint the links are always on screen and the button is
    // hidden, so an open state must not survive a resize.
    function sync() {
      if (!mobileNav.matches) setOpen(false);
    }

    setOpen(false);
    if (mobileNav.addEventListener) mobileNav.addEventListener("change", sync);
    else if (mobileNav.addListener) mobileNav.addListener(sync); // older Safari
  }

  function initScrollShadow() {
    const navbar = $("#navbar");
    if (!navbar) return;

    window.addEventListener("scroll", () => {
      navbar.classList.toggle("scrolled", window.scrollY > 8);
    });
  }

  // The navbar markup is the same canonical block on every page, so the
  // current page is highlighted from the URL rather than by a class someone
  // has to remember to add (or remove) on each page.
  function initActiveLink() {
    const links = document.querySelectorAll("#navLinks .nav-link");
    if (!links.length) return;

    const lastSegment = window.location.pathname.replace(/\/+$/, "").split("/").pop();
    const current = (lastSegment || "index.html").toLowerCase();

    links.forEach((link) => {
      const href = (link.getAttribute("href") || "").split("#")[0].split("?")[0];
      // "../../dashboard.html" and "/predict" both normalise to a bare name.
      const target = href
        .replace(/^(\.\.\/|\.\/)+/, "")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "")
        .toLowerCase();

      const isCurrent = target !== "" && target === current;
      link.classList.toggle("active", isCurrent);
      if (isCurrent) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function initBadge() {
    if (typeof window.Appointments?.all === "function") {
      window.Appointments.all().catch(() => {});
    }
  }

  function showUser(name, email) {
    const pretty = name.replace(/\b\w/g, (c) => c.toUpperCase());
    const loginBtn = $("#loginBtn");
    const signupBtn = $("#signupBtn");
    const doctorLoginBtn = $('#doctorLoginBtn');
    if (doctorLoginBtn) doctorLoginBtn.hidden = true;
    const chip = $("#userChip");
    if (loginBtn) loginBtn.hidden = true;
    if (signupBtn) signupBtn.hidden = true;
    if (chip) {
      chip.hidden = false;
      const avatar = $("#userAvatar");
      const label = $("#userName");
      if (label) label.textContent = pretty;
      if (avatar) avatar.textContent = pretty.trim().charAt(0).toUpperCase() || "U";
      if (email) chip.title = email;
    }

    window.dispatchEvent(new CustomEvent("hellodoc:user", { detail: { name: pretty, email } }));
  }

  async function initAuth() {
    try {
      const res = await fetch("/api/auth/current-user", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        const email = data.email || (data.user && data.user.email) || "";
        const name =
          (data.user && data.user.firstName) ||
          (email ? email.split("@")[0].replace(/[._]/g, " ") : "there");
        showUser(name, email);
        const chip = $("#userChip");
        if (chip) chip.dataset.role = data.role;
        if (data.role === "doctor" && !/\/doctor\.html$/.test(window.location.pathname)) {
          const links = document.querySelector("#navLinks");
          if (links && !links.querySelector('a[href="doctor.html"]')) {
            const item = document.createElement('li');
            const anchor = document.createElement('a');
            anchor.href = 'doctor.html'; anchor.className = 'nav-link'; anchor.textContent = 'Doctor workspace';
            item.append(anchor); links.append(item);
          }
        }
        if (data.role === "patient") {
          const link = document.createElement("li");
          link.innerHTML = '<a href="patient.html" class="nav-link">My health</a>';
          const links = document.querySelector("#navLinks");
          if (links && !links.querySelector('a[href="patient.html"]')) links.appendChild(link);
        }
      }
    } catch {
      // Backend unreachable, keep the guest buttons.
    }
  }

  function initUserChip() {
    const chip = $("#userChip");
    if (!chip) return;
    chip.addEventListener("click", () => {
      window.location.href = chip.dataset.role === 'admin' ? '/admin' : chip.dataset.role === 'doctor' ? 'doctor.html' : 'patient.html';
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initMenu();
    initScrollShadow();
    initActiveLink();
    initBadge();
    initUserChip();
    initAuth();
  });
})();
