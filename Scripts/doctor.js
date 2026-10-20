(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const message = (value) => { $('#message').textContent = value; };
  async function call(path, options = {}) {
    const response = await fetch('/api' + path, { credentials:'same-origin', ...options, headers:{ 'Content-Type':'application/json', ...options.headers } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Keep the status on the error so callers can tell an ended session (401)
      // apart from a feature that is merely unavailable (403/503). Only the
      // first one may send the doctor back to the sign-in page.
      const error = new Error(body.message || 'Request failed');
      error.status = response.status;
      throw error;
    }
    return body;
  }
  const request = (path, options) => call('/doctor' + path, options);
  async function load() {
    const filters = new FormData($('#filters'));
    const data = await request('/dashboard');
    const list = $('#appointments');
    list.replaceChildren();
    const rows = data.appointments.filter((a) => (!filters.get('status') || filters.get('status') === a.status) && (!filters.get('date') || a.startsAt.startsWith(filters.get('date'))));
    if (!rows.length) list.textContent = 'No appointments match these filters.';
    for (const appointment of rows) {
      const card = document.createElement('article');
      // Stable anchor so a results page can link straight back to the visit.
      card.id = `appointment-${appointment.id}`;
      card.className = 'appointment-row';
      const title = document.createElement('strong');
      title.textContent = appointment.firstName;
      const detail = document.createElement('p');
      detail.textContent = `${new Date(appointment.startsAt).toLocaleString()} · ${appointment.status}`;
      card.append(title,detail);
      const transitions = { pending:['confirmed','cancelled'], confirmed:['completed','no_show','cancelled'] };
      // The consultation entry point: the appointment id is the only thing the
      // next page receives; the patient identity is loaded server-side.
      const assess = document.createElement('a');
      assess.className = 'btn btn-primary';
      assess.href = `/doctor.html?appointment=${encodeURIComponent(appointment.id)}#assessmentSection`;
      assess.textContent = 'Open assessment';
      card.append(assess);
      for (const status of transitions[appointment.status] || []) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'btn btn-outline'; button.textContent = `Mark ${status}`;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await request(`/appointments/${appointment.id}/status`, { method:'PATCH', body:JSON.stringify({ status }) });
            await load(); message(`Appointment marked ${status}.`);
          } catch (error) { message(error.message); button.disabled = false; }
        });
        card.append(button);
      }
      list.append(card);
    }
    const now = new Date();
    const since = new Date(now.getTime()-30*86400000).toISOString().slice(0,10);
    const until = now.toISOString().slice(0,10);
    const metrics = await request(`/analytics?since=${since}&until=${until}`);
    $('#analytics').textContent = `Last 30 days (UTC): ${metrics.total} appointments; ${metrics.counts.completed} completed, ${metrics.counts.cancelled} cancelled, ${metrics.counts.no_show} no-show. Cancellation rate: ${(metrics.cancellationRate*100).toFixed(1)}%.`;
    focusRequestedAppointment();
  }

  // Arriving from an assessment with ?appointment=<id> should land on that visit.
  function focusRequestedAppointment() {
    const wanted = new URLSearchParams(window.location.search).get('appointment');
    if (!wanted) return;
    const target = document.getElementById(`appointment-${wanted}`);
    if (!target) {
      message('That appointment is not in the current list. Clear the filters to find it.');
      return;
    }
    target.classList.add('appointment-focus');
    target.tabIndex = -1;
    target.scrollIntoView({ block: 'center' });
    target.focus({ preventScroll: true });
  }
  async function availability() {
    const rows = await request('/availability');
    const list = $('#slots'); list.replaceChildren();
    if (!rows.length) list.textContent = 'No future slots.';
    for (const row of rows) {
      const item = document.createElement('p');
      item.textContent = `${new Date(row.scheduled_start).toLocaleString()} · ${row.status}`;
      list.append(item);
    }
  }
  $('#slotForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button'); button.disabled = true;
    try {
      const local = new FormData(event.target).get('startsAt');
      await request('/availability',{method:'POST',body:JSON.stringify({ startsAt:new Date(local).toISOString() })});
      event.target.reset(); await availability(); message('Slot saved.');
    } catch (error) { message(error.message); } finally { button.disabled = false; }
  });
  $('#filters').addEventListener('submit', (event) => { event.preventDefault(); load().catch((error) => message(error.message)); });
  $('#logout').addEventListener('click', async () => {
    const response = await fetch('/api/auth/logout', { method:'POST', credentials:'same-origin' });
    if (response.ok) window.location.assign('index.html');
    else message('Could not log out. Retry.');
  });
  const STATUS_TEXT = {
    pending: 'Your professional verification is pending review. An administrator will check your credentials; nothing else is required from you right now.',
    approved: 'Your account is verified. You can manage availability and attend the appointments assigned to you.',
    rejected: 'Your verification was not approved. Review the reason below, correct your details and resubmit.',
    resubmission_required: 'An administrator asked for more information. Update your professional details and resubmit for review.',
  };

  function showVerification(data) {
    const panel = $('#doctorVerification');
    const status = data.verificationStatus || 'pending';
    panel.hidden = false;
    const parts = [STATUS_TEXT[status] || STATUS_TEXT.pending];
    // A reviewer's note only explains a rejection or a request for more
    // information; showing it on an approved profile just leaks internal notes.
    if (['rejected', 'resubmission_required'].includes(status) && data.application?.review_reason) parts.push(`Reviewer note: ${data.application.review_reason}`);
    if (data.specialty) parts.push(`Specialty on file: ${data.specialty}.`);
    if (data.institution) parts.push(`Institution on file: ${data.institution}.`);
    $('#verificationStatus').textContent = parts.join(' ');
    const hint = $('#verificationHint');
    if (hint) hint.textContent = data.approved
      ? 'Your clinical tools are available. Availability and appointment status changes are recorded.'
      : 'Only an administrator can approve, reject or reopen verification. You can keep your profile up to date while a review is pending.';
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
  if (resubmitForm) resubmitForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = resubmitForm.querySelector('button[type=submit]');
    const status = $('#resubmitMessage');
    status.hidden = true;
    button.disabled = true;
    try {
      const response = await fetch('/api/doctor/application/resubmit', {
        method:'POST', credentials:'same-origin', headers:{ 'Content-Type':'application/json' },
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
      $('#verificationStatus').textContent = 'Your updated details were sent for review. An administrator will review them shortly.';
    } catch (error) {
      status.textContent = error.message;
      status.hidden = false;
    } finally { button.disabled = false; }
  });

  (async () => {
    try {
      // The overview itself is doctor-only and carries the role check, so the
      // page does not spend an extra round trip on /auth/current-user first.
      const overview = await request('/overview');
      const approved = showVerification(overview);
      $('#workspace').hidden = false;
      message(approved ? '' : 'Your dashboard is in pending-verification mode. Clinical tools unlock after approval.');
      if (!approved) {
        $('#clinicalPanels').hidden = true;
        return;
      }
      await Promise.all([
        load().catch(() => { $('#appointments').textContent = 'Appointments or analytics unavailable. Retry using Apply filters.'; }),
        availability().catch(() => { $('#slots').textContent = 'Availability unavailable. Please reload to retry.'; })
      ]);
    } catch (error) {
      // "Access denied" here means the account is not a doctor at all.
      message(error.status === 403 && /^access denied$/i.test(error.message) ? 'Sign in with a doctor account to open this dashboard.' : error.message);
      // A pending doctor, a paused model service or a Supabase 503 is not a
      // sign-out; only an authentication rejection returns to the login page.
      if (error.status === 401 || error.status === 403) setTimeout(() => window.location.assign('login.html?role=doctor'), 1500);
    }
  })();
})();
