-- 023: label demo records clearly and audit demo assessment creation.
begin;
create or replace function public.audit_demo_assessment_insert()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.demo_mode then
  insert into public.admin_audit_logs(actor_id,action,target_id,metadata)
  values(new.created_by,'demo_assessment_created',new.id,jsonb_build_object(
    'doctor_id',new.doctor_id,'appointment_id',new.appointment_id,'mode','admin_demo'));
 end if;
 return new;
end $$;
drop trigger if exists audit_demo_assessment_insert on public.assessments;
create trigger audit_demo_assessment_insert after insert on public.assessments
for each row execute function public.audit_demo_assessment_insert();
revoke all on function public.audit_demo_assessment_insert() from public,anon,authenticated;

create or replace function public.assessment_view(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rec public.assessments; patient_name text; patient_email text; appt_start timestamptz; appt_status text; doctor_name text; actor_name text; previous public.assessments; next_id uuid;
begin
 select * into rec from public.assessments where id=p_id;
 if not found then raise exception 'Assessment not found' using errcode='P0002'; end if;
 if not (rec.doctor_id=auth.uid() or rec.patient_id=auth.uid() or exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin')) then
  raise exception 'Not authorized' using errcode='42501';
 end if;
 if rec.clinic_patient_id is not null then
  select full_name into patient_name from public.clinic_patients where id=rec.clinic_patient_id; patient_email:=null;
 else
  select full_name into patient_name from public.profiles where id=rec.patient_id;
  select u.email into patient_email from auth.users u where u.id=rec.patient_id;
 end if;
 select full_name into doctor_name from public.profiles where id=rec.doctor_id;
 select full_name into actor_name from public.profiles where id=rec.created_by;
 if rec.appointment_id is not null then select scheduled_start,status into appt_start,appt_status from public.appointments where id=rec.appointment_id; end if;
 if rec.supersedes_id is not null then select * into previous from public.assessments where id=rec.supersedes_id; end if;
 select id into next_id from public.assessments where supersedes_id=rec.id order by created_at desc limit 1;
 return jsonb_build_object(
 'id',rec.id,'doctorId',rec.doctor_id,'doctorName',doctor_name,'createdBy',rec.created_by,'createdByName',actor_name,'demoMode',rec.demo_mode,
 'patientId',coalesce(rec.patient_id,rec.clinic_patient_id),'patientKind',case when rec.clinic_patient_id is null then 'account' else 'clinic' end,
 'patientName',patient_name,'patientEmail',patient_email,'appointmentId',rec.appointment_id,'appointmentStart',appt_start,'appointmentStatus',appt_status,
 'patientReported',to_jsonb(rec.patient_reported),'clinicianAdded',to_jsonb(rec.clinician_added),'observations',to_jsonb(rec.observations),
 'symptomDuration',rec.symptom_duration,'clinicalNote',rec.clinical_note,'predictedDisease',rec.predicted_disease,'modelVersion',rec.model_version,
 'modelConfidence',rec.model_confidence,'description',rec.description,'precautions',rec.precautions,'medications',rec.medications,'diet',rec.diet,'workout',rec.workout,
 'doctorAssessment',rec.doctor_assessment,'plan',rec.plan,'createdAt',rec.created_at,'updatedAt',rec.updated_at,'reportGeneratedAt',rec.report_generated_at,
 'supersedesId',rec.supersedes_id,'supersededPrediction',case when previous.id is null then null else jsonb_build_object('id',previous.id,'predictedDisease',previous.predicted_disease,'createdAt',previous.created_at) end,
 'latestRevisionId',next_id);
end $$;
revoke all on function public.assessment_view(uuid) from public,anon;
grant execute on function public.assessment_view(uuid) to authenticated;
commit;