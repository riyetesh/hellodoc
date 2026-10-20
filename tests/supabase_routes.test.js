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
const makeQuery = (table) => {
  const query = {
    select() { return this; }, eq() { return this; },
    order() { return this; }, limit() { return Promise.resolve({data:[],error:null}); },
    async single() { return { data:table === 'profiles' ? profile : table === 'doctor_applications' ? application : verification,error:table === 'doctor_applications' ? applicationError : null }; },
  };
  return query;
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
  async rpc(name,args) { calls.push({name,args}); return {data:name === 'patient_activity' ? {upcoming:1,completed:2,cancelled:0} : name === 'public_doctors' ? directory : name === 'apply_as_doctor' ? {status:'pending'} : {id:'22222222-2222-4222-8222-222222222222',status:'pending'},error:rpcError}; },
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
