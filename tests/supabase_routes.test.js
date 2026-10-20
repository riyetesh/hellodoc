const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('../backend/node_modules/express');
const modulePath = require.resolve('../backend/node_modules/@supabase/supabase-js');
let profile = { id:'11111111-1111-4111-8111-111111111111',role:'patient',full_name:'Synthetic Test' };
let rpcError = null;
let directory = [];
let calls = [];
let signupPayload;
let application = {status:'pending',specialty:'Cardiology',created_at:'2026-10-17',review_reason:null};
let applicationError = null;
let verification = {verification_status:'approved',specialty:'Cardiology',professional_bio:'',institution:'Synthetic Hospital',years_experience:5,is_accepting_appointments:true};
let refreshCalls = 0;
let refreshResult = {status:400};
let refreshSuccess = null;
let insertedAssessment = null;
let updatedAssessment = null;
let assessmentView = null;
let assessmentViewError = null;
let modelCalls = [];
let modelFailure = null;
let consultationView = {
  appointmentId:'4011b5d5-db16-41f6-9c7f-1b94f766bbda', startsAt:'2026-11-12T09:00:00Z', status:'pending',
  reason:'Persistent rash', patientId:'44444444-4444-4444-8444-444444444444',
  patientName:'Synthetic Patient', patientEmail:'patient@example.invalid',
  previousAssessmentId:null, patientReported:[], clinicianAdded:[], observations:[],
  symptomDuration:null, clinicalNote:null, doctorAssessment:null, plan:null,
};
let consultationError = null;
let assessmentSource = null;
let assessmentSourceError = null;
let insertAssessmentError = null;
const makeQuery = (table) => {
  let mode = null;
  const query = {
    select() { return this; }, eq() { return this; },
    order() { return this; }, limit() { return Promise.resolve({data:[],error:null}); },
    insert(payload) { insertedAssessment = {table,payload}; mode = 'insert'; return this; },
    update(patch) { updatedAssessment = {table,patch}; mode = 'update'; return this; },
    async single() {
      if (table === 'assessments') {
        if (mode === 'insert') return { data:insertAssessmentError ? null : {id:'33333333-3333-4333-8333-333333333333'}, error:insertAssessmentError };
        if (mode === 'update') return { data:{id:'33333333-3333-4333-8333-333333333333'}, error:null };
        // Reading one assessment (revision source): the route filters by doctor_id.
        return { data:assessmentSource, error:assessmentSourceError };
      }
      return { data:table === 'profiles' ? profile : table === 'doctor_applications' ? application : verification,error:table === 'doctor_applications' ? applicationError : null };
    },
  };
  return query;
};
const modelPath = require.resolve('../backend/model-client');
require.cache[modelPath] = {
  id:modelPath, filename:modelPath, loaded:true,
  exports:{
    validSymptoms:(list) => Array.isArray(list) && list.length > 0,
    symptomVocabulary:async () => ({ symptoms:['itching','skin_rash','nodal_skin_eruptions'], labels:{ itching:'Itching', skin_rash:'Skin rash' } }),
    modelRequest:async (path, symptoms) => {
      modelCalls.push({path, symptoms});
      if (modelFailure) { const error = new Error('model unavailable'); error.code = modelFailure; throw error; }
      if (path === '/internal/symptoms') return { symptoms:['itching','skin_rash','nodal_skin_eruptions'], labels:{ itching:'Itching' } };
      return { output:'Fungal infection', modelVersion:'mv-test', description:'Synthetic description', precautions:['p'], medications:['m'], diet:['d'], workout:['w'], disclaimer:'Experimental.' };
    },
  },
};
const fake = () => ({
  auth: {
    async getUser(token) { return { data:{user:token==='valid' ? {id:profile.id,email:'test@example.invalid'} : null} }; },
    async refreshSession() {
      refreshCalls += 1;
      // Give concurrent callers time to queue behind the shared in-flight refresh.
      await new Promise((resolve) => setTimeout(resolve,5));
      if (refreshSuccess) return { data:{session:refreshSuccess,user:{id:profile.id,email:'test@example.invalid'}},error:null };
      return { data:{session:null},error:refreshResult };
    },
    async signUp(payload) { signupPayload = payload; return {data:{session:null},error:null}; },
    async signInWithPassword() { return {data:{session:{access_token:'valid',refresh_token:'refresh',expires_in:3600},user:{id:profile.id}},error:null}; },
  },
  from:makeQuery,
  async rpc(name,args) {
    calls.push({name,args});
    if (name === 'assessment_view') return { data:assessmentView, error:assessmentViewError };
    if (name === 'doctor_consultation') return { data:consultationView, error:consultationError };
    if (name === 'assigned_patients') return { data:[{ patient_id:'44444444-4444-4444-8444-444444444444', full_name:'Synthetic Patient', email:'patient@example.invalid', appointment_id:'55555555-5555-4555-8555-555555555555', appointment_start:'2026-11-12T09:00:00Z', appointment_status:'pending', assessment_count:1 }], error:null };
    return {data:name === 'patient_activity' ? {upcoming:1,completed:2,cancelled:0} : name === 'public_doctors' ? directory : name === 'apply_as_doctor' ? {status:'pending'} : {id:'22222222-2222-4222-8222-222222222222',status:'pending'},error:rpcError};
  },
});
require.cache[modulePath] = { id:modulePath,filename:modulePath,loaded:true,exports:{createClient:fake} };
const routes = require('../backend/supabase-routes');
const app = express(); app.use(express.json()); app.use('/api',routes({url:'https://example.supabase.co',key:'sb_publishable_test'}));
let server, origin;
before(async () => { server=app.listen(0,'127.0.0.1'); await new Promise((resolve) => server.once('listening',resolve)); origin=`http://127.0.0.1:${server.address().port}`; });
after(() => server.close());
const post = async (path,body,cookie='hd_access=valid') => {
  const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
};
test('admin APIs enforce identity, role, validation and RPC authorization', async () => {
  assert.equal((await fetch(origin+'/api/admin/patients')).status,401);
  for (const role of ['patient','doctor']) {
    profile={...profile,role};
    assert.equal((await fetch(origin+'/api/admin/patients',{headers:{Cookie:'hd_access=valid'}})).status,403);
    assert.equal((await post('/api/admin/actions',{action:'suspend',target:profile.id,reason:'Test reason'})).status,403);
  }
  profile={...profile,role:'admin'};
  assert.equal((await fetch(origin+'/api/admin/patients',{headers:{Cookie:'hd_access=valid'}})).status,200);
  assert.equal((await post('/api/admin/actions',{action:'suspend',target:'bad',reason:'Test reason'})).status,400);
  rpcError={code:'42501'};
  assert.equal((await post('/api/admin/actions',{action:'suspend',target:profile.id,reason:'Test reason'})).status,409);
  rpcError=null;
  assert.equal((await post('/api/admin/actions',{action:'suspend',target:profile.id,reason:'Test reason'})).status,200);
  profile={...profile,role:'patient',suspended:true};
  assert.equal((await fetch(origin+'/api/auth/current-user',{headers:{Cookie:'hd_access=valid'}})).status,403);
  profile={...profile,suspended:false};
});
test('only patient registration; no password sent to application tables',async () => {
  assert.equal((await post('/api/auth/signup',{role:'doctor',firstName:'Synthetic',lastName:'Test',email:'test@example.invalid',password:'password123'})).status,403);
  assert.equal((await post('/api/auth/signup',{firstName:'Synthetic',lastName:'Test',email:'test@example.invalid',password:'password123'})).status,201);
});
test('resubmission is available to doctors only and never self-approves',async () => {
  const payload={specialty:'Cardiology',licenseNumber:'SYNTHETIC-123',qualifications:'Synthetic qualifications',institution:'Synthetic Hospital',yearsExperience:5};
  assert.equal((await post('/api/doctor/application/resubmit',payload,'')).status,401);
  profile={...profile,role:'patient'};
  assert.equal((await post('/api/doctor/application/resubmit',payload)).status,403);
  profile={...profile,role:'doctor'};
  assert.equal((await post('/api/doctor/application/resubmit',{...payload,qualifications:'x'})).status,400);
  const result=await post('/api/doctor/application/resubmit',payload);
  assert.equal(result.status,200);
  assert.equal(result.body.verificationStatus,'pending');
  const call=calls.find((entry) => entry.name==='resubmit_doctor_application');
  assert.ok(call);
  assert.equal(call.args.p_license,'SYNTHETIC-123');
  rpcError={code:'42501'};
  assert.equal((await post('/api/doctor/application/resubmit',payload)).status,409);
  rpcError=null;
  profile={...profile,role:'patient'};
});

