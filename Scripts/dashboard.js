/* ============================================================
   HelloDoc - Dashboard logic
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
  // The last button that opened the booking modal. We store it on the overlay
  // so both the close path and any focus-restore path can return focus there.
  let bookingTrigger = null;

  function openBooking(doc, fromBtn) {
    // `fromBtn` is the button the visitor used to open the modal. If it is
    // not provided we fall back to the current active element so focus can be
    // restored later.
    bookingTrigger = fromBtn || (document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : null);

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

    // Remember where to return focus when the modal closes.
    els.overlay._focusRestorer = { trigger: bookingTrigger };

    // Focus the first interactive control inside the modal so keyboard users
    // land inside it immediately. The close button is the first tab stop.
    const firstControl = $("#bookingClose");
    if (firstControl && typeof firstControl.focus === "function") {
      firstControl.focus();
    }
  }

  function closeBooking() {
    els.overlay.classList.remove("open");
    document.body.style.overflow = "";
    state.booking = null;

    const trigger = els.overlay._focusRestorer?.trigger || bookingTrigger;
    if (trigger && typeof trigger.focus === "function" && trigger.offsetParent !== null) {
      trigger.focus();
    }
    els.overlay._focusRestorer = null;
    bookingTrigger = null;
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
    const date = record.date ? window.formatApptDate(record.date) : "the selected date";
    const time = record.time ? window.formatApptTime(record.time) : "the selected time";
    const message = `Appointment booked with ${record.doctorName} on ${date} at ${time}.`;
    announce(message);
    closeBooking();
    window.refreshAppointmentBadge();
    toast(message, "success");
  }

  // --- user greeting (auth state itself is handled by nav.js) ---
  function setHeroGreeting(name) {
    const pretty = name.replace(/\b\w/g, (c) => c.toUpperCase());
    $("#heroGreeting").textContent = `Hi ${pretty}, find the right doctor`;
  }

  function initGreeting() {
    // Restore immediately if a previous visit already resolved the session.
    try {
      const stored = sessionStorage.getItem("hellodoc.userName");
      if (stored) setHeroGreeting(stored);
    } catch {
      // sessionStorage unavailable, wait for the event below.
    }
    // Update when nav.js resolves the session during this page load.
    window.addEventListener("hellodoc:user", (e) => {
      if (e.detail && e.detail.name) setHeroGreeting(e.detail.name);
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
      if (doc) openBooking(doc, btn);
    });
  }

  // Every interactive control the visitor could reach while the booking
  // overlay is open. When focus would leave the modal we move it back in,
  // so keyboard navigation stays inside the dialog.
  function modalFocusableControls() {
    if (!els.overlay || !els.overlay.classList.contains("open")) return [];
    return Array.from(els.overlay.querySelectorAll(
      "button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])"
    )).filter((el) => {
      if (!el || el.disabled) return false;
      if (el.style.display === "none" || el.hidden) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function trapTab(e) {
    if (!els.overlay || !els.overlay.classList.contains("open") || e.key !== "Tab") return;
    const traps = modalFocusableControls();
    if (traps.length === 0) {
      e.preventDefault();
      return;
    }
    const first = traps[0];
    const last = traps[traps.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function announce(message) {
    let region = $("#bookingAnnounce");
    if (!region) {
      region = document.createElement("div");
      region.id = "bookingAnnounce";
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "true");
      region.className = "visually-hidden";
      const footer = els.overlay && els.overlay.querySelector(".modal-footer");
      if (footer && footer.parentNode) {
        footer.parentNode.insertBefore(region, footer);
      } else if (els.overlay && els.overlay.parentNode) {
        els.overlay.appendChild(region);
      }
    }
    region.textContent = message;
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
      if (!els.overlay || !els.overlay.classList.contains("open")) return;
      if (e.key === "Escape") {
        closeBooking();
        return;
      }
      if (e.key === "Tab") trapTab(e);
    });

    // Restore focus to the trigger button after the modal closes for any reason.
    document.addEventListener("focusin", (e) => {
      const trigger = els.overlay && els.overlay._focusRestorer?.trigger;
      if (trigger && (document.activeElement === els.overlay || document.activeElement === document.body)) {
        if (trigger.offsetParent !== null) trigger.focus();
      }
    });

    // When the DOM inside the modal changes, keep focus inside it.
    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => {
        const first = modalFocusableControls()[0];
        if (first && (document.activeElement === els.overlay || document.activeElement === document.body)) {
          first.focus();
        }
      });
      observer.observe(els.overlay, { childList: true, subtree: true });
      els.overlay._bookingObserver = observer;
    }

    // Announce the modal opening for assistive tech.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // If motion is reduced, we still focus on open; no need to announce twice.
    } else {
      // Delay briefly so the announce message is read after the visual settles.
      setTimeout(() => {
        if (els.overlay && els.overlay.classList.contains("open")) {
          const title = $("#bookingTitle");
          if (title) announce("Booking dialog opened.");
        }
      }, 50);
    }

    // When the DOM inside the modal changes, restore focus to the first
    // control if focus is no longer inside the modal.
    if (typeof MutationObserver !== "undefined") {
      const observer = new MutationObserver(() => {
        const first = modalFocusableControls()[0];
        if (first && (document.activeElement === els.overlay || document.activeElement === document.body)) {
          first.focus();
        }
      });
      observer.observe(els.overlay, { childList: true, subtree: true });
      els.overlay._bookingObserver = observer;
    }
  }

  // --- init ---
  document.addEventListener("DOMContentLoaded", () => {
    els.teamContainer = $("#teamContainer");
    els.search = $("#search");
    els.chips = $("#chips");
    els.overlay = $("#bookingOverlay");

    $("#statDoctors").textContent = window.DOCTORS.length;

    initToolbar();
    initCards();
    initModal();
    initGreeting();

    renderChips();
    renderCards();
  });
})();
