/* ============================================================
   HelloDoc - Appointments page logic
   Renders upcoming / past appointments from the shared store,
   supports cancelling and rebooking visits.
   Depends on: doctors-data.js, appointments.js, app.css.
   ============================================================ */

(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  let currentTab = "upcoming";

  function toast(message, type = "info") {
    const container = $("#toastContainer");
    if (!container) return;
    const icon =
      type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-xmark" : "fa-circle-info";
    const node = document.createElement("div");
    node.className = "toast " + type;
    node.innerHTML = `<i class="fa-solid ${icon} toast-icon"></i><span></span>`;
    node.querySelector("span").textContent = message;
    container.appendChild(node);
    requestAnimationFrame(() => node.classList.add("show"));
    setTimeout(() => {
      node.classList.remove("show");
      setTimeout(() => node.remove(), 350);
    }, 3200);
  }

  async function cancelAppointment(appt, button) {
    button.disabled = true;
    try {
      const result = await window.Appointments.cancel(appt.id);
      toast(result.refreshFailed ? "Cancellation saved, but the list could not refresh. Reload to check it." : "Appointment cancelled", "success");
      render();
    } catch (error) { toast(error.message, "error"); button.disabled = false; }
  }

  function bookAgain() {
    window.location.href = "dashboard.html";
  }



  // ---- rendering ----
  function render() {
    const list = currentTab === "upcoming" ? window.Appointments.upcoming() : window.Appointments.past();

    // tab counts
    $("#upcomingCount").textContent = window.Appointments.upcoming().length;
    $("#pastCount").textContent = window.Appointments.past().length;
    window.refreshAppointmentBadge();

    const wrap = $("#apptList");
    const empty = $("#apptEmpty");

    wrap.innerHTML = "";

    if (list.length === 0) {
      empty.hidden = false;
      if (currentTab === "upcoming") {
        $("#emptyTitle").textContent = "No upcoming appointments";
        $("#emptyText").textContent = "When you book a consultation, it will show up here.";
      } else {
        $("#emptyTitle").textContent = "No past appointments";
        $("#emptyText").textContent = "Completed and cancelled visits will appear here.";
      }
      return;
    }

    empty.hidden = true;

    const frag = document.createDocumentFragment();
    list.forEach((appt) => frag.appendChild(renderCard(appt)));
    wrap.appendChild(frag);
  }

  function renderCard(appt) {
    const card = document.createElement("article");
    card.className = "appt-card";

    const statusClass = ["pending", "confirmed"].includes(appt.status) ? "upcoming" : appt.status;
    const statusLabel =
      appt.status.charAt(0).toUpperCase() + appt.status.slice(1);

    const dateStr = window.formatApptDate(appt.startsAt);
    const timeStr = window.formatApptTime(appt.startsAt);

    let actions = "";
    if (["pending", "confirmed"].includes(appt.status)) {
      actions = `
        <button class="btn btn-ghost" data-cancel="${appt.id}">Cancel</button>`;
    } else {
      actions = `
        <button class="btn btn-outline" data-again="${appt.id}">
          <i class="fa-solid fa-rotate-right"></i> Book again
        </button>
        `;
    }

    card.innerHTML = `
      <div class="appt-doc">
        <img src="./Asset/Illustrations/doctor.svg" alt="" />
        <div class="info">
          <h3></h3>
          <div class="spec"></div>
        </div>
      </div>

      <div class="appt-when">
        <span class="pill ${statusClass}"><i class="fa-solid fa-circle" style="font-size:0.5rem"></i>${statusLabel}</span>
        <div class="row"><i class="fa-regular fa-calendar"></i><strong>${dateStr}</strong></div>
        <div class="row"><i class="fa-regular fa-clock"></i>${timeStr}</div>
        ${
          appt.reason
            ? `<div class="appt-reason">“${escapeHtml(appt.reason)}”</div>`
            : ""
        }
      </div>

      <div class="appt-actions">${actions}</div>`;

    card.querySelector(".info h3").textContent = appt.doctorName;
    card.querySelector(".info .spec").textContent = appt.specialty || "Consultation";
    // wire actions
    const cancelBtn = card.querySelector("[data-cancel]");
    if (cancelBtn) cancelBtn.addEventListener("click", () => cancelAppointment(appt, cancelBtn));

    const againBtn = card.querySelector("[data-again]");
    if (againBtn) againBtn.addEventListener("click", () => bookAgain(appt));

    return card;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---- tabs ----
  function initTabs() {
    $("#tabs").addEventListener("click", (e) => {
      const tab = e.target.closest(".tab");
      if (!tab) return;
      $("#tabs").querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentTab = tab.dataset.tab;
      render();
    });
  }

  // ---- init ----
  // The shared navbar (menu, badge, auth chip) is handled by nav.js.
  document.addEventListener("DOMContentLoaded", () => {
    initTabs();
    $("#apptEmpty").hidden = false;
    $("#emptyTitle").textContent = "Loading appointments…";
    $("#emptyText").textContent = "Fetching your saved visits.";
    window.Appointments.all().then(render).catch((error) => {
      $("#apptEmpty").hidden = false;
      $("#emptyTitle").textContent = "Appointments unavailable";
      $("#emptyText").textContent = error.message === "Not authenticated" ? "Log in to see your appointments." : "Please try again later.";
    });
    window.addEventListener("appointments:changed", render);
  });
})();
