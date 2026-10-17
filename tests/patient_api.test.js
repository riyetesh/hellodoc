const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const bcrypt = require('../backend/node_modules/bcryptjs');
const mysqlPath = require.resolve('../backend/node_modules/mysql2');
const users = [];
const appointments = [];
const symptoms = [];
const queries = [];
let nextId = 1;
let doctorStatus = 'pending';
let signupDbError = null;
let server;
let origin;
const query = (sql, params, callback) => {
  if (typeof params === 'function') { callback = params; params = []; }
  queries.push({ sql, params });
  const respond = (err, rows) => queueMicrotask(() => callback(err, rows));
  if (sql.includes('INSERT INTO users')) {
    if (signupDbError) return respond(signupDbError);
    if (users.some((u) => u.email === params[2])) return respond({ code: 'ER_DUP_ENTRY' });
    users.push({ id: nextId++, firstName: params[0], lastName: params[1], email: params[2], password: params[3], role: 'patient' });
    return respond(null, { insertId: nextId - 1 });
  }
  if (sql.includes('SELECT id, password, role')) return respond(null, users.filter((u) => u.email === params[0]));
  if (sql.includes('SELECT id, email, firstName, lastName, role')) return respond(null, users.filter((u) => u.id === params[0]));
  if (sql.includes('SELECT verification_status')) return respond(null, [{ verification_status: doctorStatus }]);
  if (sql.includes('SELECT id, firstName, lastName, email')) return respond(null, users.filter((u) => u.id === params[0]));
  if (sql.includes('SELECT user_id FROM doctor_profiles')) return respond(null, [{ user_id: Number(params[0]) }]);
  if (sql.includes('SELECT doctor_id FROM appointments')) return respond(null, appointments.filter((a) => String(a.id) === String(params[0]) && a.patient_id === params[1] && ['pending','upcoming','rescheduled'].includes(a.status)).map((a) => ({ doctor_id: a.doctor_id })));
  if (sql.includes('INSERT INTO notifications')) return respond(null, { insertId: nextId++ });
  if (sql.includes('SELECT a.id, a.starts_at')) return respond(null, appointments.filter((a) => a.patient_id === params[0]).map((a) => ({ id: a.id, doctorName: 'Doctor', startsAt: a.startsAt, status: a.status })));
  if (sql.includes('SELECT id, symptoms, duration, created_at')) return respond(null, symptoms.filter((s) => s.patient_id === params[0]));
  if (sql.includes('FROM care_plans') || sql.includes('FROM prescriptions') || sql.includes('FROM clinical_assessments') || sql.includes('FROM notifications')) return respond(null, []);
  if (sql.includes('SELECT id FROM appointments')) return respond(null, appointments.filter((a) => String(a.id) === String(params[0]) && a.patient_id === params[1]));
  if (sql.includes('INSERT INTO symptom_submissions')) { symptoms.push({ id: nextId++, patient_id: params[0], appointmentId: params[1], symptoms: params[2] }); return respond(null, { insertId: nextId - 1 }); }
  if (sql.includes('UPDATE appointments SET status')) {
    const found = appointments.find((a) => String(a.id) === String(params[0]) && a.patient_id === params[1] && ['pending', 'upcoming', 'rescheduled'].includes(a.status));
    if (found) found.status = 'cancelled';
    return respond(null, { affectedRows: found ? 1 : 0 });
  }
  if (sql.includes('INSERT INTO appointments')) { appointments.push({ id: nextId++, patient_id: params[0], doctor_id: Number(params[2]), startsAt: params[3], status: 'pending' }); return respond(null, { affectedRows: 1, insertId: nextId - 1 }); }
  if (sql.includes('FROM appointments a') && sql.includes('WHERE a.id = ? AND a.doctor_id = ?')) return respond(null, appointments.filter((a) => String(a.id) === String(params[0]) && a.doctor_id === params[1]));
  if (sql.includes('FROM symptom_submissions WHERE appointment_id')) return respond(null, []);
  if (sql.includes('FROM doctor_availability') || sql.includes('FROM doctor_profiles d')) return respond(null, []);
  return respond(new Error(`Unexpected query: ${sql}`));
};
require.cache[mysqlPath] = { id: mysqlPath, filename: mysqlPath, loaded: true, exports: { createPool: () => ({ query, getConnection: (callback) => callback(null, { query, beginTransaction: (done) => done(), commit: (done) => done(), rollback: (done) => done(), release: () => {} }) }) } };
const app = require('../backend/server');
const request = async (route, { cookie, method = 'GET', body, headers = {} } = {}) => {
  const response = await fetch(origin + route, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), Origin: origin, ...headers }, body: body && JSON.stringify(body), redirect: 'manual' });
  return { status: response.status, headers: response.headers, data: await response.json().catch(() => ({})) };
};
const signup = (email, extra = {}) => request('/api/auth/signup', { method: 'POST', body: { firstName: 'Ada', lastName: 'Test', email, password: 'long-password', dob: '1990-01-01', sex: 'female', ...extra } });
const login = async (email) => { const result = await request('/api/auth/login', { method: 'POST', body: { email, password: 'long-password' } }); return { ...result, cookie: result.headers.get('set-cookie')?.split(';')[0] }; };
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); origin = `http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
test('registration is patient-only and login rotates session', async () => {
  assert.equal((await signup('a@example.com', { role: 'doctor' })).status, 403);
  assert.equal((await signup('a@example.com')).status, 201);
  assert.equal(users[0].role, 'patient');
  assert.notEqual(users[0].password, 'long-password');
  assert.equal(await bcrypt.compare('long-password', users[0].password), true);
  const a = await login('a@example.com');
  assert.equal(a.status, 200);
  assert.equal(a.data.role, 'patient');
  assert.equal((await request('/api/auth/current-user', { cookie: a.cookie })).data.role, 'patient');
  assert.equal((await request('/api/patient/overview', { cookie: a.cookie })).status, 200);
  assert.equal((await request('/api/auth/logout', { cookie: a.cookie, method: 'POST' })).status, 200);
  assert.equal((await request('/api/patient/overview', { cookie: a.cookie })).status, 401);
});
test('local signup explains bad DB credentials and doctor application cannot accept data', async () => {
  signupDbError = { code: 'ER_ACCESS_DENIED_ERROR' };
  try {
    const result = await signup('unavailable@example.invalid');
    assert.equal(result.status, 503);
    assert.match(result.data.message, /MySQL database rejected/);
    assert.equal(users.some((u) => u.email === 'unavailable@example.invalid'), false);
  } finally { signupDbError = null; }
  const result = await request('/api/doctor/apply', { method: 'POST', body: { specialty: 'Cardiology', licenseNumber: 'TEST-123' } });
  assert.equal(result.status, 503);
  assert.match(result.data.message, /Supabase backend/);
});
test('unauthenticated and cross-origin writes fail', async () => {
  assert.equal((await request('/api/patient/overview')).status, 401);
  assert.equal((await request('/api/doctor/appointments/1')).status, 401);
  const a = await login('a@example.com');
  assert.equal((await request('/api/patient/symptoms', { cookie: a.cookie, method: 'POST', body: { symptoms: 'cough', duration: '2 days' }, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/doctor/appointments/1', { cookie: a.cookie })).status, 403);
  assert.equal((await request('/api/patient/appointments', { cookie: a.cookie, method: 'POST', body: { doctorId: 1, startsAt: '2999-01-01T10:00:00', role: 'doctor' } })).status, 201);
  assert.equal((await request('/api/auth/current-user', { cookie: a.cookie })).data.role, 'patient');
});
test('expired and forged session cookies cannot access records', async () => {
  const a = await login('a@example.com');
  assert.equal((await request('/api/patient/overview', { cookie: a.cookie + 'tampered' })).status, 401);
  assert.equal((await request('/api/patient/overview', { cookie: 'connect.sid=s%3Aexpired.fake' })).status, 401);
});
test('cross-patient appointment access and doctor approval', async () => {
  await signup('b@example.com');
  const b = await login('b@example.com');
  assert.equal((await request('/api/patient/overview', { cookie: b.cookie })).data.appointments.length, 0);
  assert.equal((await request('/api/patient/symptoms', { cookie: b.cookie, method: 'POST', body: { symptoms: 'cough', duration: '2 days', appointmentId: 2 } })).status, 404);
  assert.equal((await request('/api/patient/appointments/2/cancel', { cookie: b.cookie, method: 'PATCH' })).status, 404);
  users[1].role = 'doctor';
  assert.equal((await request('/api/patient/overview', { cookie: b.cookie })).status, 403);
  assert.equal((await request('/api/doctor/appointments/2', { cookie: b.cookie })).status, 403);
  doctorStatus = 'approved';
  assert.equal((await request('/api/doctor/appointments/2', { cookie: b.cookie })).status, 404);
  assert.ok(queries.some((q) => q.sql.includes('doctor_id = ?') && q.params.includes(users[1].id)));
});