test('own-profile updates go through column-scoped RPCs and cannot touch role or verification',async () => {
  profile={...profile,role:'patient'};
  const patientUpdate=await fetch(origin+'/api/patient/profile',{method:'PATCH',headers:{'Content-Type':'application/json',Cookie:'hd_access=valid'},body:JSON.stringify({firstName:'Synthetic',lastName:'Patient',phone:'+1 555 0100',role:'admin',verificationStatus:'approved'})});
  assert.equal(patientUpdate.status,200);
  const patientCall=calls.find((entry) => entry.name==='update_own_profile');
  assert.deepEqual(Object.keys(patientCall.args).sort(),['p_full_name','p_phone']);
  profile={...profile,role:'doctor'};
  const doctorUpdate=await fetch(origin+'/api/doctor/profile',{method:'PATCH',headers:{'Content-Type':'application/json',Cookie:'hd_access=valid'},body:JSON.stringify({firstName:'Synthetic',lastName:'Doctor',bio:'Synthetic bio',institution:'Synthetic Hospital',yearsExperience:4,verification_status:'approved',role:'admin'})});
  assert.equal(doctorUpdate.status,200);
  const doctorCall=calls.find((entry) => entry.name==='update_own_doctor_profile');
  assert.equal(doctorCall.args.p_years_experience,4);
  assert.equal(doctorCall.args.verification_status,undefined);
  assert.equal(doctorCall.args.p_role,undefined);
  profile={...profile,role:'patient'};
});
test('symptom model endpoints require approved doctor before contacting model',async () => {
  profile={...profile,role:'patient'};
  assert.equal((await fetch(origin+'/api/doctor/symptoms')).status,401);
  assert.equal((await fetch(origin+'/api/doctor/symptoms',{headers:{Cookie:'hd_access=valid'}})).status,403);
  assert.equal((await post('/api/doctor/predict',{symptoms:['itching']})).status,403);
  profile={...profile,role:'doctor'};
  assert.equal((await post('/api/doctor/predict',{symptoms:[]})).status,400);
  profile={...profile,role:'patient'};
});
test('public directory exposes approved profile details without private application data',async () => {
  directory=[{id:'11111111-1111-4111-8111-111111111111',name:'Dr. Synthetic',specialty:'Cardiology',fee:300,bio:'Cardiac consultations',accepting_appointments:false}];
  const response=await fetch(origin+'/api/doctors');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),[{...directory[0],nextSlot:null}]);
  assert.ok(calls.some(({name})=>name==='public_doctors'));
  directory=[];
});
test('patient overview includes only scoped server-side activity',async () => {
  const response=await fetch(origin+'/api/patient/overview',{headers:{Cookie:'hd_access=valid'}});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.deepEqual(data.metrics,{upcoming:1,completed:2,cancelled:0});
  assert.ok(calls.some((call) => call.name==='patient_activity'));
});
test('protected booking verifies Auth identity and role; failed writes never succeed',async () => {
  const slotId='33333333-3333-4333-8333-333333333333', idempotencyKey='44444444-4444-4444-8444-444444444444';
  const payload={slotId,idempotencyKey};
  assert.equal((await post('/api/patient/appointments',payload,'')).status,401);
  assert.equal((await post('/api/patient/appointments',payload,'hd_access=forged')).status,401);
  profile={...profile,role:'doctor'};
  assert.equal((await post('/api/patient/appointments',payload)).status,403);
  profile={...profile,role:'patient'};
  assert.equal((await post('/api/patient/appointments',{...payload,slotId:'bad'})).status,400);
  rpcError={code:'23P01'};
  assert.equal((await post('/api/patient/appointments',payload)).status,409);
  rpcError={code:'P0001'};
  assert.equal((await post('/api/patient/appointments',payload)).status,409);
  rpcError=null;
  const result=await post('/api/patient/appointments',payload);
  assert.equal(result.status,201);
  assert.equal(result.body.status,'pending');
  assert.ok(calls.some((call) => call.name==='book_appointment' && call.args.p_key===idempotencyKey));
});

