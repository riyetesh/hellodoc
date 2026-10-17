require('dotenv').config();
const express = require('express');
const app = express();
app.disable('x-powered-by');
const config = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_PUBLISHABLE_KEY,
  origin: process.env.APP_ORIGIN || (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
};
function configured() {
  try {
    return new URL(config.url).protocol === 'https:' && new URL(config.origin).origin === config.origin &&
      (config.key?.startsWith('sb_publishable_') || (config.key?.split('.').length === 3 && JSON.parse(Buffer.from(config.key.split('.')[1], 'base64url')).role === 'anon'));
  } catch { return false; }
}
app.use((req,res,next) => {
  res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'});
  next();
});
app.get(['/api/health','/api/auth/health'],async (req,res) => {
  if (!configured()) return res.status(503).json({status:'unavailable',application:'running',configuration:'invalid',supabase:'not_checked'});
  try {
    // Exercise the actual Data API, schema and directory RPC without private rows.
    const response=await fetch(`${config.url}/rest/v1/rpc/public_doctors`,{method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
    if (!response.ok) {
      console.error(JSON.stringify({event:'supabase_readiness_failed',status:response.status}));
      return res.status(503).json({status:'unavailable',application:'running',configuration:'valid',supabase:'unavailable'});
    }
    if (!Array.isArray(await response.json())) throw new Error('Invalid directory response');
    res.json({status:'ok',application:'running',configuration:'valid',supabase:'connected'});
  } catch(error) {
    console.error(JSON.stringify({event:'supabase_readiness_failed',errorType:error.name}));
    res.status(503).json({status:'unavailable',application:'running',configuration:'valid',supabase:'unavailable'});
  }
});
app.use('/api',(req,res,next) => configured() ? next() : res.status(503).json({code:'CONFIGURATION_UNAVAILABLE',message:'Service configuration is unavailable. Contact support.'}));
app.use(express.json({limit:'16kb'}));
app.use((req,res,next) => {
  if (['POST','PATCH','PUT','DELETE'].includes(req.method) && req.get('origin') !== config.origin) return res.status(403).json({message:'Invalid origin'});
  next();
});
if (configured()) app.use('/api',require('./supabase-routes')({url:config.url,key:config.key,origin:config.origin}));
app.use('/api',(req,res) => res.status(404).json({message:'API route not found'}));
app.use((error,req,res,next) => {
  console.error(JSON.stringify({event:'request_failed',errorType:error.name}));
  res.status(error.type === 'entity.parse.failed' ? 400 : 500).json({message:'Unable to process request'});
});
if (require.main === module) app.listen(Number(process.env.PORT)||3000,'0.0.0.0');
module.exports=app;
