-- 012: appointment-scoped consultation context for the clinical predictor.
--
-- The doctor must start an assessment from an appointment they actually attend,
-- with the patient identity coming from the stored appointment rather than from
-- the browser. This RPC returns exactly that context, plus whatever was already
-- recorded for the same consultation (if anything), so the form can be prefilled
-- without inventing or re-typing patient details.
--
-- Apply after 011. Idempotent.
begin;

create or replace function public.doctor_consultation(p_appt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rec public.appointments; patient_name text; patient_email text; prior public.assessments; prior_found boolean := false;
begin
  if not public.is_approved_doctor() then
    raise exception 'Approved doctor required' using errcode = '42501';
  end if;

  select * into rec from public.appointments
  where id = p_appt and doctor_id = auth.uid();
  if not found then
    -- Another doctor's appointment is reported as missing, not as forbidden.
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;

  select full_name into patient_name from public.profiles where id = rec.patient_id;
  select u.email into patient_email from auth.users u where u.id = rec.patient_id;

  select * into prior from public.assessments
  where appointment_id = rec.id and doctor_id = auth.uid()
  order by created_at desc limit 1;
  prior_found := prior.id is not null;

  return jsonb_build_object(
    'appointmentId', rec.id,
    'startsAt', rec.scheduled_start,
    'status', rec.status,
    'reason', rec.reason,
    'patientId', rec.patient_id,
    'patientName', patient_name,
    'patientEmail', patient_email,
    'previousAssessmentId', prior.id,
    'patientReported', case when prior_found then to_jsonb(prior.patient_reported) else '[]'::jsonb end,
    'clinicianAdded', case when prior_found then to_jsonb(prior.clinician_added) else '[]'::jsonb end,
    'observations', case when prior_found then to_jsonb(prior.observations) else '[]'::jsonb end,
    'symptomDuration', prior.symptom_duration,
    'clinicalNote', prior.clinical_note,
    'doctorAssessment', prior.doctor_assessment,
    'plan', prior.plan
  );
end $$;
revoke all on function public.doctor_consultation(uuid) from public, anon;
grant execute on function public.doctor_consultation(uuid) to authenticated;

commit;
