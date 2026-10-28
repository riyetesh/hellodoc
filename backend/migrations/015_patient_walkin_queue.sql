-- 015: patient walk-in queue with a server-side waiting estimate.
--
-- A signed-in patient can ask to be seen today without a booked slot. This is a
-- queue, not an appointment: it has its own status and an *estimate*, never a
-- confirmed time, so it can be displayed beside scheduled visits without the two
-- ever being confused.
--
-- Nothing in this file is applied to a database. Review it, apply it to an
-- isolated project first, run backend/migrations/VERIFY.sql, then apply to the
-- connected project explicitly. Until then every walk-in route answers
-- QUEUE_NOT_CONFIGURED and the patient UI says so plainly.
--
-- Design notes
--  * One open entry per patient (partial unique index), so a double submit or a
--    page refresh can never put the same person in the queue twice. A client
--    idempotency key makes a retry return the existing entry.
--  * One open entry per patient *and* doctor, so a patient can queue separately
--    with two clinicians, and rejoining after leaving is allowed.
--  * The waiting estimate is computed in the database from position x average
--    service minutes. It is an estimate and is labelled as one; the queue never
--    claims a scheduled time.
--  * Every write is a SECURITY DEFINER RPC that re-checks the caller's role and
--    ownership. The table has no direct grants at all, so PostgREST cannot be
--    used to read or write it, and cross-patient reads are impossible by
--    construction rather than by a filter the browser could forget.
--  * Doctors manage the queue through their own RPCs, so the queue is part of
--    the clinician workflow instead of a patient-only panel nobody can serve.
--
-- Apply after 014. Idempotent where practical.

begin;

