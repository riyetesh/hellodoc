/* Walk-in registration: authorization, validation, duplicates and the
   assessment linkage. The Supabase client and the model service are stubbed, so
   these tests prove the HTTP contract and what the routes send to the database;
   the SQL itself is covered by review of migration 013, not by this file. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('../backend/node_modules/express');

let profile = { id: '11111111-1111-4111-8111-111111111111', role: 'doctor', full_name: 'Synthetic Doctor' };
let verification = { verification_status: 'approved' };
let rpcError = null;
let rpcCalls = [];
let inserted = null;
let consultation = {
  appointmentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  startsAt: '2026-10-25T09:00:00Z', status: 'pending', reason: 'Walk-in',
  patientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', patientKind: 'clinic',
  clinicPatientId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  patientName: 'Synthetic Walk-in', patientEmail: null, previousAssessmentId: null,
  patientReported: [], clinicianAdded: [], observations: [],
  symptomDuration: null, clinicalNote: null, doctorAssessment: null, plan: null,
};
let appointments = [];
let registrationExists = false;

const makeQuery = (table) => {
  let mode = null;
  return {
    select() { return this; }, eq() { return this; }, order() { return this; },
    limit() { return Promise.resolve({ data: appointments, error: null }); },
    insert(payload) { inserted = { table, payload }; mode = 'insert'; return this; },
    async single() {
      if (table === 'assessments' && mode === 'insert') {
        return { data: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, error: null };
      }
      if (table === 'assessments') return { data: null, error: { code: 'PGRST116' } };
      if (table === 'doctor_profiles') return { data: verification, error: null };
      return { data: profile, error: null };
    },
  };
};

const modelPath = require.resolve('../backend/model-client');
require.cache[modelPath] = {
  id: modelPath, filename: modelPath, loaded: true,
  exports: {
    validSymptoms: (list) => Array.isArray(list) && list.length > 0,
    symptomVocabulary: async () => ({ symptoms: ['itching', 'skin_rash'], labels: { itching: 'Itching' } }),
    modelRequest: async () => ({ output: 'Fungal infection', modelVersion: 'mv-test', description: '', precautions: [], medications: [], diet: [], workout: [] }),
  },
};

const fake = () => ({
  auth: { async getUser(token) { return { data: { user: token === 'valid' ? { id: profile.id, email: 'doctor@example.invalid' } : null } }; } },
  from: makeQuery,
  async rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === 'assigned_patient_names') return { data: [], error: null };
    if (name === 'doctor_clinic_patients') return { data: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', full_name: 'Synthetic Walk-in', email: 'walkin@example.invalid' }], error: null };
    if (name === 'doctor_clinic_patient_matches') {
      return {
        data: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', full_name: 'Synthetic Walk-in', date_of_birth: '1990-04-02', phone: '+1 555 0100', email: 'walkin@example.invalid', match_reason: 'same date of birth', last_seen: '2026-10-01T09:00:00Z' }],
        error: rpcError,
      };
    }
    if (name === 'doctor_consultation') return { data: consultation, error: rpcError };
    if (name === 'doctor_register_clinic_patient') {
      return {
        data: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', fullName: args.p_full_name, dateOfBirth: args.p_date_of_birth, phone: args.p_phone, email: args.p_email, createdAt: '2026-10-25T09:00:00Z', existing: registrationExists },
        error: rpcError,
      };
    }
    if (name === 'doctor_start_walkin_consultation') {
      return { data: { appointmentId: consultation.appointmentId, patientKind: 'clinic', patientId: consultation.patientId }, error: rpcError };
    }
    if (name === 'doctor_book_clinic_appointment') {
      return { data: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', status: 'pending', startsAt: '2026-11-20T10:00:00Z' }, error: rpcError };
    }
    return { data: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }, error: rpcError };
  },
});

const modulePath = require.resolve('../backend/node_modules/@supabase/supabase-js');
require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: { createClient: fake } };
const routes = require('../backend/supabase-routes');
const app = express();
app.use(express.json());
app.use('/api', routes({ url: 'https://example.supabase.co', key: 'sb_publishable_test' }));

let server, origin;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const request = async (path, { method = 'GET', body, cookie = 'hd_access=valid' } = {}) => {
  const response = await fetch(origin + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const KEY = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const base = { fullName: 'Synthetic Walk-in', dateOfBirth: '1990-04-02', phone: '+1 555 0100', email: 'Walk-in@Example.INVALID', idempotencyKey: KEY };

test('walk-in registration requires an approved doctor', async () => {
  assert.equal((await request('/api/doctor/walkin/patients', { cookie: '' })).status, 401);
  profile = { ...profile, role: 'patient' };
  assert.equal((await request('/api/doctor/walkin/patients', { method: 'POST', body: base })).status, 403);
  profile = { ...profile, role: 'doctor' };
  verification = { verification_status: 'pending' };
  const blocked = await request('/api/doctor/walkin/patients', { method: 'POST', body: base });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'DOCTOR_NOT_VERIFIED');
  verification = { verification_status: 'approved' };
});

test('the form is validated on the server before anything is written', async () => {
  for (const [body, message] of [
    [{ ...base, fullName: '   ' }, /name/i],
    [{ ...base, dateOfBirth: '2999-01-01' }, /date of birth/i],
    [{ ...base, dateOfBirth: '02/04/1990' }, /date of birth/i],
    [{ ...base, phone: 'call me' }, /phone/i],
    [{ ...base, email: 'not-an-address' }, /email/i],
    [{ ...base, email: 'two words@example.invalid' }, /email/i],
    [{ ...base, email: 'x'.repeat(250) + '@example.invalid' }, /email/i],
    [{ ...base, idempotencyKey: 'not-a-key' }, /registration key/i],
  ]) {
    const result = await request('/api/doctor/walkin/patients', { method: 'POST', body });
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.match(result.body.message, message);
  }
  // A patient with no phone, email, date of birth or password is valid.
  assert.equal((await request('/api/doctor/walkin/patients', { method: 'POST', body: { fullName: 'Synthetic Minimal', idempotencyKey: KEY } })).status, 201);
  const call = rpcCalls.filter((entry) => entry.name === 'doctor_register_clinic_patient').pop();
  assert.deepEqual(Object.keys(call.args).sort(), ['p_date_of_birth', 'p_email', 'p_full_name', 'p_key', 'p_phone']);
  assert.equal(call.args.p_phone, null);
  assert.equal(call.args.p_date_of_birth, null);
  assert.equal(call.args.p_email, null);
  // No password or auth field is ever forwarded: the contact email is not an
  // account and the route creates nothing in Supabase Auth.
  assert.ok(!('password' in call.args) && !('preferredLanguage' in call.args));
});

test('the contact email is optional, trimmed and normalised without creating an account', async () => {
  const made = await request('/api/doctor/walkin/patients', { method: 'POST', body: base });
  assert.equal(made.status, 201);
  const call = rpcCalls.filter((entry) => entry.name === 'doctor_register_clinic_patient').pop();
  // The domain is lowercased, the local part is left exactly as entered.
  assert.equal(call.args.p_email, 'Walk-in@example.invalid');
  assert.equal(made.body.email, 'Walk-in@example.invalid');
  assert.equal(made.body.account, false);
  // Whitespace around an address is not part of it.
  await request('/api/doctor/walkin/patients', { method: 'POST', body: { ...base, email: '  patient@Example.INVALID  ' } });
  assert.equal(rpcCalls.filter((entry) => entry.name === 'doctor_register_clinic_patient').pop().args.p_email, 'patient@example.invalid');
});

test('registration is idempotent and a duplicate identity is reported, never merged', async () => {
  const made = await request('/api/doctor/walkin/patients', { method: 'POST', body: base });
  assert.equal(made.status, 201);
  assert.equal(made.body.account, false);
  rpcError = { code: '23505', message: 'A patient with this name and date of birth is already registered' };
  const duplicate = await request('/api/doctor/walkin/patients', { method: 'POST', body: base });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'PATIENT_EXISTS');
  rpcError = null;
  // A retry of the same submission returns the record that already exists
  // instead of creating a second one.
  registrationExists = true;
  const retry = await request('/api/doctor/walkin/patients', { method: 'POST', body: base });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.existing, true);
  registrationExists = false;
  rpcError = { code: '42501' };
  assert.equal((await request('/api/doctor/walkin/patients', { method: 'POST', body: base })).status, 403);
  rpcError = null;
});

test('existing-record checks are scoped and require a term', async () => {
  assert.equal((await request('/api/doctor/walkin/matches')).status, 400);
  assert.equal((await request('/api/doctor/walkin/matches?name=' + 'x'.repeat(201))).status, 400);
  assert.equal((await request('/api/doctor/walkin/matches?dateOfBirth=02-04-1990')).status, 400);
  const found = await request('/api/doctor/walkin/matches?name=Synthetic&dateOfBirth=1990-04-02');
  assert.equal(found.status, 200);
  const call = rpcCalls.filter((entry) => entry.name === 'doctor_clinic_patient_matches').pop();
  assert.deepEqual(call.args, { p_name: 'Synthetic', p_phone: null, p_email: null, p_date_of_birth: '1990-04-02' });
  // A match can be found from an email alone, and the API returns the reason.
  const byEmail = await request('/api/doctor/walkin/matches?email=Walk-in@Example.INVALID');
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.body[0].email, 'walkin@example.invalid');
  assert.equal(byEmail.body[0].matchReason, 'same date of birth');
  const emailCall = rpcCalls.filter((entry) => entry.name === 'doctor_clinic_patient_matches').pop();
  assert.deepEqual(emailCall.args, { p_name: '', p_phone: null, p_email: 'Walk-in@example.invalid', p_date_of_birth: null });
  assert.equal((await request('/api/doctor/walkin/matches?email=bad')).status, 400);
  rpcError = { code: '42501' };
  assert.equal((await request('/api/doctor/walkin/matches?name=Synthetic')).status, 403);
  rpcError = null;
});

test('a walk-in consultation is created server side and another doctor’s patient is not found', async () => {
  const started = await request('/api/doctor/walkin/patients/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/consultation', { method: 'POST', body: {} });
  assert.equal(started.status, 201);
  assert.equal(started.body.appointmentId, consultation.appointmentId);
  assert.equal(started.body.patientKind, 'clinic');
  assert.equal((await request('/api/doctor/walkin/patients/not-a-uuid/consultation', { method: 'POST', body: {} })).status, 400);
  rpcError = { code: 'P0002' };
  assert.equal((await request('/api/doctor/walkin/patients/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/consultation', { method: 'POST', body: {} })).status, 404);
  rpcError = { code: '42501' };
  assert.equal((await request('/api/doctor/walkin/patients/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/consultation', { method: 'POST', body: {} })).status, 403);
  rpcError = null;
});

test('booking a scheduled visit validates the slot and reports conflicts', async () => {
  const path = '/api/doctor/walkin/patients/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/appointment';
  assert.equal((await request(path, { method: 'POST', body: {} })).status, 400);
  assert.equal((await request(path, { method: 'POST', body: { slotId: 'bad', idempotencyKey: KEY } })).status, 400);
  const booked = await request(path, { method: 'POST', body: { slotId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', idempotencyKey: KEY } });
  assert.equal(booked.status, 201);
  assert.equal(booked.body.status, 'pending');
  rpcError = { code: '23P01' };
  assert.equal((await request(path, { method: 'POST', body: { slotId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', idempotencyKey: KEY } })).status, 409);
  rpcError = null;
});

test('the schedule shows walk-ins with the clinical name and no account', async () => {
  appointments = [{
    id: consultation.appointmentId, patient_id: null, clinic_patient_id: consultation.patientId,
    scheduled_start: '2026-10-25T09:00:00Z', status: 'pending', reason: 'Walk-in',
  }];
  const dashboard = await request('/api/doctor/dashboard');
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.appointments[0].firstName, 'Synthetic Walk-in');
  assert.equal(dashboard.body.appointments[0].walkIn, true);
  appointments = [];
});

test('a walk-in assessment is stored against the clinic patient, resolved by the server', async () => {
  const created = await request('/api/doctor/assessments', {
    method: 'POST',
    body: {
      appointmentId: consultation.appointmentId,
      patientReported: ['itching'], clinicianAdded: [], observations: [],
      doctorAssessment: 'Synthetic impression', plan: 'Synthetic plan',
    },
  });
  assert.equal(created.status, 201);
  assert.equal(inserted.table, 'assessments');
  assert.equal(inserted.payload.clinic_patient_id, consultation.patientId);
  assert.equal(inserted.payload.patient_id, null);
  assert.equal(inserted.payload.appointment_id, consultation.appointmentId);
  // A different patient id in the body is rejected before anything is written.
  const forged = await request('/api/doctor/assessments', {
    method: 'POST',
    body: { appointmentId: consultation.appointmentId, patientId: '99999999-9999-4999-8999-999999999999', patientReported: ['itching'] },
  });
  assert.equal(forged.status, 400);
  for (const field of ['patient_id', 'clinic_patient_id', 'appointment_id']) assert.ok(field in inserted.payload);
});

// ---------------------------------------------------------------- UI contract ---
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the workspace exposes walk-in registration as a dialog, not a permanent section', () => {
  const html = read('doctor.html');
  assert.match(html, /id="openWalkin"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /<dialog[^>]*id="walkinDialog"/);
  assert.match(html, /id="walkinName"[^>]*required/);
  assert.match(html, /id="walkinDob"/);
  assert.match(html, /id="walkinPhone"/);
  assert.match(html, /id="walkinCheck"/);
  assert.match(html, /id="walkinStart"/);
  assert.match(html, /id="walkinBook"/);
  assert.match(html, /id="walkinFinish"/);
  // The distinction between a clinical record and an account is stated in the UI.
  assert.match(html, /no password or patient account is created/i);
  assert.match(html, /no HelloDoc account until they sign up/);
  assert.match(html, /does not create a HelloDoc account or portal access/);
  // Date of birth, phone and email are optional; only the name is required.
  assert.match(html, /id="walkinDob"[^>]*type="date"/);
  assert.match(html, /id="walkinEmail"[^>]*type="email"/);
  assert.equal(html.includes('walkinLanguage'), false);
  assert.equal(html.includes('Preferred language'), false);
  assert.equal((html.match(/class="walkin-tag"|walkin-tag--req/g) || []).length >= 4, true);
  // A possible match must be confirmed before a second record is created.
  assert.match(html, /id="walkinConfirm"/);
  assert.match(html, /id="walkinConfirmNew"[^>]*>[^<]*Register as a new patient anyway/);
});

test('the walk-in migration adds a nullable email and never touches Supabase Auth', () => {
  const sql = read('backend/migrations/014_walkin_email_model_optional.sql');
  assert.match(sql, /add column if not exists email text/);
  assert.match(sql, /clinic_patients_email_format/);
  assert.match(sql, /clinic_patients_doctor_email/);
  assert.match(sql, /doctor_clinic_patient_matches\(/);
  assert.match(sql, /p_email text default null/);
  assert.match(sql, /model_status/);
  assert.equal(/create\s+table[^;]*auth\.users/i.test(sql), false);
  assert.equal(/insert\s+into\s+auth\./i.test(sql), false);
  // preferred_language is kept for historical rows, not dropped destructively.
  assert.equal(/drop\s+column[^;]*preferred_language/i.test(sql), false);
});

test('the walk-in script never stores patient details and always uses the doctor API', () => {
  const script = read('Scripts/walkin.js');
  // Comments may mention browser storage; only real calls would be a problem.
  const code = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/localStorage|sessionStorage/.test(code), 'no browser storage for patient data');
  assert.match(script, /\/doctor\/walkin\/matches/);
  assert.match(script, /\/doctor\/walkin\/patients/);
  assert.match(script, /crypto\.randomUUID\(\)/);
  assert.match(script, /event\.preventDefault\(\)/);
  assert.match(script, /showModal\(\)/);
  assert.match(script, /addEventListener\('cancel'/);
  assert.match(script, /aria-busy/);
  // No fabricated contact details or credentials anywhere in the flow.
  assert.ok(!/password|@example|signUp/i.test(script));
});
