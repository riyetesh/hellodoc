/* Clinical assessment workspace: staged consultation, symptom search, local
   draft safety and a review that separates model input from the doctor's record. */
(() => {
  'use strict';
  const form = document.getElementById('assessmentForm');
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const DRAFT_KEY = 'hellodoc:assessment-draft:v1';
  const MAX_OBSERVATIONS = 20;

  const state = {
    vocabulary: { symptoms: [], labels: {} },
    patients: [],
    patientId: '',
    appointmentId: '',
    reported: [],
    clinician: [],
    observations: [],
    duration: '',
    note: '',
    doctorAssessment: '',
    plan: '',
    saved: true,
    saving: false,
    // Only a save in this session marks the review stage complete; opening an
    // existing record is not the same as having reviewed it now.
    persistedThisSession: false,
    // When set, saving creates a revision of this assessment instead of a new one.
    revisingId: null,
    revisingSource: null,
    // Set when the assessment was opened from one specific appointment.
    fixedAppointmentId: null,
    consultation: null,
    currentStep: 1,
    lastEditStep: 1,
  };

  const STEPS = [
    { number: 1, title: 'Visit context', short: 'Patient context' },
    { number: 2, title: 'Reported by the patient', short: 'Patient symptoms' },
    { number: 3, title: 'Your findings', short: 'Your observations' },
    { number: 4, title: 'Your assessment', short: 'Your impression' },
    { number: 5, title: 'Plan and follow-up', short: 'Follow-up' },
    { number: 6, title: 'Review and save', short: 'Save record' },
  ];
  const stepTitle = (number) => STEPS.find((step) => step.number === number)?.title || '';

  const humanize = (identifier) => {
    const text = String(identifier).replace(/_/g, ' ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : String(identifier);
  };
  const labelFor = (id) => state.vocabulary.labels[id] || humanize(id);

  // One date format for the whole record: seconds are noise in a consultation,
  // and the workspace and the report should not disagree about the same visit.
  const formatMoment = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(date);
  };
  const clock = () => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date());

  // ---------------------------------------------------------------- status ---
  function setDraftState(text, kind) {
    const node = $('draftState');
    if (!node) return;
    node.textContent = text;
    node.dataset.state = kind || '';
  }
  function markDirty() {
    state.saved = false;
    setDraftState('Unsaved changes', 'dirty');
    schedulePersist();
  }
  function markSaved() {
    state.saved = true;
    setDraftState('All changes saved', 'saved');
  }
  function showError(target, message) {
    const node = $(target);
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
  }

  // A clinical record belongs to a consultation. Without one the editor is
  // replaced by an empty state that points back to the schedule, instead of a
  // form that cannot be saved.
  function setEditorVisible(visible) {
    const editor = $('assessmentEditor');
    const empty = $('assessmentEmpty');
    if (editor) editor.hidden = !visible;
    if (empty) empty.hidden = visible;
  }

  // ------------------------------------------------------------ persistence ---
  function snapshot() {
    return {
      patientId: state.patientId,
      appointmentId: state.appointmentId,
      reported: state.reported,
      clinician: state.clinician,
      observations: state.observations,
      duration: state.duration,
      note: state.note,
      doctorAssessment: state.doctorAssessment,
      plan: state.plan,
    };
  }
  function persist() {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(snapshot())); } catch { /* storage may be disabled */ }
  }
  let persistTimer = 0;
  // Typing stays responsive by writing the local draft on a short delay; nothing
  // is sent to the server until the doctor saves the assessment.
  function schedulePersist() {
    window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persist();
      setDraftState(`Unsaved changes · draft kept ${clock()}`, 'dirty');
    }, 400);
  }
  function clearDraft() {
    window.clearTimeout(persistTimer);
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }
  function restoreDraft() {
    let draft = null;
    try { draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { draft = null; }
    if (!draft || typeof draft !== 'object') return false;
    state.patientId = typeof draft.patientId === 'string' ? draft.patientId : '';
    state.appointmentId = typeof draft.appointmentId === 'string' ? draft.appointmentId : '';
    state.reported = Array.isArray(draft.reported) ? draft.reported : [];
    state.clinician = Array.isArray(draft.clinician) ? draft.clinician : [];
    state.observations = Array.isArray(draft.observations) ? draft.observations : [];
    state.duration = typeof draft.duration === 'string' ? draft.duration : '';
    state.note = typeof draft.note === 'string' ? draft.note : '';
    state.doctorAssessment = typeof draft.doctorAssessment === 'string' ? draft.doctorAssessment : '';
    state.plan = typeof draft.plan === 'string' ? draft.plan : '';
    return true;
  }

  // ------------------------------------------------------------- autocomplete ---
  function createPicker({ mountId, listName, onAdd, onRemove }) {
    const mount = $(mountId);
    if (!mount) return null;
    const listId = `${listName}-options`;
    mount.innerHTML = `
      <div class="symptom-chips" role="list" data-chips></div>
      <div class="symptom-input-wrap">
        <input type="text" role="combobox" autocomplete="off" spellcheck="false"
          aria-autocomplete="list" aria-expanded="false" aria-controls="${listId}"
          aria-label="${listName === 'reported' ? 'Search symptoms reported by the patient' : 'Search symptoms recorded by the doctor'}"
          placeholder="Type to search symptoms…" />
        <ul class="symptom-options" id="${listId}" role="listbox" hidden></ul>
      </div>
      <p class="symptom-count" aria-live="polite"></p>`;
    const chips = mount.querySelector('[data-chips]');
    const input = mount.querySelector('input');
    const list = mount.querySelector('ul');
    const count = mount.querySelector('.symptom-count');
    let options = [];
    let active = -1;

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }

    function normalize(text) {
      return String(text).toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function search(query) {
      const selected = new Set([...state.reported, ...state.clinician]);
      const needle = normalize(query);
      return state.vocabulary.symptoms
        .filter((id) => !selected.has(id))
        .filter((id) => !needle || normalize(labelFor(id)).includes(needle) || normalize(id).includes(needle))
        .slice(0, 8);
    }

    function renderOptions(query) {
      const needle = normalize(query);
      options = search(query);
      active = -1;
      list.replaceChildren();
      if (!query.trim()) { close(); return; }
      if (!options.length) {
        const selected = [...state.reported, ...state.clinician];
        const already = selected.some((id) => normalize(labelFor(id)).includes(needle) || normalize(id).includes(needle));
        const empty = document.createElement('li');
        empty.className = 'symptom-option-empty';
        empty.textContent = already
          ? 'Already added to this assessment.'
          : 'No model symptom matches that search. Add it as a clinical observation instead.';
        list.append(empty);
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        return;
      }
      options.forEach((id, index) => {
        const item = document.createElement('li');
        item.id = `${listId}-${index}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.dataset.id = id;
        const label = document.createElement('span');
        label.textContent = labelFor(id);
        item.append(label);
        if (labelFor(id) !== id) {
          const code = document.createElement('code');
          code.textContent = id;
          item.append(code);
        }
        item.addEventListener('mousedown', (event) => { event.preventDefault(); choose(id); });
        list.append(item);
      });
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function highlight(index) {
      const items = [...list.querySelectorAll('[role="option"]')];
      items.forEach((item, i) => {
        item.classList.toggle('active', i === index);
        item.setAttribute('aria-selected', i === index ? 'true' : 'false');
      });
      if (items[index]) input.setAttribute('aria-activedescendant', items[index].id);
      active = index;
    }

    function choose(id) {
      if (!id) return;
      if (state.reported.includes(id) || state.clinician.includes(id)) return;
      onAdd(id);
      input.value = '';
      close();
      input.focus();
    }

    function renderChips() {
      const selected = listName === 'reported' ? state.reported : state.clinician;
      chips.replaceChildren();
      for (const id of selected) {
        const chip = document.createElement('li');
        chip.className = 'symptom-tag';
        const text = document.createElement('span');
        text.textContent = labelFor(id);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'tag-remove';
        remove.setAttribute('aria-label', `Remove ${labelFor(id)}`);
        remove.textContent = '\u00d7';
        remove.addEventListener('click', () => { onRemove(id); });
        chip.append(text, remove);
        chips.append(chip);
      }
      const total = state.reported.length + state.clinician.length;
      count.textContent = selected.length
        ? `${selected.length} selected · ${total} of ${state.vocabulary.symptoms.length} model symptoms in this assessment`
        : `No symptoms selected yet · ${state.vocabulary.symptoms.length} available model symptoms`;
    }

    input.addEventListener('input', () => renderOptions(input.value));
    input.addEventListener('focus', () => { if (input.value.trim()) renderOptions(input.value); });
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (list.hidden) renderOptions(input.value);
        if (options.length) highlight((active + 1) % options.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (options.length) highlight((active - 1 + options.length) % options.length);
        return;
      }
      if (event.key === 'Escape') { close(); return; }
      if (event.key === 'Enter') {
        // Always handled here: Enter must never submit the assessment form.
        event.preventDefault();
        if (!list.hidden && options[active >= 0 ? active : 0]) choose(options[active >= 0 ? active : 0]);
        return;
      }
      if (event.key === 'Backspace' && input.value === '') {
        const selected = listName === 'reported' ? state.reported : state.clinician;
        if (selected.length) { event.preventDefault(); onRemove(selected[selected.length - 1]); }
      }
    });

    return { renderChips, focus: () => input.focus(), renderOptions };
  }

  function addSymptom(listName, id) {
    if (state.reported.includes(id) || state.clinician.includes(id)) return;
    if (listName === 'reported') state.reported.push(id); else state.clinician.push(id);
    markDirty();
    renderAll();
    announce(`${labelFor(id)} added.`);
  }
  function removeSymptom(listName, id) {
    const list = listName === 'reported' ? state.reported : state.clinician;
    const index = list.indexOf(id);
    if (index < 0) return;
    list.splice(index, 1);
    markDirty();
    renderAll();
    announce(`${labelFor(id)} removed.`);
  }

  const reportedPicker = createPicker({
    mountId: 'reportedPicker', listName: 'reported',
    onAdd: (id) => addSymptom('reported', id),
    onRemove: (id) => removeSymptom('reported', id),
  });
  const clinicianPicker = createPicker({
    mountId: 'clinicianPicker', listName: 'clinician',
    onAdd: (id) => addSymptom('clinician', id),
    onRemove: (id) => removeSymptom('clinician', id),
  });

  // Screen-reader announcements are separate from the save-state chip so adding
  // a tag can never make the form look saved when it is not.
  function announce(message) {
    if (!message) return;
    const node = $('assessmentAnnounce');
    if (node) node.textContent = message;
  }

  // ----------------------------------------------------------------- stages ---
  const stagePanels = [...document.querySelectorAll('.dw-stage')];
  const stepButtons = [...document.querySelectorAll('.dw-step')];

  function stepDone(number) {
    if (number === 1) return Boolean(state.patientId && (state.appointmentId || state.revisingId));
    if (number === 2) return state.reported.length > 0;
    if (number === 3) return state.clinician.length > 0 || state.observations.length > 0 || Boolean(state.note.trim());
    if (number === 4) return Boolean(state.doctorAssessment.trim());
    if (number === 5) return Boolean(state.plan.trim());
    // The review is complete only once the server has confirmed a save in this
    // session; the page normally navigates to the saved record before this is seen.
    return state.persistedThisSession && !state.saving;
  }

  function renderStepper() {
    for (const button of stepButtons) {
      const number = Number(button.dataset.step);
      const done = stepDone(number);
      button.dataset.state = number === state.currentStep ? 'current' : done ? 'done' : 'todo';
      if (number === state.currentStep) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
      const marker = button.querySelector('.dw-step__state');
      if (marker) marker.textContent = number === state.currentStep ? 'Current stage' : done ? 'Complete' : STEPS[number - 1].short;
      const status = number === state.currentStep ? ', current stage' : done ? ', complete' : ', not recorded yet';
      button.setAttribute('aria-label', `Stage ${number}: ${stepTitle(number)}${status}`);
    }
    const status = $('stageStatus');
    if (status) status.textContent = `Stage ${state.currentStep} of 6 · ${stepTitle(state.currentStep)}`;
    const back = $('stepBack');
    if (back) back.disabled = state.currentStep === 1;
    const next = $('stepNext');
    if (next) next.hidden = state.currentStep === 6;
    const review = $('reviewButton');
    if (review) review.hidden = state.currentStep === 6;
    const footer = $('stageFooter');
    if (footer) footer.hidden = state.currentStep === 6;
  }

  function showStep(number, focus = false) {
    const target = Math.max(1, Math.min(6, number));
    state.currentStep = target;
    if (target !== 6) state.lastEditStep = target;
    for (const panel of stagePanels) {
      const panelStep = Number(panel.id.replace('assessmentStep', ''));
      panel.hidden = panelStep !== target;
    }
    renderStepper();
    if (!focus) return;
    const heading = $(`stepTitle${target}`);
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'nearest' });
    }
  }

  function goStep(number, focus = false) {
    // The review stage validates the record before it opens; the other stages
    // stay freely accessible so nothing the doctor typed is gated.
    if (number === 6) { openReview(); return; }
    showStep(number, focus);
  }

  // ----------------------------------------------------------- observations ---
  function renderObservations() {
    const list = $('observationTags');
    list.replaceChildren();
    state.observations.forEach((text, index) => {
      const chip = document.createElement('li');
      chip.className = 'symptom-tag observation-tag';
      const span = document.createElement('span');
      span.textContent = text;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'tag-remove';
      remove.setAttribute('aria-label', `Remove observation: ${text}`);
      remove.textContent = '\u00d7';
      remove.addEventListener('click', () => {
        state.observations.splice(index, 1);
        markDirty();
        renderAll();
      });
      chip.append(span, remove);
      list.append(chip);
    });
    if (!state.observations.length) {
      const empty = document.createElement('li');
      empty.className = 'symptom-empty';
      empty.textContent = 'No free-text observations added.';
      list.append(empty);
    }
  }

  function addObservation() {
    const input = $('observationInput');
    const value = input.value.trim();
    if (!value) return;
    if (state.observations.includes(value)) { showError('assessmentError', 'That observation is already listed.'); return; }
    if (state.observations.length >= MAX_OBSERVATIONS) { showError('assessmentError', `Limit observations to ${MAX_OBSERVATIONS} entries.`); return; }
    showError('assessmentError', '');
    state.observations.push(value);
    input.value = '';
    markDirty();
    renderAll();
    announce('Observation added.');
  }

  // ---------------------------------------------------------------- hints ---
  // Inline guidance is derived from what is on the form, never from a suggestion
  // engine, and it never invents clinical content.
  function renderHints() {
    const reported = $('reportedHint');
    if (reported) {
      const total = state.reported.length + state.clinician.length;
      if (!total) {
        reported.hidden = false;
        reported.textContent = 'At least one symptom is needed before the record can be reviewed and saved.';
      } else if (!state.reported.length) {
        reported.hidden = false;
        reported.textContent = 'Only your own findings are recorded so far. Add what the patient described if it is available.';
      } else {
        reported.hidden = true;
        reported.textContent = '';
      }
    }
    const assessment = $('assessmentHint');
    if (assessment) {
      if (!state.doctorAssessment.trim()) {
        assessment.hidden = false;
        assessment.textContent = 'Not recorded yet. You can save without it, but the record is read for your impression.';
      } else {
        assessment.hidden = true;
        assessment.textContent = '';
      }
    }
  }

  // ------------------------------------------------------------- patients ---
  function fillPatients() {
    const select = $('assessmentPatient');
    select.replaceChildren(new Option('Select a patient…', ''));
    for (const patient of state.patients) {
      const when = patient.appointmentStart ? formatMoment(patient.appointmentStart) : 'no appointment';
      const option = new Option(`${patient.fullName} — ${when}`, patient.patientId);
      option.dataset.appointmentId = patient.appointmentId || '';
      option.dataset.when = patient.appointmentStart || '';
      option.dataset.status = patient.appointmentStatus || '';
      option.dataset.email = patient.email || '';
      option.dataset.count = String(patient.assessmentCount || 0);
      option.dataset.walkIn = patient.walkIn ? 'true' : 'false';
      option.dataset.name = patient.fullName || 'Patient';
      select.append(option);
    }
    if (!state.patients.length) {
      select.replaceChildren(new Option('No patients with appointments yet', ''));
      const context = $('assessmentContext');
      context.textContent = 'Assessments can be recorded once a patient has booked an appointment with you.';
      renderVisitFacts();
      return;
    }
    // A revision keeps the patient and appointment of the record it replaces;
    // an appointment-scoped assessment keeps the patient of that visit.
    select.disabled = Boolean(state.revisingId || state.fixedAppointmentId);
    if (state.patientId && state.patients.some((patient) => patient.patientId === state.patientId)) {
      select.value = state.patientId;
    } else if (state.patientId) {
      // The draft referenced a patient this doctor no longer attends.
      state.patientId = '';
      state.appointmentId = '';
    }
    renderPatientContext();
  }

  function renderPatientContext() {
    const select = $('assessmentPatient');
    const option = select.selectedOptions[0];
    const context = $('assessmentContext');
    if (!option || !option.value) { context.textContent = ''; renderVisitFacts(); return; }
    const parts = [option.dataset.email];
    if (option.dataset.when) {
      parts.push(`Appointment ${formatMoment(option.dataset.when)}${option.dataset.status ? ` · ${humanize(option.dataset.status)}` : ''}`);
    } else {
      parts.push('No linked appointment');
    }
    const count = Number(option.dataset.count || 0);
    parts.push(count ? `${count} previous assessment${count === 1 ? '' : 's'}` : 'No previous assessments');
    context.textContent = parts.filter(Boolean).join(' · ');
    renderVisitFacts();
  }

  // A small, honest summary of the visit this record belongs to. Values come
  // from the selected option or the server's consultation payload.
  function renderVisitFacts() {
    const dl = $('stageVisit');
    if (!dl) return;
    const option = $('assessmentPatient').selectedOptions[0];
    const rows = [];
    if (option && option.value) {
      rows.push(['Patient', option.dataset.name || option.textContent.split(' — ')[0]]);
      rows.push(['Visit', option.dataset.when ? formatMoment(option.dataset.when) : 'No appointment linked']);
      if (option.dataset.status) rows.push(['Status', humanize(option.dataset.status)]);
      rows.push(['Patient record', option.dataset.walkIn === 'true' ? 'Walk-in clinical record — no online account' : 'HelloDoc account patient']);
      if (option.dataset.count) rows.push(['Previous assessments', option.dataset.count]);
    }
    if (state.consultation?.reason) rows.push(['Stated reason', state.consultation.reason]);
    dl.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'dw-context-empty';
      empty.textContent = 'Choose a patient to see the visit this record will be attached to.';
      dl.append(empty);
      return;
    }
    for (const [term, value] of rows) {
      const group = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      group.append(dt, dd);
      dl.append(group);
    }
  }

  // Consultation context for the appointment the doctor opened. Text is set with
  // textContent so a patient-stated reason can never inject markup.
  function renderConsultation(data) {
    state.consultation = data;
    const banner = $('consultationBanner');
    if (!banner) return;
    $('consultationPatient').textContent = data.patientName || 'Patient';
    $('consultationMeta').textContent = data.startsAt
      ? `· ${formatMoment(data.startsAt)}${data.status ? ` · ${humanize(data.status)}` : ''}`
      : '';
    $('consultationReason').textContent = data.reason
      ? `Patient's stated reason: ${data.reason}`
      : 'No patient-stated reason was recorded for this appointment.';
    const link = $('consultationLink');
    if (link && data.appointmentId) {
      link.href = `/doctor.html?appointment=${encodeURIComponent(data.appointmentId)}#appointment-${encodeURIComponent(data.appointmentId)}`;
    }
    banner.hidden = false;
    renderVisitFacts();
  }

  async function loadConsultation(appointmentId) {
    const response = await fetch(`/api/doctor/appointments/${encodeURIComponent(appointmentId)}/consultation`, { credentials: 'same-origin' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || 'That appointment could not be loaded.');
    }
    const data = await response.json();
    renderConsultation(data);
    return data;
  }

  function syncPatient() {
    const select = $('assessmentPatient');
    const option = select.selectedOptions[0];
    state.patientId = select.value;
    state.appointmentId = option ? (option.dataset.appointmentId || '') : '';
    markDirty();
    renderPatientContext();
    renderStepper();
  }

  // ----------------------------------------------------------------- review ---
  function fillSummary(target, rows) {
    if (!target) return;
    target.replaceChildren();
    for (const [term, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      target.append(dt, dd);
    }
  }

  function renderChecks() {
    const list = $('reviewChecks');
    if (!list) return;
    const symptoms = state.reported.length + state.clinician.length;
    const checks = [
      { ok: Boolean(state.patientId), text: state.patientId ? 'Patient selected' : 'Select the patient for this record' },
      {
        ok: Boolean(state.appointmentId || state.revisingId),
        text: state.revisingId ? 'Revision of a saved record' : state.appointmentId ? 'Linked to this appointment' : 'Open the record from an appointment',
      },
      { ok: symptoms > 0, text: symptoms ? `${symptoms} symptom${symptoms === 1 ? '' : 's'} will be sent to the model` : 'Add at least one symptom for the model' },
      {
        ok: Boolean(state.doctorAssessment.trim()), optional: true,
        text: state.doctorAssessment.trim() ? 'Your assessment is recorded' : 'Your assessment is not recorded — you can add it after saving',
      },
      {
        ok: Boolean(state.plan.trim()), optional: true,
        text: state.plan.trim() ? 'Your plan is recorded' : 'Your plan is not recorded — you can add it after saving',
      },
    ];
    list.replaceChildren();
    for (const check of checks) {
      const item = document.createElement('li');
      item.className = 'dw-review__check';
      item.dataset.state = check.ok ? 'done' : check.optional ? 'optional' : 'missing';
      const mark = document.createElement('span');
      mark.className = 'dw-review__mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = check.ok ? '\u2713' : check.optional ? '!' : '\u2715';
      const text = document.createElement('span');
      text.textContent = check.text;
      item.append(mark, text);
      list.append(item);
    }
  }

  function buildReview() {
    // Two lists on purpose: what the model actually receives (the symptom
    // identifiers) and what is stored with the record for the people reading it.
    const selected = state.patients.find((patient) => patient.patientId === state.patientId);
    fillSummary($('reviewSummary'), [
      ['Reported by the patient', state.reported.map(labelFor).join(', ') || 'None'],
      ['Recorded by you', state.clinician.map(labelFor).join(', ') || 'None'],
      ['Symptoms sent to the model', String(state.reported.length + state.clinician.length)],
    ]);
    fillSummary($('reviewClinician'), [
      ['Assessment', state.doctorAssessment.trim() || 'Not recorded'],
      ['Plan', state.plan.trim() || 'Not recorded'],
    ]);
    const recordRows = [
      ['Patient', selected ? selected.fullName : 'Not selected'],
      ['Appointment', selected?.appointmentStart
        ? `${formatMoment(selected.appointmentStart)} · ${humanize(selected.appointmentStatus || 'status unknown')}`
        : 'Not linked'],
      ['Observations', state.observations.join(' · ') || 'None'],
      ['Duration', state.duration || 'Not recorded'],
      ['Clinical note', state.note || 'Not recorded'],
    ];
    if (state.revisingSource) {
      recordRows.push(['Recorded originally', formatMoment(state.revisingSource.createdAt)]);
      recordRows.push(['Original prediction', `${state.revisingSource.predictedDisease} (kept on the previous record)`]);
    }
    fillSummary($('reviewRecord'), recordRows);
    renderChecks();
  }

  function openReview() {
    showError('assessmentError', '');
    if (state.revisingSource?.latestRevisionId) {
      showError('assessmentError', 'This assessment has already been revised. Open the newer revision before changing symptoms again.');
      return;
    }
    if (!state.patientId) {
      showError('assessmentError', 'Select the patient this assessment belongs to.');
      showStep(1, true);
      return;
    }
    if (!state.revisingId && !state.appointmentId) {
      showError('assessmentError', 'Open this assessment from an appointment assigned to you.');
      showStep(1, true);
      return;
    }
    if (!state.reported.length && !state.clinician.length) {
      showError('assessmentError', 'Add at least one model symptom before reviewing.');
      showStep(2, true);
      return;
    }
    buildReview();
    showStep(6);
    $('reviewPanel').focus();
    announce('Review the assessment before saving.');
  }

  function closeReview() {
    showStep(state.lastEditStep || 4, true);
  }

  // ------------------------------------------------------------------- save ---
  async function saveAssessment() {
    // A second click (or a shortcut) while the request is in flight must never
    // create a duplicate assessment or revision.
    if (state.saving) return;
    if (!state.patientId) { showError('reviewError', 'Select a patient first.'); return; }
    if (!state.revisingId && !state.appointmentId) { showError('reviewError', 'Open this assessment from an appointment assigned to you.'); return; }
    if (!state.reported.length && !state.clinician.length) { showError('reviewError', 'Add at least one model symptom.'); return; }
    persist();

    const button = $('saveAssessment');
    state.saving = true;
    setDraftState('Saving assessment…', 'saving');
    button.disabled = true;
    button.textContent = 'Saving assessment…';
    showError('reviewError', '');

    const shared = {
      patientReported: state.reported,
      clinicianAdded: state.clinician,
      observations: state.observations,
      symptomDuration: state.duration,
      clinicalNote: state.note,
      doctorAssessment: state.doctorAssessment,
      plan: state.plan,
    };
    const url = state.revisingId
      ? `/api/doctor/assessments/${encodeURIComponent(state.revisingId)}/revision`
      : '/api/doctor/assessments';
    // The server derives the patient from the appointment. Only the appointment
    // id is sent for a new record; a revision takes its identity from the stored
    // record. A browser-supplied patient id is never trusted.
    const payload = state.revisingId ? shared : { appointmentId: state.appointmentId, ...shared };

    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && body.code === 'ASSESSMENT_EXISTS' && body.assessmentId) {
          // Another tab (or a retry) saved this appointment first. The stored
          // record wins; open it instead of creating a duplicate. The draft is
          // gone, so leaving must not raise the unsaved-changes prompt.
          clearDraft();
          state.saved = true;
          window.location.assign(`/prediction.html?id=${encodeURIComponent(body.assessmentId)}`);
          return;
        }
        if (response.status === 401) {
          throw new Error('Your session expired. Your text is still here; sign in again in another tab and retry.');
        }
        if (body.code === 'UNSUPPORTED_SYMPTOMS' && Array.isArray(body.unsupported)) {
          // Keep every entry: move unsupported ones to observations, never drop.
          for (const id of body.unsupported) {
            state.reported = state.reported.filter((item) => item !== id);
            state.clinician = state.clinician.filter((item) => item !== id);
            const text = labelFor(id);
            if (!state.observations.includes(text)) state.observations.push(text);
          }
          markDirty();
          renderAll();
          buildReview();
          throw new Error('Some entries are not model features. They were moved to clinical observations — review and save again.');
        }
        throw new Error(body.message || 'The assessment could not be saved.');
      }
      clearDraft();
      state.persistedThisSession = true;
      markSaved();
      setDraftState('Saved', 'saved');
      announce('Assessment saved.');
      window.location.assign(`/prediction.html?id=${encodeURIComponent(body.id)}`);
    } catch (error) {
      // The draft stays in the form and on this device; the server confirmed
      // nothing, so the state must not claim success. Persist without replacing
      // the failure message with the ordinary "draft kept" label.
      setDraftState('Save failed — your text is kept', 'error');
      showError('reviewError', error.message || 'The assessment could not be saved. Your form is preserved; please retry.');
      window.clearTimeout(persistTimer);
      persist();
    } finally {
      state.saving = false;
      button.disabled = false;
      button.textContent = 'Save assessment';
      renderStepper();
    }
  }

  // ------------------------------------------------------------------ sync ---
  function renderAll() {
    reportedPicker?.renderChips();
    clinicianPicker?.renderChips();
    renderObservations();
    renderHints();
    renderStepper();
  }

  // Restoring an existing assessment into the capture form lets the doctor fix a
  // symptom list without retyping the consultation. Nothing on the stored record
  // changes: saving re-runs the model and appends a revision.
  function applyRevisionSource(data) {
    state.revisingId = data.id;
    state.revisingSource = data;
    state.patientId = data.patientId;
    state.appointmentId = data.appointmentId || '';
    // The patient list picks the "most relevant" appointment, which may be a
    // different visit for the same patient. Show the visit this record belongs
    // to so the review and PDF agree with the saved assessment.
    const match = state.patients.find((patient) => patient.patientId === data.patientId);
    if (match) {
      Object.assign(match, {
        appointmentId: data.appointmentId || match.appointmentId,
        appointmentStart: data.appointmentStart || match.appointmentStart,
        appointmentStatus: data.appointmentStatus || match.appointmentStatus,
        email: data.patientEmail || match.email,
      });
    }
    state.reported = Array.isArray(data.patientReported) ? [...data.patientReported] : [];
    state.clinician = Array.isArray(data.clinicianAdded) ? [...data.clinicianAdded] : [];
    state.observations = Array.isArray(data.observations) ? [...data.observations] : [];
    state.duration = data.symptomDuration || '';
    state.note = data.clinicalNote || '';
    state.doctorAssessment = data.doctorAssessment || '';
    state.plan = data.plan || '';
    $('symptomDuration').value = state.duration;
    $('clinicalNote').value = state.note;
    $('doctorAssessment').value = state.doctorAssessment;
    $('plan').value = state.plan;
    const banner = $('reviseBanner');
    if (banner) {
      const link = $('reviseSourceLink');
      if (link) {
        link.href = `/prediction.html?id=${encodeURIComponent(data.id)}`;
        link.textContent = `Open the original record (${formatMoment(data.createdAt)})`;
      }
      banner.hidden = false;
    }
    $('reviewButton').textContent = 'Review revision';
    state.saved = true;
    setDraftState('Editing a saved assessment', 'saved');
  }

  function syncFields() {
    state.duration = $('symptomDuration').value;
    state.note = $('clinicalNote').value;
  }

  ['symptomDuration', 'clinicalNote'].forEach((id) => {
    $(id).addEventListener('input', () => { syncFields(); markDirty(); });
  });
  $('doctorAssessment').addEventListener('input', () => {
    state.doctorAssessment = $('doctorAssessment').value;
    markDirty();
    renderHints();
    renderStepper();
  });
  $('plan').addEventListener('input', () => {
    state.plan = $('plan').value;
    markDirty();
    renderStepper();
  });
  $('assessmentPatient').addEventListener('change', syncPatient);
  $('addObservation').addEventListener('click', addObservation);
  $('observationInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); addObservation(); }
  });
  $('reviewButton').addEventListener('click', openReview);
  $('backToEdit').addEventListener('click', closeReview);
  $('saveAssessment').addEventListener('click', saveAssessment);
  $('editClinician').addEventListener('click', () => showStep(4, true));
  $('stepBack').addEventListener('click', () => goStep(state.currentStep - 1, true));
  $('stepNext').addEventListener('click', () => goStep(state.currentStep + 1, true));
  for (const button of stepButtons) {
    button.addEventListener('click', () => goStep(Number(button.dataset.step)));
  }
  // Arrow keys move through the stage list the way a tab set would.
  $('assessmentSteps')?.addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const index = stepButtons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    let target = index;
    if (event.key === 'ArrowRight') target = (index + 1) % stepButtons.length;
    if (event.key === 'ArrowLeft') target = (index - 1 + stepButtons.length) % stepButtons.length;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = stepButtons.length - 1;
    stepButtons[target].focus();
    stepButtons[target].click();
  });

  // Note scaffolds insert headings only. No clinical sentence, finding, dose or
  // plan is written for the doctor.
  for (const button of document.querySelectorAll('[data-template]')) {
    button.addEventListener('click', () => {
      const area = $('clinicalNote');
      const heading = button.dataset.template;
      const start = area.selectionStart ?? area.value.length;
      const end = area.selectionEnd ?? start;
      const before = area.value.slice(0, start);
      const separator = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
      const block = `${heading}:\n\n`;
      area.value = `${before}${separator}${block}${area.value.slice(end)}`;
      const position = before.length + separator.length + block.length;
      area.focus();
      area.setSelectionRange(position, position);
      syncFields();
      markDirty();
      announce(`${heading} heading inserted.`);
    });
  }

  $('resetDraft').addEventListener('click', () => {
    if (!window.confirm('Clear this form? Symptoms, observations and notes will be lost.')) return;
    const keepContext = Boolean(state.fixedAppointmentId || state.revisingId);
    state.reported = [];
    state.clinician = [];
    state.observations = [];
    state.duration = '';
    state.note = '';
    state.doctorAssessment = '';
    state.plan = '';
    if (!keepContext) {
      state.patientId = '';
      state.appointmentId = '';
      $('assessmentPatient').value = '';
    }
    $('symptomDuration').value = '';
    $('clinicalNote').value = '';
    $('observationInput').value = '';
    $('doctorAssessment').value = '';
    $('plan').value = '';
    $('draftBanner').hidden = true;
    showError('assessmentError', '');
    clearDraft();
    state.saved = true;
    state.persistedThisSession = false;
    setDraftState(keepContext ? 'Form cleared · consultation still open' : 'Form cleared', 'saved');
    renderAll();
    renderPatientContext();
    showStep(keepContext ? 2 : 1);
    announce(keepContext ? 'Form cleared. This consultation is still open.' : 'Form cleared.');
  });

  // Unsaved work must survive an accidental navigation, including the back
  // button; the draft is also kept in sessionStorage, this just makes it clear.
  window.addEventListener('beforeunload', (event) => {
    if (state.saved || state.saving) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('keydown', (event) => {
    const tag = (event.target.tagName || '').toLowerCase();
    const typing = ['input', 'textarea', 'select'].includes(tag) || event.target.isContentEditable;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (state.currentStep === 6) saveAssessment(); else openReview();
      return;
    }
    if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      showStep(2);
      reportedPicker?.focus();
      return;
    }
    // Escape closes the review without discarding anything; inside a field it
    // must keep its native meaning, so typing is never interrupted.
    if (event.key === 'Escape' && !typing && state.currentStep === 6) {
      event.preventDefault();
      closeReview();
    }
  });

  // ------------------------------------------------------------------ init ---
  async function load() {
    const params = new URLSearchParams(window.location.search);
    const reviseId = params.get('assess');
    const appointmentId = params.get('appointment');
    try {
      const [vocabularyResponse, patientResponse] = await Promise.all([
        fetch('/api/doctor/symptoms', { credentials: 'same-origin' }),
        fetch('/api/doctor/patients', { credentials: 'same-origin' }),
      ]);
      if (vocabularyResponse.status === 401 || vocabularyResponse.status === 403) {
        throw new Error('Sign in with an approved doctor account to record assessments.');
      }
      if (!vocabularyResponse.ok) throw new Error('The symptom model is unavailable. Retry in a moment.');
      const vocabulary = await vocabularyResponse.json();
      state.vocabulary = { symptoms: Array.isArray(vocabulary.symptoms) ? vocabulary.symptoms : [], labels: vocabulary.labels || {} };
      if (!state.vocabulary.symptoms.length) throw new Error('The model reported an empty symptom vocabulary.');
      if (!patientResponse.ok) throw new Error('Your patient list is unavailable. Retry in a moment.');
      state.patients = await patientResponse.json();
      // Restore the draft before populating the select so the saved patient is
      // selected rather than silently dropped on reload.
      if (appointmentId) {
        setEditorVisible(true);
        // Patient identity and appointment come from the stored consultation. A
        // consultation already assessed reopens that record instead of creating a
        // second assessment for the same visit.
        const consultation = await loadConsultation(appointmentId);
        const existingPatient = state.patients.find((patient) => patient.patientId === consultation.patientId);
        if (existingPatient) {
          Object.assign(existingPatient, {
            appointmentId: consultation.appointmentId,
            appointmentStart: consultation.startsAt,
            appointmentStatus: consultation.status,
            email: consultation.patientEmail || existingPatient.email,
            walkIn: Boolean(consultation.clinicPatientId) || existingPatient.walkIn,
          });
        } else {
          state.patients.push({
            patientId: consultation.patientId, fullName: consultation.patientName || 'Patient',
            email: consultation.patientEmail || '', appointmentId: consultation.appointmentId,
            appointmentStart: consultation.startsAt, appointmentStatus: consultation.status,
            assessmentCount: consultation.previousAssessmentId ? 1 : 0,
            walkIn: Boolean(consultation.clinicPatientId),
          });
        }
        if (consultation.previousAssessmentId) {
          const source = await fetch(`/api/doctor/assessments/${encodeURIComponent(consultation.previousAssessmentId)}`, { credentials: 'same-origin' });
          if (!source.ok) throw new Error('The assessment already recorded for this appointment is unavailable.');
          applyRevisionSource(await source.json());
        } else {
          state.fixedAppointmentId = consultation.appointmentId;
          state.patientId = consultation.patientId;
          state.appointmentId = consultation.appointmentId;
        }
        clearDraft();
        fillPatients();
        renderAll();
        showStep(1);
        setDraftState('No changes yet', '');
        loadRecent();
        return;
      }
      if (reviseId) {
        setEditorVisible(true);
        // The stored record wins over any leftover draft: a revision must start
        // from what was actually saved for this consultation.
        const sourceResponse = await fetch(`/api/doctor/assessments/${encodeURIComponent(reviseId)}`, { credentials: 'same-origin' });
        if (!sourceResponse.ok) throw new Error('That assessment is not available to your account.');
        applyRevisionSource(await sourceResponse.json());
        clearDraft();
        fillPatients();
        if (state.appointmentId) loadConsultation(state.appointmentId).catch(() => { /* context is optional here */ });
        if (state.revisingSource && state.revisingSource.latestRevisionId) {
          // A record can only be replaced once; sending this form would be rejected.
          setDraftState('A newer revision already exists', 'dirty');
          showError('assessmentError', 'This assessment has already been revised. Open the newer revision before changing symptoms again.');
          const review = $('reviewButton');
          review.disabled = true;
          review.textContent = 'Newer revision exists';
        }
        renderAll();
        showStep(2);
        loadRecent();
        return;
      }
      const restored = restoreDraft();
      setEditorVisible(restored);
      fillPatients();
      if (restored) {
        $('symptomDuration').value = state.duration;
        $('clinicalNote').value = state.note;
        $('doctorAssessment').value = state.doctorAssessment;
        $('plan').value = state.plan;
        $('draftBanner').hidden = false;
        state.saved = false;
        setDraftState('Unsaved changes (draft restored)', 'dirty');
      } else {
        markSaved();
      }
      renderAll();
      showStep(1);
      loadRecent();
    } catch (error) {
      // The failure is reported inside the editor, so it must stay visible.
      setEditorVisible(true);
      showError('assessmentError', error.message);
      $('assessmentPatient').replaceChildren(new Option('Patient list unavailable', ''));
      renderStepper();
      showStep(1);
    }
  }

  async function loadRecent() {
    try {
      const response = await fetch('/api/doctor/assessments', { credentials: 'same-origin' });
      if (!response.ok) return;
      const rows = await response.json();
      if (!Array.isArray(rows) || !rows.length) return;
      const list = $('recentAssessments');
      list.replaceChildren();
      for (const row of rows.slice(0, 5)) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/prediction.html?id=${encodeURIComponent(row.id)}`;
        link.textContent = `${row.patientName} · ${row.predictedDisease}`;
        const when = document.createElement('span');
        when.textContent = formatMoment(row.createdAt);
        item.append(link, when);
        list.append(item);
      }
      $('recentSection').hidden = false;
    } catch { /* recent list is optional */ }
  }

  load();
  window.HelloDocAssessment = { openReview, saveAssessment };
})();