-- 1. The queue ---------------------------------------------------------------
create table if not exists public.walkin_queue (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  doctor_id uuid not null references public.doctor_profiles(user_id) on delete cascade,
  -- Optional reason for the visit, same limit as an appointment reason.
  reason text check (reason is null or char_length(reason) <= 500),
  -- waiting -> called -> seen, or left (the patient withdrew).
  status text not null default 'waiting'
    check (status in ('waiting', 'called', 'seen', 'left')),
  -- Server-side average service time in minutes used for the estimate.
  -- Stored per entry so the estimate recorded when joining stays reproducible.
  average_minutes integer not null default 10
    check (average_minutes between 1 and 240),
  -- Client-supplied idempotency key: a double submit or a retry returns the
  -- entry that already exists instead of creating a second one.
  registration_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one active entry per patient overall: a patient cannot sit in two
-- queues at once, and a refresh cannot duplicate them.
create unique index if not exists walkin_queue_active_patient
  on public.walkin_queue (patient_id)
  where status in ('waiting', 'called');

create unique index if not exists walkin_queue_registration_key
  on public.walkin_queue (patient_id, registration_key);

create index if not exists walkin_queue_doctor_waiting
  on public.walkin_queue (doctor_id, created_at)
  where status in ('waiting', 'called');

alter table public.walkin_queue enable row level security;
revoke all on public.walkin_queue from public, anon, authenticated;

-- 2. Joining -----------------------------------------------------------------
create or replace function public.patient_walkin_join(
  p_doctor uuid, p_key uuid, p_reason text default null, p_average_minutes integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.walkin_queue;
  v_position integer;
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

  -- Only a live, approved, booking-open clinician can be queued for.
  select d.user_id, d.specialty, d.is_accepting_appointments, p.suspended
    into v_doctor
    from public.doctor_profiles d
    join public.profiles p on p.id = d.user_id
   where d.user_id = p_doctor and d.verification_status = 'approved';
  if not found then
    raise exception 'Doctor not found' using errcode = 'P0002';
  end if;
  if v_doctor.suspended or not v_doctor.is_accepting_appointments then
    raise exception 'This doctor is not accepting walk-ins right now' using errcode = '42501';
  end if;

  -- Idempotent: the same key returns the entry it already created.
  select * into v_row from public.walkin_queue
   where patient_id = auth.uid() and registration_key = p_key;
  if found then
    return public.patient_walkin_status();
  end if;

  -- Rejoining the same doctor while already queued is not a duplicate.
  select * into v_row from public.walkin_queue
   where patient_id = auth.uid() and doctor_id = p_doctor
     and status in ('waiting', 'called');
  if found then
    return public.patient_walkin_status();
  end if;

  begin
    insert into public.walkin_queue (patient_id, doctor_id, reason, registration_key, average_minutes)
    values (auth.uid(), p_doctor, v_reason, p_key, p_average_minutes)
    returning * into v_row;
  exception when unique_violation then
    -- Someone queued this patient in the same instant: return that entry.
    select * into v_row from public.walkin_queue
     where patient_id = auth.uid() and status in ('waiting', 'called');
    if not found then raise; end if;
  end;

  return public.patient_walkin_status();
end $$;
revoke all on function public.patient_walkin_join(uuid, uuid, text, integer) from public, anon;
grant execute on function public.patient_walkin_join(uuid, uuid, text, integer) to authenticated;

-- 3. Status and estimate -----------------------------------------------------
-- The estimate is position x average service time. It is deliberately an
-- estimate: no scheduled time is ever produced for a queue entry.
create or replace function public.patient_walkin_status()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.walkin_queue;
  v_position integer;
  v_minutes integer;
  v_specialty text;
begin
  perform public.require_active();

  select * into v_row from public.walkin_queue
   where patient_id = auth.uid() and status in ('waiting', 'called')
   order by created_at limit 1;
  if not found then
    return jsonb_build_object('inQueue', false);
  end if;

  select d.specialty into v_specialty
    from public.doctor_profiles d where d.user_id = v_row.doctor_id;

  select count(*) into v_position
    from public.walkin_queue
   where doctor_id = v_row.doctor_id
     and status in ('waiting', 'called')
     and created_at < v_row.created_at;
  v_position := v_position + 1;

  v_minutes := v_position * v_row.average_minutes;

  return jsonb_build_object(
    'inQueue', true,
    'entryId', v_row.id,
    'status', v_row.status,
    'position', v_position,
    'estimatedMinutes', v_minutes,
    'averageMinutes', v_row.average_minutes,
    'reason', v_row.reason,
    'joinedAt', v_row.created_at,
    'doctorId', v_row.doctor_id,
    'specialty', v_specialty,
    'estimateNote', 'Estimated wait only. A walk-in is not a scheduled appointment and the time may change.'
  );
end $$;
revoke all on function public.patient_walkin_status() from public, anon;
grant execute on function public.patient_walkin_status() to authenticated;

-- 4. Leaving -----------------------------------------------------------------
create or replace function public.patient_walkin_leave()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.walkin_queue;
begin
  perform public.require_active();
  select * into v_row from public.walkin_queue
   where patient_id = auth.uid() and status in ('waiting', 'called')
   order by created_at limit 1;
  if not found then
    return jsonb_build_object('inQueue', false);
  end if;
  update public.walkin_queue set status = 'left', updated_at = now() where id = v_row.id;
  return jsonb_build_object('inQueue', false, 'left', true);
end $$;
revoke all on function public.patient_walkin_leave() from public, anon;
grant execute on function public.patient_walkin_leave() to authenticated;

-- 5. Clinician side ----------------------------------------------------------
-- The queue is part of the doctor's workflow: list, call forward, complete.
create or replace function public.doctor_walkin_queue()
returns table(
  entry_id uuid, patient_id uuid, patient_name text, entry_reason text,
  entry_status text, queue_position integer, estimated_minutes integer, joined_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_approved_doctor() then
    raise exception 'Approved doctor required' using errcode = '42501';
  end if;
  return query
  with waiting as (
    select w.*,
           (select count(*) from public.walkin_queue c
             where c.doctor_id = w.doctor_id and c.status in ('waiting','called')
               and c.created_at <= w.created_at)::integer as pos
      from public.walkin_queue w
     where w.doctor_id = auth.uid() and w.status in ('waiting', 'called')
  )
  select w.id, w.patient_id, p.full_name, w.reason, w.status, w.pos,
         (w.pos * w.average_minutes)::integer, w.created_at
    from waiting w
    join public.profiles p on p.id = w.patient_id
   order by w.created_at;
end $$;
revoke all on function public.doctor_walkin_queue() from public, anon;
grant execute on function public.doctor_walkin_queue() to authenticated;

create or replace function public.doctor_walkin_advance(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.walkin_queue;
begin
  if not public.is_approved_doctor() then
    raise exception 'Approved doctor required' using errcode = '42501';
  end if;
  if p_status not in ('called', 'seen', 'left') then
    raise exception 'Invalid queue status' using errcode = '22023';
  end if;
  select * into v_row from public.walkin_queue where id = p_id and doctor_id = auth.uid();
  if not found then
    raise exception 'Queue entry not found' using errcode = 'P0002';
  end if;
  if v_row.status not in ('waiting', 'called') then
    raise exception 'Queue entry already closed' using errcode = '42501';
  end if;
  update public.walkin_queue set status = p_status, updated_at = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;
revoke all on function public.doctor_walkin_advance(uuid, text) from public, anon;
grant execute on function public.doctor_walkin_advance(uuid, text) to authenticated;

commit;
