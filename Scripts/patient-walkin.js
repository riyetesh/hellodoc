/* ============================================================
   HelloDoc - Walk-in queue (patient side)
   Reads the patient's own place in today's queue from the server
   and lets them join a doctor who is accepting walk-ins. Every
   number shown comes from the database: position, status and a
   wait *estimate*. Nothing here ever claims a scheduled time.
   ============================================================ */
(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { entry: null, doctorId: null, timer: null, submitting: false };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function showMessage(node, message, isError = false) {
    node.textContent = message;
    node.hidden = !message;
    node.classList.toggle("is-error", isError);
    node.classList.toggle("is-success", Boolean(message) && !isError);
  }

  function notEnabled() {
    $("#walkinStatus").hidden = true;
    $("#walkinJoin").hidden = true;
    $("#walkinUnavailable").hidden = false;
    stopPolling();
  }

  function minutesText(minutes) {
    if (typeof minutes !== "number" || !Number.isFinite(minutes)) return "Not available";
    if (minutes < 5) return "Less than 5 minutes";
    if (minutes < 60) return `About ${minutes} minutes`;
    const hours = Math.round(minutes / 60);
    return `About ${hours} hour${hours === 1 ? "" : "s"}`;
  }

  function paintStatus(entry) {
    state.entry = entry;
    const queued = Boolean(entry && entry.inQueue);
    $("#walkinStatus").hidden = !queued;
    $("#walkinJoin").hidden = queued;
    if (!queued) return;

    $("#walkinPosition").textContent = entry.position > 0 ? String(entry.position) : "—";
    $("#walkinPositionLabel").textContent =
      entry.position === 1 ? "you are next" : "people ahead of you";
    $("#walkinEta").textContent = minutesText(entry.estimatedMinutes);
    $("#walkinQueueStatus").textContent =
      entry.status === "called" ? "Called — please go to your clinician" : "Waiting";
    $("#walkinDoctor").textContent = entry.specialty ? `Walk-in · ${entry.specialty}` : "Your clinician";
    $("#walkinJoined").textContent = entry.joinedAt && !Number.isNaN(Date.parse(entry.joinedAt))
      ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(entry.joinedAt))
      : "Just now";
    $("#walkinEstimateNote").textContent = entry.estimateNote || "";
  }

  async function loadStatus() {
    try {
      const response = await fetch("/api/patient/walkin", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) {
        window.location.replace("/login.html?role=patient");
        return null;
      }
      const body = await response.json().catch(() => ({}));
      if (response.status === 503 && body.code === "QUEUE_NOT_CONFIGURED") {
        notEnabled();
        return null;
      }
      if (!response.ok) throw new Error(body.message || "The queue is unavailable right now.");
      paintStatus(body);
      if (!body.inQueue) $("#walkinJoin").hidden = false;
      return body;
    } catch (error) {
      showMessage($("#portalMessage"), error.message, true);
      return null;
    }
  }

  async function loadDoctors() {
    const host = $("#walkinDoctors");
    host.innerHTML = '<div class="patient-loading" aria-hidden="true"><span></span><span></span></div>';
    try {
      const response = await fetch("/api/doctors", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      const rows = await response.json();
      const open = (Array.isArray(rows) ? rows : [])
        .filter((doc) => doc.accepting_appointments === true)
        .filter((doc) => !/fictional test doctor/i.test(String(doc.bio || "")))
        .filter((doc) => !/^TEST ONLY\s*[-:]/i.test(String(doc.name || "")));

      host.replaceChildren();
      $("#walkinNoDoctors").hidden = open.length > 0;
      $("#walkinForm").hidden = open.length === 0;
      if (!open.length) return;

      open.forEach((doc) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "walkin-doctor";
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", "false");
        button.setAttribute("aria-pressed", "false");
        const text = el("span");
        text.append(
          el("strong", "", doc.name),
          el("small", "", doc.specialty || "Specialty not listed")
        );
        const fee = el("small", "", doc.fee ? `Rs. ${Number(doc.fee).toLocaleString()}` : "Fee not listed");
        button.append(text, fee);
        button.addEventListener("click", () => {
          state.doctorId = doc.id;
          host.querySelectorAll(".walkin-doctor").forEach((other) => {
            const selected = other === button;
            other.setAttribute("aria-checked", selected ? "true" : "false");
            other.setAttribute("aria-pressed", selected ? "true" : "false");
          });
          $("#walkinJoinButton").disabled = false;
        });
        host.append(button);
      });
    } catch {
      host.replaceChildren();
      $("#walkinForm").hidden = true;
      $("#walkinNoDoctors").hidden = false;
    }
  }

  async function join(event) {
    event.preventDefault();
    if (!state.doctorId || state.submitting) return;
    const button = $("#walkinJoinButton");
    const message = $("#walkinMessage");
    state.submitting = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    showMessage(message, "Reserving your place…");
    try {
      const key = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const response = await fetch("/api/patient/walkin/join", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctorId: state.doctorId, idempotencyKey: key, reason: $("#walkinForm").elements.reason.value.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 503 && body.code === "QUEUE_NOT_CONFIGURED") {
        notEnabled();
        return;
      }
      if (response.status === 401) {
        window.location.replace("/login.html?role=patient");
        return;
      }
      if (!response.ok) throw new Error(body.message || "Your place could not be reserved. Please try again.");
      showMessage(message, "You are in the queue.");
      paintStatus(body);
      startPolling();
    } catch (error) {
      showMessage(message, error.message, true);
    } finally {
      state.submitting = false;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }

  async function leave() {
    const button = $("#walkinLeave");
    button.disabled = true;
    try {
      const response = await fetch("/api/patient/walkin/leave", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 503 && body.code === "QUEUE_NOT_CONFIGURED") { notEnabled(); return; }
      if (!response.ok) throw new Error(body.message || "Your place could not be released. Please try again.");
      stopPolling();
      paintStatus({ inQueue: false });
      showMessage($("#portalMessage"), "You have left the queue.");
      await loadDoctors();
    } catch (error) {
      showMessage($("#portalMessage"), error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  // A modest refresh, not a live feed: the position only changes when the
  // clinic moves through the list, and the page says when it last refreshed.
  function startPolling() {
    stopPolling();
    state.timer = window.setInterval(() => { loadStatus(); }, 30000);
  }
  function stopPolling() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    $("#walkinForm").addEventListener("submit", join);
    $("#walkinLeave").addEventListener("click", leave);
    window.addEventListener("pagehide", stopPolling);

    const session = await window.PatientShell.start();
    if (!session || session.redirecting) return;
    if (session.error) {
      showMessage($("#portalMessage"), session.error, true);
      return;
    }

    const status = await loadStatus();
    // null means redirected, not configured, or an error already surfaced.
    if (!status) return;
    if (status.inQueue) startPolling();
    else await loadDoctors();
  });
})();
