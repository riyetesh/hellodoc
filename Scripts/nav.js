/* ============================================================
   HelloDoc - Shared navbar behavior
   Loaded by every page so the navbar acts the same everywhere:
   mobile menu toggle, scroll shadow, live appointments badge,
   and the logged-in user chip (fetched from the backend session).
   Requires app.css for markup/classes. Optionally uses
   appointments.js for the badge count.
   ============================================================ */

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  function initMenu() {
    const toggle = $("#menuToggle");
    const links = $("#navLinks");
    const actions = $("#navActions");
    if (!toggle || !links || !actions) return;

    toggle.addEventListener("click", () => {
      const open = toggle.classList.toggle("open");
      links.classList.toggle("open", open);
      actions.classList.toggle("open", open);
    });
  }

  function initScrollShadow() {
    const navbar = $("#navbar");
    if (!navbar) return;

    window.addEventListener("scroll", () => {
      navbar.classList.toggle("scrolled", window.scrollY > 8);
    });
  }

  function initBadge() {
    if (typeof window.refreshAppointmentBadge === "function") {
      window.refreshAppointmentBadge();
      // Keep the badge fresh when another tab books or cancels.
      window.addEventListener("appointments:changed", window.refreshAppointmentBadge);
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

    // Let pages that care (the dashboard greeting) react when the session is
    // resolved, whether it happens before or after they initialize.
    try {
      sessionStorage.setItem("hellodoc.userName", pretty);
      window.dispatchEvent(
        new CustomEvent("hellodoc:user", { detail: { name: pretty, email } })
      );
    } catch {
      // sessionStorage unavailable, the event still fires.
    }
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
      }
    } catch {
      // Backend unreachable, keep the guest buttons.
    }
  }

  function initUserChip() {
    const chip = $("#userChip");
    if (!chip) return;
    chip.addEventListener("click", () => {
      window.location.href = "appointments.html";
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initMenu();
    initScrollShadow();
    initBadge();
    initUserChip();
    initAuth();
  });
})();
