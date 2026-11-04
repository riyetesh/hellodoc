const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(require('node:path').join(__dirname,'..',p),'utf8');
test('wizard navigation never starts sessions and documentation does not require prediction',()=>{
 const source=read('Scripts/assessment.js');
 assert.equal(source.includes("dispatchEvent(new Event('hellodoc:consultation-start'))"),false);
 assert.ok(source.includes('withoutModel = withoutModel || !state.modelPreview'));
 assert.ok(source.includes('furthestWizardStep'));
 assert.equal(source.includes('sessionStorage.setItem'),false);
 assert.ok(source.includes('version:draftVersion'));
 assert.ok(source.includes('draftConflict=true'));
 assert.match(read('doctor.html'),/id="plan" rows="6" maxlength="4000"/);
});
test('session completion retains patient identity and separates report persistence from completion',()=>{
 const source=read('Scripts/consultation.js');
 assert.ok(source.includes("startButton.addEventListener('click', openConsultation)"));
 assert.equal(source.includes("addEventListener('hellodoc:consultation-start'"),false);
 assert.ok(source.includes('context.appointmentId !== sessionAppointment'));
 assert.ok(source.includes('savedReport = saved'));
 assert.ok(source.includes("+'/complete'"));
 assert.ok(source.includes('keepSession()'));
});
test('clinical migration restricts drafts, versions and booked slot deletion',()=>{
 const sql=read('backend/migrations/026_clinical_workspace.sql');
 assert.match(sql,/enable row level security/);
 assert.match(sql,/doctor_id=auth.uid\(\)/);
 assert.match(sql,/current_row.version,0\)<>p_version/);
 assert.match(sql,/from public.appointments a where a.slot_id=s.id/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/insert into public.appointment_status_history/);
 assert.match(sql,/Saved assessment required/);
});
