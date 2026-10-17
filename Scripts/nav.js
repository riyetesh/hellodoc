/* ============================================================
   HelloDoc - Shared navbar behavior
   Loaded by every page so the navbar acts the same everywhere:
   logo-triggered mobile menu, scroll shadow, live appointments badge,
   the logged-in user chip (fetched from the backend session), and the
   current-page highlight for the shared navbar.
   Requires app.css for markup/classes. Optionally uses
   appointments.js for the badge count.
   ============================================================ */

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  // There is no hamburger button any more. Below the mobile breakpoint the
  // logo/wordmark is the menu trigger; on wider screens it stays a plain link
  // to the home page, so it only becomes a disclosure while that matches.
  // Must match the nav-collapse breakpoint in Styles/app.css (1200px): the
  // canonical navbar has seven items, so it stacks into the menu earlier.
  const mobileNav = window.matchMedia("(max-width: 1200px)");

  function initMenu() {
    const brand = $(".navbar-brand");
    const links = $("#navLinks");
    const actions = $("#navActions");
    if (!brand || !links || !actions) return;

    function isOpen() {
      return links.classList.contains("open");
    }

    function setOpen(open) {
      links.classList.toggle("open", open);
      actions.classList.toggle("open", open);
      brand.setAttribute("aria-expanded", open ? "true" : "false");
      brand.setAttribute(
        "aria-label",
        open
          ? "HelloDoc, close the navigation menu"
          : "HelloDoc, open the navigation menu"
      );
    }

    function close() {
      setOpen(false);
    }

    // Mobile: the brand is a disclosure button for the menu.
    function asMenuTrigger() {
      brand.setAttribute("aria-controls", "navLinks");
      setOpen(false);
    }

    // Desktop: strip the disclosure attributes so the brand is just the home link.
    // `close()` sets those same attributes, so it has to run first.
    function asLink() {
      close();
      brand.removeAttribute("aria-controls");
      brand.removeAttribute("aria-expanded");
      brand.removeAttribute("aria-label");
    }

    brand.addEventListener("click", (event) => {
      if (!mobileNav.matches) return;
      event.preventDefault();
      setOpen(!isOpen());
    });

    // With no close button, the menu has to be dismissable in the usual ways:
    // a click outside it, Escape, or leaving the breakpoint entirely.
    document.addEventListener("click", (event) => {
      if (!mobileNav.matches || !isOpen()) return;
      const inside =
        brand.contains(event.target) ||
        links.contains(event.target) ||
        actions.contains(event.target);
      if (!inside) close();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && isOpen()) {
        close();
        brand.focus();
      }
    });

    function sync() {
      if (mobileNav.matches) asMenuTrigger();
      else asLink();
    }

    sync();
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
        if (data.role === "doctor") {
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
      window.location.href = chip.dataset.role === 'doctor' ? 'doctor.html' : 'patient.html';
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
