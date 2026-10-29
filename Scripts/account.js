/* ============================================================
   HelloDoc - Patient account page
   Reads the authenticated patient's own profile, lets them edit
   name and phone with inline validation, and offers sign-out as a
   separate, clearly-labelled action away from navigation.
   ============================================================ */
(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const PHONE = /^[+()\-\s0-9]{6,40}$/;
  let current = null;

  function showMessage(node, message, isError = false) {
    node.textContent = message;
    node.hidden = !message;
    node.classList.toggle("is-error", isError);
    node.classList.toggle("is-success", Boolean(message) && !isError);
  }

  function setFieldError(field, errorNode, message) {
    errorNode.textContent = message;
    errorNode.hidden = !message;
    if (message) {
      field.setAttribute("aria-invalid", "true");
      field.reportValidity();
      field.addEventListener("input", () => setFieldError(field, errorNode, ""), { once: true });
    } else {
      field.removeAttribute("aria-invalid");
    }
  }

  function completion(profile) {
    const checks = [
      Boolean(profile.firstName),
      Boolean(profile.lastName),
      Boolean(profile.phone),
    ];
    const done = checks.filter(Boolean).length;
    return { done, total: checks.length };
  }

  function paintMeta(profile) {
    $("#metaEmail").textContent = profile.email || "Not shared";
    const status = completion(profile);
    $("#metaCompletion").textContent =
      status.done === status.total
        ? "Complete"
        : `${status.done} of ${status.total} details added`;
  }

  function prefill(profile) {
    const form = $("#accountForm");
    form.elements.firstName.value = profile.firstName || "";
    form.elements.lastName.value = profile.lastName || "";
    form.elements.phone.value = profile.phone || "";
    paintMeta(profile);
  }

  async function save(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const firstName = form.elements.firstName.value.trim();
    const lastName = form.elements.lastName.value.trim();
    const phone = form.elements.phone.value.trim();
    const messageNode = $("#accountMessage");
    const button = $('button[type="submit"]', form);

    setFieldError(form.elements.firstName, $("#firstNameError"), "");
    setFieldError(form.elements.phone, $("#phoneError"), "");

    if (!firstName) {
      setFieldError(form.elements.firstName, $("#firstNameError"), "Add your first name to continue.");
      return;
    }
    if (phone && !PHONE.test(phone)) {
      setFieldError(form.elements.phone, $("#phoneError"), "Enter a valid phone number, or leave it blank.");
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    showMessage(messageNode, "Saving your changes…");
    try {
      const response = await fetch("/api/patient/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, phone }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) {
        window.location.replace("/login.html?role=patient");
        return;
      }
      if (!response.ok) throw new Error(result.message || "Your changes could not be saved. Try again.");
      current = { ...current, firstName: result.firstName, lastName: result.lastName, phone: result.phone || "" };
      prefill(current);
      showMessage(messageNode, "Your details are up to date.");
      // Keep the shared navbar and account menu consistent with the saved name.
      const savedName = window.PatientShell.pretty([current.firstName, current.lastName].filter(Boolean).join(" ") || "Patient");
      window.PatientShell.setIdentity(savedName, current.email);
    } catch (error) {
      showMessage(messageNode, error.message || "Your changes could not be saved. Check your connection and try again.", true);
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    $("#accountForm").addEventListener("submit", save);

    // The shell owns session verification; nav.js owns navigation and sign-out.
    const session = await window.PatientShell.start();
    if (!session || session.redirecting) return;
    if (session.error) {
      showMessage($("#portalMessage"), session.error, true);
      return;
    }

    current = session.profile || { email: session.identity?.email || "" };
    prefill(current);

    // One sign-out implementation for the whole site: the shared navbar's.
    const signOut = $("#accountSignOut");
    signOut.addEventListener("click", () => {
      if (window.HelloDocAuth && typeof window.HelloDocAuth.signOut === "function") {
        window.HelloDocAuth.signOut(signOut);
        return;
      }
      showMessage($("#portalMessage"), "Sign out is unavailable right now. Reload the page and try again.", true);
    });
  });
})();
