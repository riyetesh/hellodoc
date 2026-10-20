/* ============================================================
   HelloDoc - password recovery.

   Supabase sends the recovery link. The token arrives in the URL hash, is read
   once, and is removed from the address bar before anything else runs. The
   server exchanges it for a session and sets a new password; the browser never
   sees a Supabase key.
   ============================================================ */
(() => {
  "use strict";

  const status = document.querySelector("#status");
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token_hash");
  const access = params.get("access_token");
  const refresh = params.get("refresh_token");
  history.replaceState(null, "", window.location.pathname);

  const complete = document.querySelector("#complete");
  const request = document.querySelector("#request");
  const toggle = document.querySelector("#togglePassword");
  const hasRecoveryLink = Boolean(token || (params.get("type") === "recovery" && access && refresh));
  if (hasRecoveryLink) {
    complete.hidden = false;
    request.hidden = true;
  }

  function setStatus(message) {
    status.textContent = message;
  }

  if (toggle) {
    toggle.addEventListener("click", () => {
      const input = document.querySelector("#new-password");
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      toggle.textContent = showing ? "Show" : "Hide";
      toggle.setAttribute("aria-pressed", showing ? "false" : "true");
      input.focus();
    });
  }

  async function submit(form, path, values) {
    const button = form.querySelector("button[type=submit]") || form.querySelector("button");
    button.disabled = true;
    button.dataset.label = button.textContent;
    button.textContent = "Please wait…";
    setStatus("Contacting HelloDoc…");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = response.status === 429
          ? "Too many attempts. Wait a few minutes and try again."
          : result.message || "We could not complete that request. Please try again.";
        throw new Error(message);
      }
      setStatus(result.message || "Done.");
      form.reset();
    } catch (error) {
      setStatus(error.message);
    } finally {
      button.disabled = false;
      button.textContent = button.dataset.label || button.textContent;
    }
  }

  request.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = new FormData(request).get("email").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("Enter a complete email address, like name@example.com.");
      return;
    }
    submit(request, "/api/auth/recover", { email });
  });

  complete.addEventListener("submit", (event) => {
    event.preventDefault();
    const password = new FormData(complete).get("password");
    const confirmation = new FormData(complete).get("confirmPassword");
    if (password.length < 8) {
      setStatus("Use a new password with at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setStatus("Both passwords must match.");
      return;
    }
    submit(complete, "/api/auth/recover/complete", {
      token_hash: token,
      access_token: access,
      refresh_token: refresh,
      password,
    });
  });
})();
