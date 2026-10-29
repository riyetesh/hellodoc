(() => {
  const $ = (id) => document.getElementById(id);
  let page = 1;
  async function request(path, options) {
    const response = await fetch('/api' + path, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Request failed');
    return data;
  }
  function node(tag, text) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; }
  async function metrics() {
    const data = await request(`/admin/overview?since=${$('since').value}&until=${$('until').value}`);
    $('metrics').replaceChildren();
    for (const [label, value] of Object.entries({ Patients:data.patients, Doctors:data.doctors, 'Awaiting verification':data.awaitingVerification, 'Approved doctors':data.approvedDoctors, ...data.appointments, 'Cancellation rate':(100*data.cancellationRate).toFixed(1)+'%' })) {
      const item = node('article'); item.append(node('span',label),node('strong',value)); $('metrics').append(item);
    }
    $('trends').replaceChildren();
    const max = Math.max(1,...data.trends.map((r) => r.bookings));
    for (const row of data.trends) { const line = node('p',row.day); const meter = node('meter'); meter.max=max; meter.value=row.bookings; meter.setAttribute('aria-label',`${row.day}: ${row.bookings} bookings`); line.append(meter,node('span',row.bookings)); $('trends').append(line); }
    if (!data.trends.length) $('trends').textContent='No appointments in this period.';
    $('utilization').replaceChildren(...data.utilization.map((r) => node('p',`${r.full_name}: ${r.occupied_slots}/${r.offered_slots} (${r.offered_slots ? (100*r.occupied_slots/r.offered_slots).toFixed(1) : '0'}%)`)));
  }
  const CONFIRMATIONS = {
    approve_doctor: 'Approve this clinician? They will be able to accept appointments and attend consultations.',
    reject_doctor: 'Reject this verification? The doctor keeps dashboard access but cannot attend consultations.',
    request_resubmission: 'Ask this doctor to resubmit their professional details? Clinical access stays blocked.',
    suspend: 'Suspend this account? They will be blocked from protected data until reactivated.',
    reactivate: 'Reactivate this account? They will regain access allowed by their role.',
    cancel_appointment: 'Cancel this appointment? The patient and doctor will see it as cancelled.',
    update_doctor: 'Save these professional details?',
    edit_user: 'Save this account profile? The login email and role will not change.',
    delete_user: 'Permanently delete this patient or doctor account and its associated data? This cannot be undone.',
  };
  async function action(name,target,button) {
    const reason = prompt('Administrative reason (5–500 characters; no medical information):');
    if (reason === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 5 || trimmed.length > 500) { $('message').textContent='Enter a reason between 5 and 500 characters.'; return; }
    if (!confirm(`${CONFIRMATIONS[name] || 'Apply this administrative action?'}\n\nReason: ${trimmed}`)) return;
    let details = {};
    if (name==='approve_doctor') details.verification_confirmed=true;
    if (name==='edit_user') {
      const fullName=prompt('Full name:',target.full_name || ''); if(fullName===null) return;
      const phone=prompt('Phone number (optional):',target.phone || ''); if(phone===null) return;
      details={fullName:fullName.trim(),phone:phone.trim()};
    }
    if (name==='delete_user' && !confirm('Final confirmation: permanently delete this account?')) return;
    if (name==='update_doctor') {
      const fee=prompt('Consultation fee:'); if (fee===null || !Number.isFinite(Number(fee)) || Number(fee)<0) return;
      details={fee:Number(fee),accepting:confirm('Enable new appointments?')};
    }
    if (button) { button.disabled=true; button.dataset.label=button.textContent; button.textContent='Saving…'; }
    $('message').textContent='Saving administrative action…';
    try {
      const payload={action:name,target:typeof target==='string'?target:(target.applicant_id || target.id),reason:trimmed,details};
      const data=await request('/admin/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      $('message').textContent=data.message;
      try { await Promise.all([list(),metrics()]); } catch { $('message').textContent='Action saved; refresh failed. Reload to see current data.'; }
    } catch(error) { $('message').textContent=error.message; }
    finally { if (button) { button.disabled=false; button.textContent=button.dataset.label || button.textContent; } }
  }
  async function list() {
    const kind=$('kind').value;
    const data=await request(`/admin/${kind}?${new URLSearchParams({page,search:$('search').value,status:$('status').value})}`);
    $('records').replaceChildren();
    for (const row of data.items) {
      const card=node('article'); card.className='admin-record'; const dl=node('dl');
      for (const [key,value] of Object.entries(row)) { if (value!==null) dl.append(node('dt',key.replaceAll('_',' ')),node('dd',typeof value==='object' ? JSON.stringify(value) : String(value))); }
      card.append(dl);
      const buttons=[];
      if (kind==='patients' || kind==='doctors') buttons.push([row.suspended ? 'reactivate':'suspend',row.suspended ? 'Reactivate':'Suspend'],['edit_user','Edit profile'],['delete_user','Delete account']);
      if (kind==='doctors' && ['pending','resubmission_required'].includes(row.status)) buttons.push(['approve_doctor','Approve after verification'],['reject_doctor','Reject'],['request_resubmission','Request resubmission']);
      if (kind==='doctors' && row.status==='approved') buttons.push(['update_doctor','Update fee / availability']);
      if (kind==='appointments' && ['pending','confirmed'].includes(row.status) && new Date(row.scheduled_start)>new Date()) buttons.push(['cancel_appointment','Cancel appointment']);
      for (const [name,label] of buttons) { const button=node('button',label); button.type='button'; button.className='btn btn-outline'; button.onclick=() => action(name,(name==='edit_user'||name==='delete_user')?row:(row.applicant_id || row.id),button); card.append(button); }
      $('records').append(card);
    }
    if (!data.items.length) $('records').textContent='No matching records.';
    $('pagination').textContent=`Page ${page} · ${data.total} records`;
    $('previous').disabled=page<=1; $('next').disabled=page*25>=data.total;
  }
  const run=(fn) => fn().catch((error) => { $('message').textContent=error.message; });
  $('since').value=new Date(Date.now()-30*86400000).toISOString().slice(0,10); $('until').value=new Date().toISOString().slice(0,10);
  $('dates').onsubmit=(e) => {e.preventDefault();run(metrics);};
  $('filters').onsubmit=(e) => {e.preventDefault();page=1;run(list);};
  $('previous').onclick=() => {page--;run(list);}; $('next').onclick=() => {page++;run(list);};
  $('logout').onclick=() => run(async () => {await request('/auth/logout',{method:'POST'});location.href='/';});
  (async () => {
    try {
      const user=await request('/auth/current-user');
      if (user.role!=='admin') throw new Error('Administrator access required. Your account cannot access this area.');
      $('adminContent').hidden=false; $('signin').hidden=true; $('message').textContent='Signed in as administrator.';
      await Promise.all([metrics(),list()]);
    } catch (error) { $('message').textContent=error.message; $('signin').hidden=false; }
  })();
})();