/* ============================================================
   HelloDoc - Doctor workspace
   The appointment is the unit of work: each row carries the visit,
   its status, the patient's stated reason and the one next action.
   Clinical records and practice settings are separate sections fed
   by the same overview call.
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

  function stateBlock(title, hint) {
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
    return wrap;
  }

  // ------------------------------------------------------------- schedule ---
  let assessmentByAppointment = new Map();

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

  function visitRow(appointment) {
    const card = document.createElement('article');
    // Stable anchor so a report or results page can link straight back to the visit.
    card.id = `appointment-${appointment.id}`;
    card.className = 'visit-row';

    const when = document.createElement('div');
    when.className = 'visit-row__when';
    const date = document.createElement('span');
    date.className = 'visit-row__date';
    date.textContent = formatDate(appointment.startsAt);
    const time = document.createElement('span');
    time.className = 'visit-row__time';
    time.textContent = formatTime(appointment.startsAt);
    when.append(date, time);

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
    const primary = document.createElement('a');
    primary.className = 'btn btn-primary visit-row__primary';
    primary.href = `/doctor.html?appointment=${encodeURIComponent(appointment.id)}#assessmentSection`;
    primary.textContent = record ? 'Continue assessment' : 'Open consultation';
    primary.setAttribute('aria-label', `${primary.textContent} for ${appointment.firstName} on ${formatDate(appointment.startsAt)}`);
    actions.append(primary);

    const secondary = document.createElement('div');
    secondary.className = 'visit-row__secondary';
    if (record) {
      const viewRecord = document.createElement('a');
      viewRecord.className = 'visit-row__link';
      viewRecord.href = `/prediction.html?id=${encodeURIComponent(record.id)}`;
      viewRecord.textContent = 'View saved record';
      secondary.append(viewRecord);
    }
    const transitions = { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'no_show', 'cancelled'] };
    for (const status of transitions[appointment.status] || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline';
      button.textContent = `Mark ${(STATUS_LABEL[status] || status).toLowerCase()}`;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await request(`/appointments/${appointment.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
          await load();
          message(`Appointment for ${appointment.firstName} on ${formatDate(appointment.startsAt)} marked ${STATUS_LABEL[status].toLowerCase()}.`);
        } catch (error) {
          message(error.message);
          button.disabled = false;
        }
      });
      secondary.append(button);
    }
    if (secondary.children.length) actions.append(secondary);

    card.append(when, body, actions);
    return card;
  }

  async function load() {
    const filters = new FormData($('#filters'));
    const list = $('#appointments');
    if (!list.children.length) list.replaceChildren(stateBlock('Loading appointments…'));

    const [data] = await Promise.all([request('/dashboard'), loadAssessments()]);
    const rows = data.appointments.filter(
      (appointment) =>
        (!filters.get('status') || filters.get('status') === appointment.status) &&
        (!filters.get('date') || appointment.startsAt.startsWith(filters.get('date')))
    );

    list.replaceChildren();
    if (!rows.length) {
      list.append(
        stateBlock(
          'No appointments match these filters.',
          'Clear the date or status filter to see the rest of your schedule.'
        )
      );
    } else {
      const fragment = document.createDocumentFragment();
      for (const appointment of rows) fragment.append(visitRow(appointment));
      list.append(fragment);
    }

    renderActivity();
    focusRequestedAppointment();
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

  const filters = $('#filters');
  if (filters) {
    filters.addEventListener('submit', (event) => {
      event.preventDefault();
      load().catch((error) => message(error.message));
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

  // -------------------------------------------------------- section pointer ---
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

      initSectionNav();
      await Promise.all([
        load().catch(() => {
          $('#appointments').replaceChildren(
            stateBlock('Appointments are unavailable right now.', 'Retry using Apply filters.')
          );
        }),
        availability().catch(() => {
          $('#slots').replaceChildren(stateBlock('Availability is unavailable.', 'Reload the page to retry.'));
        }),
      ]);
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
