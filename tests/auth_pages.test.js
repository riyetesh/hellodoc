const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const PAGES = ['index.html', 'login.html', 'signup.html', 'recover.html', 'help.html', 'story.html', 'appointments.html', 'dashboard.html', 'patient.html', 'demo.html'];

test('the navbar offers exactly Login and Sign Up, with no role-specific entry points', () => {
  for (const page of PAGES) {
    const html = read(page);
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    assert.equal((nav.match(/>Login</g) || []).length, 1, `${page}: one Login button`);
    assert.equal((nav.match(/>Sign Up</g) || []).length, 1, `${page}: one Sign Up button`);
    assert.match(html, /href="login\.html"/, `${page}: Login links to login.html`);
    assert.match(html, /href="signup\.html"/, `${page}: Sign Up links to signup.html`);
    for (const banned of ['id="doctorLoginBtn"', 'login=patient', 'login=doctor', 'Log in as a patient', 'Log in as a doctor']) {
      assert.ok(!html.includes(banned), `${page}: no duplicate auth entry point ${banned}`);
    }
  }
});

test('login page defaults to Patient and offers Patient, Doctor and Admin tabs', () => {
  const html = read('login.html');
  const tabs = [...html.matchAll(/class="auth-tab"[^>]*data-role="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ['patient', 'doctor', 'admin']);
  const patient = html.match(/<button[^>]*data-role="patient"[^>]*>/)[0];
  assert.match(patient, /aria-selected="true"/);
  for (const role of ['doctor', 'admin']) {
    const tab = html.match(new RegExp(`<button[^>]*data-role="${role}"[^>]*>`))[0];
    assert.match(tab, /aria-selected="false"/);
  }
  // One form, not three: switching modes must not navigate.
  assert.equal((html.match(/id="loginForm"/g) || []).length, 1);
  assert.match(html, /id="togglePassword"/);
});

test('login script sends the chosen portal but never trusts it', () => {
  const script = read('Scripts/login-page.js');
  assert.match(script, /portal: role/);
  assert.match(script, /WRONG_PORTAL/);
  assert.match(script, /data\.redirectTo \|\| DESTINATIONS\[role\]/);
  // The browser never writes a role, token or Supabase key of its own.
  assert.ok(!/localStorage|sessionStorage/.test(script));
  assert.ok(!/supabase/i.test(script));
});

test('sign up offers Patient and Doctor only, with doctor fields revealed by the tab', () => {
  const html = read('signup.html');
  const tabs = [...html.matchAll(/class="auth-tab"[^>]*data-role="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(tabs, ['patient', 'doctor']);
  assert.ok(!/admin/i.test(html.match(/class="auth-tabs"[\s\S]*?<\/div>/)[0]), 'no public admin sign up');
  assert.match(html, /id="doctorFields" hidden/);
  for (const field of ['firstName', 'lastName', 'email', 'password', 'confirmPassword', 'phone']) {
    assert.ok(html.includes(`id="${field}"`), `patient field ${field}`);
  }
  for (const field of ['specialty', 'licenseNumber', 'qualifications', 'institution', 'yearsExperience']) {
    assert.ok(html.includes(`id="${field}"`), `doctor verification field ${field}`);
  }
  assert.match(read('Scripts/signup.js'), /\/api\/auth\/doctor-signup/);
  assert.match(read('Scripts/signup.js'), /\/api\/auth\/signup/);
});

test('retired applicant pages redirect instead of offering a second registration form', () => {
  for (const [page, target] of [['doctor-apply.html', 'signup.html?role=doctor'], ['doctor-portal.html', 'doctor.html']]) {
    const html = read(page);
    assert.match(html, new RegExp(`window\\.location\\.replace\\('${target.replace(/[.?]/g, '\\$&')}'\\)`), page);
    assert.ok(!/id="doctorApplicationForm"/.test(html), `${page}: no duplicate registration form`);
  }
});

test('password recovery offers one request form, a confirmation field and a visibility toggle', () => {
  const html = read('recover.html');
  assert.match(html, /id="request"/);
  assert.match(html, /id="complete" class="auth-form" method="post" novalidate hidden/);
  assert.match(html, /id="confirm-password"/);
  assert.match(html, /id="togglePassword"/);
  assert.match(html, /role="status" aria-live="polite"/);
  const script = read('Scripts/recover.js');
  assert.match(script, /\/api\/auth\/recover\/complete/);
  assert.match(script, /Both passwords must match/);
  // The token is consumed from the hash and removed from the address bar.
  assert.match(script, /history\.replaceState/);
});

test('the doctor dashboard renders verification state before clinical tools', () => {
  const html = read('doctor.html');
  assert.match(html, /id="verificationStatus"/);
  assert.match(html, /id="resubmitForm" hidden/);
  const script = read('Scripts/doctor.js');
  assert.match(script, /\/overview/);
  assert.match(script, /application\/resubmit/);
  assert.match(script, /clinicalPanels/);
});
