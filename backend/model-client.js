const http = require('node:http');
const https = require('node:https');

// Every failure gets one of these codes. The browser turns the code into a
// short, actionable message, and the API never forwards an upstream body (which
// could contain model internals) to the doctor.
const FAILURES = {
  MODEL_NOT_CONFIGURED: 'Model service is not configured. Contact the site administrator.',
  MODEL_UNREACHABLE: 'The private model service is not running or cannot be reached.',
  MODEL_TIMEOUT: 'The private model service did not answer in time.',
  MODEL_AUTH: 'The backend and the private model service disagree about the internal token.',
  MODEL_UNAVAILABLE: 'The private model service reported that it cannot answer right now.',
  MODEL_INVALID_RESPONSE: 'The private model service returned an unusable response.',
};

function modelFailure(code) {
  return Object.assign(new Error(FAILURES[code] || FAILURES.MODEL_UNAVAILABLE), { code });
}

function modelRequest(path, symptoms) {
  const token = process.env.PREDICTION_INTERNAL_TOKEN;
  if (!token) return Promise.reject(modelFailure('MODEL_NOT_CONFIGURED'));
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
        if (data.length > 65536) call.destroy(modelFailure('MODEL_INVALID_RESPONSE'));
      });
      response.on('end', () => {
        if (response.statusCode === 422) return reject(Object.assign(new Error('Select symptoms from the model list.'), { code: 'INVALID_SYMPTOMS' }));
        if (response.statusCode === 401 || response.statusCode === 403) return reject(modelFailure('MODEL_AUTH'));
        if (response.statusCode !== 200) return reject(modelFailure('MODEL_UNAVAILABLE'));
        try { resolve(JSON.parse(data)); } catch { reject(modelFailure('MODEL_INVALID_RESPONSE')); }
      });
    });
    call.on('timeout', () => call.destroy(modelFailure('MODEL_TIMEOUT')));
    call.on('error', (error) => reject(error.code && FAILURES[error.code] ? error : modelFailure('MODEL_UNREACHABLE')));
    call.end(body || undefined);
  });
}

function validSymptoms(symptoms) {
  return Array.isArray(symptoms) && symptoms.length > 0 && symptoms.length <= 132 &&
    symptoms.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 80) &&
    new Set(symptoms).size === symptoms.length;
}

// The vocabulary changes only when the model service restarts, so a short cache
// keeps the assessment form fast without risking a stale feature list.
let vocabularyCache = { data: null, at: 0 };
async function symptomVocabulary({ maxAge = 60 * 1000 } = {}) {
  if (vocabularyCache.data && Date.now() - vocabularyCache.at < maxAge) return vocabularyCache.data;
  const payload = await modelRequest('/internal/symptoms');
  const symptoms = payload && Array.isArray(payload.symptoms)
    ? payload.symptoms.filter((item) => typeof item === 'string' && item.trim())
    : [];
  // An empty vocabulary would leave the picker with nothing to search. Treat it
  // as a broken model response rather than as a valid empty list.
  if (!symptoms.length) throw modelFailure('MODEL_INVALID_RESPONSE');
  const labels = payload.labels && typeof payload.labels === 'object' ? payload.labels : {};
  vocabularyCache = { data: { symptoms, labels }, at: Date.now() };
  return vocabularyCache.data;
}

module.exports = { modelRequest, validSymptoms, symptomVocabulary, modelFailure };
