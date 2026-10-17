// Login modal + submit handling for the root login page.
//
// Validation lives in Scripts/form-validation.js: problems are shown under the
// field they belong to and repeated in the summary beside the Continue button,
// which is the live region announcements come from. A failed sign-in keeps the
// typed email and password so they only have to fix one of them.
document.addEventListener("DOMContentLoaded", function () {
  const loginBtn = document.getElementById("loginBtn");
  const modal = document.getElementById("login-modal");
  if (!modal) return;

  const closeBtn = modal.querySelector(".close-btn");
  const form = modal.querySelector("form");
  const emailInput = modal.querySelector("#email");
  let api = null;
  let opener = loginBtn;

  function isOpen() {
    return modal.style.display === "flex";
  }

  function openModal(role = 'patient') {
    document.getElementById('login-modal-title').textContent = role === 'doctor' ? 'Log in as a doctor' : 'Log in as a patient';
    document.getElementById('login-role-description').textContent = role === 'doctor' ? 'Approved doctors open their workspace; applicants can check their application status.' : 'Sign in to book visits and view your patient dashboard.';
    modal.style.display = "flex";
    if (api) {
      api.clearSummary();
      api.clearFieldError("email");
      api.clearFieldError("password");
    }
    if (emailInput) emailInput.focus();
  }

  function closeModal() {
    modal.style.display = "none";
    // Put focus back where the modal was opened from.
    if (opener) opener.focus();
  }

  if (window.location.search && /(?:^\?|&)login=(?:doctor|patient)(?:&|$)/.test(window.location.search)) openModal(new URLSearchParams(window.location.search).get('login'));

  if (loginBtn) {
    loginBtn.addEventListener("click", function (event) {
      event.preventDefault();
      opener = loginBtn;
      openModal('patient');
    });
  }

  const doctorLoginBtn = document.getElementById('doctorLoginBtn');
  if (doctorLoginBtn) doctorLoginBtn.addEventListener('click', (event) => {
    event.preventDefault(); opener = doctorLoginBtn; openModal('doctor');
  });
  modal.querySelectorAll('[data-login-role]').forEach((link) => link.addEventListener('click', (event) => {
    event.preventDefault(); openModal(link.dataset.loginRole);
  }));

  if (closeBtn) {
    closeBtn.addEventListener("click", closeModal);
    closeBtn.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        closeModal();
      }
    });
  }

  // Close when clicking the backdrop, or with Escape.
  window.addEventListener("click", function (event) {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && isOpen()) closeModal();
  });

  if (!form || !window.HelloDocForms) return;

  const { attach, rules } = window.HelloDocForms;

  api = attach(form, {
    fields: [
      {
        id: "email",
        label: "Email address",
        rules: [
          rules.required("Email address", "enter the address you signed up with"),
          rules.email(),
        ],
      },
      {
        id: "password",
        label: "Password",
        rules: [rules.required("Password", "enter your password")],
      },
    ],

    onSubmit: async function (values, api) {
      let done = false;
      api.setBusy(true);
      try {
        // Same-origin relative URL: works locally and behind the Vercel rewrite to the backend service.
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        const data = await response.json().catch(function () {
          return {};
        });

        if (response.ok) {
          done = true;
          window.location.href = data.role === "admin" ? "/admin" : data.role === "doctor" ? "./doctor.html" : data.role === "doctor_applicant" ? "./doctor-portal.html" : "./patient.html";
          return;
        }

        if (response.status === 503) {
          api.setSummary(data.message || "The service is unavailable right now. Please try again in a few minutes.");
          return;
        }

        // The API replies the same way for an unknown account and a wrong
        // password, so this message deliberately does not say which is wrong.
        if (response.status === 401) api.setFieldError("password", data.message || "Check the email and password you entered, then try again.");
        else api.setSummary(data.message || "Unable to sign in. Please try again.");
      } catch (error) {
        console.error("Login request failed");
        api.setSummary("We could not reach the server. Check your connection and try again.");
      } finally {
        if (!done) api.setBusy(false);
      }
    },
  });
});
