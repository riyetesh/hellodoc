(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  let assessment = null;
  let dirty = false;
  let saving = false;

  const humanize = (identifier) => {
    const text = String(identifier ?? '').replace(/_/g, ' ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : String(identifier ?? '');
  };
  const dateText = (value) => (value ? new Date(value).toLocaleString() : '');
  const show = (node, text) => { node.textContent = text; node.hidden = false; };
  const hide = (node) => { node.hidden = true; node.textContent = ''; };

  function fail(message) {
    const messageNode = $('message');
    show(messageNode, message);
    $('report').hidden = true;
  }

  function addRow(dl, term, value) {
    if (value === null || value === undefined || value === '') return;
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }

  function fillList(ul, items, emptyText) {
    ul.replaceChildren();
    const list = Array.isArray(items) ? items.filter((item) => typeof item === 'string' && item.trim()) : [];
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'symptom-empty';
      li.textContent = emptyText;
      ul.append(li);
      return;
    }
    for (const item of list) {
      const li = document.createElement('li');
      li.className = 'symptom-tag';
      const span = document.createElement('span');
      span.textContent = item;
      li.append(span);
      ul.append(li);
    }
  }

  function setClinicalState(text, state) {
    const node = $('clinicalState');
    node.textContent = text;
    node.dataset.state = state || '';
  }

  function render(data) {
    assessment = data;
    $('pageTitle').textContent = data.predictedDisease
      ? `Assessment for ${data.patientName || 'patient'}`
      : 'Clinical assessment';
    $('pageSubtitle').textContent = `Recorded ${dateText(data.createdAt)}${data.doctorName ? ` by ${data.doctorName}` : ''}.`;

    const patient = $('patientSummary');
    patient.replaceChildren();
    addRow(patient, 'Patient', data.patientName || 'Not recorded');
    addRow(patient, 'Patient email', data.patientEmail || '');
    addRow(patient, 'Appointment', data.appointmentStart
      ? `${dateText(data.appointmentStart)}${data.appointmentStatus ? ` (${data.appointmentStatus})` : ''}`
      : 'Not linked to an appointment');
    addRow(patient, 'Appointment reference', data.appointmentId || '');
    addRow(patient, 'Assessment date', dateText(data.createdAt));
    addRow(patient, 'Recording doctor', data.doctorName || '');

    fillList($('patientSymptoms'), (data.patientReported || []).map(humanize), 'None recorded.');
    fillList($('clinicianSymptoms'), (data.clinicianAdded || []).map(humanize), 'None added.');
    fillList($('observations'), data.observations || [], 'None recorded.');

    const context = $('symptomContext');
    context.replaceChildren();
    addRow(context, 'Duration', data.symptomDuration || 'Not recorded');
    addRow(context, 'Clinical note', data.clinicalNote || 'Not recorded');

    $('predictedDisease').textContent = data.predictedDisease || 'No prediction';
    const meta = $('modelMeta');
    meta.replaceChildren();
    addRow(meta, 'Model version', data.modelVersion || '');
    // The exact identifier set that produced this prediction.
    const usedByModel = [...(data.patientReported || []), ...(data.clinicianAdded || [])];
    addRow(meta, 'Symptoms used by the model', `${usedByModel.length} selected`);
    // Only a real numeric confidence from the model is ever shown; nothing is
    // derived from symptom counts or the predicted class position.
    const confidence = data.modelConfidence;
    const hasConfidence = typeof confidence === 'number' && Number.isFinite(confidence);
    if (hasConfidence) addRow(meta, 'Model confidence', `${(confidence * 100).toFixed(1)}%`);
    const note = $('confidenceNote');
    if (!note) { /* older markup */ } else if (hasConfidence) {
      note.hidden = true;
      note.textContent = '';
    } else {
      note.hidden = false;
      note.textContent = 'This model version does not provide a calibrated probability, so no confidence percentage is shown and alternative conditions are not ranked. Treat the prediction as one input to your own assessment.';
    }
    $('description').textContent = data.description || 'No description is available for this condition.';

    fillList($('precautions'), data.precautions, 'No precautions were available.');
    fillList($('medications'), data.medications, 'No medication information was available.');
    fillList($('diet'), data.diet, 'No diet guidance was available.');
    fillList($('workout'), data.workout, 'No workout guidance was available.');

    // Navigation reuses the appointment the doctor came from, so returning to the
    // consultation is one click rather than a search through the dashboard.
    // Editing an outdated record would fight the revision rule (one replacement
    // per record), so the button always targets the newest revision.
    const editLink = $('editSymptoms');
    if (editLink) {
      const target = data.latestRevisionId || id;
      editLink.href = `/doctor.html?assess=${encodeURIComponent(target)}#assessmentSection`;
      editLink.textContent = data.latestRevisionId ? 'Edit newest revision' : 'Edit symptoms';
    }
    const back = $('backToWorkspace');
    if (back) {
      if (data.appointmentId) {
        back.href = `/doctor.html?appointment=${encodeURIComponent(data.appointmentId)}#appointment-${encodeURIComponent(data.appointmentId)}`;
        back.textContent = 'Back to this appointment';
      } else {
        back.href = '/doctor.html#assessmentSection';
      }
    }
    const notice = $('revisionNotice');
    notice.replaceChildren();
    notice.hidden = true;
    const noticeParts = [];
    if (data.supersededPrediction) {
      const previous = document.createElement('a');
      previous.href = `/prediction.html?id=${encodeURIComponent(data.supersededPrediction.id)}`;
      previous.textContent = 'the earlier record';
      const text = document.createElement('span');
      text.textContent = `This revision replaced the prediction recorded ${dateText(data.supersededPrediction.createdAt)} (${data.supersededPrediction.predictedDisease}). The previous record is unchanged: `;
      noticeParts.push(text, previous);
    }
    if (data.latestRevisionId) {
      const newer = document.createElement('a');
      newer.href = `/prediction.html?id=${encodeURIComponent(data.latestRevisionId)}`;
      newer.textContent = 'Open the newest revision';
      const text = document.createElement('span');
      if (noticeParts.length) text.textContent = ' · ';
      text.append('A newer revision of this assessment exists. ');
      noticeParts.push(text, newer);
    }
    if (noticeParts.length) {
      notice.append(...noticeParts);
      notice.hidden = false;
    }

    $('doctorAssessment').value = data.doctorAssessment || '';
    $('plan').value = data.plan || '';
    dirty = false;
    setClinicalState('All changes saved', 'saved');
    $('report').hidden = false;
    hide($('message'));
  }

  async function load() {
    if (!id) { fail('No assessment was specified. Open one from the doctor workspace.'); return; }
    try {
      const response = await fetch(`/api/doctor/assessments/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
      if (response.status === 401) { window.location.assign('login.html?role=doctor'); return; }
      if (response.status === 403 || response.status === 404) {
        fail('This assessment is not available to your account.');
        return;
      }
      if (!response.ok) { fail('The assessment could not be loaded. Please retry.'); return; }
      render(await response.json());
    } catch {
      fail('The assessment could not be loaded. Check your connection and retry.');
    }
  }

  function markDirty() {
    dirty = true;
    setClinicalState('Unsaved changes', 'dirty');
  }
  $('doctorAssessment').addEventListener('input', markDirty);
  $('plan').addEventListener('input', markDirty);

  async function saveClinical() {
    if (saving || !assessment) return false;
    if (!dirty) { setClinicalState('All changes saved', 'saved'); return true; }
    saving = true;
    const button = $('saveClinical');
    button.disabled = true;
    button.textContent = 'Saving…';
    hide($('clinicalError'));
    try {
      const response = await fetch(`/api/doctor/assessments/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorAssessment: $('doctorAssessment').value,
          plan: $('plan').value,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Your assessment could not be saved.');
      assessment.doctorAssessment = $('doctorAssessment').value;
      assessment.plan = $('plan').value;
      dirty = false;
      setClinicalState('All changes saved', 'saved');
      return true;
    } catch (error) {
      show($('clinicalError'), error.message);
      return false;
    } finally {
      saving = false;
      button.disabled = false;
      button.textContent = 'Save assessment and plan';
    }
  }

  function revertClinical() {
    if (!assessment || !dirty) return;
    if (!window.confirm('Discard your unsaved assessment and plan changes?')) return;
    $('doctorAssessment').value = assessment.doctorAssessment || '';
    $('plan').value = assessment.plan || '';
    dirty = false;
    setClinicalState('All changes saved', 'saved');
  }

  $('saveClinical').addEventListener('click', saveClinical);
  $('revertClinical').addEventListener('click', revertClinical);

  async function downloadReport() {
    if (!assessment) return;
    // The PDF is rendered from what is stored, so unsaved edits would make the
    // file disagree with the screen. Offer to save first instead of printing
    // something the doctor has not reviewed.
    if (dirty) {
      if (!window.confirm('Your assessment and plan have unsaved changes. Save them, then generate the report?')) return;
      if (!(await saveClinical())) return;
    }
    const button = $('downloadReport');
    const retry = $('retryReport');
    hide($('reportError'));
    button.disabled = true;
    retry.hidden = true;
    button.textContent = 'Generating report…';
    try {
      const response = await fetch(`/api/doctor/assessments/${encodeURIComponent(id)}/report.pdf`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(response.status === 403 ? 'You are not authorized to download this report.' : 'The report could not be generated.');
      const blob = await response.blob();
      if (!blob.size) throw new Error('The generated report was empty. Please retry.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `HelloDoc-assessment-${String(id).slice(0, 8)}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (error) {
      show($('reportError'), `${error.message} Nothing was downloaded.`);
      retry.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Download PDF report';
    }
  }

  $('downloadReport').addEventListener('click', downloadReport);
  $('retryReport').addEventListener('click', downloadReport);
  $('printPage').addEventListener('click', () => window.print());
  $('logout').addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      window.location.assign('/');
    } catch {
      fail('Could not log out. Please retry.');
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('keydown', (event) => {
    // Never intercept the browser's own save/print/navigation shortcuts outside
    // this form, and never while focus is in a control that needs the key.
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (String(event.key).toLowerCase() !== 's') return;
    const tag = (event.target.tagName || '').toLowerCase();
    if (tag === 'select') return;
    event.preventDefault();
    saveClinical();
  });

  load();
})();