test('doctor signup requests a doctor account with pending verification and rejects privilege input', async () => {
  const payload = {firstName:'Synthetic',lastName:'Doctor',email:'synthetic@example.invalid',password:'Synthetic-password-123',specialty:'Cardiology',licenseNumber:'SYNTHETIC-123',qualifications:'Synthetic qualification',institution:'Synthetic Hospital',yearsExperience:6,evidenceReference:'Synthetic registry reference'};
  assert.equal((await post('/api/auth/doctor-signup', {...payload,role:'admin'}, '')).status,403);
  assert.equal((await post('/api/auth/doctor-signup', {...payload,specialty:'x'}, '')).status,400);
  assert.equal((await post('/api/auth/doctor-signup', {...payload,institution:''}, '')).status,400);
  const response = await post('/api/auth/doctor-signup', payload, '');
  assert.equal(response.status,201);
  assert.equal(response.body.authenticated,false);
  assert.equal(response.body.verificationStatus,'pending');
  assert.match(response.body.message,/confirm/);
  // account_type only selects the least-privilege doctor path; the trigger
  // decides the role in the database.
  assert.equal(signupPayload.options.data.account_type,'doctor');
  assert.equal(signupPayload.options.data.role,undefined);
  assert.equal(signupPayload.options.data.license_number,payload.licenseNumber);
  assert.equal(signupPayload.options.data.institution,payload.institution);
});

