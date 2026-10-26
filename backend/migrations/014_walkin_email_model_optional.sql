-- 014: walk-in email address + clinical records saved while the model is down.
--
-- Two independent changes, both backward compatible:
--
-- 1. A walk-in patient may have a contact email. It is nullable, it is a
--    contact detail on a clinical record, and it never creates or implies a
--    Supabase Auth account, a password or portal access. The existing
--    preferred_language column is left in place because historical rows use it;
--    the application no longer asks for it.
--
-- 2. The private symptom model can be unreachable. A doctor must still be able
--    to document the consultation, so an assessment can be stored with an
--    explicit model_status of 'unavailable': no predicted disease, no model
--    version, no guidance. Existing rows default to 'completed' and keep their
--    frozen prediction. Nothing is ever stored with a placeholder diagnosis.
--
-- Apply after 013. Idempotent where practical.

begin;

-- 1. Walk-in contact email -------------------------------------------------------
alter table public.clinic_patients add column if not exists email text;

-- Nullable for the same reason as phone: many patients do not have one. The
-- check only rejects a value that cannot be an address at all.
alter table public.clinic_patients drop constraint if exists clinic_patients_email_format;
alter table public.clinic_patients add constraint clinic_patients_email_format
  check (
    email is null
    or (
      char_length(email) between 3 and 254
      and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

-- Match lookups are scoped to the doctor first, then the address.
create index if not exists clinic_patients_doctor_email
  on public.clinic_patients (doctor_id, lower(email));

-- 2. Model status on assessments -------------------------------------------------
alter table public.assessments add column if not exists model_status text;

-- Every assessment that exists today was produced by the model.
update public.assessments set model_status = 'completed' where model_status is null;

alter table public.assessments alter column model_status set default 'completed';
alter table public.assessments alter column model_status set not null;
alter table public.assessments alter column predicted_disease drop not null;
alter table public.assessments alter column model_version drop not null;

alter table public.assessments drop constraint if exists assessments_model_status_check;
alter table public.assessments add constraint assessments_model_status_check
  check (model_status in ('completed', 'unavailable'));

-- The model needs at least one symptom when it actually ran. A clinical record
-- saved during an outage has no model input, so it has no such requirement.
alter table public.assessments drop constraint if exists assessments_symptoms_present;
alter table public.assessments add constraint assessments_symptoms_present
  check (
    model_status <> 'completed'
    or cardinality(patient_reported) + cardinality(clinician_added) > 0
  );

-- Prediction fields are all-or-nothing, and an unavailable model leaves no
-- convincing half-result behind.
alter table public.assessments drop constraint if exists assessments_model_fields;
alter table public.assessments add constraint assessments_model_fields
  check (
    (
      model_status = 'completed'
      and predicted_disease is not null
      and model_version is not null
    )
    or (
      model_status = 'unavailable'
      and predicted_disease is null
      and model_version is null
      and model_confidence is null
      and description is null
      and precautions = '[]'::jsonb
      and medications = '[]'::jsonb
      and diet = '[]'::jsonb
      and workout = '[]'::jsonb
    )
  );

-- A model-free record still has to contain something clinical.
alter table public.assessments drop constraint if exists assessments_clinical_content;
alter table public.assessments add constraint assessments_clinical_content
  check (
    model_status = 'completed'
    or cardinality(observations) > 0
    or coalesce(length(btrim(clinical_note)), 0) > 0
    or coalesce(length(btrim(doctor_assessment)), 0) > 0
    or coalesce(length(btrim(plan)), 0) > 0
  );

-- Model status is part of the frozen result and cannot be changed after insert.
create or replace function public.freeze_assessment_model()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.doctor_id <> old.doctor_id
     or new.patient_id is distinct from old.patient_id
     or new.clinic_patient_id is distinct from old.clinic_patient_id
     or new.appointment_id is distinct from old.appointment_id
     or new.model_status <> old.model_status
     or new.patient_reported <> old.patient_reported
     or new.clinician_added <> old.clinician_added
     or new.observations <> old.observations
     or new.predicted_disease is distinct from old.predicted_disease
     or new.model_version is distinct from old.model_version
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

-- 3. Walk-in list with the contact email -----------------------------------------
-- preferred_language stays in the table for history but is no longer part of the
-- walk-in API: the registration form does not collect it.
drop function if exists public.doctor_clinic_patients();
create function public.doctor_clinic_patients()
returns table(id uuid, full_name text, date_of_birth date, phone text, email text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_approved_doctor() then
    raise exception 'Approved doctor required' using errcode = '42501';
  end if;
  return query
    select c.id, c.full_name, c.date_of_birth, c.phone, c.email, c.created_at
    from public.clinic_patients c
    where c.doctor_id = auth.uid()
    order by c.created_at desc
    limit 200;
end $$;
revoke all on function public.doctor_clinic_patients() from public, anon;
grant execute on function public.doctor_clinic_patients() to authenticated;

-- 4. Duplicate checks across name, phone, email and date of birth ----------------
-- Still only this doctor's own records, still no automatic merge, and the
-- returned reason says which identifier matched so the doctor can judge it.
drop function if exists public.doctor_clinic_patient_matches(text, text, date);
create function public.doctor_clinic_patient_matches(
  p_name text, p_phone text default null, p_email text default null, p_date_of_birth date default null)
returns table(id uuid, full_name text, date_of_birth date, phone text, email text,
              match_reason text, last_seen timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  needle text := lower(btrim(coalesce(p_name, '')));
  phone_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  mail text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.is_approved_doctor() then
    raise exception 'Approved doctor required' using errcode = '42501';
  end if;
  if needle = '' and phone_digits = '' and mail = '' and p_date_of_birth is null then
    return; -- never return the whole list as "matches"
  end if;
  return query
    select c.id, c.full_name, c.date_of_birth, c.phone, c.email,
      case
        when phone_digits <> '' and c.phone is not null
          and regexp_replace(c.phone, '\D', '', 'g') = phone_digits then 'same phone number'
        when mail <> '' and c.email is not null and lower(btrim(c.email)) = mail then 'same email address'
        when p_date_of_birth is not null and c.date_of_birth = p_date_of_birth then 'same date of birth'
        else 'similar name'
      end,
      (select max(a.scheduled_start) from public.appointments a where a.clinic_patient_id = c.id)
    from public.clinic_patients c
    where c.doctor_id = auth.uid()
      and (
        (needle <> '' and lower(btrim(c.full_name)) like '%' || needle || '%')
        or (phone_digits <> '' and c.phone is not null
            and regexp_replace(c.phone, '\D', '', 'g') = phone_digits)
        or (mail <> '' and c.email is not null and lower(btrim(c.email)) = mail)
        or (p_date_of_birth is not null and c.date_of_birth = p_date_of_birth)
      )
    order by
      (phone_digits <> '' and c.phone is not null
        and regexp_replace(c.phone, '\D', '', 'g') = phone_digits) desc,
      (mail <> '' and c.email is not null and lower(btrim(c.email)) = mail) desc,
      (p_date_of_birth is not null and c.date_of_birth = p_date_of_birth) desc,
      c.created_at desc
    limit 10;
end $$;
revoke all on function public.doctor_clinic_patient_matches(text, text, text, date) from public, anon;
grant execute on function public.doctor_clinic_patient_matches(text, text, text, date) to authenticated;

-- 5. Registration stores the optional contact email ------------------------------
drop function if exists public.doctor_register_clinic_patient(text, date, text, text, uuid);
create function public.doctor_register_clinic_patient(
  p_full_name text, p_date_of_birth date, p_phone text, p_email text, p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_full_name, ''));
        v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
        v_email text := nullif(btrim(coalesce(p_email, '')), '');
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
     or (v_email is not null and (
           char_length(v_email) > 254
           or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) then
    raise exception 'Invalid patient details' using errcode = '22023';
  end if;

  -- Retry of the same submission: return the record already created.
  select id into v_existing from public.clinic_patients
  where doctor_id = auth.uid() and registration_key = p_key;
  if v_existing is not null then
    select * into v_record from public.clinic_patients where id = v_existing;
    return jsonb_build_object('id', v_record.id, 'fullName', v_record.full_name,
      'dateOfBirth', v_record.date_of_birth, 'phone', v_record.phone,
      'email', v_record.email, 'createdAt', v_record.created_at,
      'account', false, 'existing', true);
  end if;

  begin
    insert into public.clinic_patients (doctor_id, full_name, date_of_birth, phone, email, registration_key, created_by)
    values (auth.uid(), v_name, p_date_of_birth, v_phone, v_email, p_key, auth.uid())
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
    'email', v_record.email, 'createdAt', v_record.created_at,
    'account', false, 'existing', false);
end $$;
revoke all on function public.doctor_register_clinic_patient(text, date, text, text, uuid) from public, anon;
grant execute on function public.doctor_register_clinic_patient(text, date, text, text, uuid) to authenticated;

-- 6. Consultation context returns the walk-in contact email ----------------------
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
    select full_name, email into patient_name, patient_email
    from public.clinic_patients where id = rec.clinic_patient_id;
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

-- 7. Assessment view reports the model status and the walk-in contact email ------
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
    select full_name, email into patient_name, patient_email
    from public.clinic_patients where id = rec.clinic_patient_id;
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
    'modelStatus', rec.model_status,
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
