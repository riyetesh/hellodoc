/* ============================================================
   HelloDoc - login page with a role selector.

   The tab only says which portal the visitor intends to use. The
   server compares that intent with the role stored in PostgreSQL and
   refuses any mismatch, so choosing "Admin" cannot grant admin access.
   Layout: login.html. Shared styling: Styles/login.css (.auth-*).
   ============================================================ */
(function () {
  "use strict";

  const ROLES = {
    patient: { label: "Login", hint: "Sign in to book visits and view your patient dashboard." },
    doctor: { label: "Doctor Login", hint: "Doctors sign in to their workspace; verification status is shown there." },
    admin: { label: "Admin Login", hint: "Administrators sign in to the platform management dashboard." },
  };
  const DESTINATIONS = { patient: "/patient.html", doctor: "/doctor.html", admin: "/admin" };

  const form = document.getElementById("loginForm");
  if (!form) return;

  const tabs = Array.from(document.querySelectorAll(".auth-tab"));
  const hint = document.getElementById("auth-hint");
  const summary = document.getElementById("formSummary");
  const submit = document.getElementById("submitBtn");
  const email = document.getElementById("email");
  const password = document.getElementById("password");
  const toggle = document.getElementById("togglePassword");
  const fields = {
    email: { input: email, error: document.getElementById("email-error") },
    password: { input: password, error: document.getElementById("password-error") },
  };
  let role = "patient";

  function setError(field, message) {
    const target = fields[field];
    if (!target) return;
    target.error.textContent = message || "";
    target.error.hidden = !message;
    if (message) target.input.setAttribute("aria-invalid", "true");
    else target.input.removeAttribute("aria-invalid");
  }

  function setSummary(message) {
    summary.textContent = message || "";
    summary.hidden = !message;
  }

  function selectRole(next) {
    role = ROLES[next] ? next : "patient";
    tabs.forEach((tab) => {
      const active = tab.dataset.role === role;
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
    });
    if (hint) hint.textContent = ROLES[role].hint;
    submit.textContent = ROLES[role].label;
    setSummary("");
    setError("email", "");
    setError("password", "");
    // Keep the choice in the URL so a refresh or a link keeps the same portal.
    const url = new URL(window.location.href);
    url.searchParams.set("role", role);
    window.history.replaceState({}, "", url);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectRole(tab.dataset.role));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      tabs[next].focus();
      selectRole(tabs[next].dataset.role);
    });
  });

  if (toggle) {
    toggle.addEventListener("click", () => {
      const showing = password.type === "text";
      password.type = showing ? "password" : "text";
      toggle.textContent = showing ? "Show" : "Hide";
      toggle.setAttribute("aria-pressed", showing ? "false" : "true");
      password.focus();
    });
  }

  function validate() {
    let valid = true;
    const emailValue = email.value.trim();
    if (!emailValue) {
      setError("email", "Enter the email address you signed up with.");
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      setError("email", "Enter a complete email address, like name@example.com.");
      valid = false;
    } else {
      setError("email", "");
    }
    if (!password.value) {
      setError("password", "Enter your password.");
      valid = false;
    } else {
      setError("password", "");
    }
    return valid;
  }

  [email, password].forEach((input) => {
    input.addEventListener("blur", () => {
      if (input === email) validate();
    });
    input.addEventListener("input", () => {
      if (input.getAttribute("aria-invalid") === "true") validate();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setSummary("");
    if (!validate()) {
      setSummary("Check the highlighted fields and try again.");
      return;
    }

    submit.disabled = true;
    submit.classList.add("is-busy");
    const original = submit.textContent;
    submit.textContent = "Signing in…";

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.value.trim(), password: password.value, portal: role }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        window.location.assign(data.redirectTo || DESTINATIONS[role]);
        return;
      }

      if (response.status === 403 && data.code === "WRONG_PORTAL") {
        const correct = data.portal && ROLES[data.portal] ? data.portal : "patient";
        setSummary(`${data.message} Switch to ${ROLES[correct].label.replace(" Login", "")} login and try again.`);
        selectRole(correct);
        return;
      }
      if (response.status === 401) {
        setError("password", data.message || "Check the email and password you entered, then try again.");
        setSummary("We could not sign you in.");
        return;
      }
      setSummary(data.message || "Login is unavailable right now. Please try again in a moment.");
    } catch (error) {
      console.error("Login request failed");
      setSummary("We could not reach the server. Check your connection and try again.");
    } finally {
      submit.disabled = false;
      submit.classList.remove("is-busy");
      submit.textContent = original;
    }
  });

  const requested = new URLSearchParams(window.location.search).get("role");
  selectRole(requested || "patient");

  // Already signed in? Go straight to the dashboard for the server-side role.
  fetch("/api/auth/current-user", { credentials: "same-origin" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (!data || !data.role) return;
      window.location.replace(DESTINATIONS[data.role] || "/");
    })
    .catch(() => {});
})();
