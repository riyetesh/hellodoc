/* ============================================================
   HelloDoc - Appointments page logic
   Renders upcoming / past appointments from the shared store,
   supports starting a visit (routes to the symptom predictor
   /predict with context), cancelling, and rebooking.
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

  // ---- start a visit: hand off to the symptom predictor ----
  function startAppointment(appt) {
    // Build a query so the predictor can carry context (who + which visit).
    const params = new URLSearchParams({
      appointment: appt.id,
      doctor: appt.doctorName,
      speciality: appt.speciality || "",
      from: "appointments",
    });
    if (appt.reason) params.set("reason", appt.reason);

    // Mark as in-progress via the store, then route to the predictor.
    window.Appointments.update(appt.id, { status: "in-progress" });
    toast(`Starting your visit with ${appt.doctorName}…`, "info");
    setTimeout(() => {
      window.location.href = "/predict?" + params.toString();
    }, 400);
  }

  function cancelAppointment(appt) {
    window.Appointments.cancel(appt.id);
    toast(`Appointment with ${appt.doctorName} cancelled`, "error");
    render();
  }

  function bookAgain(appt) {
    const doc = window.getDoctorById(appt.doctorId);
    if (doc) {
      window.location.href = "dashboard.html";
    } else {
      window.location.href = "dashboard.html";
    }
  }

  function removeAppointment(appt) {
    window.Appointments.remove(appt.id);
    toast("Appointment removed", "info");
    render();
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

    const statusClass = appt.status === "in-progress" ? "upcoming" : appt.status;
    const statusLabel =
      appt.status === "in-progress"
        ? "In progress"
        : appt.status.charAt(0).toUpperCase() + appt.status.slice(1);

    const dateStr = window.formatApptDate(appt.date);
    const timeStr = window.formatApptTime(appt.time);

    let actions = "";
    if (appt.status === "upcoming" || appt.status === "in-progress") {
      actions = `
        <button class="btn btn-success" data-start="${appt.id}">
          <i class="fa-solid fa-video"></i> Start visit
        </button>
        <button class="btn btn-ghost" data-cancel="${appt.id}">Cancel</button>`;
    } else {
      actions = `
        <button class="btn btn-outline" data-again="${appt.id}">
          <i class="fa-solid fa-rotate-right"></i> Book again
        </button>
        <button class="btn btn-ghost" data-remove="${appt.id}">Remove</button>`;
    }

    card.innerHTML = `
      <div class="appt-doc">
        <img src="${appt.image}" alt="${appt.doctorName}" />
        <div class="info">
          <h3>${appt.doctorName}</h3>
          <div class="spec">${appt.speciality || "Consultation"}</div>
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

    // wire actions
    const startBtn = card.querySelector("[data-start]");
    if (startBtn) startBtn.addEventListener("click", () => startAppointment(appt));

    const cancelBtn = card.querySelector("[data-cancel]");
    if (cancelBtn) cancelBtn.addEventListener("click", () => cancelAppointment(appt));

    const againBtn = card.querySelector("[data-again]");
    if (againBtn) againBtn.addEventListener("click", () => bookAgain(appt));

    const removeBtn = card.querySelector("[data-remove]");
    if (removeBtn) removeBtn.addEventListener("click", () => removeAppointment(appt));

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
    render();

    window.addEventListener("appointments:changed", render);
  });
})();
