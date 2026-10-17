-- Supabase PostgreSQL 17; apply once via migration tooling to an isolated project first.
-- Existing MySQL tables are NOT migrated by this DDL. Times are UTC timestamptz.
create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
-- Make the extension's GiST operator classes visible while defining exclusions.
set search_path = public, extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(full_name) between 1 and 200),
  role text not null default 'patient' check (role in ('patient','doctor','admin')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.patient_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.doctor_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  specialty text not null, professional_bio text not null default '',
  verification_status text not null default 'pending' check (verification_status in ('pending','approved','rejected')),
  consultation_fee numeric(10,2) not null default 0 check (consultation_fee >= 0),
  is_accepting_appointments boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- Applications do not grant a doctor role. Only a trusted reviewer can approve one.
create table public.doctor_applications (
  applicant_id uuid primary key references public.profiles(id) on delete cascade,
  specialty text not null check (length(trim(specialty)) between 2 and 120),
  license_number text not null check (length(trim(license_number)) between 3 and 120),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.doctor_availability (
  id uuid primary key default gen_random_uuid(), doctor_id uuid not null references public.doctor_profiles(user_id),
  scheduled_start timestamptz not null, scheduled_end timestamptz not null,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (scheduled_end = scheduled_start + interval '30 minutes'),
  constraint no_overlapping_open_slots exclude using gist (doctor_id with =, tstzrange(scheduled_start,scheduled_end,'[)') with &&) where (status = 'open')
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patient_profiles(user_id),
  doctor_id uuid not null references public.doctor_profiles(user_id),
  slot_id uuid not null references public.doctor_availability(id),
  scheduled_start timestamptz not null, scheduled_end timestamptz not null,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','completed','no_show')),
  reason text check (length(reason) <= 500), idempotency_key uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), cancelled_at timestamptz,
  unique(patient_id,idempotency_key),
  constraint no_doctor_overlap exclude using gist (doctor_id with =, tstzrange(scheduled_start,scheduled_end,'[)') with &&) where (status in ('pending','confirmed')),
  constraint no_patient_overlap exclude using gist (patient_id with =, tstzrange(scheduled_start,scheduled_end,'[)') with &&) where (status in ('pending','confirmed'))
);
create index appointments_patient_start on public.appointments(patient_id,scheduled_start desc);
create index appointments_doctor_start on public.appointments(doctor_id,scheduled_start desc);
create index availability_doctor_start on public.doctor_availability(doctor_id,scheduled_start);
create table public.appointment_status_history (
  id bigint generated always as identity primary key, appointment_id uuid not null references public.appointments(id),
  previous_status text, new_status text not null, actor_id uuid not null references public.profiles(id),
  changed_at timestamptz not null default now()
);
create index history_appointment on public.appointment_status_history(appointment_id,changed_at desc);

-- Auth trigger intentionally ignores user_metadata.role. A self-signup is always a patient.
create function public.create_patient_profile() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.profiles(id,full_name,role) values (new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''), 'Patient'),200),'patient');
  insert into public.patient_profiles(user_id) values (new.id);
  return new;
end; $$;
create trigger create_patient_profile_after_signup after insert on auth.users
for each row execute function public.create_patient_profile();
revoke all on function public.create_patient_profile() from public, anon, authenticated;

-- The only appointment writes are trusted RPCs. auth.uid() comes from verified JWT.
create function public.book_appointment(p_slot uuid, p_key uuid, p_reason text default null)
returns public.appointments language plpgsql security definer set search_path = '' as $$
declare v_slot public.doctor_availability; v_record public.appointments; v_existing public.appointments;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and role='patient') then
    raise exception 'Patient access required' using errcode='42501';
  end if;
  if p_slot is null or p_key is null or (p_reason is not null and length(p_reason)>500) then raise exception 'Invalid booking' using errcode='22023'; end if;
  select * into v_existing from public.appointments where patient_id=auth.uid() and idempotency_key=p_key;
  if found then
    if v_existing.slot_id <> p_slot then raise exception 'Idempotency key already used' using errcode='22023'; end if;
    return v_existing;
  end if;
  select a.* into v_slot from public.doctor_availability a join public.doctor_profiles d on d.user_id=a.doctor_id
  join public.profiles p on p.id=d.user_id where a.id=p_slot and a.status='open'
  and d.verification_status='approved' and d.is_accepting_appointments and p.role='doctor'
  and a.scheduled_start > now() + interval '5 minutes' for update of a;
  if not found then raise exception 'Slot unavailable' using errcode='P0001'; end if;
  insert into public.appointments(patient_id,doctor_id,slot_id,scheduled_start,scheduled_end,reason,idempotency_key)
  values(auth.uid(),v_slot.doctor_id,v_slot.id,v_slot.scheduled_start,v_slot.scheduled_end,p_reason,p_key) returning * into v_record;
  insert into public.appointment_status_history(appointment_id,new_status,actor_id) values(v_record.id,'pending',auth.uid());
  return v_record;
end; $$;

