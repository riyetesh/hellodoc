/* ============================================================
   HelloDoc — Dashboard logic
   Renders doctor cards, handles search / sort / speciality
   filters, drives the booking modal (writes to the shared
   Appointments store), shows toasts, and keeps the nav badge
   and user greeting in sync.
   Depends on: doctors-data.js, appointments.js, app.css.
   ============================================================ */

(function () {
  "use strict";

  // --- state ---
  let state = {
    query: "",
    sort: "relevance",
    specialities: new Set(),
    booking: null, // { doctor, date, time }
  };

  const els = {};

  // --- helpers ---
  const $ = (sel) => document.querySelector(sel);

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

  // --- filtering / sorting ---
  function getVisibleDoctors() {
    let list = window.DOCTORS.slice();

    if (state.specialities.size > 0) {
      list = list.filter((d) => state.specialities.has(d.speciality));
    }

    if (state.query) {
      const q = state.query.toLowerCase();
      list = list.filter(
        (d) => d.name.toLowerCase().includes(q) || d.speciality.toLowerCase().includes(q)
      );
    }

    switch (state.sort) {
      case "experience":
        list.sort((a, b) => b.experience - a.experience);
        break;
      case "rating":
        list.sort((a, b) => b.rating - a.rating);
        break;
      case "feeLowHigh":
        list.sort((a, b) => a.hourlyFee - b.hourlyFee);
        break;
      case "feeHighLow":
        list.sort((a, b) => b.hourlyFee - a.hourlyFee);
        break;
      default:
        // relevance: available first, then rating
        list.sort((a, b) => b.available - a.available || b.rating - a.rating);
    }
    return list;
  }

  // --- rendering ---
  function renderCards() {
    const list = getVisibleDoctors();
    const grid = els.teamContainer;
    grid.innerHTML = "";

    $("#resultsCount").textContent = `${list.length} doctor${list.length === 1 ? "" : "s"}`;
    $("#resultsTitle").textContent =
      state.specialities.size > 0 ? "Filtered specialists" : "All specialists";

    $("#noResults").hidden = list.length !== 0;

    const frag = document.createDocumentFragment();
    list.forEach((doc) => {
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = `
        <div class="profile">
          <img src="${doc.image}" alt="${doc.name}" loading="lazy" />
          <span class="rating-pill"><i class="fa-solid fa-star"></i>${doc.rating.toFixed(1)}</span>
          <span class="status-dot ${doc.available ? "online" : "offline"}">
            ${doc.available ? "Available" : "Offline"}
          </span>
        </div>
        <div class="description">
          <h2>${doc.name}</h2>
          <div class="spec">${doc.speciality}</div>
          <div class="meta">
            <div><strong>${doc.experience} yrs</strong><span>Experience</span></div>
            <div><strong>Rs.${doc.hourlyFee}</strong><span>Per hour</span></div>
            <div><strong>${doc.reviews}</strong><span>Reviews</span></div>
          </div>
          <div class="next-slot"><i class="fa-regular fa-clock"></i>Next: ${doc.nextSlot}</div>
          <div class="card-actions">
            <button class="btn btn-primary" data-book="${doc.id}">
              <i class="fa-regular fa-calendar-plus"></i>Book
            </button>
            <a class="btn btn-outline" href="/predict?doctor=${encodeURIComponent(doc.name)}">
              <i class="fa-solid fa-stethoscope"></i>Symptoms
            </a>
          </div>
        </div>`;
      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  function renderChips() {
    const wrap = els.chips;
    wrap.innerHTML = "";
    window.SPECIALITIES.forEach((spec) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (state.specialities.has(spec) ? " active" : "");
      chip.textContent = spec;
      chip.addEventListener("click", () => {
        if (state.specialities.has(spec)) state.specialities.delete(spec);
        else state.specialities.add(spec);
        chip.classList.toggle("active");
        syncFilterCount();
        renderCards();
      });
      wrap.appendChild(chip);
    });
  }

  function syncFilterCount() {
    const n = state.specialities.size;
    const badge = $("#filterCount");
    badge.hidden = n === 0;
    badge.textContent = n;
  }

  // --- booking modal ---
  function openBooking(doc) {
    state.booking = { doctor: doc, date: null, time: null };
    $("#bookingImg").src = doc.image;
    $("#bookingImg").alt = doc.name;
    $("#bookingTitle").textContent = doc.name;
    $("#bookingSpeciality").textContent = doc.speciality + " · " + doc.experience + " yrs";
    $("#bookingFee").textContent = "Rs." + doc.hourlyFee;
    $("#bookingReason").value = "";
    buildDateRow();
    buildSlotGrid();
    syncConfirm();
    els.overlay.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeBooking() {
    els.overlay.classList.remove("open");
    document.body.style.overflow = "";
    state.booking = null;
  }

  function buildDateRow() {
    const row = $("#dateRow");
    row.innerHTML = "";
    const today = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "date-chip";
      chip.dataset.date = iso;
      chip.innerHTML = `
        <span class="dow">${i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" })}</span>
        <span class="dnum">${d.getDate()}</span>
        <span class="mon">${d.toLocaleDateString(undefined, { month: "short" })}</span>`;
      chip.addEventListener("click", () => {
        row.querySelectorAll(".date-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        state.booking.date = iso;
        syncConfirm();
      });
      row.appendChild(chip);
    }
  }

  function buildSlotGrid() {
    const grid = $("#slotGrid");
    grid.innerHTML = "";
    const slots = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];
    slots.forEach((time, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot";
      btn.textContent = formatTime12(time);
      // pseudo-randomly disable a couple of slots so the UI feels real
      const taken = (time.charCodeAt(1) + idx) % 7 === 0;
      if (taken) {
        btn.disabled = true;
        btn.title = "Unavailable";
      } else {
        btn.addEventListener("click", () => {
          grid.querySelectorAll(".slot").forEach((s) => s.classList.remove("active"));
          btn.classList.add("active");
          state.booking.time = time;
          syncConfirm();
        });
      }
      grid.appendChild(btn);
    });
  }

  function formatTime12(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const hr = h % 12 === 0 ? 12 : h % 12;
    return `${hr}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  function syncConfirm() {
    const ok = state.booking && state.booking.date && state.booking.time;
    $("#bookingConfirm").disabled = !ok;
  }

  function confirmBooking() {
    const b = state.booking;
    if (!b || !b.date || !b.time) return;
    const record = window.Appointments.add({
      doctorId: b.doctor.id,
      doctorName: b.doctor.name,
      speciality: b.doctor.speciality,
      image: b.doctor.image,
      fee: b.doctor.hourlyFee,
      date: b.date,
      time: b.time,
      reason: $("#bookingReason").value.trim(),
      status: "upcoming",
    });
    closeBooking();
    window.refreshAppointmentBadge();
    toast(`Appointment booked with ${record.doctorName}`, "success");
  }

  // --- user greeting ---
  async function loadUser() {
    try {
      const res = await fetch("/api/auth/current-user", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        const email = data.email || (data.user && data.user.email) || "";
        const name =
          (data.user && data.user.firstName) ||
          (email ? email.split("@")[0].replace(/[._]/g, " ") : "there");
        showUser(name, email);
        setHeroGreeting(name);
        return;
      }
    } catch {
      /* ignore */
    }
    // Not signed in — leave the Log in / Sign up buttons visible.
  }

  function showUser(name, email) {
    const pretty = name.replace(/\b\w/g, (c) => c.toUpperCase());
    $("#loginBtn").hidden = true;
    $("#signupBtn").hidden = true;
    const chip = $("#userChip");
    chip.hidden = false;
    $("#userName").textContent = pretty;
    $("#userAvatar").textContent = pretty.trim().charAt(0).toUpperCase() || "U";
    if (email) chip.title = email;
  }

  function setHeroGreeting(name) {
    const pretty = name.replace(/\b\w/g, (c) => c.toUpperCase());
    $("#heroGreeting").textContent = `Hi ${pretty}, find the right doctor`;
  }

  // --- navbar behaviour ---
  function initNav() {
    const navbar = $("#navbar");
    const toggle = $("#menuToggle");
    const links = $("#navLinks");
    const actions = $("#navActions");

    toggle.addEventListener("click", () => {
      const open = toggle.classList.toggle("open");
      links.classList.toggle("open", open);
      actions.classList.toggle("open", open);
    });

    window.addEventListener("scroll", () => {
      navbar.classList.toggle("scrolled", window.scrollY > 8);
    });

    $("#userChip").addEventListener("click", () => {
      window.location.href = "appointments.html";
    });
  }

  // --- toolbar behaviour ---
  function initToolbar() {
    els.search.addEventListener("input", (e) => {
      state.query = e.target.value.trim();
      renderCards();
    });

    const dropdown = $("#sortDropdown");
    $("#sortMenu").addEventListener("click", (e) => {
      const opt = e.target.closest(".sort-option");
      if (!opt) return;
      e.preventDefault();
      $("#sortMenu").querySelectorAll(".sort-option").forEach((o) => o.classList.remove("active"));
      opt.classList.add("active");
      state.sort = opt.dataset.value;
      $("#sortLabel").textContent = "Sort: " + opt.textContent;
      dropdown.classList.remove("open");
      renderCards();
    });
    $("#sortDropdown .dropbtn").addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("open");
    });
    document.addEventListener("click", () => dropdown.classList.remove("open"));

    $("#filterToggle").addEventListener("click", () => {
      els.chips.hidden = !els.chips.hidden;
    });

    $("#clearFilters").addEventListener("click", () => {
      state.query = "";
      state.specialities.clear();
      els.search.value = "";
      renderChips();
      syncFilterCount();
      renderCards();
    });
  }

  // --- card actions (delegated) ---
  function initCards() {
    els.teamContainer.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-book]");
      if (!btn) return;
      const doc = window.getDoctorById(btn.dataset.book);
      if (doc) openBooking(doc);
    });
  }

  // --- modal wiring ---
  function initModal() {
    $("#bookingClose").addEventListener("click", closeBooking);
    $("#bookingCancel").addEventListener("click", closeBooking);
    $("#bookingConfirm").addEventListener("click", confirmBooking);
    els.overlay.addEventListener("click", (e) => {
      if (e.target === els.overlay) closeBooking();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.overlay.classList.contains("open")) closeBooking();
    });
  }

  // --- init ---
  document.addEventListener("DOMContentLoaded", () => {
    els.teamContainer = $("#teamContainer");
    els.search = $("#search");
    els.chips = $("#chips");
    els.overlay = $("#bookingOverlay");

    $("#statDoctors").textContent = window.DOCTORS.length;

    initNav();
    initToolbar();
    initCards();
    initModal();

    renderChips();
    renderCards();
    window.refreshAppointmentBadge();
    loadUser();

    window.addEventListener("appointments:changed", window.refreshAppointmentBadge);
  });
})();
