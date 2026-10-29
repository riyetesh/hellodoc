/* Clinical assessment workspace.

   Three areas, one scrollable record: the patient and visit, the reported
   symptoms and the doctor's findings, then the doctor's decision and plan.
   Model output is a separate, optional preview; saving always stores the
   doctor's own text alongside it and never writes over it.

   The model can be down. That must not stop clinical documentation: the page
   reports which part failed, keeps every field, and offers an explicit
   "save without the model" path that stores no prediction at all. */
(() => {
  'use strict';
  const form = document.getElementById('assessmentForm');
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const DRAFT_KEY = 'hellodoc:assessment-draft:v2';
  const MAX_OBSERVATIONS = 20;

  const state = {
    vocabulary: { symptoms: [], labels: {} },
    modelAvailable: false,
    modelError: null,
    modelPreview: null,
    selectedGuidance: { precautions: [], medications: [], diet: [], workout: [] },
    // Set when a model call failed in this session. It is what makes the
    // model-free save path visible, and it is never hidden again by a later
    // successful preview.
    modelOutage: null,
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
    persistedThisSession: false,
    revisingId: null,
    revisingSource: null,
    fixedAppointmentId: null,
    consultation: null,
  };

  const humanize = (identifier) => {
    const text = String(identifier).replace(/_/g, ' ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : String(identifier);
  };
  const labelFor = (id) => state.vocabulary.labels[id] || humanize(id);
  const modelSymptoms = () => [...state.reported, ...state.clinician];
  const hasClinicalText = () => Boolean(state.observations.length || state.note.trim()
    || state.doctorAssessment.trim() || state.plan.trim());

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
  function announce(message) {
    if (!message) return;
    const node = $('assessmentAnnounce');
    if (node) node.textContent = message;
  }
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
  // Only this device's draft is written here, and only clinical identifiers and
  // the doctor's own text. No patient identity, email or appointment label.
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
    state.observations = Array.isArray(draft.observations) ? draft.observations.filter((item) => typeof item === 'string') : [];
    state.duration = typeof draft.duration === 'string' ? draft.duration : '';
    state.note = typeof draft.note === 'string' ? draft.note : '';
    state.doctorAssessment = typeof draft.doctorAssessment === 'string' ? draft.doctorAssessment : '';
    state.plan = typeof draft.plan === 'string' ? draft.plan : '';
    return true;
  }

  // ------------------------------------------------------------- autocomplete ---
  const normalize = (text) => String(text)
    .toLowerCase()
    .replace(/[_./-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  function createPicker({ mountId, listName, onAdd, onRemove }) {
    const mount = $(mountId);
    if (!mount) return null;
    if (!state.modelAvailable || !state.vocabulary.symptoms.length) {
      mount.replaceChildren();
      const empty = document.createElement('p');
      empty.className = 'symptom-unavailable';
      empty.textContent = 'Symptom search is unavailable while the model service is down.';
      mount.append(empty);
      return { renderChips() {}, focus: () => $('observationInput').focus() };
    }
    const listId = `${listName}-options`;
    mount.replaceChildren();
    const chips = document.createElement('ul');
    chips.className = 'symptom-chips';
    chips.setAttribute('role', 'list');
    chips.dataset.chips = '';
    const wrap = document.createElement('div');
    wrap.className = 'symptom-input-wrap';
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('role', 'combobox');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-label', listName === 'reported'
      ? 'Search symptoms reported by the patient'
      : 'Search symptoms recorded by the doctor');
    input.placeholder = 'Type a symptom name…';
    const list = document.createElement('ul');
    list.className = 'symptom-options';
    list.id = listId;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    wrap.append(input, list);
    const count = document.createElement('p');
    count.className = 'symptom-count';
    count.setAttribute('aria-live', 'polite');
    mount.append(chips, wrap, count);

    let options = [];
    let active = -1;

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }

    function search(query) {
      const selected = new Set(modelSymptoms());
      const tokens = normalize(query).split(' ').filter(Boolean);
      return state.vocabulary.symptoms
        .filter((id) => !selected.has(id))
        .filter((id) => {
          if (!tokens.length) return true;
          const haystack = `${normalize(labelFor(id))} ${normalize(id)}`;
          return tokens.every((token) => haystack.includes(token));
        })
        .slice(0, 8);
    }

    function renderOptions(query) {
      options = search(query);
      active = -1;
      list.replaceChildren();
      if (!query.trim()) { close(); return; }
      if (!options.length) {
        const selected = modelSymptoms();
        const tokens = normalize(query).split(' ').filter(Boolean);
        const already = selected.some((id) => tokens.every((token) => normalize(labelFor(id)).includes(token)));
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
      if (!id || modelSymptoms().includes(id)) return;
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
      if (!selected.length) {
        const empty = document.createElement('li');
        empty.className = 'symptom-empty';
        empty.textContent = listName === 'reported' ? 'Nothing reported yet.' : 'Nothing added by you yet.';
        chips.append(empty);
      }
      const total = modelSymptoms().length;
      count.textContent = selected.length
        ? `${selected.length} here · ${total} model symptom${total === 1 ? '' : 's'} in this record`
        : `None here · ${total} in this record`;
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
        // Never submits the form: Enter only picks the highlighted symptom.
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

  let reportedPicker = null;
  let clinicianPicker = null;
  function buildPickers() {
    reportedPicker = createPicker({
      mountId: 'reportedPicker', listName: 'reported',
      onAdd: (id) => addSymptom('reported', id),
      onRemove: (id) => removeSymptom('reported', id),
    });
    clinicianPicker = createPicker({
      mountId: 'clinicianPicker', listName: 'clinician',
      onAdd: (id) => addSymptom('clinician', id),
      onRemove: (id) => removeSymptom('clinician', id),
    });
  }

  function addSymptom(listName, id) {
    if (modelSymptoms().includes(id)) return;
    if (listName === 'reported') state.reported.push(id); else state.clinician.push(id);
    // A preview produced from a different symptom set would be misleading.
    state.modelPreview = null;
    markDirty();
    renderAll();
    announce(`${labelFor(id)} added.`);
  }
  function removeSymptom(listName, id) {
    const list = listName === 'reported' ? state.reported : state.clinician;
    const index = list.indexOf(id);
    if (index < 0) return;
    list.splice(index, 1);
    state.modelPreview = null;
    markDirty();
    renderAll();
    announce(`${labelFor(id)} removed.`);
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
  function renderHints() {
    const reported = $('reportedHint');
    if (reported) {
      const total = modelSymptoms().length;
      if (!state.modelAvailable) {
        reported.hidden = false;
        reported.textContent = 'Symptom search is unavailable. Record what you need in the observations and clinical note; nothing you type here is lost.';
      } else if (!total) {
        reported.hidden = false;
        reported.textContent = 'Add at least one symptom, or save this consultation as a clinical record without a model suggestion.';
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
    // A revision or an appointment-scoped record keeps the patient it belongs to.
    select.disabled = Boolean(state.revisingId || state.fixedAppointmentId);
    if (state.patientId && state.patients.some((patient) => patient.patientId === state.patientId)) {
      select.value = state.patientId;
    } else if (state.patientId) {
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
    renderSideSummary();
  }

  function renderVisitFacts() {
    const dl = $('stageVisit');
    if (!dl) return;
    const option = $('assessmentPatient').selectedOptions[0];
    const rows = [];
    if (option && option.value) {
      rows.push(['Patient', option.dataset.name || option.textContent.split(' — ')[0]]);
      rows.push(['Visit', option.dataset.when ? formatMoment(option.dataset.when) : 'No appointment linked']);
      if (option.dataset.status) rows.push(['Status', humanize(option.dataset.status)]);
      rows.push(['Patient record', option.dataset.walkIn === 'true' ? 'Walk-in clinical record, no online account' : 'HelloDoc account patient']);
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
    renderSideSummary();
  }

  // ----------------------------------------------------------------- model ---
  function outageMessage(code) {
    if (code === 'MODEL_NOT_CONFIGURED' || code === 'MODEL_AUTH') {
      return 'Symptom search is not configured correctly on this server. Clinical notes, observations and your assessment still save.';
    }
    if (code === 'MODEL_TIMEOUT') return 'The model service did not answer in time.';
    if (code === 'MODEL_INVALID_RESPONSE') return 'The model service returned a response this application cannot use.';
    return 'The model service is not reachable right now.';
  }

  function noteModelOutage(code, message) {
    state.modelOutage = { code: code || 'MODEL_UNAVAILABLE', message: message || outageMessage(code) };
    state.modelPreview = null;
    renderModelPanel();
    renderReview();
  }

  function renderModelState() {
    const box = $('modelState');
    if (!box) return;
    const title = $('modelStateTitle');
    const text = $('modelStateText');
    if (state.modelOutage || !state.modelAvailable) {
      box.dataset.state = 'down';
      title.textContent = 'Symptom search unavailable';
      text.textContent = 'You can still record observations, a clinical note, an assessment and a plan. Saving that record stores no prediction.';
    } else if (state.modelPreview) {
      box.dataset.state = 'ready';
      title.textContent = 'Prediction ready';
      text.textContent = '';
    } else {
      box.dataset.state = 'ready';
      title.textContent = `Symptom search ready · ${state.vocabulary.symptoms.length} model symptoms`;
      text.textContent = 'Choose symptoms from the model vocabulary, then run Predict to see suggestions.';
    }
  }

  function renderModelPanel() {
    renderModelState();
    const status = $('modelPanelStatus');
    const run = $('runModel');
    const result = $('modelResult');
    const fallback = $('modelFallback');
    if (!status || !run || !result) return;
    const symptoms = modelSymptoms();

    if (state.modelOutage || !state.modelAvailable) {
      status.textContent = (state.modelOutage?.message || outageMessage(state.modelError?.code))
        + ' No prediction will be stored for this consultation unless you retry the model later.';
      run.disabled = state.saving || !state.modelAvailable;
      run.textContent = state.modelAvailable ? 'Retry prediction' : 'Model unavailable';
    } else if (!symptoms.length) {
      status.textContent = 'Add symptoms first.';
      run.disabled = true;
    } else if (state.modelPreview) {
      status.textContent = 'Prediction ready.';
      run.disabled = state.saving;
    } else {
      status.textContent = 'Ready to predict.';
      run.disabled = state.saving;
    }
    run.textContent = state.modelPreview ? 'Run again' : (state.modelOutage ? 'Retry prediction' : 'Predict');

    const resultsPanel = $('modelResultsPanel');
    if (resultsPanel) resultsPanel.hidden = !state.modelPreview;

    if (state.modelPreview) {
      result.hidden = false;
      $('modelOutput').textContent = state.modelPreview.output;
      $('modelMeta').textContent = `Model version ${state.modelPreview.modelVersion}`;
      $('modelHint').textContent = 'Only the selected symptoms were sent. Your assessment and plan were not.';
    } else {
      result.hidden = true;
      $('modelOutput').textContent = '';
      $('modelMeta').textContent = '';
      $('modelHint').textContent = '';
    }

    if (fallback) {
      fallback.hidden = !state.modelOutage;
      const button = $('saveWithoutModel');
      if (button) button.disabled = state.saving;
    }
  }

  async function runModelPreview() {
    if (state.saving || !state.modelAvailable) return;
    const symptoms = modelSymptoms();
    if (!symptoms.length) { renderModelPanel(); return; }
    const button = $('runModel');
    button.disabled = true;
    button.textContent = 'Predicting…';
    $('modelPanelStatus').textContent = 'Predicting…';
    try {
      const response = await fetch('/api/doctor/predict', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symptoms }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.message || 'The model could not produce a suggestion.');
        error.code = body.code;
        throw error;
      }
      if (typeof body.output !== 'string' || !body.output.trim() || typeof body.modelVersion !== 'string') {
        const error = new Error('The model returned an unusable response.');
        error.code = 'MODEL_INVALID_RESPONSE';
        throw error;
      }
      state.modelPreview = {
        output: body.output.trim(),
        modelVersion: body.modelVersion.trim(),
        description: typeof body.description === 'string' ? body.description : '',
        precautions: Array.isArray(body.precautions) ? body.precautions.filter((item) => typeof item === 'string') : [],
        medications: Array.isArray(body.medications) ? body.medications.filter((item) => typeof item === 'string') : [],
        diet: Array.isArray(body.diet) ? body.diet.filter((item) => typeof item === 'string') : [],
        workout: Array.isArray(body.workout) ? body.workout.filter((item) => typeof item === 'string') : [],
      };
      state.selectedGuidance = { precautions: [], medications: [], diet: [], workout: [] };
      renderPredictionDialog();
      showError('assessmentError', '');
      renderModelPanel();
      announce(`Prediction ready: ${state.modelPreview.output}.`);
    } catch (error) {
      noteModelOutage(error.code, error.message);
      announce(error.message);
    } finally {
      if (!state.modelPreview) $('runModel').textContent = 'Run model suggestion';
      renderModelPanel();
    }
  }


  // ------------------------------------------------------ prediction results ---
  const guidanceGroups = [
    ['precautions', 'Precautions'],
    ['medications', 'Medication suggestions'],
    ['diet', 'Diet suggestions'],
    ['workout', 'Exercise suggestions'],
  ];

  let activeGuidanceCategory = 'precautions';
  function renderPredictionDialog() {
    const preview = state.modelPreview;
    const panel = $('modelResultsPanel');
    const disease = $('modelDialogDisease');
    const meta = $('modelDialogMeta');
    const categories = $('modelDialogCategories');
    const modalTitle = $('guidanceModalTitle');
    const categoryInput = $('modelSuggestionCategory');
    if (!panel || !disease || !meta || !categories || !preview) return;
    panel.hidden = false;
    disease.textContent = preview.output;
    meta.textContent = `Model ${preview.modelVersion} · Duration: ${state.duration.trim() || "not provided"} days`;
    categories.replaceChildren();
    const key = activeGuidanceCategory;
    const title = guidanceGroups.find(([group]) => group === key)?.[1] || 'Precautions';
    if (modalTitle) modalTitle.textContent = title;
    if (categoryInput) categoryInput.value = key;
    document.querySelectorAll('[data-guidance-category]').forEach((button) => {
      const active = button.dataset.guidanceCategory === key;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const section = document.createElement('section');
    section.className = 'model-results-category';
    const items = preview[key] || [];
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'model-results-empty';
      empty.textContent = 'No items yet. Add one below.';
      section.append(empty);
    } else {
      const list = document.createElement('ul');
      for (const value of items) {
        const row = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'guidance-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = state.selectedGuidance[key].includes(value);
        checkbox.setAttribute('aria-label', value);
        checkbox.addEventListener('change', () => {
          const selected = state.selectedGuidance[key];
          if (checkbox.checked && !selected.includes(value)) selected.push(value);
          else if (!checkbox.checked) state.selectedGuidance[key] = selected.filter((item) => item !== value);
          markDirty();
          renderSideSummary();
        });
        const text = document.createElement('span');
        text.textContent = value;
        label.append(checkbox, text);
        row.append(label);
        list.append(row);
      }
      section.append(list);
    }
    categories.append(section);
  }
  function openGuidanceCategory(key) {
    if (!['precautions', 'medications', 'diet', 'workout'].includes(key) || !state.modelPreview) return;
    activeGuidanceCategory = key;
    renderPredictionDialog();
    const modal = $('guidanceModal');
    if (modal && !modal.open) {
      try {
        modal.showModal();
      } catch {
        // Keep the category usable in browsers where showModal is unavailable.
        modal.setAttribute('open', '');
      }
    }
  }
  function closePredictionDialog() {
    const target = $('areaSymptoms');
    if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function applyPredictionSelection() {
    const status = $('modelPanelStatus');
    if (status) status.textContent = 'Selection confirmed. Only checked guidance will be included in the report.';
    markDirty();
    renderSideSummary();
    announce('Selected model guidance will be included in the consultation report.');
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

  function jumpButton(label, targetId) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dw-review__jump';
    button.textContent = label;
    button.addEventListener('click', () => {
      const target = $(targetId);
      if (!target) return;
      target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      const heading = target.querySelector('h3');
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    });
    return button;
  }

  function renderChecks() {
    const list = $('reviewChecks');
    if (!list) return;
    const symptoms = modelSymptoms().length;
    const withoutModel = Boolean(state.modelOutage) && symptoms === 0;
    const checks = [
      {
        ok: Boolean(state.patientId), optional: false,
        text: state.patientId ? 'Patient selected for this record' : 'Select the patient for this record',
        jump: state.patientId ? null : ['Choose patient', 'areaVisit'],
      },
      {
        ok: Boolean(state.appointmentId || state.revisingId), optional: false,
        text: state.revisingId ? 'Revision of a saved record' : state.appointmentId ? 'Linked to this appointment' : 'Open the record from an appointment',
        jump: state.appointmentId || state.revisingId ? null : ['Go to the schedule', 'doctorAppointments'],
      },
      {
        ok: symptoms > 0 || withoutModel, optional: false,
        text: withoutModel
          ? 'Will be saved as a clinical record without a model suggestion'
          : symptoms > 0 ? `${symptoms} symptom${symptoms === 1 ? '' : 's'} will be sent to the model` : 'Add at least one model symptom',
        jump: symptoms > 0 || withoutModel ? null : ['Add symptoms', 'areaSymptoms'],
      },
      {
        ok: hasClinicalText(), optional: true,
        text: hasClinicalText() ? 'Clinical notes or observations recorded' : 'No observations, note, assessment or plan yet',
        jump: hasClinicalText() ? null : ['Add clinical detail', 'areaSymptoms'],
      },
      {
        ok: Boolean(state.doctorAssessment.trim()), optional: true,
        text: state.doctorAssessment.trim() ? 'Your assessment is recorded' : 'Your assessment is not recorded yet',
        jump: state.doctorAssessment.trim() ? null : ['Write assessment', 'areaDecision'],
      },
      {
        ok: Boolean(state.plan.trim()), optional: true,
        text: state.plan.trim() ? 'Your plan is recorded' : 'Your plan is not recorded yet',
        jump: state.plan.trim() ? null : ['Write plan', 'areaDecision'],
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
      if (check.jump) item.append(jumpButton(check.jump[0], check.jump[1]));
      list.append(item);
    }
  }

  function renderSideSummary() {
    const option = $('assessmentPatient')?.selectedOptions[0];
    const symptoms = modelSymptoms().length;
    fillSummary($('sideSummary'), [
      ['Patient', option && option.value ? (option.dataset.name || 'Selected') : 'Not selected'],
      ['Visit', option?.dataset.when ? formatMoment(option.dataset.when) : 'Not linked'],
      ['Symptoms', String(symptoms)],
      ['Observations', String(state.observations.length)],
      ['Model', state.modelOutage || !state.modelAvailable ? 'Unavailable, no prediction' : 'Runs when you save'],
    ]);
    const hint = $('sideHint');
    if (hint) {
      if (!state.patientId) hint.textContent = 'Open a consultation from the schedule to start a record.';
      else if (!state.appointmentId && !state.revisingId) hint.textContent = 'Pick the appointment this record belongs to.';
      else if (!symptoms && !hasClinicalText()) hint.textContent = 'Add symptoms or a clinical note before saving.';
      else if (state.saved) hint.textContent = 'This record has no unsaved changes.';
      else hint.textContent = 'Unsaved changes. Saving stores them with this visit.';
    }
  }

  function renderReview() {
    const selected = state.patients.find((patient) => patient.patientId === state.patientId);
    const option = $('assessmentPatient')?.selectedOptions[0];
    const target = $('reviewSummary');
    const clinician = $('reviewClinician');
    const record = $('reviewRecord');
    const makeEditor = (parent, label, key, value, multiline = true) => {
      const wrap = document.createElement('label'); wrap.className = 'dw-review-edit';
      const caption = document.createElement('span'); caption.textContent = label;
      const control = document.createElement(multiline ? 'textarea' : 'input');
      control.value = value || ''; control.setAttribute('aria-label', label);
      if (multiline) { control.rows = 2; control.maxLength = 4000; } else { control.type = 'text'; control.maxLength = 200; }
      control.addEventListener('input', () => {
        if (key === 'reported') { const entries = control.value.split(/\n|,/).map(x => x.trim()).filter(Boolean); const ids = Object.keys(state.vocabulary.labels).filter(id => entries.some(entry => entry.toLowerCase() === labelFor(id).toLowerCase())); state.reported = ids; state.clinician = []; const custom = entries.filter(entry => !ids.some(id => labelFor(id).toLowerCase() === entry.toLowerCase())); state.observations = [...new Set([...state.observations, ...custom])].slice(0, MAX_OBSERVATIONS); state.modelPreview = null; }
        else if (key === 'observations') state.observations = control.value.split(/\n/).map(x => x.trim()).filter(Boolean).slice(0, MAX_OBSERVATIONS);
        else if (key === 'duration') state.duration = control.value;
        else if (key === 'note') state.note = control.value;
        else if (key === 'doctorAssessment') state.doctorAssessment = control.value;
        else if (key === 'plan') state.plan = control.value;
        markDirty(); renderSideSummary(); renderChecks();
      });
      wrap.append(caption, control); parent.append(wrap);
    };
    const makeGroup = (parent, title) => { const heading = document.createElement('h4'); heading.textContent = title; parent.replaceChildren(heading); };
    makeGroup(target, 'Symptoms and findings');
    makeEditor(target, 'Symptoms reported / recorded', 'reported', [...state.reported.map(labelFor), ...state.clinician.map(labelFor)].join(', '));
    makeGroup(clinician, 'Clinical assessment');
    makeEditor(clinician, 'Assessment', 'doctorAssessment', state.doctorAssessment);
    makeEditor(clinician, 'Plan', 'plan', state.plan);
    makeGroup(record, 'Patient and visit');
    const patientLine = document.createElement('p'); patientLine.className = 'dw-review-static'; patientLine.textContent = 'Patient: ' + (selected ? selected.fullName : 'Not selected'); record.append(patientLine);
    const visitLine = document.createElement('p'); visitLine.className = 'dw-review-static'; visitLine.textContent = 'Appointment: ' + (option?.dataset.when ? `${formatMoment(option.dataset.when)} · ${humanize(option.dataset.status || 'status unknown')}` : 'Not linked'); record.append(visitLine);
    makeEditor(record, 'Duration (days)', 'duration', state.duration, false);
    makeEditor(record, 'Clinical observations (one per line)', 'observations', state.observations.join('\n'));
    makeEditor(record, 'Clinical note', 'note', state.note);
    if (state.modelPreview) {
      const model = document.createElement('div'); model.className = 'dw-review-model';
      const heading = document.createElement('h4'); heading.textContent = 'Model suggestion';
      const disease = document.createElement('p'); disease.textContent = state.modelPreview.output;
      const note = document.createElement('p'); note.className = 'muted'; note.textContent = 'Model output is shown for clinician review; it is not a confirmed diagnosis.';
      model.append(heading, disease, note); record.append(model);
    }
    renderChecks(); renderSideSummary();
  }
  function openReview() {
    showError('assessmentError', '');
    if (state.revisingSource?.latestRevisionId) {
      showError('assessmentError', 'This assessment has already been revised. Open the newer revision before changing symptoms again.');
      return;
    }
    if (!state.patientId) {
      showError('assessmentError', 'Select a patient to continue.');
      setWizardStep(0);
      return;
    }
    if (!state.revisingId && !state.appointmentId) {
      showError('assessmentError', 'Open a visit assigned to you.');
      setWizardStep(0);
      return;
    }
    if (!modelSymptoms().length && !(state.modelOutage && hasClinicalText())) {
      showError('assessmentError', 'Add at least one symptom to continue.');
      setWizardStep(1);
      reportedPicker?.focus();
      return;
    }
    renderReview();
    setWizardStep(4);
    $('reviewArea').hidden = false;
    $('reviewPanel').focus({ preventScroll: true });
    announce('Review the assessment before saving.');
  }

  // ------------------------------------------------------------------- save ---
  function setSaving(value) {
    state.saving = value;
    for (const id of ['saveAssessment', 'saveAssessmentTop']) {
      const button = $(id);
      if (!button) continue;
      button.disabled = value;
      button.textContent = value ? 'Generating report…' : 'Generate consultation report';
    }
    const run = $('runModel');
    if (run) run.disabled = value || !state.modelAvailable || !modelSymptoms().length;
    for (const id of ['resetDraft', 'saveWithoutModel']) {
      const button = $(id);
      if (button) button.disabled = value;
    }
  }

  // The selected symptoms are real information. Moving them into observations
  // keeps them readable in the record instead of dropping them because the model
  // never ran on them.
  function moveSymptomsToObservations() {
    const moved = [];
    for (const id of state.reported) moved.push(`Reported: ${labelFor(id)}`);
    for (const id of state.clinician) moved.push(`Observed: ${labelFor(id)}`);
    for (const text of moved) {
      if (state.observations.length >= MAX_OBSERVATIONS) break;
      if (!state.observations.includes(text)) state.observations.push(text);
    }
    state.reported = [];
    state.clinician = [];
    state.modelPreview = null;
    renderAll();
    return moved.length;
  }

  async function saveAssessment({ withoutModel = false } = {}) {
    if (state.saving) return;
    if (withoutModel && !state.modelOutage) return;
    if (!withoutModel && !state.modelPreview) {
      if (state.modelAvailable) {
        showError('assessmentError', 'Run the prediction and choose which suggestions to include before generating the report.');
        await runModelPreview();
      } else {
        showError('assessmentError', 'The model is unavailable. Retry the prediction or use the explicit save-without-model option.');
      }
      return;
    }
    showError('sideError', '');
    if (!state.patientId) { showError('reviewError', 'Select a patient first.'); showError('sideError', 'Select a patient first.'); return; }
    if (!state.revisingId && !state.appointmentId) {
      const message = 'Open this assessment from an appointment assigned to you.';
      showError('reviewError', message); showError('sideError', message); return;
    }
    if (!withoutModel && !modelSymptoms().length) {
      const message = 'Add at least one model symptom, or save the record without the model.';
      showError('reviewError', message); showError('sideError', message);
      return;
    }
    if (withoutModel) moveSymptomsToObservations();
    if (!withoutModel && !modelSymptoms().length) return;
    persist();

    setSaving(true);
    setDraftState('Saving assessment…', 'saving');

    const shared = {
      patientReported: state.reported,
      clinicianAdded: state.clinician,
      observations: state.observations,
      symptomDuration: state.duration,
      clinicalNote: state.note,
      doctorAssessment: state.doctorAssessment,
      plan: state.plan,
      ...(state.modelPreview && !withoutModel ? { includeGuidance: state.selectedGuidance } : {}),
      ...(withoutModel ? { modelUnavailable: true } : {}),
    };
    const url = state.revisingId
      ? `/api/doctor/assessments/${encodeURIComponent(state.revisingId)}/revision`
      : '/api/doctor/assessments';
    // The server derives the patient from the appointment; the browser never
    // supplies a patient id as proof of access.
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
          // Another tab or a retry saved this appointment first. The stored
          // record wins; open it rather than creating a duplicate.
          clearDraft();
          state.saved = true;
          window.location.assign(`/prediction.html?id=${encodeURIComponent(body.assessmentId)}`);
          return;
        }
        if (response.status === 401) {
          throw new Error('Your session expired. Your text is still here; sign in again in another tab and retry.');
        }
        if (body.code === 'UNSUPPORTED_SYMPTOMS' && Array.isArray(body.unsupported)) {
          for (const id of body.unsupported) {
            state.reported = state.reported.filter((item) => item !== id);
            state.clinician = state.clinician.filter((item) => item !== id);
            const text = labelFor(id);
            if (!state.observations.includes(text) && state.observations.length < MAX_OBSERVATIONS) {
              state.observations.push(text);
            }
          }
          markDirty();
          renderAll();
          renderReview();
          throw new Error('Some entries are not model features. They were moved to clinical observations. Review and save again.');
        }
        if (typeof body.code === 'string' && body.code.startsWith('MODEL_')) {
          noteModelOutage(body.code, body.message);
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
      setDraftState('Save failed, your text is kept', 'error');
      showError('reviewError', error.message || 'The assessment could not be saved. Your text is preserved; please retry.');
      showError('sideError', error.message || 'The assessment could not be saved. Your text is preserved; please retry.');
      window.clearTimeout(persistTimer);
      persist();
      renderModelPanel();
    } finally {
      setSaving(false);
      setDraftState(state.saved ? 'All changes saved' : 'Unsaved changes', state.saved ? 'saved' : 'dirty');
      renderSideSummary();
    }
  }

  function saveWithoutModel() {
    if (!state.modelOutage || state.saving) return;
    const symptoms = modelSymptoms().length;
    if (symptoms && !window.confirm(`Save without the model?\n\n${symptoms} selected model symptom${symptoms === 1 ? '' : 's'} will be kept as clinical observations and no prediction will be stored.`)) return;
    saveAssessment({ withoutModel: true });
  }

  // ------------------------------------------------------------------ sync ---
  function renderAll() {
    reportedPicker?.renderChips();
    clinicianPicker?.renderChips();
    renderObservations();
    renderHints();
    renderModelPanel();
    renderSideSummary();
    if ($('reviewChecks')?.childElementCount) renderChecks();
  }

  function applyRevisionSource(data) {
    state.revisingId = data.id;
    state.revisingSource = data;
    state.patientId = data.patientId;
    state.appointmentId = data.appointmentId || '';
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
    state.saved = true;
    setDraftState('Editing a saved assessment', 'saved');
    renderAll();
  }

  function syncFields() {
    state.duration = $('symptomDuration').value;
    state.note = $('clinicalNote').value;
    if (state.modelPreview) {
      const meta = $('modelDialogMeta');
      if (meta) meta.textContent = `Model version ${state.modelPreview.modelVersion} · duration recorded: ${state.duration.trim() || 'not provided'}`;
    }
  }

  ['symptomDuration', 'clinicalNote'].forEach((id) => {
    $(id).addEventListener('input', () => { syncFields(); markDirty(); });
  });
  $('doctorAssessment').addEventListener('input', () => {
    state.doctorAssessment = $('doctorAssessment').value;
    markDirty();
    renderHints();
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
  $('runModel').addEventListener('click', runModelPreview);
  $('saveWithoutModel').addEventListener('click', saveWithoutModel);
  $('reviewButton').addEventListener('click', openReview);
  $('backToEdit').addEventListener('click', () => {
    setWizardStep(3);
    $('doctorAssessment')?.focus();
  });
  $('saveAssessment').addEventListener('click', () => saveAssessment());
  $('saveAssessmentTop').addEventListener('click', () => saveAssessment());

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
    state.modelPreview = null;
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
    showError('sideError', '');
    clearDraft();
    state.saved = true;
    state.persistedThisSession = false;
    setDraftState(keepContext ? 'Form cleared · consultation still open' : 'Form cleared', 'saved');
    renderAll();
    renderPatientContext();
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
      saveAssessment();
      return;
    }
    if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (state.modelAvailable) reportedPicker?.focus();
      else $('clinicalNote').focus();
    }
  });

  $('modelSuggestionAdd')?.addEventListener('click', () => {
    const input = $('modelSuggestionInput');
    const category = $('modelSuggestionCategory')?.value || activeGuidanceCategory;
    const value = input?.value.trim();
    const status = $('modelSuggestionStatus');
    if (!state.modelPreview || !['precautions', 'medications', 'diet', 'workout'].includes(category)) return;
    if (!value) {
      if (status) status.textContent = 'Enter text first.';
      input?.focus();
      return;
    }
    if (value.length > 500) {
      if (status) status.textContent = 'Suggestions must be 500 characters or fewer.';
      return;
    }
    if (state.modelPreview[category].some((item) => item.toLowerCase() === value.toLowerCase())) {
      if (status) status.textContent = 'That suggestion is already listed in this category.';
      return;
    }
    state.modelPreview[category].push(value);
    state.selectedGuidance[category].push(value);
    input.value = '';
    if (status) status.textContent = 'Added and selected for the report.';
    renderPredictionDialog();
    markDirty();
    renderSideSummary();
    input.value = '';
    input.focus();
  });
  $('modelSuggestionInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      $('modelSuggestionAdd')?.click();
    }
  });

  // Keep the consultation focused on one step at a time.
  const wizardSteps = ['#areaVisit', '#areaSymptoms', '.cw-model', '#areaDecision', '#reviewArea'];
  let activeWizardStep = 0;
  function setWizardStep(index) {
    activeWizardStep = Math.max(0, Math.min(4, index));
    wizardSteps.forEach((selector, step) => {
      const panel = document.querySelector(selector);
      if (panel) panel.hidden = step !== activeWizardStep;
    });
    document.querySelectorAll('[data-wizard-go]').forEach((button) => {
      const active = Number(button.dataset.wizardGo) === activeWizardStep;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    const consultationDock = $('consultationDock');
    // Show the patient video panel after Continue leaves Patient and visit.
    // Keep it open through the consultation steps, then close it on Review.
    if (consultationDock) consultationDock.hidden = activeWizardStep === 0 || activeWizardStep === 4;
    const controls = $('wizardControls');
    const back = $('wizardBack');
    const next = $('wizardNext');
    if (controls) controls.hidden = activeWizardStep === 4;
    if (back) back.disabled = activeWizardStep === 0;
    if (next) next.textContent = activeWizardStep === 3 ? 'Review →' : 'Continue →';
    $('assessmentSection')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function advanceWizard() {
    if (activeWizardStep === 0 && !state.patientId) { showError("assessmentError", "Select a patient to continue."); return; }
    if (activeWizardStep === 1 && !modelSymptoms().length) { showError("assessmentError", "Add at least one symptom to continue."); return; }
    if (activeWizardStep === 2 && !state.modelPreview && !state.modelOutage && state.modelAvailable) { showError("assessmentError", "Run the prediction before continuing."); return; }
    if (activeWizardStep === 3) { openReview(); return; }
    showError("assessmentError", "");
    setWizardStep(activeWizardStep + 1);
  }
  $('wizardBack')?.addEventListener('click', () => setWizardStep(activeWizardStep - 1));
  $('wizardNext')?.addEventListener('click', advanceWizard);
  document.querySelectorAll('[data-wizard-go]').forEach((button) => {
    button.addEventListener('click', () => { const target = Number(button.dataset.wizardGo); if (target <= activeWizardStep) setWizardStep(target); });
  });
  // Delegate category clicks so the controls keep working after the result panel re-renders.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-guidance-category]');
    if (!button) return;
    event.preventDefault();
    openGuidanceCategory(button.dataset.guidanceCategory);
  });
  $('guidanceModalClose')?.addEventListener('click', () => $('guidanceModal')?.close());
  $('guidanceModal')?.addEventListener('click', (event) => {
    if (event.target === $('guidanceModal')) $('guidanceModal').close();
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
      if (vocabularyResponse.status === 401 || vocabularyResponse.status === 403
        || patientResponse.status === 401 || patientResponse.status === 403) {
        throw new Error('Sign in with an approved doctor account to record assessments.');
      }
      if (vocabularyResponse.ok) {
        const vocabulary = await vocabularyResponse.json();
        state.vocabulary = {
          symptoms: Array.isArray(vocabulary.symptoms) ? vocabulary.symptoms : [],
          labels: vocabulary.labels && typeof vocabulary.labels === 'object' ? vocabulary.labels : {},
        };
        if (!state.vocabulary.symptoms.length) {
          state.modelError = { code: 'MODEL_INVALID_RESPONSE', message: 'The model reported an empty symptom vocabulary.' };
          state.modelAvailable = false;
        } else {
          state.modelAvailable = true;
        }
      } else {
        const body = await vocabularyResponse.json().catch(() => ({}));
        state.modelError = {
          code: body.code || 'MODEL_UNAVAILABLE',
          message: body.message || outageMessage(body.code),
        };
        state.modelAvailable = false;
      }
      if (!state.modelAvailable) {
        state.modelOutage = { ...state.modelError };
      }

      if (!patientResponse.ok) throw new Error('Your patient list is unavailable. Retry in a moment.');
      state.patients = await patientResponse.json();

      buildPickers();

      if (appointmentId) {
        setEditorVisible(true);
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
        setDraftState('No changes yet', '');
        $('reviewArea').hidden = true;
        loadRecent();
        return;
      }

      if (reviseId) {
        setEditorVisible(true);
        // The stored record wins over any leftover draft: a revision starts from
        // what was actually saved for this consultation.
        const sourceResponse = await fetch(`/api/doctor/assessments/${encodeURIComponent(reviseId)}`, { credentials: 'same-origin' });
        if (!sourceResponse.ok) throw new Error('That assessment is not available to your account.');
        applyRevisionSource(await sourceResponse.json());
        clearDraft();
        fillPatients();
        if (state.appointmentId) loadConsultation(state.appointmentId).catch(() => { /* context is optional here */ });
        if (state.revisingSource && state.revisingSource.latestRevisionId) {
          setDraftState('A newer revision already exists', 'dirty');
          showError('assessmentError', 'This assessment has already been revised. Open the newer revision before changing symptoms again.');
          $('saveAssessment').disabled = true;
          $('saveAssessmentTop').disabled = true;
        }
        renderAll();
        $('reviewArea').hidden = true;
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
      $('reviewArea').hidden = true;
      loadRecent();
    } catch (error) {
      // The failure is reported inside the editor, so it must stay visible.
      setEditorVisible(true);
      if (!reportedPicker) buildPickers();
      showError('assessmentError', error.message);
      $('assessmentPatient').replaceChildren(new Option('Patient list unavailable', ''));
      renderAll();
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
        const model = row.modelStatus === 'unavailable'
          ? 'no model suggestion'
          : (row.predictedDisease || 'model result unavailable');
        link.textContent = `${row.patientName || 'Patient'} · ${model}`;
        const when = document.createElement('span');
        when.textContent = formatMoment(row.createdAt);
        item.append(link, when);
        list.append(item);
      }
      $('recentSection').hidden = false;
    } catch { /* recent list is optional */ }
  }

  setWizardStep(0);
  load();
  window.HelloDocAssessment = { openReview, saveAssessment, saveWithoutModel };
})();
