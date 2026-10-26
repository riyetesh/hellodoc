/* ============================================================
   HelloDoc - Doctor workspace
   The appointment is the unit of work. The schedule is a day-by-day
   timeline you can search and narrow, with the visit's detail and the
   patient's own history one click away. Clinical records stay in the
   assessment stepper below, fed by the same authorised endpoints.
   ============================================================ */
(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);

  const STATUS_LABEL = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    completed: 'Completed',
    cancelled: 'Cancelled',
    no_show: 'No show',
    open: 'Open',
  };

  const message = (value) => {
    const node = $('#message');
    if (!node) return;
    node.textContent = value || '';
    // The static placeholder is not hidden, so an empty status would otherwise
    // leave a large blank block above the workspace.
    node.hidden = !value;
  };

  async function call(path, options = {}) {
    const response = await fetch('/api' + path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Keep the status on the error so callers can tell an ended session (401)
      // apart from a feature that is merely unavailable (403/503). Only the
      // first one may send the doctor back to the sign-in page.
      const error = new Error(body.message || 'Request failed');
      error.status = response.status;
      error.code = body.code;
      throw error;
    }
    return body;
  }
  const request = (path, options) => call('/doctor' + path, options);

  // ---------------------------------------------------------------- format ---
  const formatDate = (iso) =>
    new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  const formatTime = (iso) =>
    new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const formatDateTime = (iso) => `${formatDate(iso)}, ${formatTime(iso)}`;
  const dayKey = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  };
  const todayKey = () => dayKey(new Date());
  const dayLabel = (key) => {
    const today = todayKey();
    if (key === today) return 'Today';
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (key === dayKey(tomorrow)) return 'Tomorrow';
    return formatDate(`${key}T12:00:00`);
  };

  function statusChip(status) {
    const chip = document.createElement('span');
    chip.className = 'status-chip';
    chip.dataset.status = status;
    const dot = document.createElement('span');
    dot.className = 'status-chip__dot';
    dot.setAttribute('aria-hidden', 'true');
    chip.append(dot, document.createTextNode(STATUS_LABEL[status] || status));
    return chip;
  }

  function stateBlock(title, hint, action) {
    const wrap = document.createElement('div');
    wrap.className = 'dw-state';
    const text = document.createElement('p');
    text.className = 'dw-state__text';
    text.textContent = title;
    wrap.append(text);
    if (hint) {
      const extra = document.createElement('p');
      extra.className = 'dw-state__hint';
      extra.textContent = hint;
      wrap.append(extra);
    }
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline';
      button.textContent = action.label;
      button.addEventListener('click', action.run);
      wrap.append(button);
    }
    return wrap;
  }

  // ------------------------------------------------------------- schedule ---
  let appointments = [];
  let assessmentByAppointment = new Map();
  let searchTerm = '';
  let dateRange = 'all';
  let approvedDoctor = false;
  let loading = false;
  const expanded = new Set();
  let contextOpener = null;

  async function loadAssessments() {
    // Presence of a record is a fact we can show. Absence is not, because this
    // list is capped server side, so a row without a match says nothing about
    // whether an older record exists.
    try {
      const rows = await request('/assessments');
      const map = new Map();
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (row.appointmentId && !map.has(row.appointmentId)) map.set(row.appointmentId, row);
        }
      }
      assessmentByAppointment = map;
    } catch {
      assessmentByAppointment = new Map();
    }
    return assessmentByAppointment;
  }

  const filterForm = () => $('#filters');
  // Read the form once per render, not once per row: the schedule is rebuilt on
  // every keystroke in the search box.
  function currentFilters() {
    const form = filterForm();
    const values = form ? new FormData(form) : new FormData();
    return { status: values.get('status') || '', date: values.get('date') || '' };
  }

  function matchesFilters(appointment, filters) {
    if (filters.status && filters.status !== appointment.status) return false;
    if (filters.date && dayKey(appointment.startsAt) !== filters.date) return false;

    if (dateRange !== 'all') {
      // Ranges follow calendar days, so a visit earlier this morning belongs to
      // Today rather than appearing in both Today and Past.
      const day = dayKey(appointment.startsAt);
      const today = todayKey();
      if (dateRange === 'today' && day !== today) return false;
      if (dateRange === 'upcoming' && day <= today) return false;
      if (dateRange === 'past' && day >= today) return false;
    }

    const term = searchTerm.trim().toLowerCase();
    if (term) {
      const haystack = [
        appointment.firstName, appointment.reason, STATUS_LABEL[appointment.status],
        appointment.walkIn ? 'walk-in walkin record' : 'account patient',
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  }

  // Today's list first, then coming days soonest first, then earlier days newest
  // first: the order a doctor actually reads a schedule in.
  function dayOrder(key) {
    const today = todayKey();
    if (key === today) return [0, 0];
    const stamp = new Date(`${key}T12:00:00`).getTime();
    if (key > today) return [1, stamp];
    return [2, -stamp];
  }

  function detailFacts(appointment, record) {
    const facts = [
      ['When', formatDateTime(appointment.startsAt)],
      ['Status', STATUS_LABEL[appointment.status] || appointment.status],
      ['Patient record', appointment.walkIn ? 'Walk-in record (no online account)' : 'HelloDoc account patient'],
      ['Assessment', record ? 'Recorded for this visit' : 'Not recorded yet'],
    ];
    return facts;
  }

  function visitRow(appointment) {
    const card = document.createElement('article');
    // Stable anchor so a report or results page can link straight back to the visit.
    card.id = `appointment-${appointment.id}`;
    card.className = 'visit-row';

    const when = document.createElement('div');
    when.className = 'visit-row__when';
    const time = document.createElement('span');
    time.className = 'visit-row__time';
    time.textContent = formatTime(appointment.startsAt);
    const marker = document.createElement('span');
    marker.className = 'visit-row__marker';
    marker.setAttribute('aria-hidden', 'true');
    when.append(time, marker);

    const body = document.createElement('div');
    body.className = 'visit-row__body';
    const patient = document.createElement('h3');
    patient.className = 'visit-row__patient';
    patient.textContent = appointment.firstName;
    body.append(patient);
    if (appointment.reason) {
      const reason = document.createElement('p');
      reason.className = 'visit-row__reason';
      reason.textContent = `Reason given: ${appointment.reason}`;
      body.append(reason);
    }
    const meta = document.createElement('p');
    meta.className = 'visit-row__meta';
    meta.append(statusChip(appointment.status));
    if (appointment.walkIn) {
      const walkIn = document.createElement('span');
      walkIn.className = 'visit-row__tag';
      walkIn.textContent = 'Walk-in';
      meta.append(walkIn);
    }
    const record = assessmentByAppointment.get(appointment.id);
    if (record) {
      const recorded = document.createElement('span');
      recorded.className = 'visit-row__record';
      recorded.textContent = 'Assessment recorded';
      meta.append(recorded);
    }
    body.append(meta);

    const actions = document.createElement('div');
    actions.className = 'visit-row__actions';
    // One dominant action that matches the record's state. A cancelled visit has
    // no consultation to open, so it gets none instead of a misleading button.
    const canConsult = !['cancelled', 'no_show'].includes(appointment.status);
    if (canConsult) {
      const primary = document.createElement('a');
      primary.className = 'btn btn-primary visit-row__primary';
      primary.href = `/doctor.html?appointment=${encodeURIComponent(appointment.id)}#assessmentSection`;
      primary.textContent = record ? 'Continue assessment' : 'Open consultation';
      primary.setAttribute('aria-label', `${primary.textContent} for ${appointment.firstName} on ${formatDate(appointment.startsAt)}`);
      actions.append(primary);
    }

    const detailId = `appointment-${appointment.id}-detail`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'visit-row__toggle';
    toggle.setAttribute('aria-expanded', expanded.has(appointment.id) ? 'true' : 'false');
    toggle.setAttribute('aria-controls', detailId);
    const toggleLabel = (open) => `${open ? 'Hide' : 'Show'} details for ${appointment.firstName} on ${formatDateTime(appointment.startsAt)}`;
    toggle.textContent = 'Details';
    toggle.setAttribute('aria-label', toggleLabel(expanded.has(appointment.id)));
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', toggleLabel(open));
      detail.hidden = !open;
      if (open) expanded.add(appointment.id); else expanded.delete(appointment.id);
    });
    actions.append(toggle);

    const detail = document.createElement('div');
    detail.className = 'visit-detail';
    detail.id = detailId;
    detail.hidden = !expanded.has(appointment.id);

    const facts = document.createElement('dl');
    facts.className = 'visit-detail__facts';
    for (const [term, value] of detailFacts(appointment, record)) {
      const group = document.createElement('div');
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      group.append(dt, dd);
      facts.append(group);
    }
    detail.append(facts);

    const detailActions = document.createElement('div');
    detailActions.className = 'visit-detail__actions';

    if (appointment.patientId) {
      const context = document.createElement('button');
      context.type = 'button';
      context.className = 'btn btn-outline';
      context.textContent = 'Patient record';
      context.setAttribute('aria-label', `Open the patient record for ${appointment.firstName}`);
      context.addEventListener('click', () => openContext(appointment, context));
      detailActions.append(context);
    }

    if (record) {
      const viewRecord = document.createElement('a');
      viewRecord.className = 'btn btn-outline';
      viewRecord.href = `/prediction.html?id=${encodeURIComponent(record.id)}`;
      viewRecord.textContent = 'View saved assessment';
      detailActions.append(viewRecord);
    }

    if (canConsult) {
      const open = document.createElement('a');
      open.className = 'visit-detail__link';
      open.href = `/doctor.html?appointment=${encodeURIComponent(appointment.id)}#assessmentSection`;
      open.textContent = record ? 'Continue this consultation' : 'Start this consultation';
      detailActions.append(open);
    }

    detail.append(detailActions);

    const transitions = { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'no_show', 'cancelled'] };
    const allowed = transitions[appointment.status] || [];
    if (allowed.length) {
      const statusGroup = document.createElement('div');
      statusGroup.className = 'visit-detail__status';
      const caption = document.createElement('span');
      caption.textContent = 'Change status';
      statusGroup.append(caption);
      for (const status of allowed) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-ghost';
        button.textContent = `Mark ${(STATUS_LABEL[status] || status).toLowerCase()}`;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await request(`/appointments/${appointment.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
            message(`Appointment for ${appointment.firstName} on ${formatDate(appointment.startsAt)} marked ${STATUS_LABEL[status].toLowerCase()}.`);
            await refreshSchedule({ quiet: true });
          } catch (error) {
            message(error.message);
            button.disabled = false;
          }
        });
        statusGroup.append(button);
      }
      detail.append(statusGroup);
    }

    card.append(when, body, actions, detail);
    return card;
  }

  function renderSchedule() {
    const list = $('#appointments');
    const filters = currentFilters();
    const rows = appointments.filter((appointment) => matchesFilters(appointment, filters));
    const count = $('#visitCount');
    const total = appointments.length;

    if (count) {
      count.textContent = total === 0
        ? 'No appointments yet.'
        : `${rows.length} of ${total} appointment${total === 1 ? '' : 's'} shown.`;
    }

    list.replaceChildren();
    if (!rows.length) {
      list.append(
        stateBlock(
          total ? 'No appointments match these filters.' : 'No appointments yet.',
          total
            ? 'Clear the search, date or status filter to see the rest of your schedule.'
            : 'New bookings appear here. Patients book from the availability in Practice settings.',
          total ? { label: 'Clear filters', run: clearFilters } : null
        )
      );
      return;
    }

    const groups = new Map();
    for (const appointment of rows) {
      const key = dayKey(appointment.startsAt);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(appointment);
    }
    const ordered = [...groups.entries()].sort((a, b) => {
      const [aRank, aStamp] = dayOrder(a[0]);
      const [bRank, bStamp] = dayOrder(b[0]);
      return aRank - bRank || aStamp - bStamp;
    });

    const fragment = document.createDocumentFragment();
    for (const [key, dayRows] of ordered) {
      const day = document.createElement('section');
      day.className = 'dw-day';
      day.dataset.today = key === todayKey() ? 'true' : 'false';
      day.setAttribute('aria-label', `Appointments on ${dayLabel(key)}`);
      const head = document.createElement('div');
      head.className = 'dw-day__head';
      const label = document.createElement('h3');
      label.className = 'dw-day__label';
      label.textContent = dayLabel(key);
      const date = document.createElement('span');
      date.className = 'dw-day__date';
      date.textContent = key < todayKey() ? 'Past' : formatDate(`${key}T12:00:00`);
      const tally = document.createElement('span');
      tally.className = 'dw-day__count';
      tally.textContent = `${dayRows.length} visit${dayRows.length === 1 ? '' : 's'}`;
      head.append(label, date, tally);
      day.append(head);
      dayRows.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
      for (const appointment of dayRows) day.append(visitRow(appointment));
      fragment.append(day);
    }
    list.append(fragment);
  }

  async function refreshSchedule({ quiet = false } = {}) {
    if (!approvedDoctor || loading) return false;
    loading = true;
    const updated = $('#scheduleUpdated');
    try {
      const data = await request('/dashboard');
      appointments = Array.isArray(data.appointments) ? data.appointments : [];
      await loadAssessments();
      // A status changed elsewhere (or a walk-in was registered in another tab)
      // should re-read the schedule without throwing the doctor's place away.
      renderSchedule();
      renderActivity();
      if (updated) updated.textContent = `Updated ${formatTime(new Date())}`;
      if (!quiet) message('');
      return true;
    } catch (error) {
      if (updated) updated.textContent = `Could not refresh at ${formatTime(new Date())}. Showing the last list.`;
      if (!quiet) message(error.message);
      if (error.status === 401) {
        setTimeout(() => window.location.assign('login.html?role=doctor'), 1500);
      }
      return false;
    } finally {
      loading = false;
    }
  }

  function clearFilters() {
    filterForm()?.reset();
    searchTerm = '';
    dateRange = 'all';
    const search = $('#visitSearch');
    if (search) search.value = '';
    for (const chip of document.querySelectorAll('.dw-ranges [data-range]')) {
      const active = chip.dataset.range === 'all';
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    renderSchedule();
  }

  // Analytics is secondary: a metrics outage must never replace the appointment
  // list that has already loaded.
  async function renderActivity() {
    const mount = $('#analytics');
    if (!mount) return;
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const until = now.toISOString().slice(0, 10);
    try {
      const metrics = await request(`/analytics?since=${since}&until=${until}`);
      const list = document.createElement('dl');
      list.className = 'dw-metric-list';
      const add = (term, value) => {
        const wrap = document.createElement('div');
        wrap.className = 'dw-metric';
        const dt = document.createElement('dt');
        dt.textContent = term;
        const dd = document.createElement('dd');
        dd.textContent = value;
        wrap.append(dt, dd);
        list.append(wrap);
      };
      add('Appointments', String(metrics.total));
      add('Completed', String(metrics.counts.completed));
      add('Cancelled', String(metrics.counts.cancelled));
      add('No show', String(metrics.counts.no_show));
      add('Cancellation rate', `${(metrics.cancellationRate * 100).toFixed(1)}%`);
      mount.replaceChildren(list);
    } catch {
      mount.replaceChildren(
        stateBlock('Activity is unavailable right now.', 'Appointments above are still current.')
      );
    }
  }

  // Arriving from a record or a report with ?appointment=<id> should land on that visit.
  function focusRequestedAppointment() {
    const wanted = new URLSearchParams(window.location.search).get('appointment');
    if (!wanted) return;
    const target = document.getElementById(`appointment-${wanted}`);
    if (!target) {
      message('That appointment is not in the current list. Clear the filters to find it.');
      return;
    }
    target.classList.add('appointment-focus');
    // A different hash (the assessment) is the real destination: keep the row
    // marked so the doctor can find it on the way back, but do not steal focus.
    if (window.location.hash && window.location.hash !== `#appointment-${wanted}`) return;
    target.tabIndex = -1;
    target.scrollIntoView({ block: 'center' });
    target.focus({ preventScroll: true });
  }

  // ------------------------------------------------------- patient context ---
  const drawer = () => $('#contextDrawer');
  const scrim = () => $('#contextScrim');

  function closeContext() {
    const panel = drawer();
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    scrim().hidden = true;
    document.body.classList.remove('dw-drawer-open');
    if (contextOpener && document.contains(contextOpener)) contextOpener.focus();
    contextOpener = null;
  }

  function addFact(dl, term, value) {
    if (!value) return;
    const group = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    group.append(dt, dd);
    dl.append(group);
  }

  function listBlock(title, hint) {
    const section = document.createElement('section');
    section.className = 'dw-context-block';
    const head = document.createElement('h3');
    head.textContent = title;
    section.append(head);
    if (hint) {
      const note = document.createElement('p');
      note.className = 'dw-context-hint';
      note.textContent = hint;
      section.append(note);
    }
    return section;
  }

  function renderContext(data, appointment) {
    const body = $('#contextBody');
    body.replaceChildren();

    const identity = listBlock('Identity');
    const facts = document.createElement('dl');
    facts.className = 'dw-context-facts';
    addFact(facts, 'Name', data.patient.fullName);
    addFact(facts, 'Record', data.patient.account ? 'HelloDoc account patient' : 'Walk-in clinical record — no online account');
    addFact(facts, 'Email', data.patient.email || (data.patient.account ? 'Not shared with you' : 'No account, so no email on file'));
    addFact(facts, 'Date of birth', data.patient.dateOfBirth || 'Not recorded');
    addFact(facts, 'Phone', data.patient.phone || 'Not recorded');
    addFact(facts, 'Preferred language', data.patient.preferredLanguage || 'Not recorded');
    identity.append(facts);
    body.append(identity);

    const visits = listBlock('Visits with you', 'Only the appointments assigned to you are shown.');
    if (!data.appointments.length) {
      const empty = document.createElement('p');
      empty.className = 'dw-context-empty';
      empty.textContent = 'No visits are recorded with you yet.';
      visits.append(empty);
    } else {
      const list = document.createElement('ol');
      list.className = 'dw-context-list';
      for (const visit of data.appointments) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/doctor.html?appointment=${encodeURIComponent(visit.id)}#appointment-${encodeURIComponent(visit.id)}`;
        link.textContent = formatDateTime(visit.startsAt);
        const meta = document.createElement('span');
        meta.className = 'dw-context-meta';
        meta.append(statusChip(visit.status));
        if (appointment && visit.id === appointment.id) {
          const current = document.createElement('span');
          current.className = 'dw-context-current';
          current.textContent = 'This visit';
          meta.append(current);
        }
        item.append(link, meta);
        if (visit.reason) {
          const reason = document.createElement('p');
          reason.className = 'dw-context-reason';
          reason.textContent = `Reason given: ${visit.reason}`;
          item.append(reason);
        }
        list.append(item);
      }
      visits.append(list);
    }
    body.append(visits);

    const records = listBlock('Saved assessments', 'Newest first. A revision is stored as a new record; the earlier one is never rewritten.');
    if (!data.assessments.length) {
      const empty = document.createElement('p');
      empty.className = 'dw-context-empty';
      empty.textContent = 'No assessment has been saved for this patient yet.';
      records.append(empty);
    } else {
      const list = document.createElement('ol');
      list.className = 'dw-context-list';
      for (const record of data.assessments) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/prediction.html?id=${encodeURIComponent(record.id)}`;
        link.textContent = formatDateTime(record.createdAt);
        const meta = document.createElement('span');
        meta.className = 'dw-context-meta';
        meta.textContent = record.supersedesId ? 'Revision' : 'Original record';
        item.append(link, meta);
        const summary = document.createElement('p');
        summary.className = 'dw-context-reason';
        summary.textContent = record.predictedDisease
          ? `Model suggestion: ${record.predictedDisease}. Experimental, not a diagnosis.`
          : 'No model suggestion was stored.';
        item.append(summary);
        list.append(item);
      }
      records.append(list);
    }
    body.append(records);

    const note = document.createElement('p');
    note.className = 'dw-context-note';
    note.textContent = 'This history covers the visits and records you are authorized to handle. It is not a complete medical record.';
    body.append(note);
  }

  async function openContext(appointment, opener) {
    const panel = drawer();
    if (!panel || !appointment.patientId) return;
    contextOpener = opener || document.activeElement;
    $('#contextTitle').textContent = appointment.firstName;
    $('#contextSub').textContent = `Patient record · opened from ${formatDate(appointment.startsAt)}`;
    $('#contextBody').replaceChildren(stateBlock('Loading the patient record…'));
    panel.hidden = false;
    scrim().hidden = false;
    document.body.classList.add('dw-drawer-open');
    $('#contextClose').focus();

    try {
      const data = await request(`/patients/${encodeURIComponent(appointment.patientId)}/context`);
      renderContext(data, appointment);
    } catch (error) {
      const body = $('#contextBody');
      body.replaceChildren(stateBlock(
        error.status === 404 ? 'That patient is not one of your records.' : 'The patient record is unavailable right now.',
        error.status === 404 ? 'Open the patient from a visit assigned to you.' : error.message
      ));
    }
  }

  // ---------------------------------------------------------- availability ---
  async function availability() {
    const list = $('#slots');
    if (!list.children.length) list.replaceChildren(stateBlock('Loading availability…'));
    const rows = await request('/availability');
    list.replaceChildren();
    if (!rows.length) {
      list.append(stateBlock('No future slots.', 'Add the times patients can book below.'));
      return;
    }
    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'dw-slot';
      const when = document.createElement('span');
      when.textContent = `${formatDateTime(row.scheduled_start)} – ${formatTime(row.scheduled_end)}`;
      item.append(when, statusChip(row.status));
      list.append(item);
    }
  }

  // ---------------------------------------------------------- verification ---
  const STATUS_TEXT = {
    pending: 'Your professional verification is pending review. An administrator will check your credentials; nothing else is required from you right now.',
    approved: 'Your account is verified. You can manage availability and attend the appointments assigned to you.',
    rejected: 'Your verification was not approved. Review the reason below, correct your details and resubmit.',
    resubmission_required: 'An administrator asked for more information. Update your professional details and resubmit for review.',
  };
  const CHIP_TEXT = {
    approved: 'Verified',
    pending: 'Verification pending',
    rejected: 'Verification rejected',
    resubmission_required: 'More information requested',
  };

  function showVerification(data) {
    const panel = $('#doctorVerification');
    const status = data.verificationStatus || 'pending';
    panel.hidden = false;
    const parts = [STATUS_TEXT[status] || STATUS_TEXT.pending];
    // A reviewer's note only explains a rejection or a request for more
    // information; showing it on an approved profile just leaks internal notes.
    if (['rejected', 'resubmission_required'].includes(status) && data.application?.review_reason) {
      parts.push(`Reviewer note: ${data.application.review_reason}`);
    }
    if (data.specialty) parts.push(`Specialty on file: ${data.specialty}.`);
    if (data.institution) parts.push(`Institution on file: ${data.institution}.`);
    $('#verificationStatus').textContent = parts.join(' ');

    const hint = $('#verificationHint');
    if (hint) {
      hint.textContent = data.approved
        ? 'Your clinical tools are available. Availability and appointment status changes are recorded.'
        : 'Only an administrator can approve, reject or reopen verification. You can keep your profile up to date while a review is pending.';
    }

    const chip = $('#verificationChip');
    if (chip) {
      chip.dataset.state = status;
      chip.hidden = false;
      const label = $('#verificationChipText');
      if (label) label.textContent = CHIP_TEXT[status] || CHIP_TEXT.pending;
    }

    const identity = $('#doctorIdentity');
    if (identity) {
      const name = [data.profile?.firstName, data.profile?.lastName].filter(Boolean).join(' ');
      const facts = [name, data.specialty, data.institution].filter(Boolean);
      identity.textContent = facts.length
        ? facts.join(' · ')
        : 'Verification and appointment status for your practice.';
    }

    const form = $('#resubmitForm');
    const canResubmit = !data.approved && ['rejected', 'resubmission_required'].includes(status);
    form.hidden = !canResubmit;
    if (canResubmit || !data.approved) {
      // Keep the latest submitted details in the form so a correction starts
      // from what the reviewer already has.
      form.specialty.value = data.specialty || '';
      form.licenseNumber.value = data.application?.license_number || '';
      form.institution.value = data.institution || '';
      form.yearsExperience.value = data.application?.years_experience ?? '';
      form.qualifications.value = data.application?.qualifications || '';
    }
    return data.approved;
  }

  const resubmitForm = $('#resubmitForm');
  if (resubmitForm) {
    resubmitForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = resubmitForm.querySelector('button[type=submit]');
      const status = $('#resubmitMessage');
      status.hidden = true;
      button.disabled = true;
      try {
        const response = await fetch('/api/doctor/application/resubmit', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            specialty: resubmitForm.specialty.value.trim(),
            licenseNumber: resubmitForm.licenseNumber.value.trim(),
            institution: resubmitForm.institution.value.trim(),
            yearsExperience: Number(resubmitForm.yearsExperience.value),
            qualifications: resubmitForm.qualifications.value.trim(),
          }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || 'Resubmission failed');
        resubmitForm.hidden = true;
        $('#verificationStatus').textContent =
          'Your updated details were sent for review. An administrator will review them shortly.';
        const chip = $('#verificationChip');
        if (chip) chip.dataset.state = 'pending';
        const label = $('#verificationChipText');
        if (label) label.textContent = CHIP_TEXT.pending;
      } catch (error) {
        status.textContent = error.message;
        status.hidden = false;
      } finally {
        button.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------- section nav ---
  // The navbar's section links follow the section you are reading, so the three
  // areas stay legible in a single page.
  function initSectionNav() {
    const links = [...document.querySelectorAll('[data-section-link]')];
    const sections = links
      .map((link) => document.getElementById(link.dataset.sectionLink))
      .filter(Boolean);
    if (!links.length || !sections.length) return;

    const mark = (id) => {
      for (const link of links) {
        const current = link.dataset.sectionLink === id;
        link.classList.toggle('is-current', current);
        if (current) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    };

    let frame = 0;
    const update = () => {
      frame = 0;
      // The section under the header wins; before the first one, the first wins.
      const line = window.scrollY + 140;
      let current = sections[0].id;
      for (const section of sections) {
        if (section.getBoundingClientRect().top + window.scrollY <= line) current = section.id;
      }
      mark(current);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    update();
  }

  // -------------------------------------------------------------- controls ---
  const filters = $('#filters');
  if (filters) {
    // The date and status controls double as live filters; Apply stays for
    // keyboard users and for reloading the list after a manual change.
    const live = () => renderSchedule();
    filters.addEventListener('submit', (event) => {
      event.preventDefault();
      live();
    });
    filters.addEventListener('change', live);
  }

  const clear = $('#clearFilters');
  if (clear) clear.addEventListener('click', clearFilters);

  const search = $('#visitSearch');
  if (search) {
    let timer = 0;
    search.addEventListener('input', () => {
      window.clearTimeout(timer);
      // Debounced so typing stays smooth while the list is rebuilt.
      timer = window.setTimeout(() => {
        searchTerm = search.value;
        renderSchedule();
      }, 160);
    });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && search.value) {
        event.preventDefault();
        search.value = '';
        searchTerm = '';
        renderSchedule();
      }
    });
  }

  for (const chip of document.querySelectorAll('.dw-ranges [data-range]')) {
    chip.addEventListener('click', () => {
      dateRange = chip.dataset.range;
      for (const other of document.querySelectorAll('.dw-ranges [data-range]')) {
        const active = other === chip;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
      renderSchedule();
    });
  }

  const refresh = $('#refreshSchedule');
  if (refresh) {
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      refresh.textContent = 'Refreshing…';
      try {
        await refreshSchedule();
      } finally {
        refresh.disabled = false;
        refresh.textContent = 'Refresh schedule';
      }
    });
  }

  const contextClose = $('#contextClose');
  if (contextClose) contextClose.addEventListener('click', closeContext);
  const contextScrim = $('#contextScrim');
  if (contextScrim) contextScrim.addEventListener('click', closeContext);
  if (drawer()) {
    drawer().addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeContext();
      }
    });
  }

  const slotForm = $('#slotForm');
  if (slotForm) {
    slotForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.target.querySelector('button');
      button.disabled = true;
      try {
        const local = new FormData(event.target).get('startsAt');
        await request('/availability', { method: 'POST', body: JSON.stringify({ startsAt: new Date(local).toISOString() }) });
        event.target.reset();
        await availability();
        message('Slot saved. Patients can book it now.');
      } catch (error) {
        message(error.message);
      } finally {
        button.disabled = false;
      }
    });
  }

  const logout = $('#logout');
  if (logout) {
    logout.addEventListener('click', async () => {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      if (response.ok) window.location.assign('index.html');
      else message('Could not log out. Retry.');
    });
  }

  // ------------------------------------------------------------------ init ---
  (async () => {
    try {
      // The overview itself is doctor-only and carries the role check, so the
      // page does not spend an extra round trip on /auth/current-user first.
      const overview = await request('/overview');
      const approved = showVerification(overview);
      $('#workspace').hidden = false;
      message(approved ? '' : 'Your workspace is in pending-verification mode. Clinical tools unlock after approval.');

      if (!approved) {
        // Nothing clinical exists for an unverified doctor, and the availability
        // endpoint is closed to them too, so only the practice panel remains.
        $('#clinicalPanels').hidden = true;
        $('#doctorAvailability').hidden = true;
        return;
      }

      approvedDoctor = true;
      initSectionNav();
      const loaded = await refreshSchedule({ quiet: true });
      if (loaded) {
        focusRequestedAppointment();
      } else {
        $('#appointments').replaceChildren(
          stateBlock('Appointments are unavailable right now.', 'Use Refresh schedule to retry.')
        );
      }
      availability().catch(() => {
        $('#slots').replaceChildren(stateBlock('Availability is unavailable.', 'Reload the page to retry.'));
      });

      // A slow, visible refresh keeps the schedule current without a realtime
      // subscription (this app talks to Supabase through the server session, so
      // a browser-side channel is not available). It pauses while the tab is
      // hidden and never replaces an appointment list that is already on screen.
      window.setInterval(() => {
        if (document.visibilityState === 'visible' && approvedDoctor) refreshSchedule({ quiet: true });
      }, 60000);
    } catch (error) {
      // "Access denied" here means the account is not a doctor at all.
      message(
        error.status === 403 && /^access denied$/i.test(error.message)
          ? 'Sign in with a doctor account to open this workspace.'
          : error.message
      );
      // A pending doctor, a paused model service or a Supabase 503 is not a
      // sign-out; only an authentication rejection returns to the login page.
      // A suspended account keeps its explanation on screen instead of being
      // bounced to a login form that cannot help it.
      if (error.code === 'ACCOUNT_SUSPENDED' || error.code === 'PROFILE_UNAVAILABLE') return;
      if (error.status === 401 || error.status === 403) setTimeout(() => window.location.assign('login.html?role=doctor'), 1500);
    }
  })();
})();
