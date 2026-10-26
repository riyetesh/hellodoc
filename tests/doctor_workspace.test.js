const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the schedule exposes search, a date range and the server-provided visit list', () => {
  const html = read('doctor.html');
  const script = read('Scripts/doctor.js');
  assert.ok(html.includes('id="visitSearch"'));
  assert.ok(html.includes('id="refreshSchedule"'));
  assert.ok(html.includes('id="appointments"'));
  const ranges = [...html.matchAll(/data-range="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ranges, ['all', 'today', 'upcoming', 'past']);
  // Day groups and rows are built from the authorised dashboard payload.
  assert.ok(script.includes("request('/dashboard')"));
  assert.ok(script.includes("'dw-day'"));
  assert.ok(script.includes('matchesFilters'));
  // A row only offers a consultation when the status allows it.
  assert.ok(script.includes("['cancelled', 'no_show'].includes(appointment.status)"));
});

test('the patient record is opened by an id the server resolved, not one typed by the browser', () => {
  const script = read('Scripts/doctor.js');
  const routes = read('backend/supabase-routes.js');
  assert.ok(script.includes('appointment.patientId'));
  assert.ok(script.includes('/patients/${encodeURIComponent(appointment.patientId)}/context'));
  // The context route authorises the patient through the doctor's own lists.
  assert.ok(routes.includes("router.get('/doctor/patients/:id/context'"));
  assert.ok(routes.includes('assigned_patient_names'));
  assert.ok(routes.includes('doctor_clinic_patients'));
  assert.match(routes, /That patient is not one of your records/);
  // The dashboard now names the patient id so the drawer has something to open.
  assert.match(routes, /patientId:patientOf\(a\)/);
});

test('the consultation is a six-stage stepper whose panels exist', () => {
  const html = read('doctor.html');
  const stages = [...html.matchAll(/data-step="(\d)" aria-controls="assessmentStep(\d)"/g)];
  assert.equal(stages.length, 6);
  for (let index = 0; index < stages.length; index += 1) {
    const number = String(index + 1);
    assert.equal(stages[index][1], number);
    assert.equal(stages[index][2], number);
    assert.ok(html.includes(`id="assessmentStep${number}"`));
  }
  for (const title of ['Visit context', 'Reported by the patient', 'Your findings', 'Your assessment', 'Plan and follow-up', 'Review']) {
    assert.ok(html.includes(title), `missing stage: ${title}`);
  }
  // Stages are navigation, not a decorative progress bar.
  assert.ok(html.includes('id="assessmentSteps"'));
  assert.ok(html.includes('id="stageStatus"'));
  assert.ok(read('Scripts/assessment.js').includes("aria-current', 'step'"));
});

test('patient-reported symptoms and clinician findings stay in separate stages and lists', () => {
  const html = read('doctor.html');
  const script = read('Scripts/assessment.js');
  assert.ok(html.indexOf('id="reportedPicker"') > html.indexOf('id="assessmentStep2"'));
  assert.ok(html.indexOf('id="reportedPicker"') < html.indexOf('id="assessmentStep3"'));
  assert.ok(html.indexOf('id="clinicianPicker"') > html.indexOf('id="assessmentStep3"'));
  assert.ok(script.includes("state.reported = state.reported.filter"));
  assert.ok(script.includes("patientReported: state.reported"));
  assert.ok(script.includes("clinicianAdded: state.clinician"));
  // Free-text observations are stored, never presented as model input.
  assert.ok(script.includes('observations: state.observations'));
});

test('note scaffolds insert headings only and never clinical text', () => {
  const html = read('doctor.html');
  const templates = [...html.matchAll(/data-template="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(templates, [
    'History of presenting complaint',
    'Examination findings',
    'Follow-up plan',
  ]);
  for (const template of templates) {
    assert.match(template, /^(History of presenting complaint|Examination findings|Follow-up plan)$/);
  }
  const script = read('Scripts/assessment.js');
  // The scaffold writes a heading and a blank line, nothing else.
  assert.ok(script.includes("`${heading}:\\n\\n`"));
});

test('the draft state never claims a save before the server confirms it', () => {
  const script = read('Scripts/assessment.js');
  assert.ok(script.includes("setDraftState('Saving assessment…', 'saving')"));
  assert.ok(script.includes("setDraftState('Save failed — your text is kept', 'error')"));
  assert.ok(script.includes("setDraftState('Saved', 'saved')"));
  // Local autosave is labelled as such and is separate from the server save.
  assert.ok(script.includes('draft kept ${clock()}'));
  // The server is only asked to persist through the assessment routes.
  assert.ok(script.includes('/api/doctor/assessments'));
  assert.ok(script.includes('if (state.saving) return;'));
});

test('the report preview is built from the saved record and links to empty sections', () => {
  const html = read('prediction.html');
  const script = read('Scripts/prediction.js');
  assert.ok(html.includes('id="reportChecks"'));
  assert.ok(html.includes('id="reportPreview"'));
  assert.ok(html.includes('id="reportState"'));
  assert.ok(script.includes('renderReport'));
  assert.ok(script.includes("link.href = '#doctorPanel'"));
  assert.ok(script.includes('assessment.doctorAssessment || \'Not recorded\''));
  // The PDF is still produced by the existing server route, not a new mock one.
  assert.ok(script.includes('/report.pdf'));
  assert.match(script, /unsaved changes[\s\S]*save them, then generate the report/i);
});

test('walk-in matching runs while typing but only against the doctor endpoint', () => {
  const script = read('Scripts/walkin.js');
  assert.ok(script.includes('scheduleCheck'));
  assert.ok(script.includes('checkExisting({ quiet: true })'));
  assert.ok(script.includes('checkToken'));
  assert.ok(script.includes('/doctor/walkin/matches?'));
  // No patient details are kept in browser storage.
  for (const storage of ['localStorage', 'sessionStorage']) {
    assert.equal(script.includes(`${storage}.setItem`), false, `walk-in writes ${storage}`);
  }
});
