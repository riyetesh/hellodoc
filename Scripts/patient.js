(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const activeStatuses = new Set(['pending', 'confirmed']);
  const completedStatuses = new Set(['completed']);
  const statusLabels = { pending: 'Requested', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled', no_show: 'Missed' };
  const state = { data: null, records: null, recordsUnavailable: false, onboardingStep: 0 };

  function localDate(value, options = {}) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', ...options }).format(date);
  }

  function shortDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Date unavailable';
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function safeText(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function showMessage(node, message, isError = false) {
    if (!node) return;
    node.textContent = message;
    node.hidden = !message;
    node.classList.toggle('is-error', isError);
    node.classList.toggle('is-success', Boolean(message) && !isError);
  }

  /* ---------- Onboarding (optional, resumable, never blocking) ---------- */
  function onboardingKey(userId) { return `hellodoc:patient-setup:${userId}`; }
  function setupState(userId) {
    try {
      const value = JSON.parse(localStorage.getItem(onboardingKey(userId)) || '{}');
      return { complete: value.complete === true, step: Number.isInteger(value.step) ? Math.max(0, Math.min(2, value.step)) : 0 };
    } catch { return { complete: false, step: 0 }; }
  }
  function persistSetup(step, complete = false) {
    if (!state.data?.userId) return;
    try { localStorage.setItem(onboardingKey(state.data.userId), JSON.stringify({ step, complete })); }
    catch { /* Onboarding is optional; the dashboard stays usable without it. */ }
  }
  function markSetupComplete() {
    persistSetup(2, true);
    $('#onboarding').hidden = true;
  }
  function setupProgress(step) {
    state.onboardingStep = step;
    persistSetup(step);
    const steps = [$('#setupWelcome'), $('#setupProfile'), $('#setupFinish')];
    steps.forEach((panel, index) => { panel.hidden = index !== step; });
    $('#setupProgressText').textContent = `Step ${step + 1} of ${steps.length}`;
    $('#setupProgressBar').style.width = `${((step + 1) / steps.length) * 100}%`;
  }
  function prefillForm(form, profile) {
    if (!form) return;
    form.elements.firstName.value = profile.firstName || '';
    form.elements.lastName.value = profile.lastName || '';
    form.elements.phone.value = profile.phone || '';
  }
  function startOnboarding(profile) {
    const saved = setupState(state.data.userId);
    if (saved.complete) return;
    $('#onboarding').hidden = false;
    prefillForm($('#setupProfileForm'), profile);
    setupProgress(saved.step);
  }

  async function saveSetupProfile(form) {
    if (!form.reportValidity()) return false;
    const firstName = form.elements.firstName.value.trim();
    const lastName = form.elements.lastName.value.trim();
    const phone = form.elements.phone.value.trim();
    const phoneField = form.elements.phone;
    if (!firstName) {
      firstNameFieldValidity(form, 'Add your first name to continue.');
      return false;
    }
    if (phone && !/^[+()\-\s0-9]{6,40}$/.test(phone)) {
      phoneField.setCustomValidity('Enter a valid phone number or leave it blank.');
      phoneField.reportValidity();
      phoneField.addEventListener('input', () => phoneField.setCustomValidity(''), { once: true });
      return false;
    }
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    showMessage($('#setupProfileMessage'), 'Saving your details…');
    try {
      const response = await fetch('/api/patient/profile', {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, phone }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error('Your session ended. Sign in again to save profile changes.');
      if (!response.ok) throw new Error(result.message || 'Your profile could not be saved. Try again.');
      showMessage($('#setupProfileMessage'), 'Your profile is up to date.');
      return true;
    } catch (error) {
      showMessage($('#setupProfileMessage'), error.message || 'Your profile could not be saved. Check your connection and try again.', true);
      return false;
    } finally {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  function firstNameFieldValidity(form, message) {
    const field = form.elements.firstName;
    field.setCustomValidity(message);
    field.reportValidity();
    field.addEventListener('input', () => field.setCustomValidity(''), { once: true });
  }

  /* ---------- Appointment summary ---------- */
  function renderSummary(data) {
    const now = Date.now();
    const upcoming = data.appointments
      .filter((appointment) => activeStatuses.has(appointment.status) && new Date(appointment.startsAt).getTime() > now)
      .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    const completed = data.appointments.filter((appointment) => completedStatuses.has(appointment.status));
    const counts = data.metrics || {};
    const next = upcoming[0];

    $('#nextVisitSummary').textContent = next ? next.doctorName : 'No visit booked';
    $('#nextVisitDetail').textContent = next
      ? `${localDate(next.startsAt)} · ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(next.startsAt))}`
      : 'Choose a doctor when you are ready.';
    $('#upcomingCount').textContent = String(Number(counts.upcoming ?? upcoming.length));
    $('#completedCount').textContent = String(Number(counts.completed ?? completed.length));
    $('#summarySection').setAttribute('aria-busy', 'false');

    $('#appointmentsList').replaceChildren();
    if (!upcoming.length) {
      $('#appointmentsEmpty').hidden = false;
      $('#appointmentsList').hidden = true;
      return;
    }
    $('#appointmentsEmpty').hidden = true;
    $('#appointmentsList').hidden = false;

    for (const appointment of upcoming.slice(0, 4)) {
      const card = document.createElement('article');
      card.className = 'patient-appointment';
      const date = document.createElement('div');
      date.className = 'patient-appointment__date';
      date.append(
        safeText('span', '', new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(appointment.startsAt))),
        safeText('strong', '', new Intl.DateTimeFormat(undefined, { day: 'numeric' }).format(new Date(appointment.startsAt)))
      );
      const details = document.createElement('div');
      details.className = 'patient-appointment__details';
      details.append(safeText('h3', '', appointment.doctorName), safeText('p', '', appointment.specialty || 'Consultation'));
      const time = safeText('p', 'patient-appointment__time', `${new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(appointment.startsAt))} · ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(appointment.startsAt))}`);
      const status = safeText('span', `patient-status patient-status--${appointment.status}`, statusLabels[appointment.status] || appointment.status);
      status.setAttribute('aria-label', `Appointment status: ${statusLabels[appointment.status] || appointment.status}`);
      const cardContent = document.createElement('div');
      cardContent.className = 'patient-appointment__content';
      cardContent.append(details, time);
      const actions = document.createElement('div');
      actions.className = 'patient-appointment__actions';
      actions.append(status);
      if (activeStatuses.has(appointment.status)) {
        const cancel = safeText('button', 'patient-cancel-button', 'Cancel');
        cancel.type = 'button';
        cancel.dataset.cancelAppointment = appointment.id;
        cancel.setAttribute('aria-label', `Cancel appointment with ${appointment.doctorName}`);
        actions.append(cancel);
      }
      card.append(date, cardContent, actions);
      $('#appointmentsList').append(card);
    }
  }

  /* ---------- Follow-up and latest record ---------- */
  function renderFollowUp() {
    const panel = $('#followUpPanel');
    if (!panel) return;
    if (state.recordsUnavailable) {
      panel.replaceChildren();
      const block = document.createElement('div');
      block.className = 'patient-empty';
      block.append(
        safeText('h3', '', 'Health records are unavailable'),
        safeText('p', '', 'We could not load your assessment history right now. Your appointments are unaffected.')
      );
      const retry = safeText('button', 'patient-button patient-button--outline', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => loadRecords());
      block.append(retry);
      panel.append(block);
      return;
    }
    const latest = state.records?.[0];
    panel.replaceChildren();
    if (!latest) {
      const empty = document.createElement('div');
      empty.className = 'patient-empty';
      const art = document.createElement('img');
      art.className = 'patient-empty__art';
      art.src = '/Asset/Illustrations/care.svg';
      art.alt = '';
      empty.append(
        art,
        safeText('h3', '', 'No visits recorded yet'),
        safeText('p', '', 'After a consultation, your clinician’s assessment and any guidance they recorded will appear here.')
      );
      const link = document.createElement('a');
      link.className = 'patient-button patient-button--outline';
      link.href = 'records.html';
      link.textContent = 'Open health records';
      empty.append(link);
      panel.append(empty);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'record-symptoms';
    const heading = safeText('h3', '', latest.predictedDisease || 'Consultation recorded');
    const meta = safeText('p', '', `${shortDate(latest.recordedAt)} · ${latest.doctorName}`);
    wrap.append(heading, meta);

    if (latest.predictedDisease) {
      wrap.append(safeText('p', '', `Model suggestion: ${latest.predictedDisease}. This is experimental decision support, not a confirmed diagnosis.`));
    } else {
      wrap.append(safeText('p', '', 'The symptom model was not used for this consultation; the clinician’s notes are the record.'));
    }
    if (latest.clinicianSummary) {
      const note = safeText('p', '', latest.clinicianSummary);
      wrap.append(note);
    } else if (latest.hasPlan) {
      wrap.append(safeText('p', '', 'Your clinician recorded a plan for this visit.'));
    }

    const actions = document.createElement('div');
    actions.className = 'setup-actions';
    const open = document.createElement('a');
    open.className = 'patient-button patient-button--primary';
    open.href = `records.html?id=${encodeURIComponent(latest.id)}`;
    open.textContent = 'Read the guidance';
    const book = document.createElement('a');
    book.className = 'patient-button patient-button--outline';
    book.href = 'dashboard.html';
    book.textContent = 'Book a follow-up';
    actions.append(open, book);
    wrap.append(actions);
    panel.append(wrap);
  }

  function renderLatestRecord() {
    const host = $('#latestRecord');
    if (!host) return;
    host.replaceChildren();
    if (state.recordsUnavailable) {
      host.append(safeText('p', 'guide-empty', 'Health records could not be loaded right now.'));
      return;
    }
    const latest = state.records?.[0];
    if (!latest) {
      host.append(safeText('p', 'guide-empty', 'No records yet. Your clinician’s notes and reports will be listed here after a consultation.'));
      return;
    }
    const link = document.createElement('a');
    link.className = 'record-card';
    link.href = `records.html?id=${encodeURIComponent(latest.id)}`;
    const art = document.createElement('img');
    art.className = 'record-card__art';
    art.src = '/Asset/Illustrations/medicine.svg';
    art.alt = '';
    const body = document.createElement('span');
    body.className = 'record-card__body';
    body.append(
      safeText('strong', '', latest.predictedDisease || 'Clinical consultation'),
      safeText('span', '', `${shortDate(latest.recordedAt)} · ${latest.doctorName}`)
    );
    link.append(art, body);
    host.append(link);
  }

  async function loadRecords() {
    const panel = $('#followUpPanel');
    if (panel) panel.innerHTML = '<div class="patient-loading" aria-hidden="true"><span></span></div>';
    try {
      const response = await fetch('/api/patient/assessments', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('unavailable');
      const rows = await response.json();
      state.records = Array.isArray(rows) ? rows : [];
      state.recordsUnavailable = false;
    } catch {
      state.records = [];
      state.recordsUnavailable = true;
    }
    renderFollowUp();
    renderLatestRecord();
  }

  /* ---------- Cancellation ---------- */
  function requestCancelConfirmation() {
    const dialog = $('#cancelDialog');
    if (!dialog?.showModal) {
      showMessage($('#portalMessage'), 'This browser cannot open the appointment confirmation. Use the Appointments page to manage this visit.', true);
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const finish = () => resolve(dialog.returnValue === 'confirm');
      dialog.addEventListener('close', finish, { once: true });
      dialog.showModal();
      $('[value="keep"]', dialog).focus();
    });
  }

  async function cancelAppointment(id, button) {
    if (!await requestCancelConfirmation()) return;
    button.disabled = true;
    button.textContent = 'Cancelling…';
    try {
      const result = await window.Appointments.cancel(id);
      if (result.status !== 'cancelled') throw new Error('The appointment was not cancelled. Refresh the page to check its status.');
      await loadOverview(false);
      showMessage($('#portalMessage'), 'Appointment cancelled.');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Cancel';
      showMessage($('#portalMessage'), error.message || 'Could not cancel this appointment. Please try again.', true);
    }
  }

  /* ---------- Overview ---------- */
  async function loadOverview(showLoading = true) {
    $('#portalMessage').hidden = true;
    if (showLoading) $('#summarySection').setAttribute('aria-busy', 'true');
    const response = await fetch('/api/patient/overview', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) {
      showMessage($('#portalMessage'), 'Your session has ended. Redirecting to patient sign in…', true);
      window.location.replace('/login.html?role=patient');
      return null;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (body.code === 'ACCOUNT_SUSPENDED') throw new Error(body.message || 'This account is restricted. Contact HelloDoc support.');
      if (body.code === 'PROFILE_UNAVAILABLE') throw new Error(body.message || 'Your patient profile is unavailable. Contact support.');
      throw new Error(body.message || 'Your patient information is temporarily unavailable. Try again shortly.');
    }
    if (!body.profile || !Array.isArray(body.appointments)) throw new Error('The patient dashboard returned incomplete data. Please reload.');

    const first = body.profile.firstName || '';
    $('#greeting').textContent = first ? `Good to see you, ${first}.` : 'Your care, in view.';
    $('#welcomeMessage').textContent = 'What happens next, what your clinician recorded, and what to do about it.';
    document.title = first ? `HelloDoc | ${first}’s care` : 'HelloDoc | Patient home';
    state.data = body;
    renderSummary(body);
    startOnboarding(body.profile);
    return body;
  }

  /* ---------- Wiring ---------- */
  function wireOnboarding() {
    $$('[data-setup-next]').forEach((button) => button.addEventListener('click', () => setupProgress(1)));
    $$('[data-setup-back]').forEach((button) => button.addEventListener('click', () => setupProgress(Math.max(0, state.onboardingStep - 1))));
    $$('[data-setup-skip]').forEach((button) => button.addEventListener('click', markSetupComplete));
    $('#setupProfileForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const saved = await saveSetupProfile(event.currentTarget);
      if (saved) setupProgress(2);
    });
    $('#finishSetup').addEventListener('click', markSetupComplete);
  }

  function wireAppointments() {
    $('#retryAppointments').addEventListener('click', async () => {
      $('#appointmentsUnavailable').hidden = true;
      $('#appointmentsList').hidden = false;
      $('#appointmentsList').innerHTML = '<div class="patient-loading" aria-hidden="true"><span></span><span></span></div>';
      try {
        await loadOverview();
        $('#portalMessage').hidden = true;
      } catch (error) {
        $('#appointmentsList').hidden = true;
        $('#appointmentsUnavailable').hidden = false;
        showMessage($('#portalMessage'), error.message || 'Your appointments could not be loaded.', true);
      }
    });
    $('#appointmentsList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-cancel-appointment]');
      if (button) cancelAppointment(button.dataset.cancelAppointment, button);
    });
    $('#cancelDialog').addEventListener('click', (event) => {
      if (event.target === event.currentTarget) event.currentTarget.close('keep');
    });
  }

  window.addEventListener('pageshow', async (event) => {
    if (!event.persisted) return;
    try {
      const response = await fetch('/api/auth/current-user', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) window.location.replace('/login.html?role=patient');
    } catch { /* The server-side overview remains authoritative on reload. */ }
  });

  document.addEventListener('DOMContentLoaded', async () => {
    wireOnboarding();
    wireAppointments();
    // Session and account area come from the shared patient shell.
    const session = await window.PatientShell.start();
    if (!session || session.redirecting || session.error) {
      if (session?.error) showMessage($('#portalMessage'), session.error, true);
      $('#summarySection').setAttribute('aria-busy', 'false');
      return;
    }
    try {
      await loadOverview();
      $('#portalMessage').hidden = true;
    } catch (error) {
      $('#summarySection').setAttribute('aria-busy', 'false');
      $('#appointmentsList').hidden = true;
      $('#appointmentsEmpty').hidden = true;
      $('#appointmentsUnavailable').hidden = false;
      showMessage($('#portalMessage'), error.message || 'Your patient dashboard could not load.', true);
    }
    loadRecords();
  });
})();
