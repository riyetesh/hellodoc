// Landing page: if a session already exists, nothing to do — the page is
// fully static and every CTA is a plain link. This script only keeps the
// "Log in" nav item in sync with a previously stored login, if any.
document.addEventListener("DOMContentLoaded", function () {
  try {
    const stored = sessionStorage.getItem("hellodoc.userId");
    if (stored) {
      const nav = document.querySelector("nav a[href='login.html']");
      if (nav) nav.href = "./dashboard.html";
    }
  } catch {
    // sessionStorage unavailable (e.g. privacy mode) — links stay as-is.
  }
});
