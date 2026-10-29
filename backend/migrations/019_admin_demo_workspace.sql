-- 019: explicitly scoped admin demo workspace.
-- Admins may run the doctor workflow for a selected doctor without doctor credentials.
-- The acting admin is preserved on every saved demo assessment and audited action.
begin;

alter table public.assessments
  add column if not exists created_by uuid references public.profiles(id),
  add column if not exists demo_mode boolean not null default false;

update public.assessments set created_by = doctor_id where created_by is null;
alter table public.assessments alter column created_by set default auth.uid();

drop policy if exists appointments_admin_demo_read on public.appointments;
create policy appointments_admin_demo_read on public.appointments
  for select to authenticated using (public.is_admin());

drop policy if exists profiles_admin_demo_read on public.profiles;
create policy profiles_admin_demo_read on public.profiles
  for select to authenticated using (public.is_admin());

drop policy if exists slots_admin_demo_read on public.doctor_availability;
create policy slots_admin_demo_read on public.doctor_availability
  for select to authenticated using (public.is_admin());

drop policy if exists clinic_patients_admin_demo_read on public.clinic_patients;
create policy clinic_patients_admin_demo_read on public.clinic_patients
  for select to authenticated using (public.is_admin());

drop policy if exists assessments_admin_demo_insert on public.assessments;
create policy assessments_admin_demo_insert on public.assessments
  for insert to authenticated
  with check (
    public.is_admin()
    and created_by = auth.uid()
    and demo_mode = true
    and exists (select 1 from public.profiles d where d.id = doctor_id and d.role = 'doctor' and not d.suspended)
    and (
      (patient_id is not null and clinic_patient_id is null and exists (
        select 1 from public.appointments a
        where a.id = appointment_id and a.doctor_id = assessments.doctor_id
          and a.patient_id = assessments.patient_id
      ))
      or
      (clinic_patient_id is not null and patient_id is null and exists (
        select 1 from public.clinic_patients c
        join public.appointments a on a.clinic_patient_id = c.id
        where c.id = assessments.clinic_patient_id and c.doctor_id = assessments.doctor_id
          and a.id = appointment_id and a.doctor_id = assessments.doctor_id
      ))
    )
  );

drop policy if exists assessments_admin_demo_update on public.assessments;
create policy assessments_admin_demo_update on public.assessments
  for update to authenticated
  using (public.is_admin() and demo_mode = true and created_by = auth.uid())
  with check (public.is_admin() and demo_mode = true and created_by = auth.uid());

create or replace function public.admin_demo_doctor_profile(p_doctor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode = '42501'; end if;
  select jsonb_build_object(
    'id', p.id, 'fullName', p.full_name, 'role', p.role, 'suspended', p.suspended,
    'email', u.email, 'verificationStatus', coalesce(d.verification_status, 'pending'),
    'specialty', d.specialty, 'institution', d.institution,
    'isAcceptingAppointments', coalesce(d.is_accepting_appointments, false)
  ) into result
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.doctor_profiles d on d.user_id = p.id
  where p.id = p_doctor and p.role = 'doctor' and not p.suspended;
  if result is null then raise exception 'Doctor unavailable for demo workspace' using errcode = 'P0002'; end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, metadata)
  values (auth.uid(), 'demo_workspace_opened', p_doctor, jsonb_build_object('mode','admin_demo'));
  return result;
end $$;

