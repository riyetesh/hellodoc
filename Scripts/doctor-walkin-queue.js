/* Doctor-facing walk-in queue: ordered stack with call/seen/skip actions. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const dialog = $('walkinDialog');
  if (!dialog || !$('walkinQueueList')) return;
  const list = $('walkinQueueList');
  const state = $('walkinQueueState');
  const errorBox = $('walkinQueueError');
  const empty = $('walkinQueueEmpty');
  let busy = false;
  async function request(path, options = {}) {
    const response = await fetch('/api' + path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const e = new Error(data.message || 'The walk-in queue could not be loaded.'); e.status = response.status; throw e; }
    return data;
  }
  function setError(message) { errorBox.textContent = message || ''; errorBox.hidden = !message; }
  function time(value) { if (!value || Number.isNaN(Date.parse(value))) return 'time unavailable'; return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
  function render(rows) {
    list.replaceChildren();
    const active = rows.filter((row) => row.status === 'waiting' || row.status === 'called');
    empty.hidden = active.length > 0;
    active.forEach((row, index) => {
      const card = document.createElement('article'); card.className = 'walkin-queue-card' + (row.status === 'called' ? ' is-called' : '');
      const number = document.createElement('span'); number.className = 'walkin-queue-card__number'; number.textContent = String(row.position || index + 1);
      const main = document.createElement('div'); main.className = 'walkin-queue-card__main';
      const name = document.createElement('h3'); name.textContent = row.patientName || 'Walk-in patient';
      const meta = document.createElement('p'); meta.textContent = (row.status === 'called' ? 'Called to consultation' : 'Waiting') + ' · Joined ' + time(row.joinedAt);
      main.append(name, meta);
      if (row.reason) { const reason = document.createElement('p'); reason.className = 'walkin-queue-card__reason'; reason.textContent = row.reason; main.append(reason); }
      const actions = document.createElement('div'); actions.className = 'walkin-queue-card__actions';
      if (row.status === 'waiting') { const call = document.createElement('button'); call.type = 'button'; call.className = 'btn btn-primary'; call.textContent = index === 0 ? 'Call next' : 'Call patient'; call.addEventListener('click', () => advance(row.id, 'called')); actions.append(call); }
      const seen = document.createElement('button'); seen.type = 'button'; seen.className = 'btn btn-outline'; seen.textContent = 'Mark seen'; seen.addEventListener('click', () => advance(row.id, 'seen'));
      const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'btn btn-ghost'; skip.textContent = 'Skip'; skip.addEventListener('click', () => advance(row.id, 'left'));
      actions.append(seen, skip); card.append(number, main, actions); list.append(card);
    });
    state.textContent = active.length ? active.length + ' patient' + (active.length === 1 ? '' : 's') + ' in the queue' : 'Queue checked';
  }
  async function refresh() {
    if (busy) return; busy = true; state.textContent = 'Loading queue…'; setError(''); empty.hidden = true;
    try { const rows = await request('/doctor/walkin'); render(Array.isArray(rows) ? rows : []); }
    catch (e) { list.replaceChildren(); state.textContent = 'Queue status unavailable'; setError(e.status === 503 ? 'The queue is unavailable or not configured. You can still register a patient.' : (e.message || 'Could not load the queue. You can still register a patient.')); }
    finally { busy = false; }
  }
  async function advance(id, status) {
    if (busy) return; busy = true; setError(''); state.textContent = 'Updating queue…';
    try { await request('/doctor/walkin/' + encodeURIComponent(id) + '/status', { method: 'POST', body: JSON.stringify({ status }) }); busy = false; await refresh(); }
    catch (e) { setError(e.message || 'The queue could not be updated. Refresh and try again.'); state.textContent = 'Queue update failed'; }
    finally { busy = false; }
  }
  $('walkinQueueRefresh').addEventListener('click', refresh);
  $('walkinQueueContinue').addEventListener('click', () => { const pane = $('walkinQueuePane'); if (pane) pane.hidden = true; $('walkinForm').hidden = false; $('walkinName').focus(); });
  dialog.addEventListener('close', () => { const pane = $('walkinQueuePane'); if (pane) pane.hidden = false; });
  window.HelloDocWalkinQueue = { refresh };
  const open = $('openWalkin'); if (open) open.addEventListener('click', () => { window.setTimeout(refresh, 0); });
})();