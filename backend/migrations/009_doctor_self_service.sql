-- 009: doctor accounts exist from signup with pending verification.
--
-- Before this migration a doctor was first a `doctor_applicant` (or had to apply
-- from a patient account) and only became `doctor` after approval. From now on:
--   * registering as a doctor creates role `doctor` plus a pending
--     doctor_profiles row and a pending doctor_applications row;
--   * verification_status (pending / approved / rejected / resubmission_required)
--     decides what the account may do, and only an administrator can change it;
--   * every clinical RPC still requires verification_status='approved'.
-- Apply after 003, 005, 006 and 008. Safe to run once; additive backfills use
-- ON CONFLICT DO NOTHING.
begin;

-- 1. Professional detail columns ------------------------------------------------
alter table public.doctor_profiles add column if not exists institution text;
alter table public.doctor_profiles add column if not exists years_experience integer;
alter table public.doctor_profiles drop constraint if exists doctor_profiles_institution_check;
alter table public.doctor_profiles add constraint doctor_profiles_institution_check
  check (institution is null or length(trim(institution)) between 2 and 200);
alter table public.doctor_profiles drop constraint if exists doctor_profiles_years_experience_check;
alter table public.doctor_profiles add constraint doctor_profiles_years_experience_check
  check (years_experience is null or years_experience between 0 and 80);
alter table public.doctor_profiles drop constraint if exists doctor_profiles_verification_status_check;
alter table public.doctor_profiles add constraint doctor_profiles_verification_status_check
  check (verification_status in ('pending','approved','rejected','resubmission_required'));

alter table public.doctor_applications add column if not exists institution text;
alter table public.doctor_applications add column if not exists years_experience integer;
alter table public.doctor_applications drop constraint if exists doctor_applications_status_check;
alter table public.doctor_applications add constraint doctor_applications_status_check
  check (status in ('pending','approved','rejected','resubmission_required'));

-- 2. Promote legacy applicants to doctor accounts -------------------------------
update public.profiles set role = 'doctor', updated_at = now() where role = 'doctor_applicant';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('patient','doctor','admin'));

insert into public.doctor_profiles(user_id, specialty, qualifications, institution, years_experience, verification_status, is_accepting_appointments)
select a.applicant_id, a.specialty, coalesce(a.qualifications,''), nullif(trim(coalesce(a.institution,'')),''), a.years_experience,
       case a.status when 'approved' then 'approved' else 'pending' end, false
from public.doctor_applications a
join public.profiles p on p.id = a.applicant_id
where p.role = 'doctor'
on conflict (user_id) do nothing;

-- 3. Signup trigger: role comes from account_type only, never from role ---------
create or replace function public.create_patient_profile()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  v_name text;
  v_role text;
  v_specialty text;
  v_license text;
  v_qualifications text;
  v_institution text;
  v_phone text;
  v_experience integer;
begin
  v_name := left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'HelloDoc user'), 200);
  v_phone := nullif(trim(coalesce(new.raw_user_meta_data->>'phone', '')), '');
  if v_phone is not null and (length(v_phone) > 40) then
    raise exception 'Invalid phone number' using errcode = '22023';
  end if;
  v_role := case when new.raw_user_meta_data->>'account_type' = 'doctor' then 'doctor' else 'patient' end;

  insert into public.profiles(id, full_name, role, phone)
  values (new.id, v_name, v_role, v_phone);

  if v_role = 'doctor' then
    v_specialty := trim(coalesce(new.raw_user_meta_data->>'specialty', ''));
    v_license := trim(coalesce(new.raw_user_meta_data->>'license_number', ''));
    v_qualifications := trim(coalesce(new.raw_user_meta_data->>'qualifications', ''));
    v_institution := trim(coalesce(new.raw_user_meta_data->>'institution', ''));
    v_experience := nullif(new.raw_user_meta_data->>'years_experience', '')::integer;
    if length(v_specialty) not between 2 and 120
       or length(v_license) not between 3 and 120
       or length(v_qualifications) not between 5 and 2000
       or length(v_institution) not between 2 and 200
       or (v_experience is not null and v_experience not between 0 and 80) then
      raise exception 'Valid doctor details required' using errcode = '22023';
    end if;
    -- Pending until an administrator verifies the clinician; never accepting
    -- appointments on creation.
    insert into public.doctor_profiles(user_id, specialty, qualifications, institution, years_experience, verification_status, is_accepting_appointments)
    values (new.id, v_specialty, v_qualifications, v_institution, v_experience, 'pending', false);
    insert into public.doctor_applications(applicant_id, specialty, license_number, qualifications, institution, years_experience, status)
    values (new.id, v_specialty, v_license, v_qualifications, v_institution, v_experience, 'pending');
  else
    insert into public.patient_profiles(user_id, phone) values (new.id, v_phone);
  end if;
  return new;