create or replace function public.admin_demo_patient_names(p_doctor uuid)
returns table(id uuid, full_name text, email text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode = '42501'; end if;
  if not exists(select 1 from public.profiles where profiles.id=p_doctor and role='doctor' and not suspended) then
    raise exception 'Doctor unavailable' using errcode = 'P0002';
  end if;
  return query
    select distinct p.id, p.full_name, u.email::text
    from public.appointments a
    join public.profiles p on p.id = a.patient_id
    join auth.users u on u.id = p.id
    where a.doctor_id = p_doctor and a.patient_id is not null
    order by p.full_name;
end $$;

create or replace function public.admin_demo_clinic_patients(p_doctor uuid)
returns table(id uuid, full_name text, date_of_birth date, phone text, email text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode = '42501'; end if;
  if not exists(select 1 from public.profiles where profiles.id=p_doctor and role='doctor' and not suspended) then
    raise exception 'Doctor unavailable' using errcode = 'P0002';
  end if;
  return query select c.id, c.full_name, c.date_of_birth, c.phone, c.email, c.created_at
    from public.clinic_patients c where c.doctor_id=p_doctor order by c.created_at desc;
end $$;

create or replace function public.admin_demo_consultation(p_appt uuid, p_doctor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rec public.appointments; patient_name text; patient_email text; prior public.assessments; prior_found boolean := false;
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode = '42501'; end if;
  if not exists(select 1 from public.profiles where id=p_doctor and role='doctor' and not suspended) then
    raise exception 'Doctor unavailable' using errcode = 'P0002';
  end if;
  select * into rec from public.appointments where id=p_appt and doctor_id=p_doctor;
  if not found then raise exception 'Appointment not found for selected doctor' using errcode = 'P0002'; end if;
  if rec.patient_id is not null then
    select full_name into patient_name from public.profiles where id=rec.patient_id;
    select email into patient_email from auth.users where id=rec.patient_id;
  elsif rec.clinic_patient_id is not null then
    select full_name, email into patient_name, patient_email from public.clinic_patients where id=rec.clinic_patient_id;
  end if;
  select * into prior from public.assessments where appointment_id=rec.id and doctor_id=p_doctor order by created_at desc limit 1;
  prior_found := prior.id is not null;
  insert into public.admin_audit_logs(actor_id, action, target_id, metadata)
  values (auth.uid(), 'demo_consultation_opened', rec.id, jsonb_build_object('doctor_id',p_doctor,'mode','admin_demo'));
  return jsonb_build_object(
    'appointmentId',rec.id,'startsAt',rec.scheduled_start,'status',rec.status,'reason',rec.reason,
    'patientId',rec.patient_id,'clinicPatientId',rec.clinic_patient_id,
    'patientName',patient_name,'patientEmail',patient_email,'previousAssessmentId',prior.id,
    'patientReported',case when prior_found then to_jsonb(prior.patient_reported) else '[]'::jsonb end,
    'clinicianAdded',case when prior_found then to_jsonb(prior.clinician_added) else '[]'::jsonb end,
    'observations',case when prior_found then to_jsonb(prior.observations) else '[]'::jsonb end,
    'symptomDuration',prior.symptom_duration,'clinicalNote',prior.clinical_note,
    'doctorAssessment',prior.doctor_assessment,'plan',prior.plan
  );
end $$;

create or replace function public.admin_demo_change_appointment_status(p_id uuid, p_status text, p_doctor uuid)
returns public.appointments language plpgsql security definer set search_path = '' as $$
declare rec public.appointments; previous text;
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode = '42501'; end if;
  if p_status not in ('confirmed','cancelled','completed','no_show') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if not exists(select 1 from public.profiles where id=p_doctor and role='doctor' and not suspended) then
    raise exception 'Doctor unavailable' using errcode = 'P0002';
  end if;
  select * into rec from public.appointments where id=p_id and doctor_id=p_doctor for update;
  if not found then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  previous := rec.status;
  if not (
    (previous='pending' and p_status in ('confirmed','cancelled'))
    or (previous='confirmed' and p_status in ('cancelled','completed','no_show'))
  ) then raise exception 'Invalid status transition' using errcode = '42501'; end if;
  update public.appointments set status=p_status, updated_at=now(),
    cancelled_at=case when p_status='cancelled' then now() else null end
    where id=p_id returning * into rec;
  insert into public.appointment_status_history(appointment_id,previous_status,new_status,actor_id)
    values(p_id,previous,p_status,auth.uid());
  insert into public.admin_audit_logs(actor_id,action,target_id,metadata)
    values(auth.uid(),'demo_appointment_status_changed',p_id,jsonb_build_object('doctor_id',p_doctor,'from',previous,'to',p_status,'mode','admin_demo'));
  return rec;
end $$;

create or replace function public.admin_demo_analytics(p_doctor uuid, p_since date, p_until date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode = '42501'; end if;
  if p_until < p_since then raise exception 'Invalid date range' using errcode = '22023'; end if;
  if not exists(select 1 from public.profiles where id=p_doctor and role='doctor' and not suspended) then
    raise exception 'Doctor unavailable' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'appointments', count(*) filter (where a.status <> 'cancelled'),
    'completed', count(*) filter (where a.status = 'completed'),
    'cancelled', count(*) filter (where a.status = 'cancelled'),
    'noShow', count(*) filter (where a.status = 'no_show'),
    'trends', coalesce(jsonb_agg(jsonb_build_object('day',to_char(a.scheduled_start at time zone 'UTC','YYYY-MM-DD'),'bookings',1)
      order by a.scheduled_start) filter (where a.id is not null),'[]'::jsonb)
  ) into result
  from public.appointments a
  where a.doctor_id=p_doctor and a.scheduled_start >= p_since::timestamp at time zone 'UTC'
    and a.scheduled_start < (p_until+1)::timestamp at time zone 'UTC';
  return result;
end $$;

revoke all on function public.admin_demo_doctor_profile(uuid),
  public.admin_demo_patient_names(uuid), public.admin_demo_clinic_patients(uuid),
  public.admin_demo_consultation(uuid,uuid), public.admin_demo_change_appointment_status(uuid,text,uuid),
  public.admin_demo_analytics(uuid,date,date) from public, anon;
grant execute on function public.admin_demo_doctor_profile(uuid),
  public.admin_demo_patient_names(uuid), public.admin_demo_clinic_patients(uuid),
  public.admin_demo_consultation(uuid,uuid), public.admin_demo_change_appointment_status(uuid,text,uuid),
  public.admin_demo_analytics(uuid,date,date) to authenticated;

commit;
