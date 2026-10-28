/* ============================================================
   HelloDoc - Patient health records
   Lists the assessments recorded for the signed-in patient and
   opens one as a readable follow-up page: what the model said,
   what the clinician documented, and the guidance that came with
   it. Every field shown is read from the server record; nothing
   is invented when a field was never recorded.
   ============================================================ */
(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { records: [], detail: null, query: "" };

  /* ---------- formatting ---------- */
  function dayMonthYear(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" }).format(date);
  }

  function monthLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Other";
    return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function showMessage(node, message, isError = false) {
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
    node.classList.toggle("is-error", isError);
    node.classList.toggle("is-success", Boolean(message) && !isError);
  }

  /* ---------- list ---------- */
  function matches(record, query) {
    if (!query) return true;
    const haystack = [
      record.predictedDisease,
      record.doctorName,
      record.clinicianSummary,
      dayMonthYear(record.recordedAt),
      monthLabel(record.recordedAt),
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  }

  function renderList() {
    const list = $("#recordsList");
    const empty = $("#recordsEmpty");
    const query = state.query;
    const visible = state.records.filter((record) => matches(record, query));

    list.replaceChildren();
    $("#recordCount").textContent = state.records.length
      ? `${visible.length} of ${state.records.length} record${state.records.length === 1 ? "" : "s"}`
      : "";

    if (!state.records.length) {
      empty.hidden = false;
      $("#recordsEmptyTitle").textContent = "No health records yet";
      $("#recordsEmptyText").textContent =
        "After a consultation, the assessment your clinician recorded will be listed here, along with any guidance they saved.";
      return;
    }
    if (!visible.length) {
      empty.hidden = false;
      $("#recordsEmptyTitle").textContent = "No records match that search";
      $("#recordsEmptyText").textContent = "Try a different condition, clinician name or month.";
      return;
    }
    empty.hidden = true;

    let currentMonth = "";
    for (const record of visible) {
      const month = monthLabel(record.recordedAt);
      if (month !== currentMonth) {
        currentMonth = month;
        list.append(el("p", "record-month", month));
      }
      const card = document.createElement("a");
      card.className = "record-card";
      card.href = `records.html?id=${encodeURIComponent(record.id)}`;
      const art = document.createElement("img");
      art.className = "record-card__art";
      art.src = "/Asset/Illustrations/medicine.svg";
      art.alt = "";
      const body = el("span", "record-card__body");
      body.append(
        el("strong", "", record.predictedDisease || "Clinical consultation"),
        el("span", "", `${record.doctorName} · ${dayMonthYear(record.recordedAt)}`)
      );
      const meta = el("span", "record-card__meta", record.predictedDisease ? "Model guidance" : "Clinician notes");
      card.append(art, body, meta);
      list.append(card);
    }
  }

  async function loadList() {
    const list = $("#recordsList");
    list.hidden = false;
    $("#recordsUnavailable").hidden = true;
    list.innerHTML = '<div class="patient-loading" aria-hidden="true"><span></span><span></span></div>';
    try {
      const response = await fetch("/api/patient/assessments", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) {
        window.location.replace("/login.html?role=patient");
        return;
      }
      if (!response.ok) throw new Error("unavailable");
      const rows = await response.json();
      state.records = Array.isArray(rows) ? rows : [];
      renderList();
    } catch {
      list.hidden = true;
      $("#recordsEmpty").hidden = true;
      $("#recordsUnavailable").hidden = false;
    }
  }

  /* ---------- detail ---------- */
  function icon(path) {
    const img = document.createElement("img");
    img.src = `/Asset/Illustrations/${path}`;
    img.alt = "";
    return img;
  }

  function guidanceBlock({ title, caption, art, items, emptyText, note }) {
    const block = el("section", "guide-block");
    const head = el("div", "guide-block__head");
    head.append(icon(art));
    const titleWrap = el("div");
    titleWrap.append(el("h2", "", title), caption ? el("p", "", caption) : null);
    head.append(titleWrap);
    block.append(head);

    const bodyEl = el("div", "guide-block__body");
    if (items && items.length) {
      const list = el("ul", "guide-list");
      items.forEach((item) => list.append(el("li", "", String(item))));
      bodyEl.append(list);
    } else {
      bodyEl.append(el("p", "guide-empty", emptyText));
    }
    if (note) bodyEl.append(el("p", "guide-note", note));
    block.append(bodyEl);
    return block;
  }

  function renderDetail(record) {
    const host = $("#recordDetail");
    host.replaceChildren();

    /* --- hero --- */
    const hero = el("section", "record-hero");
    const copy = el("div");
    const badges = el("div", "record-actions");
    const recorded = el("span", "record-badge", `Recorded ${dayMonthYear(record.recordedAt)}`);
    badges.append(recorded);
    if (record.modelStatus === "completed") {
      badges.append(el("span", "record-badge record-badge--model", "Model suggestion included"));
    } else {
      badges.append(el("span", "record-badge record-badge--none", "Model not used"));
    }
    if (record.doctorAssessment) {
      badges.append(el("span", "record-badge record-badge--clinician", "Documented by your clinician"));
    }
    copy.append(badges);
    copy.append(el("h1", "", record.predictedDisease || "Clinical consultation"));
    const sub = el("p", "", `${record.doctorName}`);
    if (record.appointmentStart) {
      sub.textContent = `${record.doctorName} · Visit on ${dayMonthYear(record.appointmentStart)}`;
    }
    copy.append(sub);

    const actions = el("div", "record-actions");
    const download = document.createElement("a");
    download.className = "patient-button patient-button--outline";
    download.href = `/api/patient/assessments/${encodeURIComponent(record.id)}/report.pdf`;
    download.textContent = "Download PDF report";
    const book = document.createElement("a");
    book.className = "patient-button patient-button--primary";
    book.href = "dashboard.html";
    book.textContent = "Book a follow-up";
    actions.append(download, book);
    copy.append(actions);
    hero.append(copy);
    host.append(hero);

    /* --- assessment result --- */
    const result = el("section", "prose-block");
    result.append(el("h2", "", "Assessment result"));
    if (record.modelStatus === "completed") {
      result.append(el("p", "", record.predictedDisease
        ? `The symptom model suggested: ${record.predictedDisease}.`
        : "The symptom model returned no result for this consultation."));
      if (record.modelVersion) result.append(el("p", "", `Model version ${record.modelVersion}.`));
      if (typeof record.modelConfidence === "number" && Number.isFinite(record.modelConfidence)) {
        result.append(el("p", "", `Model confidence: ${(record.modelConfidence * 100).toFixed(1)}%.`));
      }
      if (record.description) result.append(el("p", "", record.description));
      result.append(el("p", "", "This is experimental decision support, not a confirmed diagnosis. Your clinician's assessment below is the record of this visit."));
    } else {
      result.append(el("p", "", "The symptom model was not used for this consultation, so there is no model-generated suggestion attached to it."));
      result.append(el("p", "", "The clinical notes and your clinician's assessment below are the record of this visit."));
    }
    host.append(result);

    /* --- clinician's own documentation --- */
    if (record.doctorAssessment || record.plan) {
      const clinician = el("section", "prose-block");
      clinician.append(el("h2", "", "What your clinician documented"));
      if (record.doctorAssessment) clinician.append(el("p", "", record.doctorAssessment));
      if (record.plan) {
        clinician.append(el("h2", "", "Plan"));
        clinician.append(el("p", "", record.plan));
      }
      host.append(clinician);
    }

    /* --- symptoms recorded --- */
    const symptoms = el("section", "prose-block");
    symptoms.append(el("h2", "", "Symptoms on record"));
    const symptomGrid = el("div", "record-symptoms");
    const groups = [
      ["Reported by you", record.patientReported],
      ["Recorded by your clinician", record.clinicianAdded],
      ["Clinical observations", record.observations],
    ];
    let hasSymptom = false;
    for (const [label, values] of groups) {
      if (!values || !values.length) continue;
      hasSymptom = true;
      const group = el("div");
      group.append(el("h3", "", label));
      const list = el("ul", "guide-list");
      values.forEach((value) => list.append(el("li", "", String(value).replace(/_/g, " "))));
      group.append(list);
      symptomGrid.append(group);
    }
    if (record.symptomDuration) {
      const group = el("div");
      group.append(el("h3", "", "How long"), el("p", "", record.symptomDuration));
      symptomGrid.append(group);
    }
    if (record.clinicalNote) {
      const group = el("div");
      group.append(el("h3", "", "Clinical note"), el("p", "", record.clinicalNote));
      symptomGrid.append(group);
    }
    symptoms.append(hasSymptom || record.symptomDuration || record.clinicalNote
      ? symptomGrid
      : el("p", "guide-empty", "No symptoms were recorded with this entry."));
    host.append(symptoms);

    /* --- guidance: only what actually exists --- */
    const guidanceGrid = el("div", "record-grid");

    guidanceGrid.append(guidanceBlock({
      title: "Medication information",
      caption: "General guidance saved with this assessment",
      art: "medicine.svg",
      items: record.medications,
      emptyText: "No medication information was recorded for this assessment.",
      note: "Guidance from the dataset, not a prescription. Follow only what your clinician has told you.",
    }));

    guidanceGrid.append(guidanceBlock({
      title: "Diet and nutrition",
      caption: "General guidance saved with this assessment",
      art: "diet.svg",
      items: record.diet,
      emptyText: "No diet guidance was recorded for this assessment.",
    }));

    guidanceGrid.append(guidanceBlock({
      title: "Physical activity",
      caption: "General guidance saved with this assessment",
      art: "workout.svg",
      items: record.workout,
      emptyText: "No exercise guidance was recorded for this assessment.",
    }));

    // Precautions are split only by their own wording: anything that names a
    // clinician, hospital or emergency is escalation advice, the rest is
    // "what to avoid". Nothing is added when the record has no precautions.
    const precautions = (record.precautions || []).map((item) => String(item));
    const escalation = precautions.filter((item) => /doctor|hospital|emergency|consult|seek|medical|physician|clinic/i.test(item));
    const avoidance = precautions.filter((item) => !escalation.includes(item));

    if (avoidance.length || !escalation.length) {
      guidanceGrid.append(guidanceBlock({
        title: "What to avoid",
        caption: "Precautions recorded with this assessment",
        art: "troubleshooting.svg",
        items: avoidance,
        emptyText: "No precautions were recorded for this assessment.",
      }));
    }

    if (escalation.length) {
      guidanceGrid.append(guidanceBlock({
        title: "When to seek medical help",
        caption: "Escalation advice recorded with this assessment",
        art: "care.svg",
        items: escalation,
        emptyText: "",
      }));
    }

    if (guidanceGrid.children.length) host.append(guidanceGrid);

    /* --- follow-up --- */
    const follow = el("section", "guide-block");
    const followHead = el("div", "guide-block__head");
    followHead.append(icon("appointment.svg"));
    const followTitle = el("div");
    followTitle.append(el("h2", "", "Follow-up"));
    followTitle.append(el("p", "", "If symptoms continue, book a visit or be seen today."));
    followHead.append(followTitle);
    follow.append(followHead);
    const followBody = el("div", "guide-block__body");
    const followActions = el("div", "record-actions");
    followActions.style.justifyContent = "flex-start";
    const book = document.createElement("a");
    book.className = "patient-button patient-button--primary";
    book.href = "dashboard.html";
    book.textContent = "Book an appointment";
    const walkIn = document.createElement("a");
    walkIn.className = "patient-button patient-button--outline";
    walkIn.href = "walkin.html";
    walkIn.textContent = "Join the walk-in queue";
    followActions.append(book, walkIn);
    followBody.append(followActions);
    follow.append(followBody);
    host.append(follow);

    /* --- privacy note --- */
    const note = el("p", "patient-privacy-note");
    const shield = document.createElement("i");
    shield.className = "fa-solid fa-shield-heart";
    shield.setAttribute("aria-hidden", "true");
    const span = el("span", "", "This record belongs to your account. Only you and the clinician who recorded it can read it.");
    note.append(shield, span);
    host.append(note);
  }

  async function openDetail(id) {
    $("#recordsListView").hidden = true;
    $("#recordDetailView").hidden = false;
    $("#recordDetailUnavailable").hidden = true;
    $("#recordDetail").hidden = false;
    $("#recordDetail").innerHTML = '<div class="patient-loading" aria-hidden="true"><span></span><span></span><span></span></div>';
    try {
      const response = await fetch(`/api/patient/assessments/${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) {
        window.location.replace("/login.html?role=patient");
        return;
      }
      if (response.status === 404) {
        $("#recordDetail").hidden = true;
        $("#recordDetailUnavailable").hidden = false;
        $("#recordDetailUnavailableText").textContent = "That record does not exist, or it does not belong to your account.";
        return;
      }
      if (!response.ok) throw new Error("unavailable");
      const record = await response.json();
      state.detail = record;
      renderDetail(record);
      document.title = `HelloDoc | ${record.predictedDisease || "Health record"}`;
    } catch {
      $("#recordDetail").hidden = true;
      $("#recordDetailUnavailable").hidden = false;
      $("#recordDetailUnavailableText").textContent = "We could not load this record right now. Please try again in a moment.";
    }
  }

  /* ---------- wiring ---------- */
  document.addEventListener("DOMContentLoaded", async () => {
    const session = await window.PatientShell.start();
    if (!session || session.redirecting) return;
    if (session.error) {
      showMessage($("#portalMessage"), session.error, true);
      return;
    }

    $("#recordSearch")?.addEventListener("input", (event) => {
      state.query = event.target.value.trim().toLowerCase();
      renderList();
    });
    $("#recordSearchForm")?.addEventListener("submit", (event) => event.preventDefault());
    $("#retryRecords")?.addEventListener("click", loadList);

    const id = new URLSearchParams(window.location.search).get("id");
    if (id) await openDetail(id);
    else await loadList();
  });
})();
