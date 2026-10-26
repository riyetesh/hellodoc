const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { modelRequest, validSymptoms, symptomVocabulary } = require('./model-client');
const { renderAssessmentReport } = require('./report-pdf');

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
module.exports = function supabaseRoutes({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY, origin = process.env.APP_ORIGIN }) {
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY required');
  // Derive the Secure flag from the trusted public origin rather than NODE_ENV
  // alone. A deployment served over HTTPS must never issue a session cookie a
  // browser would also send over plain HTTP, even if NODE_ENV is unset.
  const secureCookies = /^https:\/\//i.test(String(origin || ''));
  const cookieOptions = () => ({ httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/' });
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
  // Refresh tokens rotate, so concurrent requests that arrive with the same
  // expired session must share one refresh. Without this cache the losers are
  // told the token was already used and their cookies were cleared, which the
  // user experienced as being randomly signed out mid-session.
  const refreshes = new Map(); // refresh token -> in-flight refresh promise
  const rotated = new Map(); // consumed refresh token -> { session, at }
  function recentSession(token) {
    const entry = rotated.get(token);
    if (!entry) return null;
    if (Date.now() - entry.at > 60 * 1000) { rotated.delete(token); return null; }
    return entry.session;
  }
  function refreshOnce(api, token) {
    const pending = refreshes.get(token);
    if (pending) return pending;
    const request = api.auth.refreshSession({ refresh_token: token })
      .then(({ data, error }) => {
        if (data?.session) {
          rotated.set(token, { session: data.session, at: Date.now() });
          if (rotated.size > 500) for (const [key, value] of rotated) if (Date.now() - value.at > 60 * 1000) rotated.delete(key);
        }
        return { session: data?.session || null, error };
      })
      .catch((error) => ({ session: null, error }))
      .finally(() => refreshes.delete(token));
    refreshes.set(token, request);
    return request;
  }
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
        const reused = recentSession(refresh);
        const result = reused ? { session: reused } : await refreshOnce(api, refresh);
        if (result.session) {
          save(res, result.session);
          token = result.session.access_token;
          user = result.session.user || null;
        } else {
          // Only a definitive rejection ends the session. A network blip, a rate
          // limit or a Supabase 5xx must not discard a 30-day refresh token.
          const status = result.error?.status;
          if (status === 400 || status === 401) { clear(res); return res.status(401).json({ message: 'Session expired. Sign in again.' }); }
          report('refresh', result.error);
          return res.status(503).json({ message: 'Authentication service is temporarily unavailable. Please retry.' });
        }
      }
      if (!user) { clear(res); return res.status(401).json({ message: 'Not authenticated' }); }
      // A verified Auth token, not a client-supplied id. PostgREST applies RLS as this user.
      // The access token has already been checked by getUser; pass it to PostgREST
      // without creating a second session or exposing it to browser JavaScript.
      const scoped = createClient(url, key, { ...options, accessToken: async () => token });
      const result = await scoped.from('profiles').select('id,full_name,role,suspended').eq('id', user.id).single();
      if (result.data?.suspended) return res.status(403).json({ code: 'ACCOUNT_SUSPENDED', message: 'Account restricted. Contact HelloDoc support.' });
      if (result.error || !result.data) return res.status(403).json({ code: 'PROFILE_UNAVAILABLE', message: 'Profile unavailable. Contact support.' });
      req.care = { db: scoped, user, profile: result.data };
      next();
    } catch (error) { report('identity', error); res.status(503).json({ message: 'Authentication unavailable' }); }
  }
  // Doctors hold the `doctor` role from the moment they register; verification
  // status decides what they may do. `session` guards the pending-verification
  // dashboard, `guard('doctor')` guards clinical work and therefore re-checks
  // approval on every request.
  const session = (roles, handler) => [identity, async (req, res) => {
    if (roles && !roles.includes(req.care.profile.role)) return res.status(403).json({ message: 'Access denied' });
    try {
      await handler(req, res, req.care);
    } catch { res.status(503).json({ message: 'Service unavailable' }); }
  }];
  const guard = (role, handler) => [identity, async (req, res) => {
    if (role && req.care.profile.role !== role) return res.status(403).json({ message: 'Access denied' });
    try {
      if (role === 'doctor') {
        const approval = await req.care.db.from('doctor_profiles').select('verification_status').eq('user_id',req.care.user.id).single();
        if (approval.error || approval.data?.verification_status !== 'approved') return res.status(403).json({ code:'DOCTOR_NOT_VERIFIED', message: 'Doctor verification required for clinical features' });
      }
      await handler(req, res, req.care);
    } catch { res.status(503).json({ message: 'Service unavailable' }); }
  }];
  const verificationOf = async (db, userId) => {
    const result = await db.from('doctor_profiles').select('verification_status,specialty,professional_bio,institution,years_experience,is_accepting_appointments').eq('user_id', userId).single();
    if (result.error || !result.data) return { status: 'pending', profile: null };
    return { status: result.data.verification_status, profile: result.data };
  };
  const attempts = new Map();
  // Count unsuccessful credential attempts only: a legitimate sign-in should not
  // consume the brute-force budget, but every rejection or validation failure
  // does. Per-process only; use a shared store for multi-instance deployments.
  function limit(req, res, next) {
    // req.path is '/' inside a mounted router.use(paths, ...) middleware, which
    // would put every credential endpoint in one bucket; key on the real URL.
    const name = `${req.ip}:${req.originalUrl.split('?')[0]}`; const now = Date.now();
    const record = attempts.get(name);
    const entry = record && record.expires > now ? record : { count:0, expires:now+15*60*1000 };
    if (entry.count >= 15) return res.status(429).json({ message:'Too many attempts; try again later' });
    attempts.set(name,entry);
    res.on('finish', () => { if (res.statusCode >= 400) entry.count += 1; });
    if (attempts.size > 5000) { for (const [key,value] of attempts) if (value.expires < now) attempts.delete(key); }
    next();
  }
  router.use(['/auth/signup','/auth/doctor-signup','/auth/login','/auth/recover','/patient/appointments'], limit);
  router.post('/auth/signup', async (req, res) => {
    const { firstName, lastName, email, password, confirmPassword, phone = '', role } = req.body || {};
    if (role !== undefined) return res.status(403).json({ message: 'Roles cannot be assigned at registration' });
    if (![firstName,lastName,email,password].every((v) => typeof v === 'string') || !firstName.trim() || !lastName.trim() || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || firstName.length > 100 || lastName.length > 100 || password.length < 8 || password.length > 1024) return res.status(400).json({ message: 'Invalid account details' });
    if (typeof phone !== 'string' || phone.length > 40 || (phone && !/^[+()\-\s0-9]{6,40}$/.test(phone))) return res.status(400).json({ message: 'Enter a valid phone number or leave it blank' });
    if (confirmPassword !== undefined && confirmPassword !== password) return res.status(400).json({ message: 'Passwords do not match' });
    try {
      const { data, error } = await client().auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/`, data: { full_name: `${firstName.trim()} ${lastName.trim()}`.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) } } });
      if (error) return res.status(400).json({ message: error.message });
      if (data.session) save(res, data.session);
      res.status(201).json({ authenticated: Boolean(data.session), redirectTo: data.session ? '/patient.html' : null, message: data.session ? 'Account created' : 'Check your email to confirm your account before logging in.' });
    } catch (error) { report('signup', error); res.status(503).json({ message: 'Registration unavailable' }); }
  });
  router.post('/auth/doctor-signup', async (req, res) => {
    if (['role','status','approved','approvalStatus','permissions','account_type'].some((field) => Object.hasOwn(req.body || {}, field))) return res.status(403).json({ message: 'Roles and approval permissions cannot be assigned at registration' });
    const { firstName, lastName, email, password, confirmPassword, phone = '', specialty, licenseNumber, qualifications, institution, yearsExperience, evidenceReference = '' } = req.body || {};
    const clean = (value) => typeof value === 'string' ? value.trim() : '';
    const values = { firstName:clean(firstName), lastName:clean(lastName), email:clean(email), password, phone:clean(phone), specialty:clean(specialty), licenseNumber:clean(licenseNumber), qualifications:clean(qualifications), institution:clean(institution), evidenceReference:clean(evidenceReference) };
    const experience = yearsExperience === undefined || yearsExperience === '' ? null : Number(yearsExperience);
    if (!values.firstName || values.firstName.length > 100 || !values.lastName || values.lastName.length > 100 ||
        !/^\S+@\S+\.\S+$/.test(values.email) || values.email.length > 254 ||
        typeof values.password !== 'string' || values.password.length < 8 || values.password.length > 1024 ||
        (confirmPassword !== undefined && confirmPassword !== values.password) ||
        (values.phone && !/^[+()\-\s0-9]{6,40}$/.test(values.phone)) ||
        values.specialty.length < 2 || values.specialty.length > 120 ||
        values.licenseNumber.length < 3 || values.licenseNumber.length > 120 ||
        values.qualifications.length < 5 || values.qualifications.length > 2000 ||
        values.institution.length < 2 || values.institution.length > 200 ||
        (experience !== null && (!Number.isInteger(experience) || experience < 0 || experience > 80)) ||
        (values.evidenceReference && (values.evidenceReference.length < 5 || values.evidenceReference.length > 1000))) {
      return res.status(400).json({ message: 'Complete every field with valid details. Passwords must be at least 8 characters.' });
    }
    try {
      const { data, error } = await client().auth.signUp({
        email: values.email,
        password: values.password,
        options: { emailRedirectTo: `${origin}/`, data: {
          full_name: `${values.firstName} ${values.lastName}`.trim(),
          account_type: 'doctor',
          ...(values.phone ? { phone: values.phone } : {}),
          specialty: values.specialty,
          license_number: values.licenseNumber,
          qualifications: values.qualifications,
          institution: values.institution,
          ...(experience !== null ? { years_experience: experience } : {}),
          ...(values.evidenceReference ? { evidence_reference: values.evidenceReference } : {})
        } }
      });
      if (error) return res.status(400).json({ message: error.message });
      if (data.session) save(res, data.session);
      return res.status(201).json({ authenticated: Boolean(data.session), verificationStatus: 'pending', redirectTo: data.session ? '/doctor.html' : null, message: data.session ? 'Doctor account created. Your verification is pending review.' : 'Check your email to confirm your account. Your doctor verification is saved as pending.' });
    } catch (error) { report('doctor_signup', error); return res.status(503).json({ message: 'Doctor registration unavailable. Please try again later.' }); }
  });
  router.get('/doctor/application-status', ...session(['doctor','doctor_applicant'], async (req, res, { db, profile, user }) => {
    const verified = await verificationOf(db, user.id);
    if (!verified.profile) return res.status(409).json({ code: 'APPLICATION_INCONSISTENT', message: 'Your doctor profile is incomplete. Contact support; do not create another account.' });
    const result = await db.from('doctor_applications').select('status,specialty,license_number,qualifications,institution,years_experience,review_reason,created_at,updated_at').eq('applicant_id', user.id).single();
    if (result.error && result.error.code !== 'PGRST116') return res.status(503).json({ message: 'Application status is unavailable. Please retry.' });
    res.json({
      role: profile.role,
      approved: verified.status === 'approved',
      verificationStatus: verified.status,
      application: result.data || null,
    });
  }));
  // The pending-verification dashboard: any doctor account can see its own status
  // and profile, but no appointments or clinical data until approved.
  router.get('/doctor/overview', ...session(['doctor','doctor_applicant'], async (req, res, { db, user, profile }) => {
    const verified = await verificationOf(db, user.id);
    const application = await db.from('doctor_applications')
      .select('status,specialty,license_number,qualifications,institution,years_experience,review_reason,created_at,updated_at')
      .eq('applicant_id', user.id).single();
    if (application.error && application.error.code !== 'PGRST116') return res.status(503).json({ message: 'Dashboard unavailable' });
    const approved = verified.status === 'approved';
    res.json({
      profile: {
        firstName: profile.full_name.split(' ')[0],
        lastName: profile.full_name.split(' ').slice(1).join(' '),
        email: user.email,
        role: profile.role,
      },
      approved,
      verificationStatus: verified.status,
      specialty: verified.profile?.specialty || application.data?.specialty || null,
      institution: verified.profile?.institution || application.data?.institution || null,
      application: application.data || null,
      canAttendConsultations: approved && Boolean(verified.profile?.is_accepting_appointments),
      appointments: [],
    });
  }));
  // Own-profile updates only; the RPC controls which columns may change, so a
  // patient or doctor can never edit a role or verification status.
  const fullName = (firstName, lastName) => {
    const first = typeof firstName === 'string' ? firstName.trim() : '';
    const last = typeof lastName === 'string' ? lastName.trim() : '';
    if (first.length < 1 || first.length > 100 || last.length > 100) return null;
    return `${first} ${last}`.trim();
  };
  router.patch('/patient/profile', ...guard('patient', async (req, res, { db, user }) => {
    const name = fullName(req.body?.firstName, req.body?.lastName);
    const phone = req.body?.phone === undefined ? null : String(req.body.phone).trim();
    if (!name || (phone && (!/^[+()\-\s0-9]{6,40}$/.test(phone) || phone.length > 40))) return res.status(400).json({ message: 'Enter a valid name and phone number' });
    const result = await db.rpc('update_own_profile', { p_full_name: name, p_phone: phone || null });
    if (result.error) return res.status(503).json({ message: 'Profile update unavailable' });
    res.json({ firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '), phone: phone || null, userId: user.id });
  }));
  router.patch('/doctor/profile', ...session(['doctor','doctor_applicant'], async (req, res, { db, user }) => {
    const name = fullName(req.body?.firstName, req.body?.lastName);
    const bio = req.body?.bio === undefined ? '' : String(req.body.bio).trim();
    const institution = req.body?.institution === undefined ? '' : String(req.body.institution).trim();
    const experience = req.body?.yearsExperience === undefined || req.body.yearsExperience === '' ? null : Number(req.body.yearsExperience);
    if (!name || bio.length > 2000 || institution.length > 200 || (experience !== null && (!Number.isInteger(experience) || experience < 0 || experience > 80))) return res.status(400).json({ message: 'Invalid profile details' });
    const result = await db.rpc('update_own_doctor_profile', { p_full_name: name, p_bio: bio, p_institution: institution || null, p_years_experience: experience });
    if (result.error) return res.status(503).json({ message: 'Profile update unavailable' });
    res.json({ firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '), bio, institution: institution || null, yearsExperience: experience, userId: user.id });
  }));
  // Resubmission after rejection: professional details only, and only while the
  // application is rejected or awaiting resubmission.
  router.post('/doctor/application/resubmit', ...session(['doctor','doctor_applicant'], async (req, res, { db }) => {
    const clean = (value) => typeof value === 'string' ? value.trim() : '';
    const specialty = clean(req.body?.specialty), license = clean(req.body?.licenseNumber), qualifications = clean(req.body?.qualifications), institution = clean(req.body?.institution);
    const experience = req.body?.yearsExperience === undefined || req.body.yearsExperience === '' ? null : Number(req.body.yearsExperience);
    if (specialty.length < 2 || specialty.length > 120 || license.length < 3 || license.length > 120 || qualifications.length < 5 || qualifications.length > 2000 || institution.length < 2 || institution.length > 200 || (experience !== null && (!Number.isInteger(experience) || experience < 0 || experience > 80))) {
      return res.status(400).json({ message: 'Complete every verification field with valid details' });
    }
    const result = await db.rpc('resubmit_doctor_application', { p_specialty: specialty, p_license: license, p_qualifications: qualifications, p_institution: institution, p_years_experience: experience });
    if (result.error) return res.status(409).json({ message: 'Resubmission is not available for your application right now' });
    res.json({ verificationStatus: 'pending', application: result.data });
  }));
  router.post('/auth/login', async (req, res) => {
    const { email, password, portal } = req.body || {};
    if (portal !== undefined && !['patient','doctor','admin'].includes(portal)) return res.status(400).json({ message: 'Choose patient, doctor or admin login' });
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 1024) return res.status(400).json({ message: 'Invalid credentials' });
    try {
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      if (error || !data.session) return res.status(401).json({ message: 'Invalid email or password, or email not confirmed' });
      const db = createClient(url, key, { ...options, accessToken: async () => data.session.access_token });
      const profile = await db.from('profiles').select('role,suspended').eq('id', data.user.id).single();
      if (profile.data?.suspended) return res.status(403).json({ message: 'Account suspended. Contact support.' });
      if (profile.error) { report('login_profile', profile.error); return res.status(503).json({ message: 'Profile unavailable. Contact support.' }); }
      const role = profile.data?.role;
      const destinations = { patient:'/patient.html', doctor:'/doctor.html', admin:'/admin' };
      if (!destinations[role]) return res.status(403).json({ message: 'Account role unavailable. Contact support.' });
      // The selected portal is a preference, never a grant: it can only match the
      // role already stored by the database.
      if (portal) {
        const matches = portal === 'admin' ? role === 'admin'
          : portal === 'doctor' ? role === 'doctor'
          : role === 'patient';
        if (!matches) {
          const correct = role === 'admin' ? 'admin login' : role === 'doctor' ? 'doctor login' : 'patient login';
          return res.status(403).json({ code:'WRONG_PORTAL', portal: role === 'admin' ? 'admin' : role === 'doctor' ? 'doctor' : 'patient', message: `This is a ${role} account. Choose ${correct}.` });
        }
      }
      // Pending doctors may sign in and see their own dashboard; clinical
      // endpoints stay blocked until an administrator approves the application.
      let verificationStatus = null;
      if (role === 'doctor') {
        const verified = await verificationOf(db, data.user.id);
        if (verified.status === 'rejected' || verified.status === 'resubmission_required') {
          verificationStatus = verified.status;
        } else {
          verificationStatus = verified.status === 'approved' ? 'approved' : 'pending';
        }
      }
      save(res, data.session);
      res.json({ role, verificationStatus, redirectTo:destinations[role], message: 'Login successful' });
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
  // Doctor registration is the only path to a doctor account; a patient account
  // can no longer be converted into an application from the API.
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
      // Only implemented data is returned. Clinical results, care plans,
      // prescriptions, notifications and tasks have no backing yet, so they are
      // omitted rather than sent as convincing empty arrays.
      metrics: activity.data });
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
    try { res.json(await symptomVocabulary()); }
    catch (error) { res.status(503).json({ code:error.code === 'MODEL_NOT_CONFIGURED' ? error.code : 'MODEL_UNAVAILABLE', message:error.code === 'MODEL_NOT_CONFIGURED' ? error.message : 'Model service is unreachable. Ask the administrator to start the private prediction service.' }); }
  }));
  // ---------------------------------------------------------------------------
  // Clinical assessments: model output plus the doctor's own decision.
  // ---------------------------------------------------------------------------
  const stringList = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
  const cleanList = (value) => value.map((item) => item.trim()).filter(Boolean);
  // Shared validation for creating and revising an assessment, so both routes
  // enforce exactly the same limits and neither one can drift.
  const assessmentInput = (raw) => {
    const body = raw || {};
    if (!stringList(body.patientReported) || !stringList(body.clinicianAdded) || !stringList(body.observations)) {
      return { error: 'Symptoms must be a list of text values' };
    }
    const { symptomDuration = '', clinicalNote = '', doctorAssessment = '', plan = '' } = body;
    if (typeof symptomDuration !== 'string' || symptomDuration.length > 120
      || typeof clinicalNote !== 'string' || clinicalNote.length > 2000
      || typeof doctorAssessment !== 'string' || doctorAssessment.length > 4000
      || typeof plan !== 'string' || plan.length > 4000) return { error: 'Assessment details are too long' };
    const reported = cleanList(body.patientReported), added = cleanList(body.clinicianAdded), observations = cleanList(body.observations);
    if (observations.length > 20 || observations.some((item) => item.length > 200)) return { error: 'Limit clinical observations to 20 entries of 200 characters' };
    const symptoms = [...reported, ...added];
    if (!symptoms.length) return { error: 'Add at least one model symptom' };
    if (new Set(symptoms).size !== symptoms.length) return { error: 'Each symptom can only be recorded once' };
    return {
      reported, added, observations, symptoms,
      duration: symptomDuration.trim(), note: clinicalNote.trim(),
      doctorAssessment: doctorAssessment.trim(), plan: plan.trim(),
    };
  };
  const runModelAssessment = async (symptoms, res) => {
    let vocabulary;
    try { vocabulary = await symptomVocabulary(); }
    catch { res.status(503).json({ code: 'MODEL_UNAVAILABLE', message: 'The model service is unavailable. Your assessment has not been saved.' }); return null; }
    const unsupported = symptoms.filter((item) => !vocabulary.symptoms.includes(item));
    if (unsupported.length) {
      // Never silently drop a symptom: tell the caller exactly which entries are
      // not model features so the doctor can keep them as clinical observations.
      res.status(422).json({ code: 'UNSUPPORTED_SYMPTOMS', message: 'Some symptoms are not model features. Keep them as clinical observations instead.', unsupported });
      return null;
    }
    let assessment;
    try {
      assessment = await modelRequest('/internal/assess', symptoms);
    } catch (error) {
      res.status(error.code === 'INVALID_SYMPTOMS' ? 422 : 503).json({ code: error.code === 'INVALID_SYMPTOMS' ? 'INVALID_SYMPTOMS' : 'MODEL_UNAVAILABLE', message: 'The model could not produce a prediction. Your assessment has not been saved; retry when the service is available.' });
      return null;
    }
    // A malformed reply must never reach the database as a half-valid record.
    if (!assessment || typeof assessment.output !== 'string' || !assessment.output.trim()
      || typeof assessment.modelVersion !== 'string' || !assessment.modelVersion.trim()) {
      res.status(503).json({ code: 'MODEL_INVALID_RESPONSE', message: 'The model returned an unusable result. Nothing was saved; retry or ask the administrator to check the model service.' });
      return null;
    }
    const textList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : []);
    return {
      output: assessment.output.trim(),
      modelVersion: assessment.modelVersion.trim(),
      confidence: typeof assessment.confidence === 'number' && Number.isFinite(assessment.confidence) ? assessment.confidence : null,
      description: typeof assessment.description === 'string' ? assessment.description : '',
      precautions: textList(assessment.precautions),
      medications: textList(assessment.medications),
      diet: textList(assessment.diet),
      workout: textList(assessment.workout),
    };
  };
  router.get('/doctor/patients', ...guard('doctor', async (req, res, { db }) => {
    const result = await db.rpc('assigned_patients');
    if (result.error) return res.status(503).json({ message: 'Patient list unavailable' });
    res.json(result.data.map((row) => ({
      patientId: row.patient_id, fullName: row.full_name, email: row.email,
      appointmentId: row.appointment_id, appointmentStart: row.appointment_start,
      appointmentStatus: row.appointment_status, assessmentCount: Number(row.assessment_count || 0),
    })));
  }));
  // One patient's context for the doctor who attends them: identity, the visits
  // they share and the records already saved. Access is decided by the doctor's
  // own patient lists, so a browser-supplied id can never widen the scope.
  router.get('/doctor/patients/:id/context', ...guard('doctor', async (req, res, { db, user }) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Invalid patient' });
    const id = req.params.id;
    const [people, clinic] = await Promise.all([db.rpc('assigned_patients'), db.rpc('doctor_clinic_patients')]);
    if (people.error) return res.status(503).json({ message: 'Patient record unavailable' });
    const account = (people.data || []).find((row) => row.patient_id === id) || null;
    const walkIn = (Array.isArray(clinic.data) ? clinic.data : []).find((row) => row.id === id) || null;
    if (!account && !walkIn) return res.status(404).json({ message: 'That patient is not one of your records.' });
    // The two patient kinds live in different columns, and only one of them can
    // be set on an assessment, so the query filters by the column that applies.
    const column = account ? 'patient_id' : 'clinic_patient_id';
    const [visits, records] = await Promise.all([
      db.from('appointments').select('id,scheduled_start,status,reason')
        .eq('doctor_id', user.id).eq(column, id).order('scheduled_start', { ascending: false }).limit(20),
      db.from('assessments').select('id,appointment_id,created_at,predicted_disease,supersedes_id')
        .eq('doctor_id', user.id).eq(column, id).order('created_at', { ascending: false }).limit(20),
    ]);
    if (visits.error || records.error) return res.status(503).json({ message: 'Patient record unavailable' });
    res.json({
      patient: {
        id, fullName: account?.full_name || walkIn?.full_name || 'Patient',
        account: Boolean(account), email: account?.email || null,
        dateOfBirth: walkIn?.date_of_birth || null, phone: walkIn?.phone || null,
        preferredLanguage: walkIn?.preferred_language || null,
      },
      appointments: (visits.data || []).map((row) => ({
        id: row.id, startsAt: row.scheduled_start, status: row.status, reason: row.reason,
      })),
      assessments: (records.data || []).map((row) => ({
        id: row.id, appointmentId: row.appointment_id, createdAt: row.created_at,
        predictedDisease: row.predicted_disease, supersedesId: row.supersedes_id,
      })),
    });
  }));
  // ---------------------------------------------------------------------------
  // Walk-in registration: a clinical record for a patient with no account.
  // Nothing here creates an auth user, an email address or portal access.
  // ---------------------------------------------------------------------------
  const walkinError = (res, error, fallback = 'Walk-in registration is unavailable right now.') => {
    const code = error?.code;
    if (code === '42501') return res.status(403).json({ message: 'Only an approved doctor can register walk-in patients.' });
    if (code === 'P0002') return res.status(404).json({ message: 'That patient is not one of your records.' });
    if (code === '23505') {
      return res.status(409).json({
        code: 'PATIENT_EXISTS',
        message: error.message || 'A patient with these details is already registered.',
      });
    }
    if (code === '22023') return res.status(400).json({ message: error.message || 'Check the patient details.' });
    if (code === '23P01' || code === 'P0001') {
      return res.status(409).json({ message: 'That time is no longer available. Choose another slot.' });
    }
    return res.status(503).json({ code: 'WALKIN_UNAVAILABLE', message: fallback });
  };
  // One compact payload for every walk-in write. Fields the clinic does not need
  // are optional: no email, no password and no phone number are required.
  const walkinDetails = (body) => {
    const clean = (value) => (typeof value === 'string' ? value.trim() : '');
    const fullName = clean(body?.fullName);
    const rawDate = body?.dateOfBirth === undefined || body?.dateOfBirth === null ? '' : String(body.dateOfBirth).trim();
    const phone = clean(body?.phone);
    const preferredLanguage = clean(body?.preferredLanguage);
    if (fullName.length < 1 || fullName.length > 200) return { error: 'Enter the patient name (up to 200 characters).' };
    let dateOfBirth = null;
    if (rawDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return { error: 'Enter the date of birth as YYYY-MM-DD.' };
      const parsed = new Date(`${rawDate}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== rawDate) return { error: 'Enter a valid date of birth.' };
      if (rawDate > new Date().toISOString().slice(0, 10)) return { error: 'Date of birth cannot be in the future.' };
      if (rawDate < '1900-01-01') return { error: 'Check the date of birth.' };
      dateOfBirth = rawDate;
    }
    if (phone && (!/^[+()\-\s0-9]{6,40}$/.test(phone) || phone.length > 40)) return { error: 'Enter a valid phone number or leave it blank.' };
    if (preferredLanguage.length > 40) return { error: 'Preferred language is too long.' };
    return { fullName, dateOfBirth, phone: phone || null, preferredLanguage: preferredLanguage || null };
  };
  // This doctor's own walk-in records, for the "check existing" step. A name or
  // phone is required: the endpoint never dumps the list.
  router.get('/doctor/walkin/matches', ...guard('doctor', async (req, res, { db }) => {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    const phone = typeof req.query.phone === 'string' ? req.query.phone.trim() : '';
    const rawDate = typeof req.query.dateOfBirth === 'string' ? req.query.dateOfBirth.trim() : '';
    if (name.length > 200 || phone.length > 40) return res.status(400).json({ message: 'Search details are too long.' });
    if (!name && !phone && !rawDate) return res.status(400).json({ message: 'Enter a name, phone number or date of birth to check.' });
    if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return res.status(400).json({ message: 'Enter the date of birth as YYYY-MM-DD.' });
    const result = await db.rpc('doctor_clinic_patient_matches', {
      p_name: name || '', p_phone: phone || null, p_date_of_birth: rawDate || null,
    });
    if (result.error) return walkinError(res, result.error, 'Existing patients cannot be checked right now.');
    res.json((result.data || []).map((row) => ({
      id: row.id, fullName: row.full_name, dateOfBirth: row.date_of_birth,
      phone: row.phone, preferredLanguage: row.preferred_language,
      matchReason: row.match_reason, lastSeen: row.last_seen,
    })));
  }));
  router.get('/doctor/walkin/patients', ...guard('doctor', async (req, res, { db }) => {
    const result = await db.rpc('doctor_clinic_patients');
    if (result.error) return walkinError(res, result.error, 'Walk-in records are unavailable right now.');
    res.json((result.data || []).map((row) => ({
      id: row.id, fullName: row.full_name, dateOfBirth: row.date_of_birth,
      phone: row.phone, preferredLanguage: row.preferred_language, createdAt: row.created_at,
    })));
  }));
  router.post('/doctor/walkin/patients', ...guard('doctor', async (req, res, { db }) => {
    const details = walkinDetails(req.body);
    if (details.error) return res.status(400).json({ message: details.error });
    const key = req.body?.idempotencyKey;
    if (!isUuid(key)) return res.status(400).json({ message: 'A registration key is required.' });
    const result = await db.rpc('doctor_register_clinic_patient', {
      p_full_name: details.fullName, p_date_of_birth: details.dateOfBirth,
      p_phone: details.phone, p_preferred_language: details.preferredLanguage, p_key: key,
    });
    if (result.error) {
      // The code only: a patient name or phone must never reach the logs.
      report('walkin_register', result.error);
      return walkinError(res, result.error);
    }
    res.status(result.data?.existing ? 200 : 201).json({
      id: result.data.id, fullName: result.data.fullName, dateOfBirth: result.data.dateOfBirth,
      phone: result.data.phone, preferredLanguage: result.data.preferredLanguage,
      createdAt: result.data.createdAt, account: false, existing: Boolean(result.data.existing),
    });
  }));
  // Opening a consultation creates a server-side walk-in appointment for this
  // doctor and patient; the browser only names the patient it just registered.
  router.post('/doctor/walkin/patients/:id/consultation', ...guard('doctor', async (req, res, { db }) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Invalid patient.' });
    const reason = req.body?.reason === undefined ? '' : req.body.reason;
    if (typeof reason !== 'string' || reason.length > 500) return res.status(400).json({ message: 'Reason is too long.' });
    const result = await db.rpc('doctor_start_walkin_consultation', { p_patient: req.params.id, p_reason: reason || null });
    if (result.error) {
      report('walkin_consultation', result.error);
      return walkinError(res, result.error, 'A walk-in consultation cannot be started right now.');
    }
    res.status(201).json(result.data);
  }));
  router.post('/doctor/walkin/patients/:id/appointment', ...guard('doctor', async (req, res, { db }) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Invalid patient.' });
    const { slotId, idempotencyKey, reason = '' } = req.body || {};
    if (!isUuid(slotId) || !isUuid(idempotencyKey) || typeof reason !== 'string' || reason.length > 500) {
      return res.status(400).json({ message: 'Choose one of your open slots.' });
    }
    const result = await db.rpc('doctor_book_clinic_appointment', {
      p_patient: req.params.id, p_slot: slotId, p_reason: reason, p_key: idempotencyKey,
    });
    if (result.error) {
      report('walkin_booking', result.error);
      return walkinError(res, result.error, 'The appointment could not be booked right now.');
    }
    res.status(201).json({ id: result.data.id, status: result.data.status, startsAt: result.data.startsAt });
  }));
  // The consultation context for one appointment the caller attends. The patient
  // identity and appointment come from the database, never from the browser.
  router.get('/doctor/appointments/:id/consultation', ...guard('doctor', async (req, res, { db }) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Invalid appointment' });
    const result = await db.rpc('doctor_consultation', { p_appt: req.params.id });
    if (result.error) {
      const status = result.error.code === '42501' ? 403 : result.error.code === 'P0002' ? 404 : 503;
      return res.status(status).json({ message: status === 404 ? 'That appointment is not assigned to you.' : status === 403 ? 'Only an approved doctor can open a consultation.' : 'Consultation unavailable' });
    }
    res.json(result.data);
  }));
  router.get('/doctor/assessments', ...guard('doctor', async (req, res, { db, user }) => {
    const result = await db.from('assessments')
      .select('id,patient_id,predicted_disease,appointment_id,created_at')
      .eq('doctor_id', user.id).order('created_at', { ascending: false }).limit(20);
    if (result.error) return res.status(503).json({ message: 'Assessments unavailable' });
    const people = await db.rpc('assigned_patient_names');
    const names = new Map((people.data || []).map((p) => [p.id, p.full_name]));
    // Walk-in records are not in assigned_patient_names (they have no account), so
    // their display names come from the doctor's own clinic list. Best effort: an
    // older database simply leaves the neutral fallback in place.
    const clinicPeople = await db.rpc('doctor_clinic_patients');
    const clinicRows = Array.isArray(clinicPeople.data) ? clinicPeople.data : [];
    for (const row of clinicRows) names.set(row.id, row.full_name);
    res.json(result.data.map((row) => ({
      id: row.id, patientId: row.patient_id, patientName: names.get(row.patient_id) || 'Patient',
      predictedDisease: row.predicted_disease, appointmentId: row.appointment_id, createdAt: row.created_at,
    })));
  }));
  router.post('/doctor/assessments', ...guard('doctor', async (req, res, { db, user }) => {
    const body = req.body || {};
    const { appointmentId } = body;
    // The browser may only name an appointment. Patient identity, ownership and
    // approval are resolved by the database RPC, so a forged patient id cannot
    // attach this assessment to another patient.
    if (!isUuid(appointmentId)) return res.status(400).json({ message: 'Open the assessment from an appointment assigned to you.' });
    const context = await db.rpc('doctor_consultation', { p_appt: appointmentId });
    if (context.error) {
      const status = context.error.code === '42501' ? 403 : context.error.code === 'P0002' ? 404 : 503;
      return res.status(status).json({ message: status === 404 ? 'That appointment is not assigned to you.' : status === 403 ? 'Only an approved doctor can record an assessment.' : 'The appointment could not be verified. Nothing was saved.' });
    }
    const consultation = context.data || {};
    // A consultation now resolves either an account patient or a walk-in record.
    // The server decides which column the assessment belongs to; the browser only
    // names the appointment.
    const clinicPatientId = isUuid(consultation.clinicPatientId) ? consultation.clinicPatientId : null;
    const accountPatientId = clinicPatientId ? null : (isUuid(consultation.patientId) ? consultation.patientId : null);
    if ((!accountPatientId && !clinicPatientId) || !isUuid(consultation.appointmentId)) {
      return res.status(503).json({ message: 'The appointment context is incomplete. Nothing was saved.' });
    }
    if (body.patientId !== undefined && body.patientId !== consultation.patientId) {
      return res.status(400).json({ message: 'The patient does not match this appointment.' });
    }
    if (consultation.previousAssessmentId) {
      return res.status(409).json({
        code: 'ASSESSMENT_EXISTS',
        assessmentId: consultation.previousAssessmentId,
        message: 'An assessment already exists for this appointment. Open that record to make a revision.',
      });
    }
    const cleaned = assessmentInput(body);
    if (cleaned.error) return res.status(400).json({ message: cleaned.error });
    const assessment = await runModelAssessment(cleaned.symptoms, res);
    if (!assessment) return;
    const insert = await db.from('assessments').insert({
      doctor_id: user.id, patient_id: accountPatientId, clinic_patient_id: clinicPatientId,
      appointment_id: consultation.appointmentId,
      patient_reported: cleaned.reported, clinician_added: cleaned.added, observations: cleaned.observations,
      symptom_duration: cleaned.duration || null, clinical_note: cleaned.note || null,
      predicted_disease: assessment.output, model_version: assessment.modelVersion,
      // Only a real numeric score is stored; the bundled SVC exposes no
      // calibrated probabilities, so this stays null for it.
      model_confidence: assessment.confidence,
      description: assessment.description, precautions: assessment.precautions,
      medications: assessment.medications, diet: assessment.diet, workout: assessment.workout,
      doctor_assessment: cleaned.doctorAssessment || null, plan: cleaned.plan || null,
    }).select('id').single();
    if (insert.error) {
      report('assessment_create', insert.error);
      if (insert.error.code === '23505') return res.status(409).json({ message: 'This appointment already has an assessment. Open it to make a revision.' });
      const code = insert.error.code === '42501' ? 403 : insert.error.code === '23514' ? 400 : 503;
      return res.status(code).json({ message: code === 403 ? 'Only an approved doctor for this appointment can record an assessment' : 'The assessment could not be saved. Your form is preserved; please retry.' });
    }
    res.status(201).json({ id: insert.data.id });
  }));
  // Revising symptoms must not rewrite the stored prediction: the new model run
  // is saved as a new record that points at the one it replaces. Patient and
  // appointment come from the stored row, never from the request body.
  router.post('/doctor/assessments/:id/revision', ...guard('doctor', async (req, res, { db, user }) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Invalid assessment' });
    const source = await db.from('assessments')
      .select('id,patient_id,clinic_patient_id,appointment_id,observations,symptom_duration,clinical_note,doctor_assessment,plan')
      .eq('id', req.params.id).eq('doctor_id', user.id).single();
    if (source.error || !source.data) {
      return res.status(source.error?.code === 'PGRST116' ? 404 : 503).json({ message: 'Assessment unavailable' });
    }
    const body = req.body || {};
    const cleaned = assessmentInput(body);
    if (cleaned.error) return res.status(400).json({ message: cleaned.error });
    // Anything the caller did not send keeps the value already recorded for this
    // consultation, so correcting a symptom never erases the doctor's plan.
    const duration = 'symptomDuration' in body ? cleaned.duration : (source.data.symptom_duration || '');
    const note = 'clinicalNote' in body ? cleaned.note : (source.data.clinical_note || '');
    const observations = 'observations' in body ? cleaned.observations : (source.data.observations || []);
    const doctorAssessment = 'doctorAssessment' in body ? cleaned.doctorAssessment : (source.data.doctor_assessment || '');
    const plan = 'plan' in body ? cleaned.plan : (source.data.plan || '');
    const assessment = await runModelAssessment(cleaned.symptoms, res);
    if (!assessment) return;
    const insert = await db.from('assessments').insert({
      doctor_id: user.id, patient_id: source.data.patient_id, clinic_patient_id: source.data.clinic_patient_id,
      appointment_id: source.data.appointment_id,
      supersedes_id: source.data.id,
      patient_reported: cleaned.reported, clinician_added: cleaned.added, observations,
      symptom_duration: duration || null, clinical_note: note || null,
      predicted_disease: assessment.output, model_version: assessment.modelVersion,
      model_confidence: typeof assessment.confidence === 'number' && Number.isFinite(assessment.confidence) ? assessment.confidence : null,
      description: assessment.description || '', precautions: assessment.precautions || [],
      medications: assessment.medications || [], diet: assessment.diet || [], workout: assessment.workout || [],
      doctor_assessment: doctorAssessment || null, plan: plan || null,
    }).select('id').single();
    if (insert.error) {
      // Only the PostgREST code is logged, never symptoms or patient data.
      report('assessment_revision', insert.error);
      if (insert.error.code === '23505') return res.status(409).json({ message: 'This assessment has already been revised. Open the newer revision instead.' });
      const code = insert.error.code === '42501' ? 403 : insert.error.code === '23514' ? 400 : 503;
      return res.status(code).json({ message: 'The revision could not be saved. Your form is preserved; please retry.' });
    }
    res.status(201).json({ id: insert.data.id, supersedesId: source.data.id });
  }));
  router.get('/doctor/assessments/:id', ...guard('doctor', async (req, res, { db }) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Invalid assessment' });
    const result = await db.rpc('assessment_view', { p_id: req.params.id });
    if (result.error) return res.status(result.error.code === '42501' ? 403 : result.error.code === 'P0002' ? 404 : 503).json({ message: 'Assessment unavailable' });
    res.json(result.data);
  }));
  router.patch('/doctor/assessments/:id', ...guard('doctor', async (req, res, { db, user }) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Invalid assessment' });
    const body = req.body || {};
    const keys = Object.keys(body);
    if (!keys.length || keys.some((key) => !['doctorAssessment', 'plan', 'expectedUpdatedAt'].includes(key))
      || !keys.some((key) => key === 'doctorAssessment' || key === 'plan')) {
      return res.status(400).json({ message: 'Only the doctor assessment and plan can be edited' });
    }
    const expectedUpdatedAt = body.expectedUpdatedAt;
    if (expectedUpdatedAt !== undefined
      && (typeof expectedUpdatedAt !== 'string' || Number.isNaN(Date.parse(expectedUpdatedAt)))) {
      return res.status(400).json({ message: 'Invalid assessment version' });
    }
    const patch = {};
    if ('doctorAssessment' in body) {
      if (typeof body.doctorAssessment !== 'string' || body.doctorAssessment.length > 4000) return res.status(400).json({ message: 'Assessment is too long' });
      patch.doctor_assessment = body.doctorAssessment.trim() || null;
    }
    if ('plan' in body) {
      if (typeof body.plan !== 'string' || body.plan.length > 4000) return res.status(400).json({ message: 'Plan is too long' });
      patch.plan = body.plan.trim() || null;
    }
    let update = db.from('assessments').update(patch)
      .eq('id', req.params.id).eq('doctor_id', user.id);
    // Optimistic concurrency: the update only applies if the record has not
    // changed since the page loaded. Without this, a second tab would silently
    // overwrite notes saved by the first.
    if (expectedUpdatedAt !== undefined) update = update.eq('updated_at', expectedUpdatedAt);
    const result = await update.select('id,updated_at').single();
    if (result.error) {
      if (result.error.code === 'PGRST116') {
        return res.status(expectedUpdatedAt === undefined ? 404 : 409).json({
          message: expectedUpdatedAt === undefined
            ? 'Assessment could not be updated'
            : 'This assessment changed in another tab or is no longer available. Your text is still here; reload to see the current saved version.',
        });
      }
      return res.status(503).json({ message: 'Assessment could not be updated' });
    }
    res.json({ id: result.data.id, updatedAt: result.data.updated_at });
  }));
  router.get('/doctor/assessments/:id/report.pdf', ...guard('doctor', async (req, res, { db, user }) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ message: 'Invalid assessment' });
    const result = await db.rpc('assessment_view', { p_id: req.params.id });
    if (result.error) return res.status(result.error.code === '42501' ? 403 : result.error.code === 'P0002' ? 404 : 503).json({ message: 'Report unavailable' });
    let pdf;
    try { pdf = renderAssessmentReport(result.data, { generatedAt: new Date() }); }
    catch (error) { report('assessment_report', error); return res.status(503).json({ message: 'Report generation failed. Please retry.' }); }
    // Report metadata only; the model verdict itself stays frozen. The new
    // updated_at is returned so the page's concurrency token stays current after
    // a download (this write also bumps the row's updated_at trigger).
    const marked = await db.from('assessments')
      .update({ report_generated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('doctor_id', user.id).select('updated_at').single();
    if (marked.data?.updated_at) res.set('X-Assessment-Updated-At', marked.data.updated_at);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="HelloDoc-assessment-${String(req.params.id).slice(0, 8)}.pdf"`);
    res.send(pdf);
  }));
  router.post('/doctor/predict', ...guard('doctor', async (req, res) => {
    if (!validSymptoms(req.body?.symptoms)) return res.status(400).json({ message:'Select valid symptoms' });
    try {
      const result = await modelRequest('/internal/predict', req.body.symptoms);
      if (typeof result.output !== 'string' || typeof result.modelVersion !== 'string') throw new Error('Invalid model response');
      res.json({output:result.output,modelVersion:result.modelVersion,label:'Experimental decision support, not a diagnosis'});
    } catch (error) {
      // Keep a missing model configuration distinguishable from an outage so a
      // deployment gap is diagnosable instead of looking like a transient error.
      const code = ['INVALID_SYMPTOMS', 'MODEL_NOT_CONFIGURED'].includes(error.code) ? error.code : 'MODEL_UNAVAILABLE';
      res.status(code === 'INVALID_SYMPTOMS' ? 422 : 503).json({ code, message: code === 'MODEL_UNAVAILABLE' ? 'Model service unavailable. Please retry later.' : error.message });
    }
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
    const result = await db.from('appointments').select('id,patient_id,clinic_patient_id,scheduled_start,status,reason').eq('doctor_id',user.id).order('scheduled_start',{ascending:false}).limit(100);
    if (result.error) return res.status(503).json({ message:'Dashboard unavailable' });
    const patientOf = (a) => a.patient_id || a.clinic_patient_id;
    const ids = [...new Set(result.data.map(patientOf).filter(Boolean))];
    const patients = ids.length ? await db.rpc('assigned_patient_names') : { data:[],error:null };
    if (patients.error) return res.status(503).json({ message:'Dashboard unavailable' });
    const names = new Map(patients.data.map((p) => [p.id,p.full_name]));
    // Walk-in records have no account, so their names are not in the accounting
    // list above. Best effort, so an un-migrated database still shows the schedule.
    const clinic = await db.rpc('doctor_clinic_patients');
    const clinicRows = Array.isArray(clinic.data) ? clinic.data : [];
    for (const row of clinicRows) names.set(row.id, row.full_name);
    // patientId is the value the workspace uses to open that patient's context;
    // it is always one the server itself resolved for this doctor.
    res.json({ appointments:result.data.map((a) => ({ id:a.id, patientId:patientOf(a) || null, startsAt:a.scheduled_start,status:a.status,reason:a.reason, walkIn:!a.patient_id, firstName:names.get(patientOf(a)) || 'Patient' })) });
  }));
  router.get('/doctor/appointments/:id', ...guard('doctor', async (req, res, { db, user }) => {
    if (!isUuid(req.params.id)) return res.status(400).json({ message:'Invalid appointment' });
    const result = await db.from('appointments').select('id,patient_id,clinic_patient_id,scheduled_start,status,reason').eq('doctor_id',user.id).eq('id',req.params.id).single();
    if (result.error) return res.status(404).json({ message:'Appointment not found' });
    const people = await db.rpc('assigned_patient_names');
    if (people.error) return res.status(503).json({message:'Patient unavailable'});
    const clinic = await db.rpc('doctor_clinic_patients');
    const clinicRows = Array.isArray(clinic.data) ? clinic.data : [];
    const names = new Map([...(people.data || []).map((p) => [p.id, p.full_name]), ...clinicRows.map((p) => [p.id, p.full_name])]);
    const patientId = result.data.patient_id || result.data.clinic_patient_id;
    res.json({ appointment: { ...result.data, startsAt:result.data.scheduled_start, firstName:names.get(patientId) || 'Patient', walkIn:!result.data.patient_id } });
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
    if (!['approve_doctor','reject_doctor','request_resubmission','suspend','reactivate','update_doctor','cancel_appointment'].includes(action) || !isUuid(target) || typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 500 || !details || typeof details !== 'object' || Array.isArray(details)) return res.status(400).json({ message: 'Valid target, action and review reason required' });
    const result = await db.rpc('admin_action', { p_action: action, p_target: target, p_reason: reason.trim(), p_details: details });
    if (result.error) return res.status(409).json({ message: 'Action refused. Check verification, account and appointment state.' });
    res.json({ message: 'Administrative action saved and audited.' });
  }));
  return router;
};
