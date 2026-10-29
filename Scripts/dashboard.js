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
  const statusLabels = { pending: "Requested", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled", no_show: "Missed" };

  let state = {
    query: "",
    sort: "relevance",
    specialities: new Set(),
    availability: "all",
    currency: "INR",
    booking: null, // selected real server slot and idempotency key
    submitting: false,
  };

  const els = {};
  const currencyRates = { INR: 1 };
  let ratesReady = false;

  // --- helpers ---
  function formatFee(amount) {
    if (amount == null) return "Fee not listed";
    if (Number(amount) === 0) return "No fee listed";
    const rate = currencyRates[state.currency];
    if (!rate) return `₹${Number(amount).toLocaleString("en-IN")} (currency rates unavailable)`;
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: state.currency,
        maximumFractionDigits: state.currency === "NPR" || state.currency === "INR" ? 0 : 2
      }).format(Number(amount) * rate);
    } catch {
      return `${state.currency} ${(Number(amount) * rate).toFixed(2)}`;
    }
  }

  async function loadCurrencyRates() {
    try {
      const response = await fetch("https://open.er-api.com/v6/latest/INR", { cache: "no-store" });
      if (!response.ok) throw new Error("Rates unavailable");
      const data = await response.json();
      if (data.result !== "success" || !data.rates) throw new Error("Rates unavailable");
      Object.assign(currencyRates, data.rates);
      ratesReady = true;
    } catch {
      ratesReady = false;
    }
    if (els.currencySelect) {
      Array.from(els.currencySelect.options).forEach((option) => {
        option.disabled = option.value !== "INR" && !currencyRates[option.value];
      });
      if (!currencyRates[state.currency]) {
        state.currency = "INR";
        els.currencySelect.value = "INR";
      }
    }
    renderCards();
    if (state.booking) {
      $("#bookingFee").textContent = formatFee(state.booking.doctor.hourlyFee);
    }
  }
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
    if (state.availability === "open") {
      list = list.filter((d) => d.acceptingAppointments);
    }

    if (state.query) {
      const q = state.query.toLowerCase();
      list = list.filter((d) => d.name.toLowerCase().includes(q) || d.speciality.toLowerCase().includes(q) || (d.language || "").toLowerCase().includes(q));
    }

    switch (state.sort) {

      case "feeLowHigh":
        list.sort((a, b) => (a.hourlyFee ?? Number.MAX_SAFE_INTEGER) - (b.hourlyFee ?? Number.MAX_SAFE_INTEGER));
        break;
      case "feeHighLow":
        list.sort((a, b) => (b.hourlyFee ?? -1) - (a.hourlyFee ?? -1));
        break;
      default:
        // Show bookable doctors first; preserve server order within each group.
        list.sort((a, b) => Number(b.acceptingAppointments) - Number(a.acceptingAppointments));
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
    if (list.length === 0) $("#noResults p").textContent = window.DOCTORS.length ? "No doctors match these filters. Try another search or speciality." : "No approved doctors are listed yet. Try again later.";

    const frag = document.createDocumentFragment();
    list.forEach((doc) => {
      const card = document.createElement("article");
      card.className = "card";
      card.innerHTML = `
        <div class="profile profile-placeholder" aria-hidden="true">
          <img class="doctor-art" src="./Asset/Illustrations/doctor.svg" alt="" loading="lazy" />
          <span class="status-dot ${doc.acceptingAppointments ? "online" : "offline"}">
            ${doc.acceptingAppointments ? "Booking open" : "Not booking"}
          </span>
        </div>
        <div class="description">
          <h2></h2>
          <div class="spec"></div>
          <p class="doctor-bio"></p>
          <div class="meta">
            <div><strong></strong><span>Consultation fee</span></div>
          </div>
          <div class="next-slot"><i class="fa-regular fa-clock"></i><span></span></div>
          <div class="card-actions">
            <button class="btn btn-primary" type="button" data-book ${doc.acceptingAppointments ? "" : "disabled"}>
              <i class="fa-regular fa-calendar-plus"></i>${doc.acceptingAppointments ? "View times" : "Not booking"}
            </button>
          </div>
        </div>`;
      card.querySelector("[data-book]").dataset.book = String(doc.id);
      const doctorImage = card.querySelector(".doctor-art");
      if (doc.profile_image_url) {
        doctorImage.src = doc.profile_image_url;
        doctorImage.alt = doc.name + " profile photo";
        doctorImage.removeAttribute("aria-hidden");
        doctorImage.addEventListener("error", () => {
          doctorImage.src = "./Asset/Illustrations/doctor.svg";
          doctorImage.alt = "";
        }, { once: true });
      }
      card.querySelector(".description h2").textContent = doc.name;
      card.querySelector(".description .spec").textContent = doc.speciality || "Specialty not listed";
      const bio = card.querySelector(".doctor-bio");
      bio.textContent = doc.bio || "";
      bio.hidden = !doc.bio;
      card.querySelector(".meta strong").textContent = formatFee(doc.hourlyFee);
      card.querySelector(".next-slot span").textContent = doc.nextSlot ? `Next: ${doc.nextSlot}` : doc.acceptingAppointments ? "See available appointment times" : "Appointments currently unavailable";
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

  async function openBooking(doc, fromBtn) {
    bookingTrigger = fromBtn || (document.activeElement && document.activeElement !== document.body
      ? document.activeElement
      : null);
    const bookButton = fromBtn || document.querySelector(`[data-book="${CSS.escape(String(doc.id))}"]`);
    if (bookButton) { bookButton.disabled = true; bookButton.setAttribute("aria-busy", "true"); }
    state.booking = { doctor: doc, date: null, time: null, slots: [], idempotencyKey: crypto.randomUUID() };
    try {
      const response = await fetch(`/api/doctors/${encodeURIComponent(doc.id)}/slots`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 503 ? "Availability could not be loaded. Please try again." : "Could not load available appointment times.");
      state.booking.slots = await response.json();
      if (!Array.isArray(state.booking.slots)) throw new Error("Availability could not be loaded. Please try again.");
    } catch (error) {
      state.booking = null;
      toast(error.message, "error");
      if (bookButton) { bookButton.disabled = false; bookButton.removeAttribute("aria-busy"); }
      return;
    }
    if (bookButton) { bookButton.disabled = false; bookButton.removeAttribute("aria-busy"); }
    $("#bookingTitle").textContent = doc.name;
    $("#bookingImg").hidden = true;
    $("#bookingSuccessHeading").textContent = "Appointment requested";
    $("#bookingSpeciality").textContent = doc.speciality || "Specialty not listed";
    $("#bookingFee").textContent = formatFee(doc.hourlyFee);
    $("#bookingReason").value = "";
    $("#bookingFeedback").hidden = true;
    $("#bookingReview").hidden = true;
    $$("#bookingOverlay .date-chip, #bookingOverlay .slot, #bookingReason").forEach((control) => { control.disabled = false; });
    $("#bookingSuccess").hidden = true;
    $(".modal-body").hidden = false;
    $(".modal-footer").hidden = false;
    $("#bookingConfirm").textContent = "Review request";
    state.submitting = false;
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
    if (state.submitting) return;
    els.overlay.classList.remove("open");
    document.body.style.overflow = "";
    state.booking = null;

    const trigger = els.overlay._focusRestorer?.trigger || bookingTrigger;
    if (trigger && typeof trigger.focus === "function" && trigger.offsetParent !== null) {
      trigger.focus();
    }
    if (els.overlay.classList.contains("booking-complete")) {
      document.querySelector("#bookingAnnounce")?.remove();
      els.overlay.classList.remove("booking-complete");
      els.overlay.removeAttribute("aria-label");
    }
    els.overlay._focusRestorer = null;
    bookingTrigger = null;
  }

  function buildDateRow() {
    const row = $("#dateRow");
    row.innerHTML = "";
    const localDate = (value) => {
      const day = new Date(value);
      return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    };
    const dates = [...new Set(state.booking.slots.filter((slot) => new Date(slot.startsAt).getTime() > Date.now()).map((slot) => localDate(slot.startsAt)))];
    if (!dates.length) {
      row.textContent = "No open appointments are listed for this doctor right now.";
      return;
    }
    dates.forEach((iso) => {
      const d = new Date(iso + "T12:00:00");
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "date-chip";
      chip.dataset.date = iso;
      chip.innerHTML = `
        <span class="dow">${d.toLocaleDateString(undefined, { weekday: "short" })}</span>
        <span class="dnum">${d.getDate()}</span>
        <span class="mon">${d.toLocaleDateString(undefined, { month: "short" })}</span>`;
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", () => {
        row.querySelectorAll(".date-chip").forEach((c) => { c.classList.remove("active"); c.setAttribute("aria-pressed", "false"); });
        chip.classList.add("active");
        chip.setAttribute("aria-pressed", "true");
        state.booking.date = iso;
        state.booking.time = null;
        buildSlotGrid();
        syncConfirm();
      });
      row.appendChild(chip);
    });
  }

  function buildSlotGrid() {
    const grid = $("#slotGrid");
    grid.innerHTML = "";
    const slots = state.booking.slots.filter((slot) => {
      const date = new Date(slot.startsAt);
      const localDay = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return localDay === state.booking.date && date.getTime() > Date.now();
    });
    if (!slots.length) { grid.textContent = "No times are available on this date."; return; }
    slots.forEach((slot) => {
      const btnTime = new Date(slot.startsAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot";
      btn.textContent = btnTime;
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => {
        grid.querySelectorAll(".slot").forEach((s) => { s.classList.remove("active"); s.setAttribute("aria-pressed", "false"); });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        state.booking.time = slot.id;
        syncConfirm();
      });
      grid.appendChild(btn);
    });
  }

  function syncConfirm() {
    const ok = state.booking && state.booking.date && state.booking.time;
    $("#bookingConfirm").disabled = !ok || state.submitting;
    $("#bookingConfirm").setAttribute("aria-busy", state.submitting ? "true" : "false");
  }

  function selectedSlot() {
    return state.booking?.slots.find((slot) => slot.id === state.booking.time) || null;
  }

  async function confirmBooking() {
    const b = state.booking;
    if (!b || !b.date || !b.time || state.submitting) return;
    const action = $("#bookingConfirm");
    const review = $("#bookingReview");
    if (review.hidden) {
      const slot = selectedSlot();
      if (!slot) return;
      const reason = $("#bookingReason").value.trim();
      $("#bookingReviewText").textContent = `${b.doctor.name} · ${b.doctor.speciality} · ${new Date(slot.startsAt).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}${reason ? ` · Reason: ${reason}` : ""}`;
      b.review = { slotId: slot.id, reason };
      $$("#bookingOverlay .date-chip, #bookingOverlay .slot, #bookingReason").forEach((control) => { control.disabled = true; });
      review.hidden = false;
      action.textContent = "Confirm appointment request";
      announce("Review the selected doctor and appointment time, then confirm your request.");
      return;
    }

    const slot = selectedSlot();
    if (!slot) return;
    state.submitting = true;
    action.disabled = true;
    action.textContent = "Sending request…";
    $("#bookingFeedback").hidden = true;
    try {
      const result = await window.Appointments.add({ slotId: b.review?.slotId || b.time, idempotencyKey: b.idempotencyKey, reason: b.review?.reason ?? $("#bookingReason").value.trim() });
      if (!result?.id || !["pending", "confirmed"].includes(result.status)) {
        throw new Error("The booking could not be verified. Check your appointments before trying again.");
      }
      const status = result.status;
      const confirmedSlot = selectedSlot();
      const when = confirmedSlot ? new Date(confirmedSlot.startsAt).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" }) : "the selected time";
      $("#bookingSuccessHeading").textContent = status === "confirmed" ? "Appointment confirmed" : "Appointment requested";
      $("#bookingSuccessText").textContent = `${b.doctor.name} · ${b.doctor.speciality} · ${when}`;
      if (result.refreshFailed) $("#bookingSuccessText").textContent += " · Reload appointments to check current details.";
      $("#bookingSuccessStatus").textContent = status === "confirmed" ? "Confirmed by the clinic" : "Request sent · awaiting confirmation";
      $("#bookingReview").hidden = true;
      $(".modal-body").hidden = true;
      $(".modal-footer").hidden = true;
      $("#bookingSuccess").hidden = false;
      els.overlay.classList.add("booking-complete");
      els.overlay.setAttribute("aria-label", "Appointment request confirmation");
      $("#bookingClose").focus();
      announce(`${statusLabels[status] || status}: appointment with ${b.doctor.name} for ${when}.`);
    } catch (error) {
      const message = error.message === "Not authenticated" || /session/i.test(error.message)
        ? "Your session has ended. Sign in again before requesting an appointment."
        : /unavailable|conflict/i.test(error.message)
          ? "That time is no longer available. Choose another available time and try again."
          : error.message || "We couldn’t send this request. Check your connection and try again.";
      $("#bookingFeedback").textContent = message;
      $("#bookingFeedback").hidden = false;
      $("#bookingFeedback").setAttribute("role", /session/i.test(message) ? "alert" : "status");
      review.hidden = true;
      $$("#bookingOverlay .date-chip, #bookingOverlay .slot, #bookingReason").forEach((control) => { control.disabled = false; });
      b.review = null;
      action.textContent = "Review request";
      syncConfirm();
      announce(message);
    } finally {
      state.submitting = false;
      if (state.booking && $("#bookingSuccess").hidden) syncConfirm();
    }
  }

  // --- user greeting (auth state itself is handled by nav.js) ---
  function setHeroGreeting(name) {
    const pretty = name.replace(/\b\w/g, (c) => c.toUpperCase());
    $("#heroGreeting").textContent = `Hi ${pretty}, find the right doctor`;
  }

  function initGreeting() {
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
    $("#availabilityFilter").addEventListener("change", (event) => {
      state.availability = event.target.value;
      renderCards();
    });

    $("#clearFilters").addEventListener("click", () => {
      state.query = "";
      state.specialities.clear();
      state.availability = "all";
      $("#availabilityFilter").value = "all";
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
      const doc = window.DOCTORS.find((d) => String(d.id) === btn.dataset.book);
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
    $("#bookingDone").addEventListener("click", closeBooking);
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

  }

  // --- init ---
  document.addEventListener("DOMContentLoaded", () => {
    els.teamContainer = $("#teamContainer");
    els.search = $("#search");
    els.chips = $("#chips");
    els.overlay = $("#bookingOverlay");
    els.currencySelect = $("#currencySelect");
    if (els.currencySelect) {
      const savedCurrency = localStorage.getItem("hellodoc-currency");
      if (savedCurrency && Array.from(els.currencySelect.options).some((o) => o.value === savedCurrency)) {
        state.currency = savedCurrency;
        els.currencySelect.value = savedCurrency;
      }
      els.currencySelect.addEventListener("change", () => {
        state.currency = els.currencySelect.value;
        localStorage.setItem("hellodoc-currency", state.currency);
        renderCards();
        if (state.booking) $("#bookingFee").textContent = formatFee(state.booking.doctor.hourlyFee);
      });
    }

    window.DOCTORS = [];
    window.SPECIALITIES = [];
    $("#statDoctors").textContent = "0";
    $("#noResults").hidden = true;

    // Always request the current directory response. A cached API response can
    // otherwise make a recently approved/updated directory look empty.
    async function loadDoctors() {
      const retryButton = $("#retryDoctors");
      if (retryButton) {
        retryButton.disabled = true;
        retryButton.textContent = "Loading…";
        retryButton.hidden = true;
      }
      $("#resultsCount").textContent = "Loading doctors…";
      $("#noResults").hidden = true;
      try {
        const response = await fetch("/api/doctors", {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error("Directory request failed");
        const doctors = await response.json();
        if (!Array.isArray(doctors)) throw new Error("Directory response was invalid");

        window.DOCTORS = doctors
          .filter((d) => d && !/fictional test doctor/i.test(String(d.bio || "")) && !/^TEST ONLY\\s*[-:]/i.test(String(d.name || "")))
          .map((d) => ({
            ...d,
            name: String(d.name || "Doctor"),
            speciality: d.specialty || d.speciality || "General consultation",
            hourlyFee: d.fee == null && d.hourlyFee == null ? null : Number(d.fee ?? d.hourlyFee),
            acceptingAppointments: d.accepting_appointments === true || d.acceptingAppointments === true,
            nextSlot: d.nextSlot ? new Date(d.nextSlot).toLocaleString() : null,
          }));
        window.SPECIALITIES = [...new Set(window.DOCTORS.map((d) => d.speciality))];
        $("#statDoctors").textContent = window.DOCTORS.length;
        renderChips();
        renderCards();
      } catch {
        $("#resultsCount").textContent = "Could not load doctors";
        $("#noResults").hidden = false;
        $("#noResults h3").textContent = "Doctor directory temporarily unavailable";
        $("#noResults p").textContent = "The approved doctor list could not be loaded. Check your connection and try again.";
        if (retryButton) {
          retryButton.hidden = false;
          retryButton.disabled = false;
          retryButton.textContent = "Retry";
        }
      }
    }

    const retryButton = document.createElement("button");
    retryButton.className = "btn btn-outline";
    retryButton.id = "retryDoctors";
    retryButton.type = "button";
    retryButton.hidden = true;
    retryButton.textContent = "Retry";
    retryButton.addEventListener("click", loadDoctors);
    $("#noResults").appendChild(retryButton);
    loadDoctors();

    initToolbar();
    initCards();
    initModal();
    initGreeting();
    loadCurrencyRates();

    renderChips();
  });
})();