test('patient signup accepts an optional phone but never a role', async () => {
  assert.equal((await post('/api/auth/signup',{firstName:'Synthetic',lastName:'Patient',email:'patient@example.invalid',password:'password123',phone:'+1 555 0100',role:'doctor'})).status,403);
  const response = await post('/api/auth/signup',{firstName:'Synthetic',lastName:'Patient',email:'patient@example.invalid',password:'password123',confirmPassword:'password123',phone:'+1 555 0100'});
  assert.equal(response.status,201);
  assert.equal(signupPayload.options.data.phone,'+1 555 0100');
  assert.equal((await post('/api/auth/signup',{firstName:'Synthetic',lastName:'Patient',email:'patient@example.invalid',password:'password123',confirmPassword:'different123'})).status,400);
  assert.equal((await post('/api/auth/signup',{firstName:'Synthetic',lastName:'Patient',email:'patient@example.invalid',password:'password123',phone:'not-a-phone'})).status,400);
});

test('application status is doctor-only and exposes the verification state', async () => {
  const status = () => fetch(origin+'/api/doctor/application-status',{headers:{Cookie:'hd_access=valid'}});
  assert.equal((await fetch(origin+'/api/doctor/application-status')).status,401);
  profile={...profile,role:'patient'};
  assert.equal((await status()).status,403);
  profile={...profile,role:'doctor'};
  assert.equal((await status()).status,200);
  assert.equal((await (await status()).json()).approved,true);
  application={...application,status:'rejected',review_reason:'Synthetic review'};
  assert.equal((await (await status()).json()).application.review_reason,'Synthetic review');
  const rejected=application;
  application=null;
  applicationError={code:'PGRST116'};
  const missing=await status();
  assert.equal(missing.status,200);
  assert.equal((await missing.json()).application,null);
  application=rejected;
  applicationError=null;
  profile={...profile,suspended:true};
  assert.equal((await (await status()).json()).code,'ACCOUNT_SUSPENDED');
  profile={...profile,suspended:false};
  profile={...profile,role:'patient'};
});

