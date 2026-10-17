const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { modelRequest, validSymptoms } = require('./model-client');

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
module.exports = function supabaseRoutes({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY, origin = process.env.APP_ORIGIN }) {
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY required');
  const client = () => createClient(url, key, options);
  const report = (operation, error) => console.error(JSON.stringify({ event: 'supabase_operation_failed', operation, code: typeof error?.code === 'string' ? error.code : undefined, status: error?.status, errorType: error?.name }));
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const cookies = (req) => Object.fromEntries((req.get('cookie') || '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter((entry) => entry.length));
  function save(res, session) {
    res.cookie('hd_access', session.access_token, { ...cookieOptions(), maxAge: Math.max(1000, session.expires_in * 1000) });
    res.cookie('hd_refresh', session.refresh_token, { ...cookieOptions(), maxAge: 30 * 24 * 3600 * 1000 });
  }
  function clear(res) { res.clearCookie('hd_access', cookieOptions()); res.clearCookie('hd_refresh', cookieOptions()); }
  async function identity(req, res, next) {
    try {
      const api = client();
      const { hd_access: access, hd_refresh: refresh } = cookies(req);
      let user = null, token = access;
      if (access) {
        const result = await api.auth.getUser(access);
        user = result.data.user;
      }
      if (!user && refresh) {
        const result = await api.auth.refreshSession({ refresh_token: refresh });
        if (result.data.session) {
          save(res, result.data.session);
          token = result.data.session.access_token;
          user = result.data.user;
        }
      }
      if (!user) { clear(res); return res.status(401).json({ message: 'Not authenticated' }); }
      // A verified Auth token, not a client-supplied id. PostgREST applies RLS as this user.
      // The access token has already been checked by getUser; pass it to PostgREST
      // without creating a second session or exposing it to browser JavaScript.
      const scoped = createClient(url, key, { ...options, accessToken: async () => token });
      const result = await scoped.from('profiles').select('id,full_name,role,suspended').eq('id', user.id).single();
      if (result.error || !result.data || result.data.suspended) return res.status(403).json({ message: 'Profile unavailable' });
      req.care = { db: scoped, user, profile: result.data };
      next();
    } catch (error) { report('identity', error); res.status(503).json({ message: 'Authentication unavailable' }); }
  }
  const guard = (role, handler) => [identity, async (req, res) => {
    if (role && req.care.profile.role !== role) return res.status(403).json({ message: 'Access denied' });
    try {
      if (role === 'doctor') {
        const approval = await req.care.db.from('doctor_profiles').select('verification_status').eq('user_id',req.care.user.id).single();
        if (approval.error || approval.data?.verification_status !== 'approved') return res.status(403).json({ message: 'Doctor approval required' });
      }
      await handler(req, res, req.care);
    } catch { res.status(503).json({ message: 'Service unavailable' }); }
  }];
  const attempts = new Map();
  function limit(req, res, next) {
    const name = `${req.ip}:${req.path}`; const now = Date.now();
    const record = attempts.get(name);
    const entry = record && record.expires > now ? record : { count:0, expires:now+15*60*1000 };
    if (++entry.count > 15) return res.status(429).json({ message:'Too many attempts; try again later' });
    attempts.set(name,entry);
    if (attempts.size > 5000) { for (const [key,value] of attempts) if (value.expires < now) attempts.delete(key); }
    next();
  }
  router.use(['/auth/signup','/auth/doctor-signup','/auth/login','/auth/recover','/patient/appointments'], limit);
  router.post('/auth/signup', async (req, res) => {
    const { firstName, lastName, email, password, role } = req.body || {};
    if (role !== undefined) return res.status(403).json({ message: 'Roles cannot be assigned at registration' });
    if (![firstName,lastName,email,password].every((v) => typeof v === 'string') || !firstName.trim() || !lastName.trim() || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || firstName.length > 100 || lastName.length > 100 || password.length < 8 || password.length > 1024) return res.status(400).json({ message: 'Invalid account details' });
    try {
      const { data, error } = await client().auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/`, data: { full_name: `${firstName.trim()} ${lastName.trim()}`.trim() } } });
      if (error) return res.status(400).json({ message: error.message });
      if (data.session) save(res, data.session);
      res.status(201).json({ message: data.session ? 'Account created' : 'Check your email to confirm your account before logging in.' });
    } catch (error) { report('signup', error); res.status(503).json({ message: 'Registration unavailable' }); }
  });
  router.post('/auth/doctor-signup', async (req, res) => {
    const { firstName, lastName, email, password, specialty, licenseNumber, qualifications, evidenceReference } = req.body || {};
    const clean = (value) => typeof value === 'string' ? value.trim() : '';
    const values = { firstName:clean(firstName), lastName:clean(lastName), email:clean(email), password, specialty:clean(specialty), licenseNumber:clean(licenseNumber), qualifications:clean(qualifications), evidenceReference:clean(evidenceReference) };
    if (!values.firstName || values.firstName.length > 100 || !values.lastName || values.lastName.length > 100 ||
        !/^\S+@\S+\.\S+$/.test(values.email) || values.email.length > 254 ||
        typeof values.password !== 'string' || values.password.length < 8 || values.password.length > 1024 ||
        values.specialty.length < 2 || values.specialty.length > 120 ||
        values.licenseNumber.length < 3 || values.licenseNumber.length > 120 ||
        values.qualifications.length < 5 || values.qualifications.length > 2000 ||
        values.evidenceReference.length < 5 || values.evidenceReference.length > 1000) {
      return res.status(400).json({ message: 'Complete every field with valid details. Passwords must be at least 8 characters.' });
    }
    try {
      const { data, error } = await client().auth.signUp({
        email: values.email,
        password: values.password,
        options: { emailRedirectTo: `${origin}/`, data: {
          full_name: `${values.firstName} ${values.lastName}`.trim(),
          account_type: 'doctor_applicant',
          specialty: values.specialty,
          license_number: values.licenseNumber,
          qualifications: values.qualifications,
          evidence_reference: values.evidenceReference
        } }
      });
      if (error) return res.status(400).json({ message: error.message });
      if (data.session) save(res, data.session);
      return res.status(201).json({ authenticated: Boolean(data.session), message: data.session ? 'Doctor application created.' : 'Check your email to confirm your account. Your doctor application is saved as pending.' });
    } catch (error) { report('doctor_signup', error); return res.status(503).json({ message: 'Doctor registration unavailable. Please try again later.' }); }
  });
  router.get('/doctor/application-status', ...guard(null, async (req, res, { db, profile, user }) => {
    if (!['doctor_applicant','doctor'].includes(profile.role)) return res.status(403).json({ message: 'This portal is for doctor applicants and approved doctors.' });
    const result = await db.from('doctor_applications').select('status,specialty,created_at,review_reason').eq('applicant_id', user.id).single();
    if (result.error) return res.status(503).json({ message: 'Application status is unavailable.' });
    res.json({ role: profile.role, application: result.data });
  }));
  router.post('/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 1024) return res.status(400).json({ message: 'Invalid credentials' });
    try {
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error || !data.session) return res.status(401).json({ message: 'Invalid email or password, or email not confirmed' });
      const db = createClient(url, key, { ...options, accessToken: async () => data.session.access_token });
      const profile = await db.from('profiles').select('role,suspended').eq('id', data.user.id).single();
      if (profile.data?.suspended) return res.status(403).json({ message: 'Account suspended. Contact support.' });
      if (profile.error) { report('login_profile', profile.error); return res.status(503).json({ message: 'Profile unavailable. Contact support.' }); }
      save(res, data.session);
      res.json({ role: profile.data.role, message: 'Login successful' });
    } catch (error) { report('login', error); res.status(503).json({ message: 'Login unavailable' }); }
  });
  router.post('/auth/recover', async (req, res) => {
    if (typeof req.body?.email !== 'string') return res.status(400).json({ message: 'Email required' });
    try {
      const { error } = await client().auth.resetPasswordForEmail(req.body.email, { redirectTo: `${origin}/recover.html` });
      if (error) return res.status(503).json({ message: 'Recovery unavailable' });
      res.json({ message: 'If the account exists, a recovery email will arrive.' });
    } catch { res.status(503).json({ message: 'Recovery unavailable' }); }
  });
  router.post('/auth/recover/complete', async (req, res) => {
    const { token_hash: tokenHash, password, access_token: access, refresh_token: refresh } = req.body || {};
    const validHash = typeof tokenHash === 'string' && /^[a-f0-9]{64}$/i.test(tokenHash);
    const validSession = typeof access === 'string' && access.length < 8192 && typeof refresh === 'string' && refresh.length < 8192;
    if ((!validHash && !validSession) || typeof password !== 'string' || password.length < 8 || password.length > 1024) return res.status(400).json({ message:'Invalid recovery details' });
    const api = client();
    try {
      const verified = validHash ? await api.auth.verifyOtp({ token_hash:tokenHash,type:'recovery' }) : await api.auth.setSession({ access_token:access,refresh_token:refresh });
      if (verified.error || !verified.data.session) return res.status(400).json({ message:'Recovery link expired or invalid' });
      const changed = await api.auth.setSession({ access_token:verified.data.session.access_token,refresh_token:verified.data.session.refresh_token });
      if (changed.error) return res.status(503).json({message:'Recovery unavailable'});
      const updated = await api.auth.updateUser({ password });
      if (updated.error) return res.status(503).json({ message:'Could not update password' });
      clear(res); res.json({message:'Password changed. Sign in with your new password.'});
    } catch { res.status(503).json({ message:'Recovery unavailable' }); }
  });
  router.post('/auth/logout', async (req, res) => {
    try {
      const { hd_access: access, hd_refresh: refresh } = cookies(req);
      if (refresh) {
        const api = client();
        const restored = await api.auth.setSession({ access_token: access || '', refresh_token: refresh });
        if (restored.error) { clear(res); return res.status(503).json({ message: 'Local session cleared; server revocation unavailable.' }); }
        const result = await api.auth.signOut();
        if (result.error) { clear(res); return res.status(503).json({ message: 'Local session cleared; server revocation unavailable.' }); }
      }
      clear(res); res.json({ message: 'Logged out' });
    } catch { clear(res); res.status(503).json({ message: 'Local session cleared; server revocation unavailable.' }); }
  });
  router.get('/auth/current-user', ...guard(null, async (req, res, { user, profile }) => res.json({ userId: user.id, email: user.email, role: profile.role, user: { firstName: profile.full_name.split(' ')[0] } })));
  router.get('/auth/profile', ...guard('patient', async (req, res, { user, profile }) => res.json({ id: user.id, firstName: profile.full_name.split(' ')[0], lastName: profile.full_name.split(' ').slice(1).join(' '), email: user.email })));
  router.post('/doctor/apply', ...guard('patient', async (req, res, { db }) => {
    const { specialty, licenseNumber, qualifications = '', evidenceReference = '' } = req.body || {};
    if (typeof specialty !== 'string' || typeof licenseNumber !== 'string' || specialty.trim().length < 2 || specialty.length > 120 || licenseNumber.trim().length < 3 || licenseNumber.length > 120) return res.status(400).json({ message:'Valid specialty and license number required' });
    const hasEvidence = qualifications !== '' || evidenceReference !== '';
    if (hasEvidence && (typeof qualifications !== 'string' || qualifications.trim().length < 5 || qualifications.length > 2000 || typeof evidenceReference !== 'string' || evidenceReference.trim().length < 5 || evidenceReference.length > 1000)) return res.status(400).json({ message: 'Valid qualifications and evidence reference required' });
    const result = hasEvidence ? await db.rpc('submit_doctor_application', { p_specialty:specialty.trim(), p_license:licenseNumber.trim(), p_qualifications:qualifications, p_evidence:evidenceReference }) : await db.rpc('apply_as_doctor', { p_specialty:specialty.trim(), p_license_number:licenseNumber.trim() });
    if (result.error) return res.status(result.error.code === '23505' ? 409 : 503).json({ message:result.error.code === '23505' ? 'Application already submitted' : result.error.code === 'PGRST202' || result.error.code === '42P01' ? 'Doctor applications are not configured in this database. Contact the site administrator.' : 'Application unavailable. Please try again later.' });
    res.status(201).json({ status:result.data.status });
  }));
  router.get('/doctors', async (req, res) => {
    const api = client();
    const result = await api.rpc('public_doctors');
    if (result.error) { report('directory', result.error); return res.status(503).json({ message: 'Directory unavailable' }); }
    res.json(result.data.map((d) => ({ ...d, nextSlot: null })));
  });
  router.get('/doctors/:id/slots', async (req, res) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Invalid doctor' });
    const result = await client().rpc('public_slots',{ p_doctor:req.params.id });
    if (result.error) return res.status(503).json({ message: 'Slots unavailable' });
    res.json(result.data.map((s) => ({ id: s.id, startsAt: s.scheduled_start })));
  });
  router.get('/patient/overview', ...guard('patient', async (req, res, { db, user, profile }) => {
    const result = await db.from('appointments').select('id,doctor_id,scheduled_start,status,reason').eq('patient_id',user.id).order('scheduled_start',{ ascending:false }).limit(100);
    if (result.error) { report('patient_appointments', result.error); return res.status(503).json({ message: 'Appointments unavailable' }); }
    const activity = await db.rpc('patient_activity');
    if (activity.error) return res.status(503).json({ message:'Metrics unavailable' });
    const directory = await db.rpc('public_doctors');
    if (directory.error) return res.status(503).json({ message:'Directory unavailable' });
    const doctors = new Map(directory.data.map((d) => [d.id,d]));
    res.json({ profile: { firstName: profile.full_name.split(' ')[0], lastName: profile.full_name.split(' ').slice(1).join(' '), email: user.email },
      appointments: result.data.map((a) => ({ id:a.id, doctorName:doctors.get(a.doctor_id)?.name || 'Doctor', specialty:doctors.get(a.doctor_id)?.specialty || 'Consultation', startsAt:a.scheduled_start, status:a.status, reason:a.reason })),
      metrics: activity.data, symptoms:[], assessments:[], carePlans:[], prescriptions:[], notifications:[] });
  }));
  router.post('/patient/appointments', ...guard('patient', async (req, res, { db }) => {
    const { slotId, idempotencyKey, reason = '' } = req.body || {};
    if (!isUuid(slotId) || !isUuid(idempotencyKey) || typeof reason !== 'string' || reason.length > 500) return res.status(400).json({ message: 'Invalid appointment details' });
    const result = await db.rpc('book_appointment',{ p_slot:slotId,p_key:idempotencyKey,p_reason:reason });
    if (result.error) return res.status(result.error.code === '42501' ? 403 : ['23P01','23505','P0001'].includes(result.error.code) ? 409 : 503).json({ message: result.error.code === '42501' ? 'Patient access required' : ['23P01','23505','P0001'].includes(result.error.code) ? 'Slot unavailable or booking conflicts' : 'Booking unavailable' });
    res.status(201).json({ id:result.data.id,status:result.data.status });
  }));
  router.patch('/patient/appointments/:id/cancel', ...guard('patient', async (req, res, { db }) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Invalid appointment' });
    const result = await db.rpc('change_appointment_status',{ p_id:req.params.id,p_status:'cancelled' });
    if (result.error) return res.status(result.error.code === 'P0002' ? 404 : 409).json({ message:'Cannot cancel this appointment' });
    res.json({ status:result.data.status });
  }));
  router.get('/doctor/symptoms', ...guard('doctor', async (req, res) => {
    try { res.json(await modelRequest('/internal/symptoms')); }
    catch { res.status(503).json({ message:'Symptom model unavailable' }); }
  }));
  router.post('/doctor/predict', ...guard('doctor', async (req, res) => {
    if (!validSymptoms(req.body?.symptoms)) return res.status(400).json({ message:'Select valid symptoms' });
    try {
      const result = await modelRequest('/internal/predict', req.body.symptoms);
      if (typeof result.output !== 'string' || typeof result.modelVersion !== 'string') throw new Error('Invalid model response');
      res.json({output:result.output,modelVersion:result.modelVersion,label:'Experimental decision support, not a diagnosis'});
    } catch { res.status(503).json({ message:'Symptom model unavailable or selection invalid' }); }
  }));
  router.post('/doctor/availability', ...guard('doctor', async (req, res, { db }) => {
    const start = req.body?.startsAt;
    if (typeof start !== 'string' || Number.isNaN(Date.parse(start)) || !/Z$|[+-]\d\d:\d\d$/.test(start)) return res.status(400).json({ message:'UTC offset required' });
    const result = await db.rpc('add_doctor_slot',{p_start:start});
    if (result.error) return res.status(['23P01','23505'].includes(result.error.code) ? 409 : 400).json({message:'Invalid or overlapping slot'});
    res.status(201).json({id:result.data.id});
  }));
  router.get('/doctor/availability', ...guard('doctor', async (req, res, { db, user }) => {
    const result = await db.from('doctor_availability').select('id,scheduled_start,scheduled_end,status').eq('doctor_id',user.id).gt('scheduled_start',new Date().toISOString()).order('scheduled_start').limit(100);
    if (result.error) return res.status(503).json({message:'Availability unavailable'});
    res.json(result.data);
  }));
  router.get('/doctor/dashboard', ...guard('doctor', async (req, res, { db, user }) => {
    const result = await db.from('appointments').select('id,patient_id,scheduled_start,status,reason').eq('doctor_id',user.id).order('scheduled_start',{ascending:false}).limit(100);
    if (result.error) return res.status(503).json({ message:'Dashboard unavailable' });
    const ids = [...new Set(result.data.map((a) => a.patient_id))];
    const patients = ids.length ? await db.rpc('assigned_patient_names') : { data:[],error:null };
    if (patients.error) return res.status(503).json({ message:'Dashboard unavailable' });
    const names = new Map(patients.data.map((p) => [p.id,p.full_name]));
    res.json({ appointments:result.data.map((a) => ({ id:a.id, startsAt:a.scheduled_start,status:a.status,reason:a.reason, firstName:names.get(a.patient_id) || 'Patient' })), tasks:[],drafts:[] });
  }));
  router.get('/doctor/appointments/:id', ...guard('doctor', async (req, res, { db, user }) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ message:'Invalid appointment' });
    const result = await db.from('appointments').select('id,patient_id,scheduled_start,status,reason').eq('doctor_id',user.id).eq('id',req.params.id).single();
    if (result.error) return res.status(404).json({ message:'Appointment not found' });
    const people = await db.rpc('assigned_patient_names');
    if (people.error) return res.status(503).json({message:'Patient unavailable'});
    res.json({ appointment: { ...result.data, startsAt:result.data.scheduled_start, firstName:people.data.find((p) => p.id===result.data.patient_id)?.full_name || 'Patient' }, symptoms:[],history:[],assessments:[],plans:[],prescriptions:[],predictions:[],tasks:[] });
  }));
  router.patch('/doctor/appointments/:id/status', ...guard('doctor', async (req, res, { db }) => {
    if (!isUuid(req.params.id) || !['confirmed','cancelled','completed','no_show'].includes(req.body?.status)) return res.status(400).json({ message:'Invalid status' });
    const result = await db.rpc('change_appointment_status',{p_id:req.params.id,p_status:req.body.status});
    if (result.error) return res.status(409).json({ message:'Invalid status transition' });
    res.json({status:result.data.status});
  }));
  router.get('/doctor/analytics', ...guard('doctor', async (req, res, { db }) => {
    const since = req.query.since, until = req.query.until;
    if (![since,until].every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))) || since > until) return res.status(400).json({ message:'Valid since and until dates required' });
    const result = await db.rpc('doctor_activity',{p_since:since,p_until:until});
    if (result.error) return res.status(503).json({message:'Analytics unavailable'});
    res.json(result.data);
  }));
  router.get('/admin/overview', ...guard('admin', async (req, res, { db }) => {
    const { since, until } = req.query;
    if (![since, until].every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) || since > until) return res.status(400).json({ message: 'Valid UTC date range required' });
    const result = await db.rpc('admin_metrics', { p_since: since, p_until: until });
    if (result.error) return res.status(400).json({ message: 'Metrics unavailable; use a range of at most 367 days.' });
    res.json(result.data);
  }));
  router.get('/admin/:kind', ...guard('admin', async (req, res, { db }) => {
    if (!['patients','doctors','appointments','audit'].includes(req.params.kind)) return res.status(404).json({ message: 'Not found' });
    const page = Number(req.query.page || 1), search = req.query.search || '', status = req.query.status || '';
    if (!Number.isInteger(page) || page < 1 || page > 10000 || typeof search !== 'string' || search.length > 120 || typeof status !== 'string') return res.status(400).json({ message: 'Invalid filters' });
    const result = await db.rpc('admin_list', { p_kind: req.params.kind, p_page: page, p_search: search, p_status: status });
    if (result.error) return res.status(503).json({ message: 'List unavailable' });
    res.json(result.data);
  }));
  router.post('/admin/actions', ...guard('admin', async (req, res, { db }) => {
    const { action, target, reason, details = {} } = req.body || {};
    if (!['approve_doctor','reject_doctor','suspend','reactivate','update_doctor','cancel_appointment'].includes(action) || !isUuid(target) || typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 500 || !details || typeof details !== 'object' || Array.isArray(details)) return res.status(400).json({ message: 'Valid target, action and review reason required' });
    const result = await db.rpc('admin_action', { p_action: action, p_target: target, p_reason: reason.trim(), p_details: details });
    if (result.error) return res.status(409).json({ message: 'Action refused. Check verification, account and appointment state.' });
    res.json({ message: 'Administrative action saved and audited.' });
  }));
  return router;
};
