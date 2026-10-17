const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { modelRequest } = require('../backend/model-client');
test('private model transport preserves validation failures and requires configuration', async () => {
  const oldToken=process.env.PREDICTION_INTERNAL_TOKEN, oldOrigin=process.env.FLASK_ORIGIN;
  const server=http.createServer((req,res)=>{
    assert.equal(req.headers['x-internal-token'],'synthetic-transport-token');
    res.writeHead(422,{'Content-Type':'application/json'}); res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    delete process.env.PREDICTION_INTERNAL_TOKEN;
    await assert.rejects(modelRequest('/internal/symptoms'),{code:'MODEL_NOT_CONFIGURED'});
    process.env.PREDICTION_INTERNAL_TOKEN='synthetic-transport-token';
    process.env.FLASK_ORIGIN=`http://127.0.0.1:${server.address().port}`;
    await assert.rejects(modelRequest('/internal/predict',['invalid']),{code:'INVALID_SYMPTOMS'});
  } finally {
    await new Promise(resolve=>server.close(resolve));
    for(const [key,value] of Object.entries({PREDICTION_INTERNAL_TOKEN:oldToken,FLASK_ORIGIN:oldOrigin})) {
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