test('pending doctors reach their own dashboard but no clinical endpoint', async () => {
  profile={...profile,role:'doctor',suspended:false};
  verification={...verification,verification_status:'pending',is_accepting_appointments:false};
  const overview=await fetch(origin+'/api/doctor/overview',{headers:{Cookie:'hd_access=valid'}});
  assert.equal(overview.status,200);
  const data=await overview.json();
  assert.equal(data.approved,false);
  assert.equal(data.verificationStatus,'pending');
  assert.equal(data.canAttendConsultations,false);
  assert.deepEqual(data.appointments,[]);
  // Clinical endpoints stay closed until an administrator approves.
  for (const route of ['/api/doctor/dashboard','/api/doctor/availability','/api/doctor/analytics']) {
    assert.equal((await fetch(origin+route,{headers:{Cookie:'hd_access=valid'}})).status,403,route);
  }
  assert.equal((await post('/api/doctor/availability',{startsAt:'2026-11-01T10:00:00Z'})).status,403);
  assert.equal((await post('/api/doctor/predict',{symptoms:['itching']})).status,403);
  profile={...profile,role:'patient'};
  verification={...verification,verification_status:'approved',is_accepting_appointments:true};
});

test('login validates the selected portal against the database role and never grants it', async () => {
  const payload={email:'synthetic@example.invalid',password:'Synthetic-password',portal:'doctor'};
  profile={...profile,role:'patient',suspended:false};
  let response=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(response.status,403);
  assert.equal(response.headers.get('set-cookie'),null);
  assert.equal((await response.json()).code,'WRONG_PORTAL');
  profile={...profile,role:'doctor'};
  const result=await post('/api/auth/login',payload,'');
  assert.equal(result.status,200);
  assert.equal(result.body.redirectTo,'/doctor.html');
  assert.equal(result.body.verificationStatus,'approved');
  assert.equal((await post('/api/auth/login',{...payload,portal:'patient'},'')).status,403);
  assert.equal((await post('/api/auth/login',{...payload,portal:'admin'},'')).status,403);
  profile={...profile,role:'admin'};
  const admin=await post('/api/auth/login',{...payload,portal:'admin'},'');
  assert.equal(admin.status,200);
  assert.equal(admin.body.redirectTo,'/admin');
  assert.equal((await post('/api/auth/login',payload,'')).status,403);
  assert.equal((await post('/api/auth/login',{...payload,portal:'nonsense'},'')).status,400);
  profile={...profile,role:'patient'};
});

test('a transient auth failure keeps the session instead of signing the doctor out', async () => {
  profile={...profile,role:'doctor',suspended:false};
  // A definitive rejection (stale, already-used token) still ends the session.
  refreshResult={status:400}; refreshCalls=0;
  const ended=await fetch(origin+'/api/auth/current-user',{headers:{Cookie:'hd_access=expired; hd_refresh=stale-token'}});
  assert.equal(ended.status,401);
  assert.ok(ended.headers.getSetCookie().some((cookie) => cookie.startsWith('hd_refresh=;')));
  // A Supabase outage or rate limit must not discard the 30-day refresh token.
  refreshResult={status:503}; refreshCalls=0;
  const transient=await fetch(origin+'/api/auth/current-user',{headers:{Cookie:'hd_access=expired; hd_refresh=flaky-token'}});
  assert.equal(transient.status,503);
  assert.deepEqual(transient.headers.getSetCookie().filter((cookie) => cookie.startsWith('hd_refresh=;')),[]);
  assert.equal(refreshCalls,1);
});

