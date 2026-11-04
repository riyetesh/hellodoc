(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const dock = $('consultationDock');
  const startButton = $('consultationTimerStart');
  const panel = $('consultationModal');
  const endButton = $('consultationEnd');
  const finishClose = $('consultationFinishClose');
  const elapsedDisplay = $('consultationTimerDisplay');
  const startDisplay = $('consultationStartTime');
  const endDisplay = $('consultationEndTime');
  const statusDisplay = $('consultationSessionStatus');
  const summary = $('consultationEndedSummary');
  const activeView = $('consultationActiveView');
  let startedAt = null;
  let endedAt = null;
  let interval = null;
  let busy = false;

  const formatMoment = (date) => new Intl.DateTimeFormat(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).format(date);

  const patientName = () => {
    const context = window.HelloDocAssessment && window.HelloDocAssessment.getConsultationContext
      ? window.HelloDocAssessment.getConsultationContext() : null;
    return context && context.patientName && !/loading|select a patient/i.test(context.patientName)
      ? context.patientName : 'Selected patient';
  };

  const showMessage = (value) => {
    const node = $('message');
    if (node) { node.textContent = value || ''; node.hidden = !value; }
  };

  const paintElapsed = () => {
    if (!startedAt) { elapsedDisplay.textContent = '00:00:00'; return; }
    const seconds = Math.max(0, Math.floor(((endedAt || new Date()).getTime() - startedAt.getTime()) / 1000));
    elapsedDisplay.textContent = [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60]
      .map((v) => String(v).padStart(2, '0')).join(':');
  };

  const openConsultation = () => {
    if (startedAt) return;
    const context = window.HelloDocAssessment && window.HelloDocAssessment.getConsultationContext
      ? window.HelloDocAssessment.getConsultationContext() : null;
    if (!context || !context.appointmentId || !context.patientSelected) {
      showMessage('Open a patient appointment before starting a consultation.');
      return;
    }
    startedAt = new Date();
    endedAt = null;
    $('consultationModalPatient').textContent = patientName();
    $('consultationAvatar').textContent = patientName().split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase();
    dock.hidden = true;
    startDisplay.textContent = formatMoment(startedAt);
    endDisplay.textContent = 'In progress';
    statusDisplay.textContent = 'In progress';
    summary.hidden = true;
    summary.textContent = '';
    activeView.hidden = false;
    endButton.hidden = false;
    endButton.disabled = false;
    endButton.textContent = 'End consultation & save report';
    finishClose.hidden = true;
    $('consultationModalClose').hidden = true;
    $('consultationCancel').hidden = true;
    $('consultationModalTitle').textContent = 'Consultation in progress';
    startButton.disabled = true;
    startButton.textContent = 'Consultation in progress';
    paintElapsed();
    if (interval) window.clearInterval(interval);
    interval = window.setInterval(paintElapsed, 1000);
    panel.dataset.open = 'true';
  };

  const endConsultation = async () => {
    if (busy || !startedAt) return;
    const context = window.HelloDocAssessment && window.HelloDocAssessment.getConsultationContext
      ? window.HelloDocAssessment.getConsultationContext() : null;
    if (!context || !context.appointmentId) {
      statusDisplay.textContent = 'Appointment missing';
      return;
    }
    if (!endedAt) {
      endedAt = new Date();
      if (interval) window.clearInterval(interval);
      interval = null;
      paintElapsed();
      endDisplay.textContent = formatMoment(endedAt);
    }
    busy = true;
    endButton.disabled = true;
    endButton.textContent = 'Saving report…';
    statusDisplay.textContent = 'Saving report…';
    try {
      let saved = await window.HelloDocAssessment.saveAssessment({ redirect: false });
      let latest = window.HelloDocAssessment.getConsultationContext();
      // The first save attempt may run the model. Retry after it becomes ready.
      if (!saved && latest.hasModelPreview && latest.hasSymptoms) {
        saved = await window.HelloDocAssessment.saveAssessment({ redirect: false });
      }
      if (!saved && latest.modelOutage) {
        saved = await window.HelloDocAssessment.saveWithoutModel({ redirect: false });
      }
      if (!saved || !saved.id) {
        statusDisplay.textContent = 'Report needs attention';
        endButton.disabled = false;
        endButton.textContent = 'Retry save & end';
        showMessage('The session timer has stopped, but the report was not saved. Resolve the report error and retry saving.');
        return;
      }

      statusDisplay.textContent = 'Report saved';

      const updateStatus = async (status) => {
        const demoDoctorId = new URLSearchParams(window.location.search).get('demoDoctor');
        const headers = { 'Content-Type': 'application/json' };
        if (demoDoctorId) headers['X-HelloDoc-Demo-Doctor'] = demoDoctorId;
        const response = await fetch('/api/doctor/appointments/' + encodeURIComponent(context.appointmentId) + '/status', {
          method: 'PATCH', credentials: 'same-origin',
          headers,
          body: JSON.stringify({ status: status })
        });
        if (!response.ok) {
          const problem = await response.json().catch(() => ({}));
          throw new Error(problem.message || 'The report was saved, but the appointment status could not be updated.');
        }
      };
      if (context.appointmentStatus === 'pending') await updateStatus('confirmed');
      if (context.appointmentStatus !== 'completed') await updateStatus('completed');

      summary.textContent = 'Started: ' + formatMoment(startedAt) + ' · Ended: ' + formatMoment(endedAt) + ' · Duration: ' + elapsedDisplay.textContent + '. Assessment report saved for clinician review.';
      summary.hidden = false;
      activeView.hidden = true;
      endButton.hidden = true;
      finishClose.hidden = false;
      $('consultationModalClose').hidden = true;
      $('consultationModalTitle').textContent = 'Consultation completed';
      startButton.disabled = false;
      startButton.textContent = 'Consultation completed';
      showMessage('Consultation ended. Report saved and appointment marked completed.');
      window.dispatchEvent(new CustomEvent('hellodoc:consultation-ended', {
        detail: { appointmentId: context.appointmentId, assessmentId: saved.id }
      }));
    } catch (error) {
      statusDisplay.textContent = 'Could not finish';
      endButton.disabled = false;
      endButton.textContent = 'Retry save & end';
      showMessage(error.message || 'Could not end the consultation.');
    } finally {
      busy = false;
    }
  };

  const closeModal = () => {
    const wasEnded = Boolean(endedAt);
    if (interval) window.clearInterval(interval);
    interval = null;
    panel.dataset.open = 'false';
    if (endedAt) {
      startedAt = null;
      endedAt = null;
      startButton.disabled = false;
      startButton.textContent = 'Start consultation';
      elapsedDisplay.textContent = '00:00:00';
      startDisplay.textContent = 'Not started';
      endDisplay.textContent = 'In progress';
      statusDisplay.textContent = 'Ready to start';
    }
    if (wasEnded) window.location.reload();
  };

  startButton && startButton.addEventListener('click', openConsultation);
  endButton && endButton.addEventListener('click', endConsultation);
  finishClose && finishClose.addEventListener('click', closeModal);
  $('consultationModalClose') && $('consultationModalClose').addEventListener('click', closeModal);
  $('consultationCancel') && $('consultationCancel').addEventListener('click', closeModal);


  const patientSelect = $('assessmentPatient');
  const syncDock = () => {
    const step = document.querySelector('.consultation-wizard__step.is-active');
    dock.hidden = Boolean(startedAt) || !patientSelect || !patientSelect.value;
    $('dockPatientName').textContent = patientName();
  };
  patientSelect && patientSelect.addEventListener('change', syncDock);
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-wizard-go]')) window.setTimeout(syncDock, 0);
  });
  if (patientSelect && window.MutationObserver) {
    new MutationObserver(syncDock).observe(patientSelect, { childList: true, subtree: true });
  }
  window.HelloDocConsultation = { isActive: () => Boolean(startedAt) };
  window.addEventListener('hellodoc:consultation-start', openConsultation);
  const minimize = $('consultationMinimize');
  minimize.addEventListener('click', () => {
    const compact = panel.classList.toggle('is-compact');
    minimize.setAttribute('aria-expanded', String(!compact));
    minimize.textContent = compact ? 'Expand' : 'Minimize';
  });
  window.addEventListener('beforeunload', event => {
    if (startedAt && !endedAt) { event.preventDefault(); event.returnValue = ''; }
  });
  syncDock();
})();
