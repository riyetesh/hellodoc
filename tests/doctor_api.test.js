const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mysqlPath = require.resolve('../backend/node_modules/mysql2');

let server, origin;
let mode = 'approved';
let calls = [];
const db = {
  query(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    calls.push({ sql, params });
    if (sql.includes('FROM users WHERE id')) return callback(null, [{ id: 11, role: mode === 'patient' ? 'patient' : 'doctor', firstName: 'Clinician' }]);
    if (sql.includes('verification_status FROM doctor_profiles')) return callback(null, [{ verification_status: mode === 'pending' ? 'pending' : 'approved' }]);
    if (sql.includes('FROM appointments a') && sql.includes('WHERE a.id = ? AND a.doctor_id = ?')) return callback(null, params[0] === '7' && params[1] === 11 ? [{ id: 7, patientId: 21, doctorId: 11, status: 'upcoming' }] : []);
    if (sql.includes('FROM clinical_assessments WHERE appointment_id') && sql.includes('published_at IS NOT NULL')) return callback(null, []);
    if (sql.startsWith('UPDATE appointments SET status')) return callback(null, { affectedRows: 1 });
    if (sql.startsWith('INSERT INTO notifications')) return callback(null, { insertId: 1 });
    return callback(null, []);
  },
  getConnection(callback) { callback(null, { query: db.query.bind(db), beginTransaction: (done) => done(), commit: (done) => done(), rollback: (done) => done(), release: () => {} }); },
};
function fetchJson(path, options = {}) {
  return fetch(origin + path, { headers: { Cookie: 'connect.sid=test', 'Content-Type': 'application/json', Origin: origin }, ...options });
}
before(async () => {
  require.cache[mysqlPath] = { id: mysqlPath, filename: mysqlPath, loaded: true, exports: { createPool: () => db } };
  const sessionPath = require.resolve('../backend/node_modules/express-session');
  require.cache[sessionPath] = { id: sessionPath, filename: sessionPath, loaded: true, exports: () => (req, res, next) => { req.session = { userId: 11 }; next(); } };
  const app = require('../backend/server.js');
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve));  });

test('doctor workspace requires approved doctor identity', async () => {
  for (const [role, code] of [['patient', 403], ['pending', 403], ['approved', 200]]) {
    mode = role;
    const response = await fetchJson('/api/doctor/dashboard');
    assert.equal(response.status, code);
  }
});
test('symptom tool is doctor-only and rejects invalid selections', async () => {
  mode = 'patient';
  assert.equal((await fetchJson('/api/doctor/symptoms')).status, 403);
  assert.equal((await fetchJson('/api/doctor/predict', {method:'POST',body:JSON.stringify({symptoms:['itching']})})).status, 403);
  mode = 'pending';
  assert.equal((await fetchJson('/api/doctor/symptoms')).status, 403);
  mode = 'approved';
  assert.equal((await fetchJson('/api/doctor/predict', {method:'POST',body:JSON.stringify({symptoms:[]})})).status, 400);
});
test('doctor cannot open a visit owned by another clinician', async () => {
  mode = 'approved'; calls = [];
  const response = await fetchJson('/api/doctor/appointments/8');
  assert.equal(response.status, 404);
  assert.equal(calls.filter((call) => call.sql.includes('symptom_submissions')).length, 0);
});
test('consultation cannot complete without a published assessment', async () => {
  mode = 'approved';
  const response = await fetchJson('/api/doctor/appointments/7/status', { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) });
  assert.equal(response.status, 409);
});
test('confirmed appointment writes a patient notification scoped to assigned visit', async () => {
  mode = 'approved'; calls = [];
  const response = await fetchJson('/api/doctor/appointments/7/status', { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
  assert.equal(response.status, 200);
  assert.ok(calls.some(({ sql, params }) => sql.startsWith('INSERT INTO notifications') && params[0] === 21));
});
test('rejects foreign-origin writes and invalid clinical entry', async () => {
  mode = 'approved';
  const rejected = await fetchJson('/api/doctor/appointments/7/assessments', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ assessment: 'test' }) });
  assert.equal(rejected.status, 403);
  const invalid = await fetchJson('/api/doctor/appointments/7/assessments', { method: 'POST', body: JSON.stringify({ assessment: '' }) });
  assert.equal(invalid.status, 400);
  const absent = await fetchJson('/api/doctor/appointments/7/assessments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assessment: 'Not authorized' }) });
  assert.equal(absent.status, 403);
});
