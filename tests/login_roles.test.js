const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('login entry points and role switch retain one server-authorized login flow', () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {style:{},dataset:{},listeners:{},addEventListener(event,fn){this.listeners[event]=fn;},focus(){},querySelector(){return null;}});
    return nodes.get(id);
  };
  const patient = node('patientLink'); patient.dataset.loginRole='patient';
  const doctor = node('doctorLink'); doctor.dataset.loginRole='doctor';
  node('login-modal').querySelectorAll = () => [patient,doctor];
  const document = {getElementById:node,addEventListener(event,fn){if(event==='DOMContentLoaded')fn();}};
  const window = {location:{search:'?login=doctor'},addEventListener(){}};
  vm.runInNewContext(fs.readFileSync('Scripts/login.js','utf8'),{document,window,URLSearchParams});
  assert.equal(node('login-modal-title').textContent,'Log in as a doctor');
  patient.listeners.click({preventDefault(){}});
  assert.equal(node('login-modal-title').textContent,'Log in as a patient');
  node('doctorLoginBtn').listeners.click({preventDefault(){}});
  assert.equal(node('login-modal-title').textContent,'Log in as a doctor');
  const script=fs.readFileSync('Scripts/login.js','utf8');
  assert.match(script,/fetch\("\/api\/auth\/login"/);
  assert.match(script,/data\.role === "doctor_applicant"/);
});

test('doctor navigation targets real dashboard sections including protected predictor', () => {
  const html=fs.readFileSync('doctor.html','utf8');
  for(const id of ['doctorAppointments','doctorAvailability','doctorAnalytics','doctorPredictor']) {
    assert.ok(html.includes(`href="#${id}"`));
    assert.ok(html.includes(`id="${id}"`));
  }
  assert.ok(html.includes('id="workspace" hidden'));
  assert.ok(html.includes('id="predictionForm"'));
});
