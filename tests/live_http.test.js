const test = require('node:test');
const assert = require('node:assert/strict');

// Live checks are opt-in. They are skipped by default so `npm test` works
// offline and never touches a real deployment. Point TEST_ORIGIN at a local or
// disposable server, and set the Data API pair only for a disposable project.
const origin = process.env.TEST_ORIGIN;
const publicOrigin = process.env.TEST_PUBLIC_ORIGIN || origin;
const noServer = origin ? false : 'set TEST_ORIGIN to a disposable running server';
const dataUrl = (process.env.TEST_SUPABASE_URL || '').replace(/\/$/, '');
const dataKey = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const noDataApi = dataUrl && dataKey
  ? false
  : 'set TEST_SUPABASE_URL and TEST_SUPABASE_PUBLISHABLE_KEY for a disposable project';

test('live public pages and persisted directory are served', { skip: noServer }, async () => {
  for (const route of ['/', '/signup.html', '/admin', '/Styles/admin.css', '/Scripts/admin.js']) {
    assert.equal((await fetch(origin + route)).status, 200, route);
  }
  const response = await fetch(origin + '/api/doctors');
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(await response.json()));
});

test('live admin API and private records fail closed without a session', { skip: noServer }, async () => {
  for (const route of [
    '/api/admin/patients',
    '/api/admin/doctors',
    '/api/admin/audit',
    '/api/admin/overview?since=2026-10-01&until=2026-10-17',
    '/api/patient/overview',
  ]) {
    assert.equal((await fetch(origin + route)).status, 401, route);
  }
});

test('live mutations reject foreign origins and elevated signup roles', { skip: noServer }, async () => {
  const post = (path, body, header) =>
    fetch(origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: header },
      body: JSON.stringify(body),
    });
  assert.equal((await post('/api/auth/login', {}, 'https://attacker.invalid')).status, 403);
  assert.equal((await post('/api/auth/signup', { role: 'admin' }, publicOrigin)).status, 403);
  assert.equal((await post('/api/admin/actions', {}, publicOrigin)).status, 401);
});

test('Supabase Data API grants no anonymous private access or bootstrap', { skip: noDataApi }, async () => {
  const url = `${dataUrl}/rest/v1`;
  const headers = { apikey: dataKey, 'Content-Type': 'application/json' };
  for (const table of ['profiles', 'patient_profiles', 'appointments', 'doctor_applications', 'admin_audit_logs']) {
    assert.ok([401, 403].includes((await fetch(`${url}/${table}?select=*`, { headers })).status), table);
  }
  for (const [rpc, body] of [
    ['admin_list', { p_kind: 'patients' }],
    ['bootstrap_first_admin', { p_user: '11111111-1111-4111-8111-111111111111' }],
  ]) {
    assert.ok(
      [401, 403].includes(
        (await fetch(`${url}/rpc/${rpc}`, { method: 'POST', headers, body: JSON.stringify(body) })).status
      ),
      rpc
    );
  }
});
