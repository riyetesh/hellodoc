/* ============================================================
   HelloDoc - sign up page with Patient / Doctor selection.

   Both tabs share one form: choosing Doctor reveals the professional
   verification fields and posts to /api/auth/doctor-signup, which asks
   Supabase to create an account whose trigger assigns role `doctor`
   with verification_status 'pending'. Choosing Patient posts to
   /api/auth/signup, which can only ever create a patient. There is no
   admin sign-up path.
   ============================================================ */
(function () {
  "use strict";

  const form = document.getElementById("signupForm");
  if (!form) return;

  const tabs = Array.from(document.querySelectorAll(".auth-tab"));
  const hint = document.getElementById("auth-hint");
  const summary = document.getElementById("formSummary");
  const notice = document.getElementById("formNotice");
  const submit = document.getElementById("submitBtn");
  const doctorFields = document.getElementById("doctorFields");
  const loginLink = document.getElementById("loginLink");
  const toggle = document.getElementById("togglePassword");
  const password = document.getElementById("password");
  const confirmPassword = document.getElementById("confirmPassword");

  const ids = ["firstName", "lastName", "email", "password", "confirmPassword", "phone", "specialty", "licenseNumber", "yearsExperience", "institution", "qualifications"];
  const fields = {};
  ids.forEach((id) => {
    const input = document.getElementById(id);
    fields[id] = { input, error: document.getElementById(id + "-error") };
  });

  const DOCTOR_REQUIRED = ["specialty", "licenseNumber", "yearsExperience", "institution", "qualifications"];
  let role = "patient";
  let submitting = false;

  function setError(id, message) {
    const target = fields[id];
    if (!target) return;
    target.error.textContent = message || "";
    target.error.hidden = !message;
    if (message) target.input.setAttribute("aria-invalid", "true");
    else target.input.removeAttribute("aria-invalid");
  }

  function clearErrors() {
    ids.forEach((id) => setError(id, ""));
    summary.textContent = "";
    summary.hidden = true;
    notice.textContent = "";
    notice.hidden = true;
  }

  function setSummary(message) {
    summary.textContent = message || "";
    summary.hidden = !message;
  }

  function selectRole(next) {
    role = next === "doctor" ? "doctor" : "patient";
    tabs.forEach((tab) => {
      const active = tab.dataset.role === role;
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
    });
    if (hint) {
      hint.textContent = role === "doctor"
        ? "Register as a doctor. Professional details are reviewed before your account can accept appointments."
        : "Create a patient account to book and manage appointments.";
    }
    if (doctorFields) doctorFields.hidden = role !== "doctor";
    DOCTOR_REQUIRED.forEach((id) => {
      fields[id].input.required = role === "doctor";
    });
    submit.textContent = role === "doctor" ? "Create doctor account" : "Create patient account";
    if (loginLink) loginLink.href = `login.html?role=${role}`;
    const url = new URL(window.location.href);
    url.searchParams.set("role", role);
    window.history.replaceState({}, "", url);
    clearErrors();
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
    const value = (id) => fields[id].input.value.trim();

    if (!value("firstName")) { setError("firstName", "Enter your first name."); valid = false; }
    else setError("firstName", "");
    if (!value("lastName")) { setError("lastName", "Enter your last name."); valid = false; }
    else setError("lastName", "");

    if (!value("email")) { setError("email", "Enter the email address you want to sign in with."); valid = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value("email"))) { setError("email", "Enter a complete email address, like name@example.com."); valid = false; }
    else setError("email", "");

    if (!password.value) { setError("password", "Choose a password with at least 8 characters."); valid = false; }
    else if (password.value.length < 8) { setError("password", "Use at least 8 characters."); valid = false; }
    else setError("password", "");

    if (!confirmPassword.value) { setError("confirmPassword", "Re-enter your password."); valid = false; }
    else if (confirmPassword.value !== password.value) { setError("confirmPassword", "Both passwords must match."); valid = false; }
    else setError("confirmPassword", "");

    if (value("phone") && !/^[+()\-\s0-9]{6,40}$/.test(value("phone"))) {
      setError("phone", "Use digits, spaces, brackets, + or -, or leave it blank.");
      valid = false;
    } else setError("phone", "");

    if (role === "doctor") {
      if (value("specialty").length < 2) { setError("specialty", "Enter your medical specialty."); valid = false; } else setError("specialty", "");
      if (value("licenseNumber").length < 3) { setError("licenseNumber", "Enter your registration or licence number."); valid = false; } else setError("licenseNumber", "");
      const years = value("yearsExperience");
      if (years === "" || !Number.isInteger(Number(years)) || Number(years) < 0 || Number(years) > 80) {
        setError("yearsExperience", "Enter whole years between 0 and 80.");
        valid = false;
      } else setError("yearsExperience", "");
      if (value("institution").length < 2) { setError("institution", "Enter your hospital or clinic."); valid = false; } else setError("institution", "");
      if (value("qualifications").length < 5) { setError("qualifications", "Describe your qualifications and experience."); valid = false; } else setError("qualifications", "");
    } else {
      DOCTOR_REQUIRED.forEach((id) => setError(id, ""));
    }
    return valid;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;
    clearErrors();
    if (!validate()) {
      setSummary("Check the highlighted fields and try again.");
      const firstInvalid = ids.map((id) => fields[id].input).find((input) => input.getAttribute("aria-invalid") === "true");
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const payload = {
      firstName: fields.firstName.input.value.trim(),
      lastName: fields.lastName.input.value.trim(),
      email: fields.email.input.value.trim(),
      password: password.value,
      confirmPassword: confirmPassword.value,
      phone: fields.phone.input.value.trim(),
    };
    if (role === "doctor") {
      payload.specialty = fields.specialty.input.value.trim();
      payload.licenseNumber = fields.licenseNumber.input.value.trim();
      payload.yearsExperience = Number(fields.yearsExperience.input.value);
      payload.institution = fields.institution.input.value.trim();
      payload.qualifications = fields.qualifications.input.value.trim();
    }

    submitting = true;
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = "Creating account…";

    try {
      const response = await fetch(role === "doctor" ? "/api/auth/doctor-signup" : "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        if (data.authenticated && data.redirectTo) {
          window.location.assign(data.redirectTo);
          return;
        }
        // Email confirmation is enabled: keep the form disabled so the account
        // is not created twice, and point at the correct login portal.
        notice.textContent = data.message || "Check your email to confirm your account, then sign in.";
        notice.hidden = false;
        if (loginLink) {
          loginLink.href = `login.html?role=${role}`;
          loginLink.textContent = "Sign in after confirming your email";
        }
        submit.textContent = "Account created";
        return;
      }

      const message = data.message || "We could not create your account. Please try again.";
      if (/rate limit|rate_limit/i.test(message)) {
        // Confirmation email is enabled but the project cannot send right now.
        setSummary("We could not send the confirmation email. Please try again shortly, or ask the site administrator to enable sign-ups.");
      } else if (/already registered|already exists|already been registered/i.test(message)) {
        setError("email", "An account already exists for this email. Try logging in instead.");
        setSummary("This email is already registered.");
      } else if (/passwords do not match/i.test(message)) {
        setError("confirmPassword", "Both passwords must match.");
        setSummary("Check your passwords.");
      } else if (/password/i.test(message) && response.status === 400) {
        setError("password", message);
        setSummary("Choose a stronger password.");
      } else if (response.status === 429) {
        setSummary("Too many attempts. Wait a few minutes and try again.");
      } else {
        setSummary(message);
      }
      submit.disabled = false;
      submit.textContent = original;
    } catch (error) {
      console.error("Signup request failed");
      setSummary("We could not reach the server. Check your connection and try again.");
      submit.disabled = false;
      submit.textContent = original;
    } finally {
      submitting = false;
    }
  });

  const requested = new URLSearchParams(window.location.search).get("role");
  selectRole(requested === "doctor" ? "doctor" : "patient");
})();
