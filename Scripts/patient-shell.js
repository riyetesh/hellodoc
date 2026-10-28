/* ============================================================
   HelloDoc - Patient workspace shell
   Shared by every patient page: confirms the session really is a
   patient, fills the account area in the rail, and owns the one
   sign-out implementation. Sign-out lives here, away from the
   healthcare navigation, so it is never mixed with a care action.
   ============================================================ */
(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const DESTINATIONS = { doctor: "/doctor.html", admin: "/admin" };

  async function readJson(response) {
    return response.json().catch(() => ({}));
  }

  // Verifies the session server-side. The browser never stores a role, so a
  // patient page cannot be reached by editing local state.
  async function requirePatient() {
    let response;
    try {
      response = await fetch("/api/auth/current-user", { credentials: "same-origin", cache: "no-store" });
    } catch {
      return { error: "We could not verify your session. Check your connection and try again." };
    }
    if (response.status === 401) {
      window.location.replace("/login.html?role=patient");
      return { redirecting: true };
    }
    const identity = await readJson(response);
    if (!response.ok) {
      return { error: identity.message || "We could not verify your session. Try again shortly." };
    }
    if (identity.role !== "patient" || !identity.userId) {
      window.location.replace(DESTINATIONS[identity.role] || "/login.html?role=patient");
      return { redirecting: true };
    }
    return { identity };
  }

  async function loadProfile() {
    let response;
    try {
      response = await fetch("/api/auth/profile", { credentials: "same-origin", cache: "no-store" });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    return readJson(response);
  }

  function displayName(identity, profile) {
    const full = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim();
    return full || (identity?.user?.firstName || "").trim() || "Patient";
  }

  function initialsOf(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((part) => part[0].toUpperCase());
    return letters.join("") || "P";
  }

  function pretty(name) {
    return String(name).replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function markActiveLink() {
    const current = (window.location.pathname.split("/").pop() || "patient.html").toLowerCase();
    $$("[data-patient-nav] .patient-rail__link").forEach((link) => {
      const target = (link.getAttribute("href") || "").split("?")[0].toLowerCase();
      const active = target === current;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function paintAccount(identity, profile) {
    const name = pretty(displayName(identity, profile));
    const email = profile?.email || identity?.email || "";
    const nameNode = $("#railName");
    const emailNode = $("#railEmail");
    const avatarNode = $("#railAvatar");
    if (nameNode) nameNode.textContent = name;
    if (emailNode) emailNode.textContent = email;
    if (avatarNode) avatarNode.textContent = initialsOf(name);
    // The greeting on a page can opt in to the real name.
    $$("[data-patient-name]").forEach((node) => { node.textContent = name; });
    return { name, email };
  }

  function wireSignOut() {
    const button = $("#patientSignOut");
    if (!button) return;
    button.addEventListener("click", async () => {
      button.disabled = true;
      const original = button.textContent;
      button.textContent = "Signing out…";
      try {
        const response = await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        // The server clears the cookies even when revocation fails, so the
        // visitor is signed out locally either way.
        if (!response.ok && response.status >= 500) {
          const body = await readJson(response);
          window.location.replace("/login.html?role=patient");
          return;
        }
        window.location.replace("/index.html");
      } catch {
        button.disabled = false;
        button.textContent = original;
        const message = $("#portalMessage");
        if (message) {
          message.hidden = false;
          message.classList.add("is-error");
          message.textContent = "Sign out could not be completed. Check your connection and try again.";
        }
      }
    });
  }

  // Runs the guard, then paints the account area. Pages call this before any
  // patient-only request of their own.
  async function start() {
    markActiveLink();
    wireSignOut();
    const gate = await requirePatient();
    if (gate.redirecting || gate.error) return gate;
    const profile = await loadProfile();
    const account = paintAccount(gate.identity, profile);
    return { identity: gate.identity, profile, account };
  }

  window.PatientShell = { start, requirePatient, loadProfile, pretty };
})();