create function public.apply_as_doctor(p_specialty text, p_license_number text)
returns public.doctor_applications language plpgsql security definer set search_path = '' as $$
declare v_record public.doctor_applications;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p join public.patient_profiles pp on pp.user_id=p.id
 where p.id=auth.uid() and p.role='patient') then
  raise exception 'Patient account required' using errcode='42501'; end if;
 if p_specialty is null or length(trim(p_specialty)) not between 2 and 120
 or p_license_number is null or length(trim(p_license_number)) not between 3 and 120 then
  raise exception 'Invalid application' using errcode='22023'; end if;
 insert into public.doctor_applications(applicant_id,specialty,license_number)
 values(auth.uid(),trim(p_specialty),trim(p_license_number)) returning * into v_record;
 return v_record;
end; $$;
revoke all on function public.apply_as_doctor(text,text) from public,anon;
grant execute on function public.apply_as_doctor(text,text) to authenticated;

create function public.add_doctor_slot(p_start timestamptz)
returns public.doctor_availability language plpgsql security definer set search_path = '' as $$
declare v_record public.doctor_availability;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p join public.doctor_profiles d on d.user_id=p.id where p.id=auth.uid() and p.role='doctor' and d.verification_status='approved') then
  raise exception 'Doctor access required' using errcode='42501'; end if;
 if p_start is null or p_start<=now()+interval '5 minutes' then raise exception 'Invalid slot' using errcode='22023'; end if;
 insert into public.doctor_availability(doctor_id,scheduled_start,scheduled_end)
 values(auth.uid(),p_start,p_start+interval '30 minutes') returning * into v_record;
 return v_record;
end; $$;
revoke all on function public.add_doctor_slot(timestamptz) from public, anon;
grant execute on function public.add_doctor_slot(timestamptz) to authenticated;

create function public.change_appointment_status(p_id uuid, p_status text)
returns public.appointments language plpgsql security definer set search_path = '' as $$
declare v_record public.appointments; v_role text; v_previous text;
begin
  select role into v_role from public.profiles where id=auth.uid();
  select * into v_record from public.appointments where id=p_id for update;
  if not found then raise exception 'Appointment not found' using errcode='P0002'; end if;
  v_previous := v_record.status;
  if (v_role='patient' and v_record.patient_id=auth.uid() and p_status='cancelled' and v_record.status in ('pending','confirmed') and v_record.scheduled_start > now())
  or (v_role='doctor' and v_record.doctor_id=auth.uid() and exists(select 1 from public.doctor_profiles where user_id=auth.uid() and verification_status='approved') and
      ((v_record.status='pending' and p_status in ('confirmed','cancelled') and v_record.scheduled_start > now()) or
       (v_record.status='confirmed' and p_status='cancelled' and v_record.scheduled_start > now()) or
       (v_record.status='confirmed' and p_status in ('completed','no_show') and v_record.scheduled_end <= now()))) then
    update public.appointments set status=p_status, updated_at=now(),
      cancelled_at=case when p_status='cancelled' then now() else null end where id=p_id returning * into v_record;
    insert into public.appointment_status_history(appointment_id,previous_status,new_status,actor_id)
      values(p_id,v_previous,p_status,auth.uid());
    return v_record;
  end if;
  raise exception 'Invalid status transition' using errcode='42501';
end; $$;

-- Direct writes are prohibited; grant only the scoped RPCs.
revoke all on public.profiles, public.patient_profiles, public.doctor_profiles, public.doctor_availability,
 public.appointments, public.appointment_status_history, public.doctor_applications from anon, authenticated;
grant select on public.profiles, public.patient_profiles, public.doctor_availability,
 public.appointments, public.appointment_status_history to authenticated;
grant select on public.doctor_profiles, public.doctor_applications to authenticated;
grant select (user_id,specialty,professional_bio,verification_status,consultation_fee,is_accepting_appointments) on public.doctor_profiles to anon;
grant select on public.doctor_availability to anon;
revoke all on function public.book_appointment(uuid,uuid,text), public.change_appointment_status(uuid,text) from public, anon;
grant execute on function public.book_appointment(uuid,uuid,text), public.change_appointment_status(uuid,text) to authenticated;

alter table public.profiles enable row level security;
alter table public.patient_profiles enable row level security;
alter table public.doctor_profiles enable row level security;
alter table public.doctor_applications enable row level security;
create policy doctor_application_own on public.doctor_applications for select to authenticated using (applicant_id=auth.uid());
alter table public.doctor_availability enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_status_history enable row level security;
create policy profiles_own on public.profiles for select to authenticated using (id=auth.uid());
-- Patient display names for assigned consultations are returned only by a scoped RPC
-- to avoid exposing full profile rows to an arbitrary signed-in doctor.
create function public.assigned_patient_names() returns table(id uuid,full_name text)
language sql security definer set search_path = '' as $$
 select distinct p.id,p.full_name from public.profiles p join public.appointments a on a.patient_id=p.id
 join public.doctor_profiles d on d.user_id=a.doctor_id
 where a.doctor_id=auth.uid() and d.verification_status='approved'
 and exists(select 1 from public.profiles own where own.id=auth.uid() and own.role='doctor')