end
$function$;

-- 4. Self-service profile updates ----------------------------------------------
create function public.update_own_profile(p_full_name text, p_phone text)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare result public.profiles;
begin
  perform public.require_active();
  if p_full_name is null or length(trim(p_full_name)) not between 1 and 200
     or (p_phone is not null and length(p_phone) > 40) then
    raise exception 'Invalid profile details' using errcode = '22023';
  end if;
  -- Only name and phone are writable; role, suspended and id are untouched.
  update public.profiles set full_name = trim(p_full_name), phone = nullif(trim(coalesce(p_phone,'')),''), updated_at = now()
  where id = auth.uid() returning * into result;
  if not found then raise exception 'Profile unavailable' using errcode = '42501'; end if;
  update public.patient_profiles set phone = result.phone, updated_at = now() where user_id = auth.uid();
  return result;
end $$;

create function public.update_own_doctor_profile(p_full_name text, p_bio text, p_institution text, p_years_experience integer)
returns public.doctor_profiles language plpgsql security definer set search_path = '' as $$
declare result public.doctor_profiles;
begin
  perform public.require_active();
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'doctor') then
    raise exception 'Doctor account required' using errcode = '42501';
  end if;
  if p_full_name is null or length(trim(p_full_name)) not between 1 and 200
     or p_bio is null or length(p_bio) > 2000
     or (p_institution is not null and p_institution <> '' and length(trim(p_institution)) not between 2 and 200)
     or (p_years_experience is not null and p_years_experience not between 0 and 80) then
    raise exception 'Invalid doctor details' using errcode = '22023';
  end if;
  update public.profiles set full_name = trim(p_full_name), updated_at = now() where id = auth.uid();
  update public.doctor_profiles
     set professional_bio = p_bio,
         institution = nullif(trim(coalesce(p_institution,'')),''),
         years_experience = p_years_experience,
         updated_at = now()
   where user_id = auth.uid()
   returning * into result;
  if not found then raise exception 'Doctor profile unavailable' using errcode = '42501'; end if;
  return result;
end $$;

-- 5. Resubmission after rejection ----------------------------------------------
create function public.resubmit_doctor_application(p_specialty text, p_license text, p_qualifications text, p_institution text, p_years_experience integer)
returns public.doctor_applications language plpgsql security definer set search_path = '' as $$
declare result public.doctor_applications;
begin
  perform public.require_active();
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'doctor') then
    raise exception 'Doctor account required' using errcode = '42501';
  end if;
  if p_specialty is null or length(trim(p_specialty)) not between 2 and 120
     or p_license is null or length(trim(p_license)) not between 3 and 120
     or p_qualifications is null or length(trim(p_qualifications)) not between 5 and 2000
     or p_institution is null or length(trim(p_institution)) not between 2 and 200
     or (p_years_experience is not null and p_years_experience not between 0 and 80) then
    raise exception 'Complete verification details required' using errcode = '22023';
  end if;
  -- Only a rejected or resubmission-requested application may be resubmitted; a
  -- verified doctor cannot reset their own status.
  update public.doctor_applications
     set specialty = trim(p_specialty), license_number = trim(p_license), qualifications = trim(p_qualifications),
         institution = trim(p_institution), years_experience = p_years_experience,
         status = 'pending', review_reason = null, reviewed_by = null, reviewed_at = null, updated_at = now()
   where applicant_id = auth.uid() and status in ('rejected','resubmission_required')
   returning * into result;
  if not found then raise exception 'Resubmission not available' using errcode = '42501'; end if;
  update public.doctor_profiles
     set specialty = trim(p_specialty), institution = trim(p_institution), years_experience = p_years_experience,
         verification_status = 'pending', is_accepting_appointments = false, updated_at = now()
   where user_id = auth.uid();
  return result;
