const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Every page in the patient area shares the one website navbar.
const PATIENT_PAGES = ['patient.html', 'account.html', 'records.html', 'walkin.html'];

test('the patient sidebar is gone from every patient page', () => {
  for (const page of PATIENT_PAGES) {
    const html = read(page);
    assert.equal(html.includes('patient-rail'), false, `${page}: sidebar markup left behind`);
    assert.equal(html.includes('patient-workspace'), false, `${page}: sidebar layout wrapper left behind`);
    assert.equal(html.includes('patientSignOut'), false, `${page}: duplicate sign-out control left behind`);
    assert.equal(html.includes('data-patient-nav'), false, `${page}: duplicate patient navigation left behind`);
  }
  const css = read('Styles/patient.css');
  assert.equal(css.includes('.patient-rail'), false, 'rail styles were not removed');
  assert.equal(css.includes('.patient-workspace'), false, 'rail layout styles were not removed');
});

test('patient destinations are defined once and rendered into the shared navbar', () => {
  const nav = read('Scripts/nav.js');
  assert.match(nav, /const PATIENT_LINKS = \[/);
  const order = [...nav.matchAll(/\{ href: "(patient|dashboard|appointments|records|walkin)\.html"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['patient', 'dashboard', 'appointments', 'records', 'walkin']);
  assert.match(nav, /function initPatientNav\(\)/);
  assert.match(nav, /classList\.contains\("patient-page"\)/);
  assert.match(nav, /nav-badge/);
  // The shell no longer owns navigation or sign-out.
  const shell = read('Scripts/patient-shell.js');
  assert.equal(shell.includes('patient-rail'), false);
  assert.equal(shell.includes('/api/auth/logout'), false);
});

test('account settings and sign-out live in a keyboard-accessible account menu', () => {
  const nav = read('Scripts/nav.js');
  assert.match(nav, /account-menu__panel/);
  assert.match(nav, /account\.html/);
  assert.match(nav, /Sign out/);
  assert.match(nav, /\/api\/auth\/logout/);
  assert.match(nav, /aria-haspopup/);
  assert.match(nav, /aria-expanded/);
  assert.match(nav, /aria-controls/);
  assert.match(nav, /event\.key === "Escape"/);
  assert.match(nav, /window\.location\.replace\("\/index\.html"\)/);
  // The account page uses the one shared implementation.
  assert.equal(read('Scripts/account.js').includes('HelloDocAuth.signOut'), true);
  assert.equal(read('Styles/app.css').includes('.account-menu__panel'), true);
});

test('the patient dashboard keeps its live data contract and links every destination', () => {
  const html = read('patient.html');
  for (const id of ['greeting', 'portalMessage', 'onboarding', 'summarySection', 'nextVisitSummary',
                    'upcomingCount', 'completedCount', 'appointmentsList', 'appointmentsUnavailable',
                    'appointmentsEmpty', 'retryAppointments', 'followUpPanel', 'latestRecord',
                    'cancelDialog', 'patientMain']) {
    assert.ok(html.includes(`id="${id}"`), `dashboard lost #${id}`);
  }
  assert.match(html, /<main class="container patient-main" id="patientMain">/);
  for (const href of ['dashboard.html', 'appointments.html', 'records.html', 'walkin.html']) {
    assert.ok(html.includes(`href="${href}"`), `dashboard does not link to ${href}`);
  }
  assert.ok(html.includes('/Scripts/nav.js'));
  assert.ok(html.includes('/Scripts/patient-shell.js'));
  // Live data still comes from the patient API, never baked into the page.
  assert.ok(read('Scripts/patient.js').includes("'/api/patient/overview'"));
  // Emergency access stays part of the shared navbar script.
  assert.ok(read('Scripts/nav.js').includes('hdEmergencyRoot'));
});
