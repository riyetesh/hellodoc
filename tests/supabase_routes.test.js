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
const makeQuery = (table) => {
  const query = {
    select() { return this; }, eq() { return this; },
    order() { return this; }, limit() { return Promise.resolve({data:[],error:null}); },
    async single() { return { data:table === 'profiles' ? profile : table === 'doctor_applications' ? application : {verification_status:'approved'},error:table === 'doctor_applications' ? applicationError : null }; },
  };
  return query;
};
const fake = () => ({
  auth: {
    async getUser(token) { return { data:{user:token==='valid' ? {id:profile.id,email:'test@example.invalid'} : null} }; },
    async refreshSession() { return { data:{session:null} }; },
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
test('doctor application requires patient identity and never assigns doctor role',async () => {
  const payload={specialty:'Cardiology',licenseNumber:'SYNTHETIC-123'};
  assert.equal((await post('/api/doctor/apply',payload,'')).status,401);
  profile={...profile,role:'doctor'};
  assert.equal((await post('/api/doctor/apply',payload)).status,403);
  profile={...profile,role:'patient'};
  assert.equal((await post('/api/doctor/apply',{...payload,specialty:'x'})).status,400);
  const result=await post('/api/doctor/apply',payload);
  assert.equal(result.status,201);
  assert.ok(calls.some((call) => call.name==='apply_as_doctor' && call.args.p_license_number==='SYNTHETIC-123'));
  assert.equal(profile.role,'patient');
  rpcError={code:'PGRST202'};
  const missing=await post('/api/doctor/apply',payload);
  assert.equal(missing.status,503);
  assert.match(missing.body.message,/not configured/);
  rpcError=null;
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

test('independent doctor signup uses only applicant metadata and rejects privilege input', async () => {
  const payload = {firstName:'Synthetic',lastName:'Applicant',email:'synthetic@example.invalid',password:'Synthetic-password-123',specialty:'Cardiology',licenseNumber:'SYNTHETIC-123',qualifications:'Synthetic qualification',evidenceReference:'Synthetic registry reference'};
  assert.equal((await post('/api/auth/doctor-signup', {...payload,role:'admin'}, '')).status,403);
  assert.equal((await post('/api/auth/doctor-signup', {...payload,specialty:'x'}, '')).status,400);
  const response = await post('/api/auth/doctor-signup', payload, '');
  assert.equal(response.status,201);
  assert.equal(response.body.authenticated,false);
  assert.match(response.body.message,/confirm/);
  assert.equal(signupPayload.options.data.account_type,'doctor_applicant');
  assert.equal(signupPayload.options.data.role,undefined);
  assert.equal(signupPayload.options.data.license_number,payload.licenseNumber);
});

test('application status is authenticated, applicant-only, and distinguishes missing and suspended accounts', async () => {
  const status = () => fetch(origin+'/api/doctor/application-status',{headers:{Cookie:'hd_access=valid'}});
  assert.equal((await fetch(origin+'/api/doctor/application-status')).status,401);
  profile={...profile,role:'patient'};
  assert.equal((await status()).status,403);
  profile={...profile,role:'doctor_applicant'};
  assert.equal((await status()).status,200);
  assert.equal((await fetch(origin+'/api/doctor/dashboard',{headers:{Cookie:'hd_access=valid'}})).status,403);
  application={...application,status:'rejected',review_reason:'Synthetic review'};
  assert.equal((await (await status()).json()).application.review_reason,'Synthetic review');
  applicationError={code:'PGRST116'};
  assert.equal((await status()).status,404);
  applicationError=null;
  profile={...profile,suspended:true};
  assert.equal((await (await status()).json()).code,'ACCOUNT_SUSPENDED');
  profile={...profile,role:'doctor',suspended:false};
  assert.equal((await (await status()).json()).approved,true);
  profile={...profile,role:'patient'};
});
