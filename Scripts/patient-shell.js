/* ============================================================
   HelloDoc - Patient session shell
   Shared by every patient page. It verifies server-side that the
   session really is a patient, loads the profile and publishes the
   patient's name. Navigation, the account menu and sign-out belong
   to Scripts/nav.js so there is exactly one implementation.
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

  function pretty(name) {
    return String(name).replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Publishes the account name to the shared navbar and any page that opts in
  // with data-patient-name, without a second navigation implementation here.
  function setIdentity(name, email) {
    const clean = pretty(name || "Patient");
    $$("[data-patient-name]").forEach((node) => {
      node.textContent = clean;
    });
    window.dispatchEvent(new CustomEvent("hellodoc:identity", { detail: { name: clean, email } }));
    return clean;
  }

  // Runs the guard, then publishes the identity. Pages call this before any
  // patient-only request of their own.
  async function start() {
    const gate = await requirePatient();
    if (gate.redirecting || gate.error) return gate;
    const profile = await loadProfile();
    const subset = displayName(gate.identity, profile);
    const email = profile?.email || gate.identity?.email || "";
    const account = setIdentity(subset, email);
    return { identity: gate.identity, profile, account };
  }

  window.PatientShell = { start, requirePatient, loadProfile, pretty, setIdentity };
})();