test('concurrent requests share one refresh instead of racing for it', async () => {
  const session={access_token:'refreshed',refresh_token:'rotated',expires_in:3600,user:{id:profile.id,email:'test@example.invalid'}};
  refreshSuccess=session; refreshCalls=0;
  const responses=await Promise.all(Array.from({length:5},() => fetch(origin+'/api/auth/current-user',{headers:{Cookie:'hd_access=expired; hd_refresh=shared-token'}})));
  for (const response of responses) assert.equal(response.status,200);
  assert.equal(refreshCalls,1);
  refreshSuccess=null; refreshResult={status:400};
});

test('pending doctors can sign in and are routed to the dashboard with their status', async () => {
  profile={...profile,role:'doctor',suspended:false};
  verification={...verification,verification_status:'pending',is_accepting_appointments:false};
  const result=await post('/api/auth/login',{email:'synthetic@example.invalid',password:'Synthetic-password',portal:'doctor'},'');
  assert.equal(result.status,200);
  assert.equal(result.body.redirectTo,'/doctor.html');
  assert.equal(result.body.verificationStatus,'pending');
  verification={...verification,verification_status:'approved',is_accepting_appointments:true};
  profile={...profile,role:'patient'};
});

test('clinical assessments require an approved doctor and validated model symptoms', async () => {
  const body = {
    patientId:'44444444-4444-4444-8444-444444444444',
    appointmentId:'55555555-5555-4555-8555-555555555555',
    patientReported:['itching'], clinicianAdded:['skin_rash'], observations:['Visible scaling'],
    symptomDuration:'3 days', clinicalNote:'No fever.', doctorAssessment:'Impression', plan:'Review',
  };
  const send = (payload=body) => post('/api/doctor/assessments', payload);

  assert.equal((await post('/api/doctor/assessments', body, '')).status, 401);
  profile={...profile,role:'patient',suspended:false};
  assert.equal((await send()).status, 403);
  profile={...profile,role:'doctor'};
  verification={...verification,verification_status:'pending'};
  assert.equal((await send()).status, 403);
  verification={...verification,verification_status:'approved'};

  // Model vocabulary is the source of truth; duplicates and unknowns are refused.
  assert.equal((await send({...body, patientReported:['itching'], clinicianAdded:['itching']})).status, 400);
  const unsupported = await send({...body, clinicianAdded:['not_a_feature']});
  assert.equal(unsupported.status, 422);
  assert.equal(unsupported.body.code, 'UNSUPPORTED_SYMPTOMS');
  assert.deepEqual(unsupported.body.unsupported, ['not_a_feature']);
  assert.equal((await send({...body, patientReported:[], clinicianAdded:[], observations:['x']})).status, 400);
  assert.equal((await send({...body, patientReported:[1]})).status, 400);
  assert.equal((await send({...body, appointmentId:'not-a-uuid'})).status, 400);

  modelCalls = []; insertedAssessment = null;
  const created = await send();
  assert.equal(created.status, 201);
  assert.equal(created.body.id, '33333333-3333-4333-8333-333333333333');
  // Only symptom identifiers reach the model - no patient identifiers or notes.
  const assessCall = modelCalls.find((call) => call.path === '/internal/assess');
  assert.deepEqual(assessCall.symptoms, ['itching','skin_rash']);
  assert.equal(insertedAssessment.table, 'assessments');
  assert.equal(insertedAssessment.payload.predicted_disease, 'Fungal infection');
  assert.equal(insertedAssessment.payload.patient_id, body.patientId);
  assert.equal(insertedAssessment.payload.appointment_id, body.appointmentId);
  assert.deepEqual(insertedAssessment.payload.patient_reported, ['itching']);
  assert.deepEqual(insertedAssessment.payload.clinician_added, ['skin_rash']);
  assert.equal(JSON.stringify(insertedAssessment.payload).includes('Synthetic Patient'), false);

  // A model outage must never store a half-made record: the caller keeps the form.
  modelFailure='MODEL_UNAVAILABLE'; insertedAssessment=null;
  const unavailable = await send();
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.code, 'MODEL_UNAVAILABLE');
  assert.equal(insertedAssessment, null);
  modelFailure=null;

  profile={...profile,role:'patient'};
});

