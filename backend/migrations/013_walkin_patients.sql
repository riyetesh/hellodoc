-- 013: walk-in patients — a clinical record that does not require an account.
--
-- A patient who arrives without an appointment is registered by the doctor who
-- attends them. That record is clinical data, not an account: it is not an
-- auth.users row, it has no password, no fabricated email and no portal access.
-- If the patient later wants online access they still go through the normal
-- sign-up and recovery flows; nothing here creates or implies an account.
--
-- Nothing in this file is applied to a database. Apply to an isolated project
-- first, run backend/migrations/VERIFY.sql and the walk-in checks, then review.
--
-- Design notes
--  * clinic_patients is the walk-in counterpart of public.patient_profiles.
--    It is not a second copy of the account-backed patient data: rows that have
--    an account keep living in profiles/patient_profiles, untouched.
--  * appointments and assessments gain a nullable clinic_patient_id and their
--    account patient_id becomes nullable, with a check that exactly one is set.
--    Existing rows keep patient_id and are unaffected.
--  * Every write goes through a SECURITY DEFINER RPC that re-checks
--    is_approved_doctor() and scopes the patient to auth.uid(). The tables stay
--    closed to direct writes.
--
-- Apply after 012. Idempotent where practical.

begin;

-- 1. The clinical record ---------------------------------------------------------
create table if not exists public.clinic_patients (
  id uuid primary key default gen_random_uuid(),
  -- The doctor who registered and attends this patient. Scoping the record to
  -- one doctor is what keeps a walk-in list from becoming a clinic-wide search
  -- across other clinicians' patients.
  doctor_id uuid not null references public.profiles(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 200),
  date_of_birth date check (date_of_birth is null or date_of_birth <= current_date),
  phone text check (phone is null or phone ~ '^[+()\-\s0-9]{6,40}$'),
  preferred_language text check (preferred_language is null or char_length(preferred_language) <= 40),
  -- Client-supplied idempotency key: a double submit or a retry after a timeout
  -- returns the record that was already created instead of a second one.
  registration_key uuid not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Server-side duplicate guard. Same doctor, same name, same date of birth is
-- not silently merged: the constraint makes the second insert fail so the UI can
-- ask the doctor whether this is the returning patient or a different person.
create unique index if not exists clinic_patients_identity
  on public.clinic_patients (doctor_id, lower(btrim(full_name)), coalesce(date_of_birth, date '0001-01-01'));
create unique index if not exists clinic_patients_registration_key
  on public.clinic_patients (doctor_id, registration_key);
create index if not exists clinic_patients_doctor_name
  on public.clinic_patients (doctor_id, lower(btrim(full_name)));

-- Audit trail: who created the record and when it was linked to a consultation.
create table if not exists public.clinic_patient_audit (
  id bigint generated always as identity primary key,
  clinic_patient_id uuid not null references public.clinic_patients(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null check (action in ('registered', 'consultation_started', 'appointment_booked')),
  appointment_id uuid references public.appointments(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists clinic_patient_audit_patient on public.clinic_patient_audit (clinic_patient_id, created_at desc);

-- 2. Appointments can now belong to either kind of patient -----------------------
alter table public.appointments alter column patient_id drop not null;
alter table public.appointments alter column slot_id drop not null;

alter table public.appointments
  add column if not exists clinic_patient_id uuid references public.clinic_patients(id),
  add column if not exists walk_in boolean not null default false;

alter table public.appointments drop constraint if exists appointments_patient_source;
alter table public.appointments add constraint appointments_patient_source
  check ((patient_id is null) <> (clinic_patient_id is null));

-- A scheduled appointment needs its slot. A walk-in is created from the visit
-- itself and has no bookable availability row behind it.
alter table public.appointments drop constraint if exists appointments_slot_required;
alter table public.appointments add constraint appointments_slot_required
  check (slot_id is not null or walk_in);

-- The account-backed unique(patient_id, idempotency_key) is NULL-tolerant, so
-- walk-in retries need their own index.
create unique index if not exists appointments_walkin_key
  on public.appointments (clinic_patient_id, idempotency_key)
  where clinic_patient_id is not null;

-- 3. Assessments can be recorded for either kind of patient ---------------------
alter table public.assessments alter column patient_id drop not null;
alter table public.assessments add column if not exists clinic_patient_id uuid references public.clinic_patients(id);
alter table public.assessments drop constraint if exists assessments_patient_source;
alter table public.assessments add constraint assessments_patient_source
  check ((patient_id is null) <> (clinic_patient_id is null));

-- Identity is still frozen, now including the clinic patient it belongs to.
create or replace function public.freeze_assessment_model()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.doctor_id <> old.doctor_id
     or new.patient_id is distinct from old.patient_id
     or new.clinic_patient_id is distinct from old.clinic_patient_id
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

-- Ownership check for a superseded record, for either kind of patient.
create or replace function public.is_own_assessment(p_id uuid, p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.assessments a
    where a.id = p_id
      and a.doctor_id = auth.uid()
      and (a.patient_id = p_patient or a.clinic_patient_id = p_patient)
  )
$$;
revoke all on function public.is_own_assessment(uuid, uuid) from public, anon;
grant execute on function public.is_own_assessment(uuid, uuid) to authenticated;

-- Insert policy: an account patient must be one this doctor has an appointment
-- with (unchanged). A clinic patient must belong to this doctor AND the
-- assessment must be tied to a walk-in appointment the doctor attended.
drop policy if exists assessments_insert on public.assessments;
create policy assessments_insert on public.assessments for insert to authenticated with check (
  doctor_id = auth.uid()
  and public.is_approved_doctor()
  and (
    (
      assessments.patient_id is not null
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
    )
    or (
      assessments.clinic_patient_id is not null
      and exists (
        select 1 from public.clinic_patients c
        where c.id = assessments.clinic_patient_id and c.doctor_id = auth.uid()
      )
      and exists (
        select 1 from public.appointments a
        where a.id = assessments.appointment_id
          and a.doctor_id = auth.uid()
          and a.clinic_patient_id = assessments.clinic_patient_id
      )
      and (
        supersedes_id is null
        or public.is_own_assessment(assessments.supersedes_id, assessments.clinic_patient_id)
      )
    )
  )
);

-- 4. Reading a record that may belong to a clinic patient -----------------------
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
  if rec.clinic_patient_id is not null then
    select full_name into patient_name from public.clinic_patients where id = rec.clinic_patient_id;
    patient_email := null; -- no account, therefore no account email
  else
    select full_name into patient_name from public.profiles where id = rec.patient_id;
    select u.email into patient_email from auth.users u where u.id = rec.patient_id;
  end if;
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
    'patientId', coalesce(rec.patient_id, rec.clinic_patient_id),
    'patientKind', case when rec.clinic_patient_id is null then 'account' else 'clinic' end,
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

-- 5. Names for the recent-record list ------------------------------------------
create or replace function public.doctor_clinic_patients()
returns table(id uuid, full_name text, date_of_birth date, phone text, preferred_language text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_approved_doctor() then
    raise exception 'Approved doctor required' using errcode = '42501';
  end if;
  return query
    select c.id, c.full_name, c.date_of_birth, c.phone, c.preferred_language, c.created_at
    from public.clinic_patients c
    where c.doctor_id = auth.uid()
    order by c.created_at desc
    limit 200;
end $$;
revoke all on function public.doctor_clinic_patients() from public, anon;
grant execute on function public.doctor_clinic_patients() to authenticated;

-- 6. Duplicate checks ------------------------------------------------------------
-- Only this doctor's own records are searched: a walk-in is not a clinic-wide
-- patient directory. The reason for a match is returned so the doctor can judge
-- it; nothing is merged automatically.
create or replace function public.doctor_clinic_patient_matches(
  p_name text, p_phone text default null, p_date_of_birth date default null)
returns table(id uuid, full_name text, date_of_birth date, phone text, preferred_language text,
              match_reason text, last_seen timestamptz)
language plpgsql security definer set search_path = '' as $$
declare needle text := lower(btrim(coalesce(p_name, '')));
begin
  if not public.is_approved_doctor() then
    raise exception 'Approved doctor required' using errcode = '42501';
  end if;
  if needle = '' and coalesce(btrim(p_phone), '') = '' and p_date_of_birth is null then
    return; -- never return the whole list as "matches"
  end if;
  return query
    select c.id, c.full_name, c.date_of_birth, c.phone, c.preferred_language,
      case
        when coalesce(btrim(p_phone), '') <> '' and c.phone is not null and regexp_replace(c.phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g') then 'same phone number'
        when p_date_of_birth is not null and c.date_of_birth = p_date_of_birth then 'same date of birth'
        else 'similar name'
      end,
      (select max(a.scheduled_start) from public.appointments a where a.clinic_patient_id = c.id)
    from public.clinic_patients c
    where c.doctor_id = auth.uid()
      and (
        (needle <> '' and lower(btrim(c.full_name)) like '%' || needle || '%')
        or (coalesce(btrim(p_phone), '') <> '' and c.phone is not null
            and regexp_replace(c.phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g'))
        or (p_date_of_birth is not null and c.date_of_birth = p_date_of_birth)
      )
    order by (p_date_of_birth is not null and c.date_of_birth = p_date_of_birth) desc, c.created_at desc
    limit 10;
end $$;
revoke all on function public.doctor_clinic_patient_matches(text, text, date) from public, anon;
grant execute on function public.doctor_clinic_patient_matches(text, text, date) to authenticated;

-- 7. Registration ----------------------------------------------------------------
create or replace function public.doctor_register_clinic_patient(
  p_full_name text, p_date_of_birth date, p_phone text, p_preferred_language text, p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_full_name, ''));
        v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
        v_language text := nullif(btrim(coalesce(p_preferred_language, '')), '');
        v_record public.clinic_patients; v_existing uuid;
begin
  if not public.is_approved_doctor() then
    raise exception 'Approved doctor required' using errcode = '42501';
  end if;
  if p_key is null then
    raise exception 'A registration key is required' using errcode = '22023';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 200
     or (p_date_of_birth is not null and p_date_of_birth > current_date)
     or (v_phone is not null and v_phone !~ '^[+()\-\s0-9]{6,40}$')
     or (v_language is not null and char_length(v_language) > 40) then
    raise exception 'Invalid patient details' using errcode = '22023';
  end if;

  -- Retry of the same submission: return the record already created.
  select id into v_existing from public.clinic_patients
  where doctor_id = auth.uid() and registration_key = p_key;
  if v_existing is not null then
    select * into v_record from public.clinic_patients where id = v_existing;
    return jsonb_build_object('id', v_record.id, 'fullName', v_record.full_name,
      'dateOfBirth', v_record.date_of_birth, 'phone', v_record.phone,
      'preferredLanguage', v_record.preferred_language, 'createdAt', v_record.created_at,
      'account', false, 'existing', true);
  end if;

  begin
    insert into public.clinic_patients (doctor_id, full_name, date_of_birth, phone, preferred_language, registration_key, created_by)
    values (auth.uid(), v_name, p_date_of_birth, v_phone, v_language, p_key, auth.uid())
    returning * into v_record;
  exception when unique_violation then
    -- Same name and date of birth already exists for this doctor. Report it as a
    -- possible duplicate; never merge or overwrite.
    raise exception 'A patient with this name and date of birth is already registered'
      using errcode = '23505';
  end;

  insert into public.clinic_patient_audit (clinic_patient_id, actor_id, action)
  values (v_record.id, auth.uid(), 'registered');

  return jsonb_build_object('id', v_record.id, 'fullName', v_record.full_name,
    'dateOfBirth', v_record.date_of_birth, 'phone', v_record.phone,
    'preferredLanguage', v_record.preferred_language, 'createdAt', v_record.created_at,
    'account', false, 'existing', false);
end $$;
revoke all on function public.doctor_register_clinic_patient(text, date, text, text, uuid) from public, anon;
grant execute on function public.doctor_register_clinic_patient(text, date, text, text, uuid) to authenticated;

-- 8. Walk-in consultation --------------------------------------------------------
-- Creates (or reuses today's) walk-in appointment for one of this doctor's clinic
-- patients. The patient id must belong to the caller; the appointment is what the
-- assessment flow authorises against, exactly like a booked visit.
create or replace function public.doctor_start_walkin_consultation(
  p_patient uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.clinic_patients; rec public.appointments; prior public.assessments;
        prior_found boolean := false; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_approved_doctor() then
    raise exception 'Approved doctor required' using errcode = '42501';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Reason is too long' using errcode = '22023';
  end if;
  select * into c from public.clinic_patients where id = p_patient and doctor_id = auth.uid();
  if not found then
    -- Another doctor's patient is reported as missing, not as forbidden.
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;

  select * into rec from public.appointments
  where doctor_id = auth.uid() and clinic_patient_id = p_patient and walk_in
    and status in ('pending', 'confirmed') and scheduled_start >= date_trunc('day', now())
  order by created_at desc limit 1;

  if not found then
    insert into public.appointments
      (patient_id, doctor_id, slot_id, clinic_patient_id, walk_in, scheduled_start, scheduled_end, reason, idempotency_key)
    values (null, auth.uid(), null, p_patient, true, now(), now() + interval '30 minutes', v_reason, gen_random_uuid())
    returning * into rec;
    insert into public.appointment_status_history (appointment_id, new_status, actor_id)
    values (rec.id, 'pending', auth.uid());
    insert into public.clinic_patient_audit (clinic_patient_id, actor_id, action, appointment_id)
    values (p_patient, auth.uid(), 'consultation_started', rec.id);
  end if;

  select * into prior from public.assessments
  where appointment_id = rec.id and doctor_id = auth.uid()
  order by created_at desc limit 1;
  prior_found := prior.id is not null;

  return jsonb_build_object(
    'appointmentId', rec.id,
    'startsAt', rec.scheduled_start,
    'status', rec.status,
    'reason', rec.reason,
    'patientId', c.id,
    'patientKind', 'clinic',
    'clinicPatientId', c.id,
    'patientName', c.full_name,
    'patientEmail', null,
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
revoke all on function public.doctor_start_walkin_consultation(uuid, text) from public, anon;
grant execute on function public.doctor_start_walkin_consultation(uuid, text) to authenticated;

-- 9. Book a scheduled visit for a clinic patient ---------------------------------
-- Uses the doctor's own open availability, so the walk-in patient enters the same
-- scheduling structures as everyone else.
create or replace function public.doctor_book_clinic_appointment(
  p_patient uuid, p_slot uuid, p_reason text, p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_slot public.doctor_availability; v_record public.appointments;
        v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_approved_doctor() then
    raise exception 'Approved doctor required' using errcode = '42501';
  end if;
  if p_slot is null or p_key is null or (v_reason is not null and char_length(v_reason) > 500) then
    raise exception 'Invalid booking' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clinic_patients where id = p_patient and doctor_id = auth.uid()) then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;

  select * into v_record from public.appointments
  where clinic_patient_id = p_patient and idempotency_key = p_key;
  if found then
    return jsonb_build_object('id', v_record.id, 'status', v_record.status, 'startsAt', v_record.scheduled_start);
  end if;

  select a.* into v_slot from public.doctor_availability a
  where a.id = p_slot and a.doctor_id = auth.uid() and a.status = 'open'
    and a.scheduled_start > now() + interval '5 minutes'
  for update of a;
  if not found then
    raise exception 'Slot unavailable' using errcode = 'P0001';
  end if;

  insert into public.appointments
    (patient_id, doctor_id, slot_id, clinic_patient_id, walk_in, scheduled_start, scheduled_end, reason, idempotency_key)
  values (null, auth.uid(), v_slot.id, p_patient, false, v_slot.scheduled_start, v_slot.scheduled_end, v_reason, p_key)
  returning * into v_record;

  insert into public.appointment_status_history (appointment_id, new_status, actor_id)
  values (v_record.id, 'pending', auth.uid());
  insert into public.clinic_patient_audit (clinic_patient_id, actor_id, action, appointment_id)
  values (p_patient, auth.uid(), 'appointment_booked', v_record.id);

  return jsonb_build_object('id', v_record.id, 'status', v_record.status, 'startsAt', v_record.scheduled_start);
end $$;
revoke all on function public.doctor_book_clinic_appointment(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.doctor_book_clinic_appointment(uuid, uuid, text, uuid) to authenticated;

-- 10. Consultation context now resolves both kinds of patient --------------------
create or replace function public.doctor_consultation(p_appt uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rec public.appointments; patient_name text; patient_email text; prior public.assessments;
        prior_found boolean := false;
begin
  if not public.is_approved_doctor() then
    raise exception 'Approved doctor required' using errcode = '42501';
  end if;

  select * into rec from public.appointments
  where id = p_appt and doctor_id = auth.uid();
  if not found then
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;

  if rec.clinic_patient_id is not null then
    select full_name into patient_name from public.clinic_patients where id = rec.clinic_patient_id;
    patient_email := null;
  else
    select full_name into patient_name from public.profiles where id = rec.patient_id;
    select u.email into patient_email from auth.users u where u.id = rec.patient_id;
  end if;

  select * into prior from public.assessments
  where appointment_id = rec.id and doctor_id = auth.uid()
  order by created_at desc limit 1;
  prior_found := prior.id is not null;

  return jsonb_build_object(
    'appointmentId', rec.id,
    'startsAt', rec.scheduled_start,
    'status', rec.status,
    'reason', rec.reason,
    'patientId', coalesce(rec.patient_id, rec.clinic_patient_id),
    'patientKind', case when rec.clinic_patient_id is null then 'account' else 'clinic' end,
    'clinicPatientId', rec.clinic_patient_id,
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

-- 11. Access rules for the clinical record ---------------------------------------
alter table public.clinic_patients enable row level security;
alter table public.clinic_patient_audit enable row level security;

revoke all on public.clinic_patients, public.clinic_patient_audit from anon, authenticated;
grant select on public.clinic_patients to authenticated;
grant select on public.clinic_patient_audit to authenticated;

drop policy if exists clinic_patients_own on public.clinic_patients;
create policy clinic_patients_own on public.clinic_patients for select to authenticated
  using (doctor_id = auth.uid() and public.is_approved_doctor());

drop policy if exists clinic_patient_audit_own on public.clinic_patient_audit;
create policy clinic_patient_audit_own on public.clinic_patient_audit for select to authenticated
  using (exists (
    select 1 from public.clinic_patients c
    where c.id = clinic_patient_id and c.doctor_id = auth.uid() and public.is_approved_doctor()
  ));

commit;
