const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the home page does not advertise the withdrawn public symptom checker', () => {
  const index = read('index.html');
  assert.equal(/quick machine-learning symptom check/i.test(index), false);
  assert.equal(index.includes('href="/predict"'), false);
});

test('the story page describes the Supabase and doctor assessment architecture, not the retired stack', () => {
  const story = read('story.html');
  for (const retired of ['MySQL', 'mysql2', 'bcrypt', 'JSON Web Token', 'Flask /predict', 'Results page']) {
    assert.equal(story.includes(retired), false, `story still claims: ${retired}`);
  }
  assert.ok(story.includes('Supabase Auth'));
  assert.ok(story.includes('/api/doctor/assessments'));
  assert.ok(story.includes('Private model service'));
  // The public endpoint is described as closed rather than as a working form.
  assert.match(story, /public <code>\/predict<\/code> route returns 403/);
});

test('help copy does not promise features the application does not implement', () => {
  const help = read('help.html');
  for (const claim of [
    'You can reschedule',
    'You can book for a family member',
    'You can rate and review doctors',
    'permanently deleted within 30 days',
    'proof of identity',
    'medical records management',
  ]) {
    assert.equal(help.includes(claim), false, `help still claims: ${claim}`);
  }
  assert.ok(help.includes('No. Cancel the booking'));
  assert.ok(help.includes('Ratings and reviews are not implemented.'));
  assert.ok(help.includes('The public symptom checker has been withdrawn.'));
});

test('the patient portal labels the sections it cannot fill', () => {
  const patient = read('patient.html');
  const script = read('Scripts/patient.js');
  assert.ok(patient.includes('Task assignment is not built yet'));
  assert.ok(patient.includes('not shown in this prototype'));
  assert.ok(script.includes('No follow up tasks are available in this prototype.'));
  // Suspension is surfaced by code, not mistaken for the wrong portal.
  assert.ok(script.includes("body.code === 'ACCOUNT_SUSPENDED'"));
  assert.ok(read('Scripts/doctor.js').includes("error.code === 'ACCOUNT_SUSPENDED'"));
});

test('model output, dataset guidance and the doctor assessment stay distinct', () => {
  const page = read('prediction.html');
  assert.ok(page.includes('Guidance from the dataset'));
  assert.equal(page.includes('Guidance from the model'), false);
  assert.ok(page.includes('General dataset-associated guidance requiring clinician review.'));
  assert.ok(page.includes('not a confirmed diagnosis'));
  assert.ok(page.includes('This section is yours. It is stored separately from the model output'));
  // No confidence is rendered unless the model supplied a finite number.
  const script = read('Scripts/prediction.js');
  assert.ok(script.includes("typeof confidence === 'number' && Number.isFinite(confidence)"));
  assert.equal(script.includes('confidence * 100'), true);
});
