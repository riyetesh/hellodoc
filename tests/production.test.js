const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require.resolve('../backend/production');
// production.js calls dotenv with no path, so it would load backend/.env when
// the suite runs from backend/. The dotenv stub keeps the missing-configuration
// case isolated from a developer's local file.
const dotenvPath=require.resolve('../backend/node_modules/dotenv');
const dotenv=require(dotenvPath);
const realDotenvConfig=dotenv.config;
async function instance(env,run) {
 const saved={...process.env};
 for(const key of ['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','APP_ORIGIN','VERCEL_ENV','VERCEL_URL']) delete process.env[key];
 dotenv.config=()=>{ return { parsed: {} }; };
 Object.assign(process.env,env); delete require.cache[path]; const app=require(path); const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 try { await run(`http://127.0.0.1:${server.address().port}`); } finally {await new Promise(r=>server.close(r)); dotenv.config=realDotenvConfig; process.env=saved;}
}
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',APP_ORIGIN:'https://hellodoc.example'};
test('missing configuration stays inspectable and never falls back to MySQL',async()=>instance({},async url=>{
 const response=await fetch(url+'/api/health'); assert.equal(response.status,503); assert.deepEqual(await response.json(),{status:'unavailable',application:'running',configuration:'invalid',problems:['SUPABASE_URL is missing','SUPABASE_PUBLISHABLE_KEY is missing','APP_ORIGIN is missing'],supabase:'not_checked'});
 assert.equal((await fetch(url+'/api/auth/login',{method:'POST'})).status,503);
}));
test('privileged keys rejected by production configuration',async()=>instance({...env,SUPABASE_PUBLISHABLE_KEY:'sb_secret_never_use'},async url=>{
 const response=await fetch(url+'/api/health'); assert.equal(response.status,503);
 const body=await response.json();
 assert.equal(body.configuration,'invalid');
 assert.deepEqual(body.problems,['SUPABASE_PUBLISHABLE_KEY must be the publishable/anon key; secret keys are rejected']);
 assert.ok(!JSON.stringify(body).includes('sb_secret_never_use'),'the rejected key must never be echoed');
}));
test('an origin with a path is rejected instead of silently trusted',async()=>instance({...env,APP_ORIGIN:'https://hellodoc.example/app'},async url=>{
 const body=await (await fetch(url+'/api/health')).json();
 assert.deepEqual(body.problems,['APP_ORIGIN must be a bare origin with no path, e.g. https://example.com']);
}));
test('readiness distinguishes successful schema query and connectivity failure safely',async()=>instance(env,async url=>{
 const real=global.fetch;
 try {
 global.fetch=async(input,options)=>String(input).startsWith('https://example.supabase.co') ? new Response('[]',{status:200}) : real(input,options);
 const ready=await fetch(url+'/api/health'); assert.equal(ready.status,200); assert.equal((await ready.json()).supabase,'connected');
 global.fetch=async(input,options)=>String(input).startsWith('https://example.supabase.co') ? new Response('private internal details',{status:401}) : real(input,options);
 const down=await fetch(url+'/api/health'); assert.equal(down.status,503); assert.ok(!(await down.text()).includes('private internal'));
 } finally {global.fetch=real;}
}));
test('production retains full API paths and denies anonymous admin/foreign origin',async()=>instance(env,async url=>{
 assert.equal((await fetch(url+'/api/admin/patients')).status,401);
 assert.equal((await fetch(url+'/api/auth/signup',{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await fetch(url+'/api/auth/signup',{method:'POST',headers:{Origin:env.APP_ORIGIN,'Content-Type':'application/json'},body:'{"role":"admin"}'})).status,403);
}));
