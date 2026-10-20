-- 010: clinical assessments (model prediction + doctor decision) and report data.
--
-- A doctor runs the symptom model for a patient they actually have an
-- appointment with, and the result is stored as one immutable row. The raw
-- model output (predicted_disease, model_version, guidance) is frozen at insert
-- time; only the doctor's own assessment, plan and report metadata may change
-- afterwards. That keeps "what the model said" separate from "what the doctor
-- decided" and stops any later edit from rewriting history.
--
-- Apply after 003, 005, 006, 008 and 009. Idempotent where practical.
begin;

-- 1. Authorisation helper -------------------------------------------------------
create or replace function public.is_approved_doctor(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.profiles p
    join public.doctor_profiles d on d.user_id = p.id
    where p.id = p_user
      and p.role = 'doctor'
      and not p.suspended
      and d.verification_status = 'approved'
  )
$$;
revoke all on function public.is_approved_doctor(uuid) from public, anon;
grant execute on function public.is_approved_doctor(uuid) to authenticated;

-- 2. Assessment record ----------------------------------------------------------
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.profiles(id) on delete cascade,
  patient_id uuid not null references public.profiles(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  -- Model inputs, split by who reported them. Both hold exact model identifiers.
  patient_reported text[] not null default '{}',
  clinician_added text[] not null default '{}',
  -- Clinical observations the model cannot interpret. Never sent to the model.
  observations text[] not null default '{}',
  symptom_duration text,
  clinical_note text,
  -- Raw model output: frozen after insert.
  predicted_disease text not null,
  model_version text not null,
  model_confidence numeric,
  description text,
  precautions jsonb not null default '[]'::jsonb,
  medications jsonb not null default '[]'::jsonb,
  diet jsonb not null default '[]'::jsonb,
  workout jsonb not null default '[]'::jsonb,
  -- The doctor's independent decision: editable only by the recording doctor.
  doctor_assessment text,
  plan text,
  report_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assessments_symptoms_present
    check (cardinality(patient_reported) + cardinality(clinician_added) > 0),
  constraint assessments_note_length
    check (clinical_note is null or length(clinical_note) <= 2000),
  constraint assessments_duration_length
    check (symptom_duration is null or length(symptom_duration) <= 120),
  constraint assessments_doctor_assessment_length
    check (doctor_assessment is null or length(doctor_assessment) <= 4000),
  constraint assessments_plan_length
    check (plan is null or length(plan) <= 4000),
  constraint assessments_confidence_range
    check (model_confidence is null or (model_confidence >= 0 and model_confidence <= 1)),
  constraint assessments_observations_count
    check (cardinality(observations) <= 20)
);
create index if not exists assessments_doctor_created on public.assessments(doctor_id, created_at desc);
create index if not exists assessments_patient_created on public.assessments(patient_id, created_at desc);
create index if not exists assessments_appointment on public.assessments(appointment_id);

-- 3. Freeze the model's verdict, allow only the doctor's own edits ---------------
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
     or new.created_at <> old.created_at then
    raise exception 'Model result and assessment identity are immutable' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.freeze_assessment_model() from public, anon, authenticated;

drop trigger if exists assessments_freeze_model on public.assessments;
create trigger assessments_freeze_model
  before update on public.assessments
  for each row execute function public.freeze_assessment_model();

-- 4. RLS ------------------------------------------------------------------------
alter table public.assessments enable row level security;
grant select, insert, update on public.assessments to authenticated;

drop policy if exists assessments_read on public.assessments;
create policy assessments_read on public.assessments for select to authenticated using (
  doctor_id = auth.uid()
  or patient_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

-- A row may only be created by its own approved doctor, for a patient that
-- doctor actually has an appointment with, and optionally linked to that
-- appointment (which must belong to the same doctor and patient).
drop policy if exists assessments_insert on public.assessments;
create policy assessments_insert on public.assessments for insert to authenticated with check (
  doctor_id = auth.uid()
  and public.is_approved_doctor()
  and exists (
    select 1 from public.appointments a
    where a.doctor_id = auth.uid() and a.patient_id = patient_id
  )
  and (
    appointment_id is null
    or exists (
      select 1 from public.appointments a
      where a.id = appointment_id
        and a.doctor_id = auth.uid()
        and a.patient_id = patient_id
    )
  )
);

drop policy if exists assessments_update on public.assessments;
create policy assessments_update on public.assessments for update to authenticated
  using (doctor_id = auth.uid() and public.is_approved_doctor())
  with check (doctor_id = auth.uid() and public.is_approved_doctor());

-- No delete policy: assessments are append-only clinical records.

-- 5. Doctor-scoped context ------------------------------------------------------
-- Returns the doctor's own patients with the most relevant appointment (the next
-- active one, otherwise the most recent), so the UI never has to guess an id or
-- trust one supplied by the browser.
create or replace function public.assigned_patients()
returns table(
  patient_id uuid,
  full_name text,
  email text,
  appointment_id uuid,
  appointment_start timestamptz,
  appointment_status text,
  assessment_count bigint
) language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_approved_doctor() then
    raise exception 'Approved doctor required' using errcode = '42501';
  end if;
  return query
  with mine as (
    select distinct a.patient_id as pid
    from public.appointments a
    where a.doctor_id = auth.uid()
  ), pick as (
    select m.pid,
      coalesce(
        (select a.id from public.appointments a
          where a.doctor_id = auth.uid() and a.patient_id = m.pid
            and a.status in ('pending','confirmed') and a.scheduled_start >= now()
          order by a.scheduled_start limit 1),
        (select a.id from public.appointments a
          where a.doctor_id = auth.uid() and a.patient_id = m.pid
          order by a.scheduled_start desc limit 1)
      ) as appt
    from mine m
  )
  select p.id, p.full_name, u.email::text, a.id, a.scheduled_start, a.status,
         (select count(*) from public.assessments s where s.doctor_id = auth.uid() and s.patient_id = p.id)
  from pick
  join public.profiles p on p.id = pick.pid
  join auth.users u on u.id = p.id
  left join public.appointments a on a.id = pick.appt
  order by coalesce(a.scheduled_start, now()) desc, p.full_name;
end $$;
revoke all on function public.assigned_patients() from public, anon;
grant execute on function public.assigned_patients() to authenticated;

-- Single assessment for the recording doctor, its patient or an administrator.
-- SECURITY DEFINER deliberately bypasses RLS, so authorisation is re-checked here.
create or replace function public.assessment_view(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rec public.assessments; patient_name text; patient_email text;
        appt_start timestamptz; appt_status text; doctor_name text; begin
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
    'reportGeneratedAt', rec.report_generated_at
  );
end $$;
revoke all on function public.assessment_view(uuid) from public, anon;
grant execute on function public.assessment_view(uuid) to authenticated;

update public.profiles set updated_at = now() where false; -- no-op; keeps statement order explicit
commit;
