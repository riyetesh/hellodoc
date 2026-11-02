-- Let an approved doctor switch walk-in availability from the workspace.
-- Walk-in availability is separate from scheduled appointment booking.
begin;

alter table public.doctor_profiles
  add column if not exists is_accepting_walkins boolean not null default false;

create or replace function public.set_own_walkin_availability(p_available boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or not exists (
       select 1
       from public.profiles p
       join public.doctor_profiles d on d.user_id = p.id
       where p.id = auth.uid()
         and p.role = 'doctor'
         and not p.suspended
         and d.verification_status = 'approved'
     ) then
    raise exception 'Approved doctor access required' using errcode = '42501';
  end if;

  update public.doctor_profiles
     set is_accepting_walkins = p_available,
         updated_at = now()
   where user_id = auth.uid();

  return p_available;
end;
$$;

revoke all on function public.set_own_walkin_availability(boolean) from public, anon;
grant execute on function public.set_own_walkin_availability(boolean) to authenticated;

create or replace function public.patient_walkin_join(
  p_doctor uuid, p_key uuid, p_reason text default null, p_average_minutes integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $
declare
  v_row public.walkin_queue;
  v_doctor record;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.require_active();

  if p_key is null or p_average_minutes is null
     or p_average_minutes not between 1 and 240 then
    raise exception 'Invalid queue request' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Reason is too long' using errcode = '22023';
  end if;

  select d.user_id, d.specialty, d.is_accepting_walkins, p.suspended
    into v_doctor
    from public.doctor_profiles d
    join public.profiles p on p.id = d.user_id
   where d.user_id = p_doctor and d.verification_status = 'approved';
  if not found then
    raise exception 'Doctor not found' using errcode = 'P0002';
  end if;
  if v_doctor.suspended or not v_doctor.is_accepting_walkins then
    raise exception 'This doctor is not accepting walk-ins right now' using errcode = '42501';
  end if;

  select * into v_row from public.walkin_queue
   where patient_id = auth.uid() and registration_key = p_key;
  if found then return public.patient_walkin_status(); end if;

  select * into v_row from public.walkin_queue
   where patient_id = auth.uid() and doctor_id = p_doctor
     and status in ('waiting', 'called');
  if found then return public.patient_walkin_status(); end if;

  begin
    insert into public.walkin_queue (patient_id, doctor_id, reason, registration_key, average_minutes)
    values (auth.uid(), p_doctor, v_reason, p_key, p_average_minutes)
    returning * into v_row;
  exception when unique_violation then
    select * into v_row from public.walkin_queue
     where patient_id = auth.uid() and status in ('waiting', 'called');
    if not found then raise; end if;
  end;

  return public.patient_walkin_status();
end $;
revoke all on function public.patient_walkin_join(uuid, uuid, text, integer) from public, anon;
grant execute on function public.patient_walkin_join(uuid, uuid, text, integer) to authenticated;

commit;
