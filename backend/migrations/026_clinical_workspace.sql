-- Operator-run after 025. Test on an isolated database before applying.
begin;
-- Symptoms remain clinical facts even when prediction is deliberately skipped.
alter table public.assessments drop constraint if exists assessments_clinical_content;
alter table public.assessments add constraint assessments_clinical_content check (
 model_status='completed' or cardinality(patient_reported)+cardinality(clinician_added)>0
 or cardinality(observations)>0 or coalesce(length(btrim(clinical_note)),0)>0
 or coalesce(length(btrim(doctor_assessment)),0)>0 or coalesce(length(btrim(plan)),0)>0);

create table public.consultation_drafts (
 doctor_id uuid not null references public.profiles(id) on delete cascade,
 appointment_id uuid not null references public.appointments(id) on delete cascade,
 payload jsonb not null default '{}', version integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(doctor_id,appointment_id),
 check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=40000)
);
alter table public.consultation_drafts enable row level security;
revoke all on public.consultation_drafts from public,anon,authenticated;
grant select on public.consultation_drafts to authenticated;
create policy own_clinical_drafts on public.consultation_drafts for select to authenticated
 using (doctor_id=(select auth.uid()) and public.is_approved_doctor());

create function public.save_consultation_draft(p_appointment uuid,p_version integer,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_row public.consultation_drafts; begin
 if not public.is_approved_doctor() or not exists(select 1 from public.appointments where id=p_appointment and doctor_id=auth.uid() and status in ('pending','confirmed')) then
 raise exception 'Assigned active appointment required' using errcode='42501'; end if;
 if p_version is null or p_version<0 or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>40000 then raise exception 'Invalid draft' using errcode='22023'; end if;
 -- Serialize first inserts as well as updates. The lock contains no clinical text.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_appointment::text,0));
 select * into current_row from public.consultation_drafts where doctor_id=auth.uid() and appointment_id=p_appointment for update;
 if coalesce(current_row.version,0)<>p_version then raise exception 'Draft changed in another tab' using errcode='40001'; end if;
 insert into public.consultation_drafts(doctor_id,appointment_id,payload,version)
 values(auth.uid(),p_appointment,p_payload,p_version+1)
 on conflict(doctor_id,appointment_id) do update set payload=excluded.payload,version=excluded.version,updated_at=now()
 returning * into current_row;
 return jsonb_build_object('version',current_row.version,'updatedAt',current_row.updated_at);
end $$;
revoke all on function public.save_consultation_draft(uuid,integer,jsonb) from public,anon;
grant execute on function public.save_consultation_draft(uuid,integer,jsonb) to authenticated;

create function public.manage_doctor_slots(p_starts timestamptz[] default '{}',p_remove uuid default null)
returns integer language plpgsql security definer set search_path='' as $$
declare start_at timestamptz; count_added integer:=0; begin
 if not public.is_approved_doctor() then raise exception 'Approved doctor required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 if p_remove is not null then
 -- A historical booking still owns its slot. Never delete a booked slot.
 delete from public.doctor_availability s where s.id=p_remove and s.doctor_id=auth.uid() and s.status='open' and s.scheduled_start>now()
 and not exists(select 1 from public.appointments a where a.slot_id=s.id);
 if not found then raise exception 'Slot is booked or unavailable' using errcode='42501'; end if;
 end if;
 if p_starts is null or cardinality(p_starts)>200 then raise exception 'Maximum 200 slots' using errcode='22023'; end if;
 foreach start_at in array p_starts loop
 if start_at is null or start_at<=now()+interval '5 minutes' or start_at>now()+interval '180 days' then raise exception 'Invalid slot time' using errcode='22023'; end if;
 if exists(select 1 from public.appointments where doctor_id=auth.uid() and status in ('pending','confirmed') and tstzrange(scheduled_start,scheduled_end,'[)') && tstzrange(start_at,start_at+interval '30 minutes','[)')) then raise exception 'Booking conflict' using errcode='23P01'; end if;
 perform public.add_doctor_slot(start_at); count_added:=count_added+1;
 end loop;
 return count_added;
end $$;
revoke all on function public.manage_doctor_slots(timestamptz[],uuid) from public,anon;
grant execute on function public.manage_doctor_slots(timestamptz[],uuid) to authenticated;
-- A queue entry opens an authorised account-patient visit, never a duplicate clinic identity.
alter table public.walkin_queue add column appointment_id uuid references public.appointments(id);
create function public.start_queued_consultation(p_entry uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare entry public.walkin_queue; visit public.appointments; begin
 if not public.is_approved_doctor() then raise exception 'Approved doctor required' using errcode='42501'; end if;
 select * into entry from public.walkin_queue where id=p_entry and doctor_id=auth.uid() for update;
 if not found or entry.status not in ('waiting','called') then raise exception 'Queue entry unavailable' using errcode='P0002'; end if;
 if entry.appointment_id is not null then return entry.appointment_id; end if;
 insert into public.appointments(patient_id,doctor_id,slot_id,walk_in,scheduled_start,scheduled_end,reason,idempotency_key,status)
 values(entry.patient_id,auth.uid(),null,true,now(),now()+interval '30 minutes',entry.reason,entry.registration_key,'pending') returning * into visit;
 update public.walkin_queue set status='called',appointment_id=visit.id,updated_at=now() where id=p_entry;
 insert into public.appointment_status_history(appointment_id,new_status,actor_id) values(visit.id,'pending',auth.uid());
 return visit.id;
end $$;
revoke all on function public.start_queued_consultation(uuid) from public,anon;
grant execute on function public.start_queued_consultation(uuid) to authenticated;

-- Complete only after a report exists; retain status history and finish the linked queue atomically.
create function public.complete_documented_consultation(p_appointment uuid) returns void
language plpgsql security definer set search_path='' as $$
declare visit public.appointments; begin
 if not public.is_approved_doctor() then raise exception 'Approved doctor required' using errcode='42501'; end if;
 select * into visit from public.appointments where id=p_appointment and doctor_id=auth.uid() for update;
 if not found then raise exception 'Appointment unavailable' using errcode='P0002'; end if;
 if visit.status='completed' then return; end if;
 if visit.status not in ('pending','confirmed') or not exists(select 1 from public.assessments where appointment_id=visit.id and doctor_id=auth.uid()) then raise exception 'Saved assessment required' using errcode='42501'; end if;
 update public.appointments set status='completed',updated_at=now() where id=visit.id;
 insert into public.appointment_status_history(appointment_id,previous_status,new_status,actor_id) values(visit.id,visit.status,'completed',auth.uid());
 update public.walkin_queue set status='seen',updated_at=now() where appointment_id=visit.id and doctor_id=auth.uid() and status='called';
 delete from public.consultation_drafts where appointment_id=visit.id and doctor_id=auth.uid();
end $$;
revoke all on function public.complete_documented_consultation(uuid) from public,anon;
grant execute on function public.complete_documented_consultation(uuid) to authenticated;
commit;
