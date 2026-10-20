/* Clinical assessment workspace: symptom autocomplete, draft safety, review. */
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
    // When set, saving creates a revision of this assessment instead of a new one.
    revisingId: null,
    revisingSource: null,
    // Set when the assessment was opened from one specific appointment.
    fixedAppointmentId: null,
  };

  const humanize = (identifier) => {
    const text = String(identifier).replace(/_/g, ' ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : String(identifier);
  };
  const labelFor = (id) => state.vocabulary.labels[id] || humanize(id);
  const sameSet = (a, b) => a.length === b.length && a.every((item) => b.includes(item));

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
    persist();
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
  function clearDraft() {
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
        renderObservations();
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
    renderObservations();
    announce('Observation added.');
  }

  // ------------------------------------------------------------- patients ---
  function fillPatients() {
    const select = $('assessmentPatient');
    select.replaceChildren(new Option('Select a patient…', ''));
    for (const patient of state.patients) {
      const when = patient.appointmentStart ? new Date(patient.appointmentStart).toLocaleString() : 'no appointment';
      const option = new Option(`${patient.fullName} — ${when}`, patient.patientId);
      option.dataset.appointmentId = patient.appointmentId || '';
      option.dataset.when = patient.appointmentStart || '';
      option.dataset.status = patient.appointmentStatus || '';
      option.dataset.email = patient.email || '';
      option.dataset.count = String(patient.assessmentCount || 0);
      select.append(option);
    }
    if (!state.patients.length) {
      select.replaceChildren(new Option('No patients with appointments yet', ''));
      const context = $('assessmentContext');
      context.textContent = 'Assessments can be recorded once a patient has booked an appointment with you.';
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
    if (!option || !option.value) { context.textContent = ''; return; }
    const parts = [option.dataset.email];
    if (option.dataset.when) {
      parts.push(`Appointment ${new Date(option.dataset.when).toLocaleString()}${option.dataset.status ? ` (${option.dataset.status})` : ''}`);
    } else {
      parts.push('No linked appointment');
    }
    const count = Number(option.dataset.count || 0);
    parts.push(count ? `${count} previous assessment${count === 1 ? '' : 's'}` : 'No previous assessments');
    context.textContent = parts.filter(Boolean).join(' · ');
  }

  // Consultation context for the appointment the doctor opened. Text is set with
  // textContent so a patient-stated reason can never inject markup.
  function renderConsultation(data) {
    const banner = $('consultationBanner');
    if (!banner) return;
    $('consultationPatient').textContent = data.patientName || 'Patient';
    $('consultationMeta').textContent = data.startsAt
      ? `· appointment ${new Date(data.startsAt).toLocaleString()}${data.status ? ` (${data.status})` : ''}`
      : '';
    $('consultationReason').textContent = data.reason
      ? `Patient's stated reason: ${data.reason}`
      : 'No patient-stated reason was recorded for this appointment.';
    const link = $('consultationLink');
    if (link && data.appointmentId) {
      link.href = `/doctor.html?appointment=${encodeURIComponent(data.appointmentId)}#appointment-${encodeURIComponent(data.appointmentId)}`;
    }
    banner.hidden = false;
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
  }

  // ----------------------------------------------------------------- review ---
  function buildReview() {
    const summary = $('reviewSummary');
    summary.replaceChildren();
    const selected = state.patients.find((patient) => patient.patientId === state.patientId);
    const rows = [
      ['Patient', selected ? selected.fullName : 'Not selected'],
      ['Appointment', selected?.appointmentStart
        ? `${new Date(selected.appointmentStart).toLocaleString()} (${selected.appointmentStatus || 'status unknown'})`
        : 'Not linked'],
      ['Reported by patient', state.reported.map(labelFor).join(', ') || 'None'],
      ['Recorded by you', state.clinician.map(labelFor).join(', ') || 'None'],
      ['Model symptoms', String(state.reported.length + state.clinician.length)],
      ['Observations (not sent to model)', state.observations.join(' · ') || 'None'],
      ['Duration', state.duration || 'Not recorded'],
      ['Clinical note', state.note || 'Not recorded'],
    ];
    if (state.revisingSource) {
      rows.push(['Recorded originally', new Date(state.revisingSource.createdAt).toLocaleString()]);
      rows.push(['Original prediction', `${state.revisingSource.predictedDisease} (kept on the previous record)`]);
    }
    for (const [term, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      summary.append(dt, dd);
    }
  }

  function openReview() {
    showError('assessmentError', '');
    if (state.revisingSource?.latestRevisionId) {
      showError('assessmentError', 'This assessment has already been revised. Open the newer revision before changing symptoms again.');
      return;
    }
    if (!state.patientId) { showError('assessmentError', 'Select the patient this assessment belongs to.'); return; }
    if (!state.reported.length && !state.clinician.length) {
      showError('assessmentError', 'Add at least one model symptom before reviewing.');
      return;
    }
    $('doctorAssessment').value = state.doctorAssessment;
    $('plan').value = state.plan;
    buildReview();
    $('reviewPanel').hidden = false;
    $('reviewPanel').focus();
    announce('Review the assessment before saving.');
  }

  function closeReview() {
    $('reviewPanel').hidden = true;
    form.querySelector('#reviewButton').focus();
  }

  // ------------------------------------------------------------------- save ---
  async function saveAssessment() {
    // A second click (or a shortcut) while the request is in flight must never
    // create a duplicate assessment or revision.
    if (state.saving) return;
    if (!state.patientId) { showError('reviewError', 'Select a patient first.'); return; }
    if (!state.reported.length && !state.clinician.length) { showError('reviewError', 'Add at least one model symptom.'); return; }
    state.doctorAssessment = $('doctorAssessment').value;
    state.plan = $('plan').value;
    persist();

    const button = $('saveAssessment');
    state.saving = true;
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
    // The revision endpoint takes the patient and appointment from the stored
    // record, so they are deliberately not resent from the browser.
    const payload = state.revisingId ? shared : { patientId: state.patientId, appointmentId: state.appointmentId || null, ...shared };

    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
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
      markSaved();
      window.location.assign(`/prediction.html?id=${encodeURIComponent(body.id)}`);
    } catch (error) {
      showError('reviewError', error.message || 'The assessment could not be saved. Your form is preserved; please retry.');
    } finally {
      state.saving = false;
      button.disabled = false;
      button.textContent = 'Save assessment';
    }
  }

  // ------------------------------------------------------------------ sync ---
  function renderAll() {
    reportedPicker?.renderChips();
    clinicianPicker?.renderChips();
    renderObservations();
  }

  // Restoring an existing assessment into the capture form lets the doctor fix a
  // symptom list without retyping the consultation. Nothing on the stored record
  // changes: saving re-runs the model and appends a revision.
  function applyRevisionSource(data) {
    state.revisingId = data.id;
    state.revisingSource = data;
    state.patientId = data.patientId;
    state.appointmentId = data.appointmentId || '';
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
        link.textContent = `Open the original record (${new Date(data.createdAt).toLocaleString()})`;
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
  });
  $('plan').addEventListener('input', () => {
    state.plan = $('plan').value;
    markDirty();
  });
  $('assessmentPatient').addEventListener('change', syncPatient);
  $('addObservation').addEventListener('click', addObservation);
  $('observationInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); addObservation(); }
  });
  $('reviewButton').addEventListener('click', openReview);
  $('backToEdit').addEventListener('click', closeReview);
  $('saveAssessment').addEventListener('click', saveAssessment);
  $('resetDraft').addEventListener('click', () => {
    if (!window.confirm('Clear this draft? Recorded symptoms and notes will be lost.')) return;
    state.patientId = ''; state.appointmentId = '';
    state.reported = []; state.clinician = []; state.observations = [];
    state.duration = ''; state.note = ''; state.doctorAssessment = ''; state.plan = '';
    $('assessmentPatient').value = '';
    $('symptomDuration').value = '';
    $('clinicalNote').value = '';
    $('observationInput').value = '';
    $('doctorAssessment').value = '';
    $('plan').value = '';
    $('reviewPanel').hidden = true;
    $('draftBanner').hidden = true;
    showError('assessmentError', '');
    clearDraft();
    markSaved();
    renderAll();
    renderPatientContext();
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
      if (!$('reviewPanel').hidden) saveAssessment(); else openReview();
      return;
    }
    if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      reportedPicker?.focus();
      return;
    }
    // Escape closes the review without discarding anything; inside a field it
    // must keep its native meaning, so typing is never interrupted.
    if (event.key === 'Escape' && !typing && !$('reviewPanel').hidden) {
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
        // Patient identity and appointment come from the stored consultation. A
        // consultation already assessed reopens that record instead of creating a
        // second assessment for the same visit.
        const consultation = await loadConsultation(appointmentId);
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
        loadRecent();
        return;
      }
      if (reviseId) {
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
        loadRecent();
        return;
      }
      const restored = restoreDraft();
      fillPatients();
      if (restored) {
        $('symptomDuration').value = state.duration;
        $('clinicalNote').value = state.note;
        $('draftBanner').hidden = false;
        state.saved = false;
        setDraftState('Unsaved changes (draft restored)', 'dirty');
      } else {
        markSaved();
      }
      renderAll();
      loadRecent();
    } catch (error) {
      showError('assessmentError', error.message);
      $('assessmentPatient').replaceChildren(new Option('Patient list unavailable', ''));
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
        when.textContent = new Date(row.createdAt).toLocaleString();
        item.append(link, when);
        list.append(item);
      }
      $('recentSection').hidden = false;
    } catch { /* recent list is optional */ }
  }

  load();
  window.HelloDocAssessment = { openReview, saveAssessment };
})();
