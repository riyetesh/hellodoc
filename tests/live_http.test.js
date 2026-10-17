const test = require('node:test');
const assert = require('node:assert/strict');
const origin=process.env.TEST_ORIGIN || 'http://127.0.0.1:3000';
const publicOrigin=process.env.TEST_PUBLIC_ORIGIN || 'https://pv-d5b4f89787fe-6896bd08-bc73-41ea-870e-93ba5caab932.style.dev';
test('live public pages and persisted directory are served',async () => {
 for (const route of ['/','/signup.html','/admin','/Styles/admin.css','/Scripts/admin.js']) assert.equal((await fetch(origin+route)).status,200,route);
 const response=await fetch(origin+'/api/doctors'); assert.equal(response.status,200); assert.ok(Array.isArray(await response.json()));
});
test('live admin API and private records fail closed without a session',async () => {
 for (const route of ['/api/admin/patients','/api/admin/doctors','/api/admin/audit','/api/admin/overview?since=2026-10-01&until=2026-10-17','/api/patient/overview']) assert.equal((await fetch(origin+route)).status,401,route);
});
test('live mutations reject foreign origins and elevated signup roles',async () => {
 const post=(path,body,header) => fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:header},body:JSON.stringify(body)});
 assert.equal((await post('/api/auth/login',{},'https://attacker.invalid')).status,403);
 assert.equal((await post('/api/auth/signup',{role:'admin'},publicOrigin)).status,403);
 assert.equal((await post('/api/admin/actions',{},publicOrigin)).status,401);
});
test('Supabase Data API grants no anonymous private access or bootstrap',async () => {
 const url='https://fsqtjdavnfjnwsbswqel.supabase.co/rest/v1';
 const headers={apikey:process.env.TEST_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_qYmvye6S1Pv55jW9mjJjlw_DNOjhY92','Content-Type':'application/json'};
 for (const table of ['profiles','patient_profiles','appointments','doctor_applications','admin_audit_logs']) assert.ok([401,403].includes((await fetch(`${url}/${table}?select=*`,{headers})).status),table);
 for (const [rpc,body] of [['admin_list',{p_kind:'patients'}],['bootstrap_first_admin',{p_user:'11111111-1111-4111-8111-111111111111'}]]) assert.ok([401,403].includes((await fetch(`${url}/rpc/${rpc}`,{method:'POST',headers,body:JSON.stringify(body)})).status),rpc);
});
