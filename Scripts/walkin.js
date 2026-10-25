/* ============================================================
   HelloDoc - Walk-in registration
   A doctor registers a patient who arrives without an appointment and
   without an account. This creates a clinical record only: no auth user,
   no email address and no portal access are created here.

   Every write goes through the doctor API, which resolves the doctor from
   the session and re-checks approval on the server. Patient details are never
   written to localStorage or sessionStorage, and the browser never supplies a
   patient id as proof of access: the server returns the appointment that the
   assessment flow then authorises against.
   ============================================================ */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const dialog = $('walkinDialog');
  const openButton = $('openWalkin');
  if (!dialog || !openButton) return;

  const form = $('walkinForm');
  const done = $('walkinDone');
  const nameInput = $('walkinName');
  const dobInput = $('walkinDob');
  const phoneInput = $('walkinPhone');
  const languageInput = $('walkinLanguage');
  const submitButton = $('walkinSubmit');
  const checkButton = $('walkinCheck');
  const matchesBox = $('walkinMatches');
  const pageError = $('walkinError');
  const stateLine = $('walkinState');
  const doneError = $('walkinDoneError');
  const startButton = $('walkinStart');
  const bookButton = $('walkinBook');
  const slotSelect = $('walkinSlot');

  // The idempotency key is kept for the lifetime of one registration attempt, so
  // a retry after a timeout or a double click returns the record already created
  // instead of making a second one. It is regenerated whenever the form resets.
  let key = crypto.randomUUID();
  let busy = false;
  let matches = [];
  let chosen = null; // { id, fullName, dateOfBirth, phone, preferredLanguage, existing }
  let slotsLoaded = false;

  const today = new Date().toISOString().slice(0, 10);
  dobInput.max = today;

  function setError(node, message) {
    node.textContent = message || '';
    node.hidden = !message;
  }

  function showPageError(message) {
    pageError.textContent = message || '';
    pageError.hidden = !message;
  }

  // The workspace is usable before the walk-in tables exist. When they do not,
  // say so once, clearly, instead of failing after the doctor has typed a form.
  let available = true;
  function setAvailable(value) {
    available = value;
    $('walkinSetup').hidden = value;
    submitButton.disabled = !value;
    checkButton.disabled = !value;
  }

  async function probe() {
    try {
      await call('/doctor/walkin/patients');
      setAvailable(true);
    } catch (error) {
      if (error.code === 'WALKIN_UNAVAILABLE' || error.status === 404 || error.status === 503) {
        setAvailable(false);
      }
    }
  }

  function setBusy(value, label) {
    busy = value;
    submitButton.disabled = value || !available;
    checkButton.disabled = value || !available;
    startButton.disabled = value;
    bookButton.disabled = value;
    form.setAttribute('aria-busy', value ? 'true' : 'false');
    stateLine.textContent = value ? label || 'Working…' : '';
  }

  function clearFieldErrors() {
    for (const input of [nameInput, dobInput, phoneInput]) {
      input.removeAttribute('aria-invalid');
      const error = $(`${input.id}Error`);
      if (error) setError(error, '');
    }
    showPageError('');
  }

  function validate() {
    clearFieldErrors();
    let valid = true;
    const name = nameInput.value.trim();
    if (!name) {
      setError($('walkinNameError'), 'Enter the patient name.');
      nameInput.setAttribute('aria-invalid', 'true');
      valid = false;
    }
    const dob = dobInput.value;
    if (dob) {
      if (dob > today) {
        setError($('walkinDobError'), 'Date of birth cannot be in the future.');
        dobInput.setAttribute('aria-invalid', 'true');
        valid = false;
      } else if (dob < '1900-01-01') {
        setError($('walkinDobError'), 'Check the date of birth.');
        dobInput.setAttribute('aria-invalid', 'true');
        valid = false;
      }
    }
    const phone = phoneInput.value.trim();
    if (phone && !/^[+()\-\s0-9]{6,40}$/.test(phone)) {
      setError($('walkinPhoneError'), 'Enter a valid phone number or leave it blank.');
      phoneInput.setAttribute('aria-invalid', 'true');
      valid = false;
    }
    if (!valid) {
      const firstInvalid = form.querySelector('[aria-invalid="true"]');
      if (firstInvalid) firstInvalid.focus();
    }
    return valid;
  }

  function details() {
    return {
      fullName: nameInput.value.trim(),
      dateOfBirth: dobInput.value || null,
      phone: phoneInput.value.trim() || null,
      preferredLanguage: languageInput.value.trim() || null,
    };
  }

  async function call(path, options = {}) {
    const response = await fetch('/api' + path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message || 'Request failed');
      error.status = response.status;
      error.code = body.code;
      throw error;
    }
    return body;
  }

  const formatDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const formatMoment = (value) => (value ? new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '');

  // ------------------------------------------------------------- matching ---
  function renderMatches(rows) {
    matches = rows;
    matchesBox.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'walkin-empty';
      empty.textContent = 'No matching record under your account. Register this patient as new.';
      matchesBox.append(empty);
      return;
    }
    const heading = document.createElement('p');
    heading.className = 'walkin-check__hint';
    heading.textContent = `${rows.length} possible ${rows.length === 1 ? 'match' : 'matches'}. Check the details before choosing one.`;
    matchesBox.append(heading);
    for (const row of rows) {
      const card = document.createElement('div');
      card.className = 'walkin-match';
      const copy = document.createElement('div');
      const name = document.createElement('p');
      name.className = 'walkin-match__name';
      name.textContent = row.fullName;
      const meta = document.createElement('p');
      meta.className = 'walkin-match__meta';
      const facts = [
        row.dateOfBirth ? `Born ${formatDate(row.dateOfBirth)}` : 'No date of birth recorded',
        row.phone || 'No phone recorded',
        row.preferredLanguage || null,
        row.lastSeen ? `Last visit ${formatMoment(row.lastSeen)}` : null,
      ].filter(Boolean);
      meta.textContent = facts.join(' · ');
      copy.append(name, meta);
      if (row.matchReason) {
        const reason = document.createElement('span');
        reason.className = 'walkin-match__reason';
        reason.textContent = row.matchReason;
        copy.append(reason);
      }
      const use = document.createElement('button');
      use.type = 'button';
      use.className = 'btn btn-outline';
      use.textContent = 'Use this record';
      use.setAttribute('aria-label', `Use the existing record for ${row.fullName}`);
      use.addEventListener('click', () => showDone({ ...row, existing: true }));
      card.append(copy, use);
      matchesBox.append(card);
    }
  }

  async function checkExisting() {
    const current = details();
    if (!available) return;
    if (!current.fullName && !current.phone && !current.dateOfBirth) {
      showPageError('Enter a name, phone number or date of birth before checking.');
      nameInput.focus();
      return;
    }
    setBusy(true, 'Checking your records…');
    showPageError('');
    try {
      const query = new URLSearchParams();
      if (current.fullName) query.set('name', current.fullName);
      if (current.phone) query.set('phone', current.phone);
      if (current.dateOfBirth) query.set('dateOfBirth', current.dateOfBirth);
      renderMatches(await call(`/doctor/walkin/matches?${query}`));
    } catch (error) {
      renderMatches([]);
      showPageError(error.status === 403 ? error.message : 'Existing patients could not be checked. You can still register this patient.');
    } finally {
      setBusy(false);
    }
  }

  // --------------------------------------------------------- registration ---
  async function register(event) {
    event.preventDefault();
    if (busy || chosen) return;
    if (!available) return;
    if (!validate()) return;
    setBusy(true, 'Registering…');
    try {
      const patient = await call('/doctor/walkin/patients', {
        method: 'POST',
        body: JSON.stringify({ ...details(), idempotencyKey: key }),
      });
      showDone({ ...patient, existing: Boolean(patient.existing) });
    } catch (error) {
      if (error.code === 'PATIENT_EXISTS') {
        // The database refuses a second record with the same name and date of
        // birth. Show it as a choice instead of forcing a duplicate or a merge.
        showPageError('A patient with this name and date of birth is already registered. Check the matches below.');
        await checkExisting();
        matchesBox.scrollIntoView({ block: 'nearest' });
      } else {
        if (error.code === 'WALKIN_UNAVAILABLE' || error.status === 404 || error.status === 503) {
          // Not a connection problem and not something the doctor can retry.
          setAvailable(false);
          showPageError('Walk-in registration is not enabled on this database yet. Your details are kept in this form; nothing was saved.');
        } else {
          showPageError(error.status === 400 || error.status === 403
            ? error.message
            : 'The patient could not be registered. Your details are still here; retry when the connection is back.');
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function showDone(patient) {
    chosen = patient;
    form.hidden = true;
    done.hidden = false;
    const facts = [
      patient.existing ? 'Existing record' : 'New record',
      patient.dateOfBirth ? `Born ${formatDate(patient.dateOfBirth)}` : null,
      patient.phone || null,
      patient.preferredLanguage || null,
    ].filter(Boolean);
    $('walkinDoneSummary').textContent = `${patient.fullName} — ${facts.join(' · ')}`;
    $('walkinDoneTitle').textContent = patient.existing ? 'Existing patient selected' : 'Patient registered';
    startButton.focus();
  }

  async function startConsultation() {
    if (!chosen || busy) return;
    setBusy(true, 'Opening the consultation…');
    setError(doneError, '');
    try {
      const consultation = await call(`/doctor/walkin/patients/${encodeURIComponent(chosen.id)}/consultation`, {
        method: 'POST',
        body: JSON.stringify({ reason: '' }),
      });
      // The appointment id comes from the server; the assessment page then loads
      // its context through the same authorised consultation RPC as any visit.
      window.location.assign(`/doctor.html?appointment=${encodeURIComponent(consultation.appointmentId)}#assessmentSection`);
    } catch (error) {
      setBusy(false);
      setError(doneError, error.status === 403 ? error.message
        : 'The consultation could not be started. The patient record is saved; try again.');
    }
  }

  async function loadSlots() {
    if (slotsLoaded || !slotSelect) return;
    slotsLoaded = true;
    try {
      const rows = await call('/doctor/availability');
      slotSelect.replaceChildren();
      const open = (rows || []).filter((row) => row.status === 'open');
      if (!open.length) {
        slotSelect.append(new Option('No open slots. Add availability first.', ''));
        bookButton.disabled = true;
        return;
      }
      slotSelect.append(new Option('Choose a slot…', ''));
      for (const row of open) {
        const option = new Option(`${formatMoment(row.scheduled_start)} – ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(row.scheduled_end))}`, row.id);
        slotSelect.append(option);
      }
    } catch {
      slotsLoaded = false;
      slotSelect.replaceChildren(new Option('Slots are unavailable right now.', ''));
    }
  }

  async function bookAppointment() {
    if (!chosen || busy) return;
    const slotId = slotSelect.value;
    if (!slotId) {
      setError(doneError, 'Choose an open slot first.');
      slotSelect.focus();
      return;
    }
    setBusy(true, 'Booking…');
    setError(doneError, '');
    try {
      const appointment = await call(`/doctor/walkin/patients/${encodeURIComponent(chosen.id)}/appointment`, {
        method: 'POST',
        body: JSON.stringify({ slotId, idempotencyKey: crypto.randomUUID(), reason: '' }),
      });
      setBusy(false);
      setError(doneError, '');
      $('walkinDoneSummary').textContent = `${chosen.fullName} — booked for ${formatMoment(appointment.startsAt)}.`;
      $('walkinDoneTitle').textContent = 'Appointment booked';
      slotSelect.disabled = true;
      bookButton.disabled = true;
      refreshWorkspace();
    } catch (error) {
      setBusy(false);
      setError(doneError, error.message || 'The appointment could not be booked.');
    }
  }

  // The schedule lives in the page behind the dialog; nudge it to reload rather
  // than reloading the whole workspace and losing the doctor's place.
  function refreshWorkspace() {
    const filters = $('filters');
    if (filters) filters.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }

  // ------------------------------------------------------------ open/close ---
  function reset() {
    form.reset();
    clearFieldErrors();
    setError(doneError, '');
    matchesBox.replaceChildren();
    matches = [];
    chosen = null;
    key = crypto.randomUUID();
    form.hidden = false;
    done.hidden = true;
    slotSelect.disabled = false;
    bookButton.disabled = false;
    setBusy(false);
    setAvailable(true);
  }

  function open() {
    reset();
    dialog.showModal();
    nameInput.focus();
    probe();
  }

  function close() {
    if (dialog.open) dialog.close();
    reset();
    openButton.focus();
  }

  openButton.addEventListener('click', open);
  $('walkinClose').addEventListener('click', close);
  $('walkinCancel').addEventListener('click', close);
  $('walkinFinish').addEventListener('click', () => { refreshWorkspace(); close(); });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  // Clicking the backdrop closes the dialog; clicking inside must not.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  form.addEventListener('submit', register);
  checkButton.addEventListener('click', checkExisting);
  startButton.addEventListener('click', startConsultation);
  bookButton.addEventListener('click', bookAppointment);

  const bookDetails = dialog.querySelector('.walkin-book');
  if (bookDetails) bookDetails.addEventListener('toggle', () => { if (bookDetails.open) loadSlots(); });

})();
