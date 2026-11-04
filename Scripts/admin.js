(() => {
'use strict';
const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const human=s=>String(s??'—').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const date=s=>s?new Date(s).toLocaleString(undefined,{timeZone:'UTC'})+' UTC':'—';
let page=1,version=0,metricVersion=0,pending=null;
async function request(path,options){const r=await fetch('/api'+path,options);const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.message||'Request failed. Try again.');return d;}
const run=fn=>fn().catch(e=>{$('message').textContent=e.message;});
function table(headers){const wrap=el('div',undefined,'table-wrap'),t=el('table'),head=el('thead'),row=el('tr'),body=el('tbody');headers.forEach(h=>{const th=el('th',h);th.scope='col';row.append(th);});head.append(row);t.append(head,body);wrap.append(t);return{wrap,body};}
async function metrics(){
const v=++metricVersion;if($('since').value>$('until').value)throw Error('Start date must precede end date.');
const d=await request(`/admin/overview?since=${$('since').value}&until=${$('until').value}`);if(v!==metricVersion)return;
$('metrics').replaceChildren();for(const [label,value] of [['Patients',d.patients],['Doctors',d.doctors],['Awaiting verification',d.awaitingVerification],['Approved doctors',d.approvedDoctors]]){const a=el('article');a.append(el('span',label),el('strong',value));$('metrics').append(a);}
$('outcomes').replaceChildren();for(const [key,value]of Object.entries({...d.appointments,'cancellation rate':(d.cancellationRate*100).toFixed(1)+'%'})){const r=el('div',undefined,'outcome-row');r.append(el('span',human(key)),el('strong',value));$('outcomes').append(r);}
$('trends').replaceChildren();const max=Math.max(1,...d.trends.map(r=>r.bookings));for(const r of d.trends){const line=el('div',undefined,'trend-row'),m=el('meter');m.max=max;m.value=r.bookings;m.setAttribute('aria-label',`${r.day}: ${r.bookings} bookings`);line.append(el('span',r.day),m,el('strong',r.bookings));$('trends').append(line);}if(!d.trends.length)$('trends').append(el('p','No bookings in this period.'));
const t=table(['Clinician','Bookings','Offered slots','Utilization']);for(const r of d.utilization){const tr=el('tr');[r.full_name,r.occupied_slots,r.offered_slots,r.offered_slots?(100*r.occupied_slots/r.offered_slots).toFixed(1)+'%':'No offered slots'].forEach(x=>tr.append(el('td',x)));t.body.append(tr);}$('utilization').replaceChildren(d.utilization.length?t.wrap:el('p','No capacity data available.'));
}
const labels={approve_doctor:'Approve clinician',reject_doctor:'Reject application',request_resubmission:'Request resubmission',suspend:'Suspend account',reactivate:'Reactivate account',edit_user:'Edit profile',update_doctor:'Edit practice details',cancel_appointment:'Cancel appointment',delete_user:'Delete account'};
function field(label,id,value,type='text'){const l=el('label',label),i=el('input');i.id=id;i.type=type;i.value=value??'';l.append(i);$('actionFields').append(l);return i;}
function check(label,id){const l=el('label',undefined,'check'),i=el('input');i.type='checkbox';i.id=id;l.append(i,el('span',label));$('actionFields').append(l);return i;}
function action(name,row){pending={name,row};$('actionTitle').textContent=labels[name];$('actionDescription').textContent=name==='delete_user'?'Permanent deletion cannot be undone. Linked records may prevent deletion where retention is required.':`Review this change for ${row.full_name||row.patient_name||'this record'}. The server checks whether the action is permitted.`;$('actionFields').replaceChildren();$('actionReason').value='';$('actionError').textContent='';
if(name==='edit_user'){const n=field('Full name','editName',row.full_name);n.required=true;n.maxLength=200;field('Phone (optional)','editPhone',row.phone).maxLength=40;}
if(name==='update_doctor'){field('Specialty','editSpecialty',row.specialty).maxLength=120;field('Professional biography','editBio',row.professional_bio).maxLength=2000;const f=field('Consultation fee','editFee',row.consultation_fee,'number');f.min=0;f.step='0.01';f.required=true;check('Accept new appointments','editAccepting').checked=!!row.is_accepting_appointments;}
if(name==='approve_doctor')check('I independently verified identity, license and qualifications.','verified').required=true;
if(name==='delete_user'){const i=field('Type DELETE to confirm','deleteConfirm','');i.required=true;i.pattern='DELETE';}
$('confirmAction').textContent=labels[name];$('actionDialog').showModal();}
$('actionForm').onsubmit=async e=>{e.preventDefault();if(!pending)return;const{name,row}=pending;const reason=$('actionReason').value.trim();if(reason.length<5){$('actionError').textContent='Enter a reason of at least 5 characters.';return;}let details={};
if(name==='approve_doctor')details.verification_confirmed=$('verified').checked;
if(name==='edit_user'){details={fullName:$('editName').value.trim(),phone:$('editPhone').value.trim()};if(!details.fullName){$('actionError').textContent='Full name is required.';return;}}
if(name==='update_doctor')details={specialty:$('editSpecialty').value.trim(),bio:$('editBio').value.trim(),fee:Number($('editFee').value),accepting:$('editAccepting').checked};
$('confirmAction').disabled=true;$('actionError').textContent='';try{const d=await request('/admin/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:name,target:row.applicant_id||row.id,reason,details})});$('actionDialog').close();$('message').textContent=d.message;try{await Promise.all([list(),metrics()]);}catch{$('message').textContent='Change saved. Reload to refresh current data.';}}catch(err){$('actionError').textContent=err.message;}finally{$('confirmAction').disabled=false;}};
['closeDialog','cancelDialog'].forEach(id=>$(id).onclick=()=>{if(!$('confirmAction').disabled)$('actionDialog').close();});$('actionDialog').addEventListener('cancel',e=>{if($('confirmAction').disabled)e.preventDefault();});
function filters(){const kind=$('kind').value;const statuses={doctors:['pending','resubmission_required','approved','rejected'],appointments:['pending','confirmed','completed','cancelled','no_show']}[kind]||[];$('status').replaceChildren(new Option('All statuses',''),...statuses.map(s=>new Option(human(s),s)));$('statusLabel').hidden=!statuses.length;$('searchLabel').hidden=kind==='audit';$('search').value='';document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===kind?'page':'false'));}
async function list(){const v=++version,kind=$('kind').value;$('records').setAttribute('aria-busy','true');try{const d=await request(`/admin/${kind}?${new URLSearchParams({page,search:$('search').value,status:$('status').value})}`);if(v!==version)return;
const headers={patients:['Patient','Contact','Access','Management'],doctors:['Clinician','Specialty','Verification','Management'],appointments:['Patient / clinician','Scheduled (UTC)','Status','Management'],audit:['Action','Timestamp (UTC)','Target','Details']}[kind];const t=table(headers);
for(const r of d.items){const tr=el('tr'),a=el('td'),b=el('td'),c=el('td'),actions=el('td');if(kind==='patients'||kind==='doctors'){a.append(el('span',r.full_name,'record-name'),el('small','Joined '+date(r.created_at)));b.textContent=kind==='patients'?(r.phone||'No phone provided'):(r.specialty||'Not provided');c.append(el('span',r.suspended?'Suspended':kind==='patients'?'Active':human(r.status),'badge'));}if(kind==='appointments'){a.append(el('span',r.patient_name,'record-name'),el('small',r.doctor_name));b.textContent=date(r.scheduled_start);c.append(el('span',human(r.status),'badge'));}if(kind==='audit'){a.textContent=human(r.action);b.textContent=date(r.created_at);c.textContent=r.target_id||'—';c.style.overflowWrap='anywhere';}
const buttons=el('div',undefined,'record-actions');const add=name=>{const button=el('button',labels[name]);button.type='button';button.onclick=()=>action(name,r);buttons.append(button);};
if(kind==='doctors'&&['pending','resubmission_required'].includes(r.status)){add('approve_doctor');add('reject_doctor');add('request_resubmission');}
if(kind==='doctors'||kind==='patients'){add('edit_user');add(r.suspended?'reactivate':'suspend');}
if(kind==='doctors'&&r.status==='approved')add('update_doctor');
if(kind==='appointments'&&['pending','confirmed'].includes(r.status)&&new Date(r.scheduled_start)>new Date())add('cancel_appointment');
actions.append(buttons);
const details=el('details'),dl=el('dl');details.append(el('summary','Record details'));
for(const[k,value]of Object.entries(r))if(value!==null)dl.append(el('dt',human(k)),el('dd',typeof value==='object'?JSON.stringify(value,null,2):String(value)));
details.append(dl);
if(kind==='doctors'||kind==='patients'){const del=el('button','Delete account');del.type='button';del.onclick=()=>action('delete_user',r);details.append(del);}
actions.append(details);tr.append(a,b,c,actions);t.body.append(tr);
}
$('records').replaceChildren(d.items.length?t.wrap:el('p','No matching records. Try another name or status.','empty'));
$('pagination').textContent=`Page ${page} · ${d.total} records`;$('previous').disabled=page<=1;$('next').disabled=page*(d.pageSize||25)>=d.total;
}finally{if(v===version)$('records').removeAttribute('aria-busy');}}
function view(kind,status=''){$('kind').value=kind;filters();$('status').value=status;page=1;run(list);$('management').scrollIntoView();}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
$('reviewPending').onclick=()=>view('doctors','pending');
$('kind').onchange=()=>{filters();page=1;run(list);};
$('since').value=new Date(Date.now()-30*86400000).toISOString().slice(0,10);$('until').value=new Date().toISOString().slice(0,10);
$('dates').onsubmit=e=>{e.preventDefault();run(metrics);};$('filters').onsubmit=e=>{e.preventDefault();page=1;run(list);};
$('previous').onclick=()=>{page=Math.max(1,page-1);run(list);};$('next').onclick=()=>{page++;run(list);};
$('logout').onclick=()=>run(async()=>{await request('/auth/logout',{method:'POST'});location.href='/';});
(async()=>{try{const user=await request('/auth/current-user');if(user.role!=='admin')throw Error('Administrator access required.');}catch(e){$('message').textContent=e.message;$('signin').hidden=false;return;}
$('adminContent').hidden=false;$('message').textContent='Administrative actions are recorded in the audit history.';filters();await run(()=>Promise.all([metrics(),list()]));})();
})();
