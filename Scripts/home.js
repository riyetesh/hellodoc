/* ============================================================
   HelloDoc - Landing page interactions

   Three small behaviours, all local to index.html:
   1. Tab groups (hero preview, visit journey): click, arrow keys,
      Home and End, with the inactive panels hidden.
   2. The consultation demonstration: example symptom chips that
      only toggle their own pressed state. Nothing is stored, sent
      or turned into a prediction.
   3. The directory pull: reads the same public endpoint the app
      uses (/api/doctors) and shows only the fields that endpoint
      publishes. It never books, and it never invents a doctor.
   ============================================================ */

(function () {
  "use strict";

  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));

  /* ---- Tabs ---------------------------------------------------- */
  function initTabGroups() {
    $$("[data-tabs]").forEach((group) => {
      const list = $("[role='tablist']", group);
      if (!list) return;
      const tabs = $$("[role='tab']", list);
      const panels = tabs.map((tab) => document.getElementById(tab.getAttribute("aria-controls")));
      if (!tabs.length || panels.some((panel) => !panel)) return;

      // Without JavaScript every panel stays visible, so the page still
      // explains itself. Only now do the inactive panels get hidden.
      function select(index, focus) {
        tabs.forEach((tab, i) => {
          const active = i === index;
          tab.classList.toggle("is-active", active);
          tab.setAttribute("aria-selected", active ? "true" : "false");
          tab.tabIndex = active ? 0 : -1;
          panels[i].hidden = !active;
          panels[i].classList.toggle("is-active", active);
        });
        if (focus && tabs[index]) tabs[index].focus();
      }

      tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => select(index, false));
        tab.addEventListener("keydown", (event) => {
          const last = tabs.length - 1;
          let next = null;
          if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index === last ? 0 : index + 1;
          else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index === 0 ? last : index - 1;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = last;
          if (next === null) return;
          event.preventDefault();
          select(next, true);
        });
      });

      const initial = Math.max(0, tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true"));
      select(initial, false);
    });
  }

  /* ---- Consultation demonstration ------------------------------ */
  function initSymptomDemo() {
    const set = $("[data-symptoms]");
    if (!set) return;
    const chips = $$(".lp-chip", set);
    const count = $("[data-symptom-count]");

    function update() {
      if (!count) return;
      const selected = chips.filter((chip) => chip.getAttribute("aria-pressed") === "true").length;
      if (selected === 0) count.textContent = "No symptoms selected.";
      else count.textContent = selected === 1 ? "1 example symptom selected." : selected + " example symptoms selected.";
    }

    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        const pressed = chip.getAttribute("aria-pressed") === "true";
        chip.setAttribute("aria-pressed", pressed ? "false" : "true");
        update();
      });
    });

    update();
  }

  /* ---- Directory pull ------------------------------------------ */
  function feeLabel(fee) {
    if (fee === null || fee === undefined || fee === "") return "Fee not published";
    const value = Number(fee);
    return Number.isFinite(value) ? "Rs." + value.toLocaleString() : "Fee not published";
  }

  // The hero preview is a snapshot of the same public list: real approved
  // doctors, their specialty and the fee the directory publishes. It is
  // marked aria-hidden in the markup because the accessible directory below
  // repeats the same information.
  function renderPreview(doctors) {
    const list = $("[data-preview-rows]");
    const caption = $("[data-preview-caption]");
    if (!list) return;

    list.textContent = "";
    const shown = doctors.slice(0, 3);

    if (!shown.length) {
      const item = document.createElement("li");
      item.className = "lp-preview__empty";
      item.textContent = "No doctor has been approved yet.";
      list.append(item);
      if (caption) caption.textContent = "The directory lists a doctor as soon as an administrator approves them.";
      return;
    }

    shown.forEach((doctor) => {
      const item = document.createElement("li");
      const avatar = document.createElement("img");
      avatar.src = doctor.profile_image_url || "./Asset/Illustrations/doctor.svg";
      avatar.alt = "";
      avatar.width = 32;
      avatar.height = 32;
      avatar.loading = "lazy";
      avatar.addEventListener("error", () => {
        avatar.src = "./Asset/Illustrations/doctor.svg";
        avatar.alt = "";
      }, { once: true });

      const lines = document.createElement("span");
      lines.className = "lp-wire__lines";

      const name = document.createElement("span");
      name.className = "lp-preview__name";
      name.textContent = doctor.name || "Doctor";

      const meta = document.createElement("span");
      meta.className = "lp-preview__meta";
      meta.textContent = [doctor.specialty || "Consultation", feeLabel(doctor.fee)].join(" \u00b7 ");

      lines.append(name, meta);
      item.append(avatar, lines);
      list.append(item);
    });

    if (caption) caption.textContent = "A snapshot of the live directory, approved doctors only.";
  }

  function renderPreviewUnavailable() {
    const list = $("[data-preview-rows]");
    const caption = $("[data-preview-caption]");
    if (!list) return;
    list.textContent = "";
    const item = document.createElement("li");
    item.className = "lp-preview__empty";
    item.textContent = "Open the directory to see current doctors.";
    list.append(item);
    if (caption) caption.textContent = "The directory is not reachable from this page right now.";
  }

  function initDirectory() {
    const root = $("[data-directory]");
    if (!root) return;

    const status = $("[data-dir-status]", root);
    const list = $("[data-dir-list]", root);
    const search = $("#dirSearch", root);
    const select = $("#dirSpecialty", root);
    if (!status || !list || !search || !select) return;

    let doctors = [];
    let loaded = false;

    // The static markup carries a neutral sentence so the section still reads
    // correctly without JavaScript; the loading state is only honest once this
    // script is actually running.
    status.textContent = "Loading the live directory.";

    function render() {
      if (!loaded) return;
      const term = search.value.trim().toLowerCase();
      const specialty = select.value;
      const matches = doctors.filter((doctor) => {
        const name = String(doctor.name || "");
        const field = String(doctor.specialty || "");
        const inSpecialty = !specialty || field === specialty;
        const inTerm = !term || name.toLowerCase().includes(term) || field.toLowerCase().includes(term);
        return inSpecialty && inTerm;
      });

      list.textContent = "";

      if (!doctors.length) {
        status.textContent = "No doctors are approved in this directory yet. The application shows each new approval here.";
        return;
      }

      if (!matches.length) {
        status.textContent = "No approved doctor matches that search.";
        return;
      }

      const shown = matches.slice(0, 5);
      shown.forEach((doctor) => {
        const item = document.createElement("li");
        item.className = "lp-dir__item";

        const avatar = document.createElement("img");
        avatar.className = "lp-dir__avatar";
        avatar.src = doctor.profile_image_url || "./Asset/Illustrations/doctor.svg";
        avatar.alt = doctor.profile_image_url ? (doctor.name || "Doctor") + " profile photo" : "";
        avatar.width = 48;
        avatar.height = 48;
        avatar.loading = "lazy";
        avatar.addEventListener("error", () => {
          avatar.src = "./Asset/Illustrations/doctor.svg";
          avatar.alt = "";
        }, { once: true });

        const details = document.createElement("div");
        details.className = "lp-dir__details";

        const name = document.createElement("p");
        name.className = "lp-dir__name";
        name.textContent = doctor.name || "Doctor";

        const meta = document.createElement("p");
        meta.className = "lp-dir__meta";
        const parts = [doctor.specialty || "Consultation", feeLabel(doctor.fee)];
        parts.push(doctor.accepting_appointments === false ? "Not accepting new appointments" : "Accepting appointments");
        meta.textContent = parts.join(" \u00b7 ");

        details.append(name, meta);
        item.append(avatar, details);
        list.append(item);
      });

      status.textContent =
        matches.length > shown.length
          ? "Showing " + shown.length + " of " + matches.length + " approved doctors."
          : (matches.length === 1 ? "1 approved doctor." : matches.length + " approved doctors.");
    }

    function unavailable() {
      loaded = false;
      search.disabled = true;
      select.disabled = true;
      list.textContent = "";
      status.textContent = "The live directory could not be loaded here. Open the directory in the app to see current doctors.";
      renderPreviewUnavailable();
    }

    fetch("/api/doctors", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error("Directory unavailable");
        return response.json();
      })
      .then((data) => {
        if (!Array.isArray(data)) throw new Error("Directory unavailable");
        doctors = data
          .filter((doctor) => doctor && typeof doctor === "object")
          .map((doctor) => ({
            name: typeof doctor.name === "string" ? doctor.name : "",
            specialty: typeof doctor.specialty === "string" ? doctor.specialty : "",
            fee: doctor.fee === null || doctor.fee === undefined ? null : Number(doctor.fee),
            profile_image_url: typeof doctor.profile_image_url === "string" ? doctor.profile_image_url : "",
            accepting_appointments: doctor.accepting_appointments !== false,
          }));

        const specialties = Array.from(new Set(doctors.map((doctor) => doctor.specialty).filter(Boolean))).sort();
        specialties.forEach((specialty) => {
          const option = document.createElement("option");
          option.value = specialty;
          option.textContent = specialty;
          select.append(option);
        });

        loaded = true;
        renderPreview(doctors);
        render();
      })
      .catch(unavailable);

    search.addEventListener("input", render);
    select.addEventListener("change", render);
  }

  function init() {
    initTabGroups();
    initSymptomDemo();
    initDirectory();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