end $$;

-- 6. Administrative review, including request_resubmission ---------------------
create or replace function public.admin_action(p_action text, p_target uuid, p_reason text, p_details jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare app public.doctor_applications; visit public.appointments; begin
  perform public.require_admin();
  if p_reason is null or length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Review reason required' using errcode = '22023';
  end if;
  if p_action in ('approve_doctor','reject_doctor','request_resubmission') then
    select * into app from public.doctor_applications where applicant_id = p_target for update;
    if not found or app.status not in ('pending','resubmission_required') then
      raise exception 'Pending application required';
    end if;
    if p_action = 'approve_doctor' then
      if coalesce(p_details->>'verification_confirmed','false') <> 'true' then
        raise exception 'Independent verification required';
      end if;
      update public.profiles set role = 'doctor', updated_at = now() where id = p_target and not suspended;
      if not found then raise exception 'Active doctor required'; end if;
      -- The row already exists from signup, so update it instead of inserting.
      insert into public.doctor_profiles(user_id, specialty, qualifications, verification_status, is_accepting_appointments)
      values (p_target, app.specialty, coalesce(app.qualifications,''), 'approved', true)
      on conflict (user_id) do update
        set specialty = app.specialty,
            qualifications = coalesce(app.qualifications, public.doctor_profiles.qualifications),
            verification_status = 'approved',
            is_accepting_appointments = true,
            updated_at = now();
    elsif p_action = 'reject_doctor' then
      update public.doctor_profiles set verification_status = 'rejected', is_accepting_appointments = false, updated_at = now() where user_id = p_target;
    else
      update public.doctor_profiles set verification_status = 'resubmission_required', is_accepting_appointments = false, updated_at = now() where user_id = p_target;
    end if;
    update public.doctor_applications
       set status = case p_action when 'approve_doctor' then 'approved' when 'reject_doctor' then 'rejected' else 'resubmission_required' end,
           review_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
     where applicant_id = p_target;
  elsif p_action in ('suspend','reactivate') then
    update public.profiles set suspended = (p_action = 'suspend'), updated_at = now() where id = p_target and role <> 'admin';
    if not found then raise exception 'Patient or doctor required'; end if;
    if p_action = 'suspend' then
      update public.doctor_profiles set is_accepting_appointments = false, updated_at = now() where user_id = p_target;
    end if;
  elsif p_action = 'update_doctor' then
    update public.doctor_profiles set specialty = coalesce(p_details->>'specialty', specialty),
      professional_bio = coalesce(p_details->>'bio', professional_bio),
      consultation_fee = coalesce((p_details->>'fee')::numeric, consultation_fee),
      is_accepting_appointments = coalesce((p_details->>'accepting')::boolean, is_accepting_appointments),
      updated_at = now() where user_id = p_target;
    if not found then raise exception 'Doctor required'; end if;
  elsif p_action = 'cancel_appointment' then
    select * into visit from public.appointments where id = p_target for update;
    if not found or visit.status not in ('pending','confirmed') or visit.scheduled_start <= now() then
      raise exception 'Future active appointment required';
    end if;
    update public.appointments set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = p_target;
    insert into public.appointment_status_history(appointment_id, previous_status, new_status, actor_id)
    values (p_target, visit.status, 'cancelled', auth.uid());
  else
    raise exception 'Invalid administrative action';
  end if;
  insert into public.admin_audit_logs(actor_id, action, target_id, metadata)
  values (auth.uid(), p_action, p_target, jsonb_build_object('reason', p_reason));
end $$;

-- 7. Grants -------------------------------------------------------------------
revoke all on function public.update_own_profile(text,text), public.update_own_doctor_profile(text,text,text,integer),
  public.resubmit_doctor_application(text,text,text,text,integer) from public, anon;
grant execute on function public.update_own_profile(text,text), public.update_own_doctor_profile(text,text,text,integer),
  public.resubmit_doctor_application(text,text,text,text,integer) to authenticated;

commit;
