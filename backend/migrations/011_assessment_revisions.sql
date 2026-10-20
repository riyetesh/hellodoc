-- 011: revised assessments.
--
-- A doctor sometimes has to correct the symptom list after the model already
-- produced a prediction. The row holding that prediction is append-only, so a
-- correction cannot rewrite it: instead the correction is stored as a new
-- assessment that points at the record it replaces (`supersedes_id`). The
-- original model output, and the doctor's decision recorded against it, are
-- preserved. The newest revision of a record is the one shown by default.
--
-- Apply after 010. Idempotent where practical.
begin;

-- 1. Lineage --------------------------------------------------------------------
alter table public.assessments
  add column if not exists supersedes_id uuid references public.assessments(id) on delete set null;
create index if not exists assessments_supersedes on public.assessments(supersedes_id);

-- A record can only be revised once, so a duplicated submit (double click, retry
-- after a timeout) cannot create two competing revisions.
create unique index if not exists assessments_single_revision
  on public.assessments(supersedes_id) where supersedes_id is not null;

-- 2. Lineage is immutable too ----------------------------------------------------
create or replace function public.freeze_assessment_model()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.doctor_id <> old.doctor_id
     or new.patient_id <> old.patient_id
     or new.appointment_id is distinct from old.appointment_id
     or new.patient_reported <> old.patient_reported
     or new.clinician_added <> old.clinician_added
     or new.observations <> old.observations
     or new.predicted_disease <> old.predicted_disease
     or new.model_version <> old.model_version
     or new.model_confidence is distinct from old.model_confidence
     or new.description is distinct from old.description
     or new.precautions <> old.precautions
     or new.medications <> old.medications
     or new.diet <> old.diet
     or new.workout <> old.workout
     or new.supersedes_id is distinct from old.supersedes_id
     or new.created_at <> old.created_at then
    raise exception 'Model result and assessment identity are immutable' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.freeze_assessment_model() from public, anon, authenticated;

-- 3. Insert authorisation, now including the superseded record -------------------
-- Columns of the new row are table-qualified: inside a subquery an unqualified
-- name would bind to the subquery's own table (appointments.patient_id,
-- assessments.supersedes_id), silently making the check true or impossible.
-- The superseded row cannot be looked up directly inside a policy on the same
-- table (Postgres rejects that as infinite recursion, SQLSTATE 42P17), so it is
-- checked through a SECURITY DEFINER helper instead.
create or replace function public.is_own_assessment(p_id uuid, p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assessments a
    where a.id = p_id and a.doctor_id = auth.uid() and a.patient_id = p_patient
  )
$$;
revoke all on function public.is_own_assessment(uuid, uuid) from public, anon;
grant execute on function public.is_own_assessment(uuid, uuid) to authenticated;

drop policy if exists assessments_insert on public.assessments;
create policy assessments_insert on public.assessments for insert to authenticated with check (
  doctor_id = auth.uid()
  and public.is_approved_doctor()
  and exists (
    select 1 from public.appointments a
    where a.doctor_id = auth.uid() and a.patient_id = assessments.patient_id
  )
  and (
    appointment_id is null
    or exists (
      select 1 from public.appointments a
      where a.id = assessments.appointment_id
        and a.doctor_id = auth.uid()
        and a.patient_id = assessments.patient_id
    )
  )
  and (
    supersedes_id is null
    or public.is_own_assessment(assessments.supersedes_id, assessments.patient_id)
  )
);

-- 4. Read model with lineage context --------------------------------------------
create or replace function public.assessment_view(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rec public.assessments; patient_name text; patient_email text;
        appt_start timestamptz; appt_status text; doctor_name text;
        previous public.assessments; next_id uuid; begin
  select * into rec from public.assessments where id = p_id;
  if not found then
    raise exception 'Assessment not found' using errcode = 'P0002';
  end if;
  if not (rec.doctor_id = auth.uid()
          or rec.patient_id = auth.uid()
          or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select full_name into patient_name from public.profiles where id = rec.patient_id;
  select u.email into patient_email from auth.users u where u.id = rec.patient_id;
  select full_name into doctor_name from public.profiles where id = rec.doctor_id;
  if rec.appointment_id is not null then
    select scheduled_start, status into appt_start, appt_status
    from public.appointments where id = rec.appointment_id;
  end if;
  if rec.supersedes_id is not null then
    select * into previous from public.assessments where id = rec.supersedes_id;
  end if;
  select id into next_id from public.assessments
  where supersedes_id = rec.id
  order by created_at desc limit 1;
  return jsonb_build_object(
    'id', rec.id,
    'doctorId', rec.doctor_id,
    'doctorName', doctor_name,
    'patientId', rec.patient_id,
    'patientName', patient_name,
    'patientEmail', patient_email,
    'appointmentId', rec.appointment_id,
    'appointmentStart', appt_start,
    'appointmentStatus', appt_status,
    'patientReported', to_jsonb(rec.patient_reported),
    'clinicianAdded', to_jsonb(rec.clinician_added),
    'observations', to_jsonb(rec.observations),
    'symptomDuration', rec.symptom_duration,
    'clinicalNote', rec.clinical_note,
    'predictedDisease', rec.predicted_disease,
    'modelVersion', rec.model_version,
    'modelConfidence', rec.model_confidence,
    'description', rec.description,
    'precautions', rec.precautions,
    'medications', rec.medications,
    'diet', rec.diet,
    'workout', rec.workout,
    'doctorAssessment', rec.doctor_assessment,
    'plan', rec.plan,
    'createdAt', rec.created_at,
    'updatedAt', rec.updated_at,
    'reportGeneratedAt', rec.report_generated_at,
    'supersedesId', rec.supersedes_id,
    'supersededPrediction', case when previous.id is null then null else jsonb_build_object(
      'id', previous.id,
      'predictedDisease', previous.predicted_disease,
      'createdAt', previous.created_at
    ) end,
    'latestRevisionId', next_id
  );
end $$;
revoke all on function public.assessment_view(uuid) from public, anon;
grant execute on function public.assessment_view(uuid) to authenticated;

commit;