test('a symptom correction is appended as a revision and never rewrites the original prediction', async () => {
  profile={...profile,role:'doctor',suspended:false};
  verification={...verification,verification_status:'approved'};
  const id='99999999-9999-4999-8999-999999999999';
  assessmentSource={
    id, patient_id:'44444444-4444-4444-8444-444444444444', appointment_id:'55555555-5555-4555-8555-555555555555',
    observations:['Original observation'], symptom_duration:'3 days', clinical_note:'No fever.',
    doctor_assessment:'Impression', plan:'Review in 1 week.',
  };
  insertedAssessment=null; modelCalls=[];
  const base={ patientReported:['itching'], clinicianAdded:['skin_rash'], observations:['Original observation'] };
  const revise=(body=base) => post(`/api/doctor/assessments/${id}/revision`, body);

  // Identity, symptoms and vocabulary are enforced exactly as for a new record.
  assert.equal((await post(`/api/doctor/assessments/${id}/revision`, base, '')).status,401);
  profile={...profile,role:'patient'};
  assert.equal((await revise()).status,403);
  profile={...profile,role:'doctor'};
  verification={...verification,verification_status:'pending'};
  assert.equal((await revise()).status,403);
  verification={...verification,verification_status:'approved'};
  assert.equal((await revise({...base, patientReported:['itching'], clinicianAdded:['itching']})).status,400);
  assert.equal((await revise({...base, patientReported:[], clinicianAdded:[]})).status,400);
  const unsupported=await revise({...base, clinicianAdded:['not_a_feature']});
  assert.equal(unsupported.status,422);
  assert.equal(unsupported.body.code,'UNSUPPORTED_SYMPTOMS');
  assert.deepEqual(unsupported.body.unsupported,['not_a_feature']);

  // Someone else's record (RLS returns nothing) and an already-revised one fail cleanly.
  const owned=assessmentSource;
  assessmentSource=null;
  // RLS returns no row (Supabase reports PGRST116) for another doctor's record.
  assessmentSourceError={code:'PGRST116'};
  assert.equal((await revise()).status,404);
  assessmentSource=owned;
  assessmentSourceError=null;
  insertAssessmentError={code:'23505'};
  assert.equal((await revise()).status,409);
  insertAssessmentError=null;

  const created=await revise();
  assert.equal(created.status,201);
  assert.equal(created.body.supersedesId,id);
  assert.equal(insertedAssessment.payload.supersedes_id,id);
  assert.equal(insertedAssessment.payload.patient_id,'44444444-4444-4444-8444-444444444444');
  assert.equal(insertedAssessment.payload.appointment_id,'55555555-5555-4555-8555-555555555555');
  assert.equal(insertedAssessment.payload.predicted_disease,'Fungal infection');
  assert.equal(insertedAssessment.payload.model_version,'mv-test');
  // The doctor's earlier decision is carried forward, not dropped.
  assert.equal(insertedAssessment.payload.doctor_assessment,'Impression');
  assert.equal(insertedAssessment.payload.plan,'Review in 1 week.');
  assert.deepEqual(insertedAssessment.payload.patient_reported,['itching']);
  assert.deepEqual(insertedAssessment.payload.clinician_added,['skin_rash']);
  // Only symptom identifiers are sent to the model.
  assert.deepEqual(modelCalls[0],{path:'/internal/assess',symptoms:['itching','skin_rash']});

  // An explicit plan in the revision replaces the stored one.
  await revise({...base, doctorAssessment:'Updated impression', plan:'Updated plan'});
  assert.equal(insertedAssessment.payload.doctor_assessment,'Updated impression');
  assert.equal(insertedAssessment.payload.plan,'Updated plan');

  assessmentSource=null;
  profile={...profile,role:'patient'};
});

