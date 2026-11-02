-- Allow doctors to close a pending appointment once its assessment has been saved.
-- The saved assessment is the evidence that the visit took place; a pending
-- appointment cannot be marked completed through this path without that row.
begin;

create or replace function public.change_appointment_status(p_id uuid, p_status text)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record public.appointments;
  v_role text;
  v_previous text;
begin
  select role into v_role from public.profiles where id = auth.uid();
  select * into v_record from public.appointments where id = p_id for update;
  if not found then
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;

  v_previous := v_record.status;

  if (
    v_role = 'patient'
    and v_record.patient_id = auth.uid()
    and p_status = 'cancelled'
    and v_record.status in ('pending', 'confirmed')
    and v_record.scheduled_start > now()
  )
  or (
    v_role = 'doctor'
    and v_record.doctor_id = auth.uid()
    and exists (
      select 1 from public.doctor_profiles
      where user_id = auth.uid() and verification_status = 'approved'
    )
    and (
      (v_record.status = 'pending' and p_status in ('confirmed', 'cancelled') and v_record.scheduled_start > now())
      or (
        v_record.status = 'pending'
        and p_status = 'completed'
        and exists (
          select 1 from public.assessments
          where appointment_id = p_id and doctor_id = auth.uid()
        )
      )
      or (v_record.status = 'confirmed' and p_status = 'cancelled' and v_record.scheduled_start > now())
      or (v_record.status = 'confirmed' and p_status in ('completed', 'no_show') and v_record.scheduled_end <= now())
    )
  ) then
    update public.appointments
    set status = p_status,
        updated_at = now(),
        cancelled_at = case when p_status = 'cancelled' then now() else null end
    where id = p_id
    returning * into v_record;

    insert into public.appointment_status_history(appointment_id, previous_status, new_status, actor_id)
    values (p_id, v_previous, p_status, auth.uid());

    return v_record;
  end if;

  raise exception 'Invalid status transition' using errcode = '42501';
end;
$$;

create or replace function public.admin_demo_change_appointment_status(
  p_id uuid,
  p_status text,
  p_doctor uuid
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.appointments;
  previous text;
begin
  if not public.is_admin() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_status not in ('confirmed', 'cancelled', 'completed', 'no_show') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_doctor and role = 'doctor' and not suspended
  ) then
    raise exception 'Doctor unavailable' using errcode = 'P0002';
  end if;

  select * into rec
  from public.appointments
  where id = p_id and doctor_id = p_doctor
  for update;
  if not found then
    raise exception 'Appointment not found' using errcode = 'P0002';
  end if;

  previous := rec.status;
  if not (
    (previous = 'pending' and p_status in ('confirmed', 'cancelled'))
    or (
      previous = 'pending'
      and p_status = 'completed'
      and exists (
        select 1 from public.assessments
        where appointment_id = p_id and doctor_id = p_doctor
      )
    )
    or (previous = 'confirmed' and p_status in ('cancelled', 'completed', 'no_show'))
  ) then
    raise exception 'Invalid status transition' using errcode = '42501';
  end if;

  update public.appointments
  set status = p_status,
      updated_at = now(),
      cancelled_at = case when p_status = 'cancelled' then now() else null end
  where id = p_id
  returning * into rec;

  insert into public.appointment_status_history(appointment_id, previous_status, new_status, actor_id)
  values (p_id, previous, p_status, auth.uid());

  insert into public.admin_audit_logs(actor_id, action, target_id, metadata)
  values (
    auth.uid(),
    'demo_appointment_status_changed',
    p_id,
    jsonb_build_object('doctor_id', p_doctor, 'from', previous, 'to', p_status, 'mode', 'admin_demo')
  );

  return rec;
end;
$$;

commit;
