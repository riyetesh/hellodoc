const http = require('node:http');
const https = require('node:https');

function modelRequest(path, symptoms) {
  const token = process.env.PREDICTION_INTERNAL_TOKEN;
  if (!token) return Promise.reject(Object.assign(new Error('Model service is not configured. Contact the site administrator.'), { code:'MODEL_NOT_CONFIGURED' }));
  const origin = new URL(process.env.FLASK_ORIGIN || `http://127.0.0.1:${process.env.FLASK_PORT || 5001}`);
  const target = new URL(path, origin);
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const body = symptoms === undefined ? null : JSON.stringify({ symptoms });
    const call = transport.request(target, {
      method: body ? 'POST' : 'GET', timeout: 10000,
      headers: { 'X-Internal-Token': token, ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) }
    }, (response) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
        if (data.length > 65536) call.destroy(new Error('Model response too large'));
      });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(Object.assign(new Error(response.statusCode === 422 ? 'Select symptoms from the model list.' : 'Model service unavailable.'), { code:response.statusCode === 422 ? 'INVALID_SYMPTOMS' : 'MODEL_UNAVAILABLE' }));
        try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid model response')); }
      });
    });
    call.on('timeout', () => call.destroy(new Error('Model timed out')));
    call.on('error', reject);
    call.end(body || undefined);
  });
}

function validSymptoms(symptoms) {
  return Array.isArray(symptoms) && symptoms.length > 0 && symptoms.length <= 132 &&
    symptoms.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 80) &&
    new Set(symptoms).size === symptoms.length;
}

module.exports = { modelRequest, validSymptoms };
