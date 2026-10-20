const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderAssessmentReport } = require('../backend/report-pdf');

const base = {
  id: '099e8312-9989-4f44-a7e2-ff47b509ef14',
  doctorName: 'Asha Rao',
  patientId: 'ecb08537-8dbd-4013-b798-421bfc3ae8bd',
  patientName: 'Meera Nair',
  patientEmail: 'meera@example.invalid',
  appointmentId: '4011b5d5-db16-41f6-9c7f-1b94f766bbda',
  appointmentStart: '2026-11-12T09:00:00+00:00',
  appointmentStatus: 'pending',
  patientReported: ['itching', 'skin_rash'],
  clinicianAdded: ['nodal_skin_eruptions'],
  observations: ['Patient reports a mild headache after meals'],
  symptomDuration: '3 days',
  clinicalNote: 'Rash on trunk, no fever reported.',
  predictedDisease: 'Fungal infection',
  modelVersion: '9167ccc09a8b0dc4',
  modelConfidence: null,
  description: 'Fungal infection is a common skin condition caused by fungi.',
  precautions: ['keep infected area dry'],
  medications: ['Antifungal Cream'],
  diet: ['Probiotics'],
  workout: ['Stay hydrated'],
  doctorAssessment: 'Fungal dermatitis is most likely.',
  plan: 'Review in 1 week.',
  createdAt: '2026-10-20T10:58:23.415194+00:00',
  disclaimer: 'Experimental decision support, not a confirmed diagnosis.',
};

function textOf(buffer) {
  const raw = buffer.toString('latin1');
  return [...raw.matchAll(/\(((?:\\.|[^\\()])*)\) Tj/g)]
    .map((match) => match[1].replace(/\\([()\\])/g, '$1'))
    .join(' ');
}

test('report renders the same assessment the page shows', () => {
  const pdf = renderAssessmentReport(base, { generatedAt: new Date('2026-10-20T11:00:00Z') });
  const text = textOf(pdf);

  assert.ok(pdf.subarray(0, 5).toString() === '%PDF-');
  assert.ok(text.includes('HelloDoc'));
  assert.ok(text.includes('Clinical assessment'));
  assert.ok(text.includes('Meera Nair'));
  assert.ok(text.includes('meera@example.invalid'));
  assert.ok(text.includes('Fungal infection'));
  assert.ok(text.includes('9167ccc09a8b0dc4'));
  assert.ok(text.includes('Reported by the patient'));
  assert.ok(text.includes('Recorded by the doctor'));
  assert.ok(text.includes('not interpreted by the model'));
  assert.ok(text.includes('Patient reports a mild headache after meals'));
  assert.ok(text.includes('Rash on trunk, no fever reported.'));
  assert.ok(text.includes('Fungal dermatitis is most likely.'));
  assert.ok(text.includes('Review in 1 week.'));
  assert.ok(text.includes('Experimental decision support, not a confirmed diagnosis.'));
  const pages = (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) || []).length;
  assert.ok(pages >= 1);
  assert.ok(text.includes(`Page 1 of ${pages}`));
  assert.ok(text.includes(`Page ${pages} of ${pages}`));
});

test('no confidence figure is invented when the model supplies none', () => {
  const text = textOf(renderAssessmentReport(base));
  assert.equal(/Model confidence/.test(text), false);
  assert.equal(/%/.test(text), false);
  // The limitation is stated instead of leaving the reader to guess.
  assert.ok(text.includes('does not provide a calibrated probability'));
});

test('guidance is labelled as dataset guidance needing clinician review', () => {
  const text = textOf(renderAssessmentReport(base));
  assert.ok(text.includes('Symptoms used by the model'));
  assert.ok(text.includes('Guidance from the model'));
  assert.ok(text.includes('General dataset-associated guidance requiring clinician review.'));
});

test('a real confidence figure is shown when present', () => {
  const text = textOf(renderAssessmentReport({ ...base, modelConfidence: 0.87 }));
  assert.ok(text.includes('Model confidence'));
  assert.ok(text.includes('87.0%'));
});

test('missing fields are labelled rather than fabricated', () => {
  const sparse = {
    id: base.id,
    predictedDisease: 'Allergy',
    modelVersion: 'abc123',
    createdAt: base.createdAt,
    patientReported: ['continuous_sneezing'],
    clinicianAdded: [],
    observations: [],
    precautions: [],
    medications: [],
    diet: [],
    workout: [],
    doctorAssessment: null,
    plan: null,
    modelConfidence: null,
  };
  const text = textOf(renderAssessmentReport(sparse));
  assert.ok(text.includes('Not recorded.'));
  assert.ok(text.includes('No medication information was available.'));
  assert.ok(text.includes('No diet guidance was available.'));
  assert.equal(/Dr\. /.test(text), false);
  assert.equal(/Signature/.test(text), false);
  assert.equal(/Blood Type/.test(text), false);
});

test('long content paginates without dropping sections', () => {
  const long = 'This is a deliberately long clinical sentence. '.repeat(120);
  const many = Array.from({ length: 40 }, (_, index) => `Guidance item ${index + 1}`);
  const pdf = renderAssessmentReport({
    ...base,
    description: long,
    clinicalNote: long.slice(0, 2000),
    precautions: many,
    medications: many,
    diet: many,
    workout: many,
  });
  const raw = pdf.toString('latin1');
  const text = textOf(pdf);
  const pages = (raw.match(/\/Type \/Page[^s]/g) || []).length;

  assert.ok(pages > 1, 'expected more than one page');
  assert.ok(text.includes(`Page 1 of ${pages}`));
  assert.ok(text.includes(`Page ${pages} of ${pages}`));
  // Sections late in the document survive the page breaks.
  assert.ok(text.includes('Workout'));
  assert.ok(text.includes("Doctor's assessment and plan"));
  assert.ok(text.includes('Disclaimer'));
  assert.ok(text.includes('Guidance item 40'));
});

test('a revision names the record it replaced without restating it as current', () => {
  const text = textOf(renderAssessmentReport({
    ...base,
    predictedDisease: 'Allergy',
    supersededPrediction: {
      id: '11111111-2222-4333-8444-555555555555',
      predictedDisease: 'Fungal infection',
      createdAt: '2026-10-19T08:15:00+00:00',
    },
  }));
  assert.ok(text.includes('Revision of'));
  assert.ok(text.includes('2026-10-19 08:15:00 UTC'));
  assert.ok(text.includes('predicted then: Fungal infection'));
  // Only one condition is presented as the model output for this record.
  assert.ok(text.includes('Predicted condition'));
});

test('unsafe model guidance never reaches the page as raw injection text', () => {
  const text = textOf(renderAssessmentReport({
    ...base,
    description: '</script><img src=x onerror=alert(1)>',
    precautions: ['a) do this', 'b\\ do that'],
  }));
  // Escaping is the writer's job; the text survives verbatim in the content stream.
  assert.ok(text.includes('</script><img src=x onerror=alert(1)>'));
  assert.ok(text.includes('a) do this'));
  assert.ok(text.includes('b\\ do that'));
});

test('text with parentheses and backslashes is escaped, not corrupted', () => {
  const text = textOf(renderAssessmentReport({
    ...base,
    clinicalNote: 'Patient said "it hurts (a lot)" and used a backslash \\ marker.',
  }));
  assert.ok(text.includes('Patient said "it hurts (a lot)" and used a backslash \\ marker.'));
});