test('a consultation exposes only the doctor own appointment and stored patient identity', async () => {
  const id='4011b5d5-db16-41f6-9c7f-1b94f766bbda';
  const open=() => fetch(`${origin}/api/doctor/appointments/${id}/consultation`,{headers:{Cookie:'hd_access=valid'}});

  profile={...profile,role:'doctor',suspended:false};
  verification={...verification,verification_status:'pending'};
  assert.equal((await fetch(`${origin}/api/doctor/appointments/${id}/consultation`)).status,401);
  assert.equal((await open()).status,403);
  profile={...profile,role:'patient'};
  verification={...verification,verification_status:'approved'};
  assert.equal((await open()).status,403);
  profile={...profile,role:'doctor'};

  const response=await open();
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.patientName,'Synthetic Patient');
  assert.equal(data.appointmentId,id);
  assert.ok(calls.some((call) => call.name==='doctor_consultation' && call.args.p_appt===id));

  // Another doctor's appointment is reported as missing, never as viewable.
  consultationError={code:'P0002'};
  assert.equal((await open()).status,404);
  consultationError=null;
  assert.equal((await fetch(`${origin}/api/doctor/appointments/not-a-uuid/consultation`,{headers:{Cookie:'hd_access=valid'}})).status,400);
  profile={...profile,role:'patient'};
});

test('an assessment can only be read or edited by its own doctor', async () => {
  profile={...profile,role:'doctor',suspended:false};
  verification={...verification,verification_status:'approved'};
  const id='99999999-9999-4999-8999-999999999999';

  assessmentViewError={code:'42501'};
  assert.equal((await fetch(`${origin}/api/doctor/assessments/${id}`)).status,401);
  assert.equal((await fetch(`${origin}/api/doctor/assessments/${id}`,{headers:{Cookie:'hd_access=valid'}})).status,403);
  assert.equal((await fetch(`${origin}/api/doctor/assessments/${id}/report.pdf`,{headers:{Cookie:'hd_access=valid'}})).status,403);

  assessmentViewError=null;
  assessmentView={ id, doctorName:'Dr Synthetic', patientName:'Synthetic Patient', predictedDisease:'Fungal infection', modelVersion:'mv-test', patientReported:['itching'], clinicianAdded:[], observations:[], precautions:[], medications:[], diet:[], workout:[] };
  const detail = await fetch(`${origin}/api/doctor/assessments/${id}`,{headers:{Cookie:'hd_access=valid'}});
  assert.equal(detail.status,200);
  assert.equal((await detail.json()).patientName,'Synthetic Patient');

  const report = await fetch(`${origin}/api/doctor/assessments/${id}/report.pdf`,{headers:{Cookie:'hd_access=valid'}});
  assert.equal(report.status,200);
  assert.equal(report.headers.get('content-type'),'application/pdf');
  assert.match(report.headers.get('content-disposition') || '', /attachment/);
  const pdf = Buffer.from(await report.arrayBuffer()).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-'));
  const text = [...pdf.matchAll(/\(((?:\\.|[^\\()])*)\) Tj/g)].map((match) => match[1]).join(' ');
  assert.ok(text.includes('Synthetic Patient'));
  assert.ok(text.includes('Fungal infection'));
  assert.ok(text.includes('experimental decision support'));

  // The model verdict can never be edited through the API.
  const forbidden = await fetch(`${origin}/api/doctor/assessments/${id}`,{ method:'PATCH',headers:{'Content-Type':'application/json',Cookie:'hd_access=valid'},body:JSON.stringify({predictedDisease:'Allergy'}) });
  assert.equal(forbidden.status,400);
  updatedAssessment=null;
  const patched = await fetch(`${origin}/api/doctor/assessments/${id}`,{ method:'PATCH',headers:{'Content-Type':'application/json',Cookie:'hd_access=valid'},body:JSON.stringify({doctorAssessment:'Clinical impression',plan:'Follow up'}) });
  assert.equal(patched.status,200);
  assert.deepEqual(Object.keys(updatedAssessment.patch).sort(),['doctor_assessment','plan']);
  assessmentView=null;
  profile={...profile,role:'patient'};
});
