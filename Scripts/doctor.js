(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const message = (value) => { $('#message').textContent = value; };
  async function request(path, options = {}) {
    const response = await fetch('/api/doctor' + path, { credentials:'same-origin', ...options, headers:{ 'Content-Type':'application/json', ...options.headers } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'Request failed');
    return body;
  }
  async function load() {
    const filters = new FormData($('#filters'));
    const data = await request('/dashboard');
    const list = $('#appointments');
    list.replaceChildren();
    const rows = data.appointments.filter((a) => (!filters.get('status') || filters.get('status') === a.status) && (!filters.get('date') || a.startsAt.startsWith(filters.get('date'))));
    if (!rows.length) list.textContent = 'No appointments match these filters.';
    for (const appointment of rows) {
      const card = document.createElement('article');
      const title = document.createElement('strong');
      title.textContent = appointment.firstName;
      const detail = document.createElement('p');
      detail.textContent = `${new Date(appointment.startsAt).toLocaleString()} · ${appointment.status}`;
      card.append(title,detail);
      const transitions = { pending:['confirmed','cancelled'], confirmed:['completed','no_show','cancelled'] };
      for (const status of transitions[appointment.status] || []) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'btn btn-outline'; button.textContent = `Mark ${status}`;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await request(`/appointments/${appointment.id}/status`, { method:'PATCH', body:JSON.stringify({ status }) });
            await load(); message(`Appointment marked ${status}.`);
          } catch (error) { message(error.message); button.disabled = false; }
        });
        card.append(button);
      }
      list.append(card);
    }
    const now = new Date();
    const since = new Date(now.getTime()-30*86400000).toISOString().slice(0,10);
    const until = now.toISOString().slice(0,10);
    const metrics = await request(`/analytics?since=${since}&until=${until}`);
    $('#analytics').textContent = `Last 30 days (UTC): ${metrics.total} appointments; ${metrics.counts.completed} completed, ${metrics.counts.cancelled} cancelled, ${metrics.counts.no_show} no-show. Cancellation rate: ${(metrics.cancellationRate*100).toFixed(1)}%.`;
  }
  async function availability() {
    const rows = await request('/availability');
    const list = $('#slots'); list.replaceChildren();
    if (!rows.length) list.textContent = 'No future slots.';
    for (const row of rows) {
      const item = document.createElement('p');
      item.textContent = `${new Date(row.scheduled_start).toLocaleString()} · ${row.status}`;
      list.append(item);
    }
  }
  async function loadSymptoms() {
    const select = $('#modelSymptoms');
    const button = $('#predictionForm').querySelector('button');
    button.disabled = true;
    try {
      const data = await request('/symptoms');
      if (!Array.isArray(data.symptoms)) throw new Error('Symptom model unavailable');
      select.replaceChildren(...data.symptoms.map((value) => new Option(value.replaceAll('_',' '),value)));
      $('#predictionStatus').textContent = 'Model ready. Select symptoms to run it.';
      button.disabled = false;
    } catch (error) {
      $('#predictionStatus').textContent = error.message;
    }
  }
  $('#predictionForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const symptoms = [...$('#modelSymptoms').selectedOptions].map((item) => item.value);
    const button = event.target.querySelector('button');
    button.disabled = true;
    $('#predictionStatus').textContent = 'Running model…';
    try {
      const result = await request('/predict', {method:'POST',body:JSON.stringify({symptoms})});
      $('#predictionStatus').textContent = `${result.output}. ${result.label}`;
    } catch (error) { $('#predictionStatus').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('#slotForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button'); button.disabled = true;
    try {
      const local = new FormData(event.target).get('startsAt');
      await request('/availability',{method:'POST',body:JSON.stringify({ startsAt:new Date(local).toISOString() })});
      event.target.reset(); await availability(); message('Slot saved.');
    } catch (error) { message(error.message); } finally { button.disabled = false; }
  });
  $('#filters').addEventListener('submit', (event) => { event.preventDefault(); load().catch((error) => message(error.message)); });
  $('#logout').addEventListener('click', async () => {
    const response = await fetch('/api/auth/logout', { method:'POST', credentials:'same-origin' });
    if (response.ok) window.location.assign('index.html');
    else message('Could not log out. Retry.');
  });
  (async () => {
    try {
      const response = await fetch('/api/auth/current-user', { credentials:'same-origin' });
      if (!response.ok || (await response.json()).role !== 'doctor') throw new Error('Sign in as a doctor to view appointments.');
      // Confirm clinical approval before revealing tools; load panels independently.
      await request('/application-status');
      $('#workspace').hidden = false; message('');
      await Promise.all([
        load().catch(() => { $('#appointments').textContent = 'Appointments or analytics unavailable. Retry using Apply filters.'; }),
        availability().catch(() => { $('#slots').textContent = 'Availability unavailable. Please reload to retry.'; }),
        loadSymptoms()
      ]);
    } catch (error) { message(error.message); }
  })();
})();