$$;
revoke all on function public.assigned_patient_names() from public,anon;
grant execute on function public.assigned_patient_names() to authenticated;
create policy patient_own on public.patient_profiles for select to authenticated using (user_id=auth.uid());
create policy doctors_public_or_own on public.doctor_profiles for select to anon,authenticated using (
 (verification_status='approved' and is_accepting_appointments) or user_id=auth.uid());
create policy slots_public on public.doctor_availability for select to anon,authenticated using (
 status='open' and scheduled_start>now() and exists(select 1 from public.doctor_profiles d where d.user_id=doctor_id and d.verification_status='approved' and d.is_accepting_appointments));
create policy slots_doctor on public.doctor_availability for select to authenticated using (doctor_id=auth.uid());
create policy appointments_own on public.appointments for select to authenticated using (
 patient_id=auth.uid() or (doctor_id=auth.uid() and exists (
  select 1 from public.doctor_profiles d join public.profiles p on p.id=d.user_id
  where d.user_id=auth.uid() and p.role='doctor' and d.verification_status='approved')));
create policy history_own on public.appointment_status_history for select to authenticated using (
 exists(select 1 from public.appointments a where a.id=appointment_id and (a.patient_id=auth.uid() or
 (a.doctor_id=auth.uid() and exists(select 1 from public.doctor_profiles d join public.profiles p on p.id=d.user_id
 where d.user_id=auth.uid() and p.role='doctor' and d.verification_status='approved')))));

-- Public directory reveals only approved doctors' display name and specialty.
create function public.doctor_activity(p_since date,p_until date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_counts jsonb; v_total integer;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p join public.doctor_profiles d on d.user_id=p.id where p.id=auth.uid() and p.role='doctor' and d.verification_status='approved') then
  raise exception 'Doctor access required' using errcode='42501'; end if;
 if p_since is null or p_until is null or p_since>p_until or p_until-p_since>366 then raise exception 'Invalid date range' using errcode='22023'; end if;
 select count(*)::integer, jsonb_build_object(
 'pending',count(*) filter(where status='pending'), 'confirmed',count(*) filter(where status='confirmed'),
 'cancelled',count(*) filter(where status='cancelled'), 'completed',count(*) filter(where status='completed'),
 'no_show',count(*) filter(where status='no_show')) into v_total,v_counts
 from public.appointments where doctor_id=auth.uid() and scheduled_start>=p_since::timestamp at time zone 'UTC'
 and scheduled_start<(p_until+1)::timestamp at time zone 'UTC';
 return jsonb_build_object('counts',v_counts,'total',v_total,'cancellationRate',
 case when v_total=0 then 0 else (v_counts->>'cancelled')::numeric/v_total end,'timezone','UTC');
end; $$;
revoke all on function public.doctor_activity(date,date) from public,anon;
grant execute on function public.doctor_activity(date,date) to authenticated;

-- Aggregation is scoped by auth.uid(); no patient or doctor identifiers leave this function.
create function public.patient_activity() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_counts jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p join public.patient_profiles pp on pp.user_id=p.id
  where p.id=auth.uid() and p.role='patient') then
  raise exception 'Patient access required' using errcode='42501'; end if;
 select jsonb_build_object(
  'upcoming',count(*) filter(where status in ('pending','confirmed') and scheduled_start > now()),
  'completed',count(*) filter(where status='completed'),
  'cancelled',count(*) filter(where status='cancelled')) into v_counts
 from public.appointments where patient_id=auth.uid();
 return v_counts;
end; $$;
revoke all on function public.patient_activity() from public,anon;
grant execute on function public.patient_activity() to authenticated;

create function public.public_slots(p_doctor uuid) returns table(id uuid,scheduled_start timestamptz)
language sql security definer set search_path = '' as $$
 select s.id,s.scheduled_start from public.doctor_availability s join public.doctor_profiles d on d.user_id=s.doctor_id
 where s.doctor_id=p_doctor and s.status='open' and s.scheduled_start>now()+interval '5 minutes'
 and d.verification_status='approved' and d.is_accepting_appointments
 and not exists(select 1 from public.appointments a where a.doctor_id=s.doctor_id
 and a.status in ('pending','confirmed') and a.scheduled_start<s.scheduled_end and a.scheduled_end>s.scheduled_start)
 order by s.scheduled_start limit 100
$$;
revoke all on function public.public_slots(uuid) from public;
grant execute on function public.public_slots(uuid) to anon,authenticated;

create function public.public_doctors() returns table(id uuid,name text,specialty text,fee numeric,bio text,accepting_appointments boolean)
language sql security definer set search_path = '' as $$
 select d.user_id,p.full_name,d.specialty,d.consultation_fee,d.professional_bio,d.is_accepting_appointments
 from public.doctor_profiles d join public.profiles p on p.id=d.user_id
 where p.role='doctor' and d.verification_status='approved'
 order by p.full_name limit 100
$$;
revoke all on function public.public_doctors() from public;
grant execute on function public.public_doctors() to anon,authenticated;
