-- Apply after 003. 004 is a test specification, not a migration.
begin;
alter table public.profiles add column phone text check(length(phone)<=40), add column suspended boolean not null default false;
alter table public.doctor_profiles add column qualifications text not null default '';
alter table public.doctor_applications add column qualifications text not null default '', add column evidence_reference text not null default '', add column review_reason text, add column reviewed_by uuid references public.profiles(id), add column reviewed_at timestamptz;
alter table public.appointments add constraint valid_appointment_duration check(scheduled_end>scheduled_start);
create table public.admin_audit_logs (
 id bigint generated always as identity primary key, actor_id uuid references public.profiles(id),
 action text not null, target_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.admin_audit_logs enable row level security;
revoke all on public.admin_audit_logs from anon,authenticated;
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table private.admin_bootstrap (singleton boolean primary key default true check(singleton), user_id uuid not null references auth.users(id), created_at timestamptz not null default now());

create function public.is_active() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and not suspended)
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and not suspended)
$$;
revoke all on function public.is_active(),public.is_admin() from public,anon;
grant execute on function public.is_active(),public.is_admin() to authenticated;
-- Restrictive policies also block suspended users from otherwise permitted reads.
do $$ declare t text; begin
 foreach t in array array['patient_profiles','doctor_profiles','doctor_applications','doctor_availability','appointments','appointment_status_history'] loop
 execute format('create policy active_account on public.%I as restrictive for select to authenticated using (public.is_active())',t);
 end loop;
end $$;
-- Definer RPCs must check suspension too; run before their body via a wrapper.
alter function public.book_appointment(uuid,uuid,text) rename to internal_book_appointment;
alter function public.apply_as_doctor(text,text) rename to internal_apply_as_doctor;
alter function public.add_doctor_slot(timestamptz) rename to internal_add_doctor_slot;
alter function public.change_appointment_status(uuid,text) rename to internal_change_appointment_status;
alter function public.assigned_patient_names() rename to internal_assigned_patient_names;
alter function public.doctor_activity(date,date) rename to internal_doctor_activity;
alter function public.patient_activity() rename to internal_patient_activity;
revoke all on function public.internal_book_appointment(uuid,uuid,text),public.internal_apply_as_doctor(text,text),public.internal_add_doctor_slot(timestamptz),public.internal_change_appointment_status(uuid,text),public.internal_assigned_patient_names(),public.internal_doctor_activity(date,date),public.internal_patient_activity() from public,anon,authenticated;
create function public.require_active() returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.is_active() then raise exception 'Active account required' using errcode='42501'; end if;
end $$;
revoke all on function public.require_active() from public,anon,authenticated;
create function public.book_appointment(p_slot uuid,p_key uuid,p_reason text default null) returns public.appointments language plpgsql security definer set search_path='' as $$ begin
 perform public.require_active();
 -- Serialize a patient's retries so simultaneous identical keys return one booking.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 return public.internal_book_appointment(p_slot,p_key,p_reason);
end $$;
create function public.apply_as_doctor(p_specialty text,p_license_number text) returns public.doctor_applications language plpgsql security definer set search_path='' as $$ begin perform public.require_active(); return public.internal_apply_as_doctor(p_specialty,p_license_number); end $$;
create function public.add_doctor_slot(p_start timestamptz) returns public.doctor_availability language plpgsql security definer set search_path='' as $$ begin perform public.require_active(); return public.internal_add_doctor_slot(p_start); end $$;
create function public.change_appointment_status(p_id uuid,p_status text) returns public.appointments language plpgsql security definer set search_path='' as $$ begin perform public.require_active(); return public.internal_change_appointment_status(p_id,p_status); end $$;
create function public.assigned_patient_names() returns table(id uuid,full_name text) language plpgsql security definer set search_path='' as $$ begin perform public.require_active(); return query select * from public.internal_assigned_patient_names(); end $$;
create function public.doctor_activity(p_since date,p_until date) returns jsonb language plpgsql security definer set search_path='' as $$ begin perform public.require_active(); return public.internal_doctor_activity(p_since,p_until); end $$;
create function public.patient_activity() returns jsonb language plpgsql security definer set search_path='' as $$ begin perform public.require_active(); return public.internal_patient_activity(); end $$;
revoke all on function public.book_appointment(uuid,uuid,text),public.apply_as_doctor(text,text),public.add_doctor_slot(timestamptz),public.change_appointment_status(uuid,text),public.assigned_patient_names(),public.doctor_activity(date,date),public.patient_activity() from public,anon;
grant execute on function public.book_appointment(uuid,uuid,text),public.apply_as_doctor(text,text),public.add_doctor_slot(timestamptz),public.change_appointment_status(uuid,text),public.assigned_patient_names(),public.doctor_activity(date,date),public.patient_activity() to authenticated;

create function public.bootstrap_first_admin(p_user uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 perform pg_advisory_xact_lock(718264310);
 if exists(select 1 from private.admin_bootstrap where user_id=p_user) then return; end if;
 if exists(select 1 from private.admin_bootstrap) or exists(select 1 from public.profiles where role='admin') then raise exception 'Bootstrap already consumed'; end if;
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then raise exception 'Confirmed Auth account required'; end if;
 update public.profiles set role='admin',updated_at=now() where id=p_user and not suspended;
 if not found then raise exception 'Profile unavailable'; end if;
 insert into private.admin_bootstrap(user_id) values(p_user);
 insert into public.admin_audit_logs(actor_id,action,target_id) values(p_user,'bootstrap_admin',p_user);
end $$;
revoke all on function public.bootstrap_first_admin(uuid) from public,anon,authenticated;
grant execute on function public.bootstrap_first_admin(uuid) to service_role;

create function public.require_admin() returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
end $$;
revoke all on function public.require_admin() from public,anon,authenticated;
create function public.admin_list(p_kind text,p_page integer default 1,p_search text default '',p_status text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; n bigint; begin
 perform public.require_admin();
 if p_page is null or p_page<1 or p_page>10000 or p_search is null or length(p_search)>120 then raise exception 'Invalid pagination'; end if;
 if p_kind='patients' then
 select count(*) into n from public.profiles where role='patient' and full_name ilike '%'||p_search||'%';
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (select id,full_name,phone,suspended,created_at from public.profiles where role='patient' and full_name ilike '%'||p_search||'%' order by created_at desc,id limit 25 offset (p_page-1)*25) r;
 elsif p_kind='doctors' then
 select count(*) into n from public.doctor_applications a join public.profiles p on p.id=a.applicant_id where p.full_name ilike '%'||p_search||'%' and (p_status='' or a.status=p_status);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (select a.*,p.full_name,p.suspended,d.consultation_fee,d.professional_bio,d.is_accepting_appointments from public.doctor_applications a join public.profiles p on p.id=a.applicant_id left join public.doctor_profiles d on d.user_id=a.applicant_id where p.full_name ilike '%'||p_search||'%' and (p_status='' or a.status=p_status) order by a.created_at desc,a.applicant_id limit 25 offset (p_page-1)*25) r;
 elsif p_kind='appointments' then
 select count(*) into n from public.appointments a join public.profiles p on p.id=a.patient_id join public.profiles d on d.id=a.doctor_id where (p.full_name ilike '%'||p_search||'%' or d.full_name ilike '%'||p_search||'%') and (p_status='' or a.status=p_status);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (select a.id,a.scheduled_start,a.scheduled_end,a.status,p.full_name patient_name,d.full_name doctor_name from public.appointments a join public.profiles p on p.id=a.patient_id join public.profiles d on d.id=a.doctor_id where (p.full_name ilike '%'||p_search||'%' or d.full_name ilike '%'||p_search||'%') and (p_status='' or a.status=p_status) order by a.scheduled_start desc,a.id limit 25 offset (p_page-1)*25) r;
 elsif p_kind='audit' then
 select count(*) into n from public.admin_audit_logs;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from (select * from public.admin_audit_logs order by created_at desc,id desc limit 25 offset (p_page-1)*25) r;
 else raise exception 'Invalid list'; end if;
 return jsonb_build_object('items',result,'total',n,'page',p_page,'pageSize',25);
end $$;

create function public.admin_action(p_action text,p_target uuid,p_reason text,p_details jsonb default '{}') returns void language plpgsql security definer set search_path='' as $$
declare app public.doctor_applications; visit public.appointments; begin
 perform public.require_admin();
 if p_reason is null or length(trim(p_reason)) not between 5 and 500 then raise exception 'Review reason required' using errcode='22023'; end if;
 if p_action in ('approve_doctor','reject_doctor') then
 select * into app from public.doctor_applications where applicant_id=p_target for update;
 if not found or app.status<>'pending' then raise exception 'Pending application required'; end if;
 if p_action='approve_doctor' then
 if coalesce(p_details->>'verification_confirmed','false')<>'true' then raise exception 'Independent verification required'; end if;
 update public.profiles set role='doctor',updated_at=now() where id=p_target and not suspended;
 if not found then raise exception 'Active applicant required'; end if;
 insert into public.doctor_profiles(user_id,specialty,qualifications,verification_status,is_accepting_appointments) values(p_target,app.specialty,app.qualifications,'approved',true);
 end if;
 update public.doctor_applications set status=case when p_action='approve_doctor' then 'approved' else 'rejected' end,review_reason=p_reason,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where applicant_id=p_target;
 elsif p_action in ('suspend','reactivate') then
 update public.profiles set suspended=(p_action='suspend'),updated_at=now() where id=p_target and role<>'admin';
 if not found then raise exception 'Patient or doctor required'; end if;
 if p_action='suspend' then update public.doctor_profiles set is_accepting_appointments=false,updated_at=now() where user_id=p_target; end if;
 elsif p_action='update_doctor' then
 update public.doctor_profiles set specialty=coalesce(p_details->>'specialty',specialty),professional_bio=coalesce(p_details->>'bio',professional_bio),consultation_fee=coalesce((p_details->>'fee')::numeric,consultation_fee),is_accepting_appointments=coalesce((p_details->>'accepting')::boolean,is_accepting_appointments),updated_at=now() where user_id=p_target;
 if not found then raise exception 'Doctor required'; end if;
 elsif p_action='cancel_appointment' then
 select * into visit from public.appointments where id=p_target for update;
 if not found or visit.status not in ('pending','confirmed') or visit.scheduled_start<=now() then raise exception 'Future active appointment required'; end if;
 update public.appointments set status='cancelled',cancelled_at=now(),updated_at=now() where id=p_target;
 insert into public.appointment_status_history(appointment_id,previous_status,new_status,actor_id) values(p_target,visit.status,'cancelled',auth.uid());
 else raise exception 'Invalid administrative action'; end if;
 insert into public.admin_audit_logs(actor_id,action,target_id,metadata) values(auth.uid(),p_action,p_target,jsonb_build_object('reason',p_reason));
end $$;

create function public.admin_metrics(p_since date,p_until date) returns jsonb language plpgsql security definer set search_path='' as $$
declare counts jsonb; trends jsonb; utilization jsonb; total numeric; cancelled numeric; begin
 perform public.require_admin();
 if p_since is null or p_until is null or p_until<p_since or p_until-p_since>366 then raise exception 'Date range must be at most 367 days'; end if;
 select jsonb_build_object('pending',count(*) filter(where status='pending'),'confirmed',count(*) filter(where status='confirmed'),'completed',count(*) filter(where status='completed'),'cancelled',count(*) filter(where status='cancelled'),'no_show',count(*) filter(where status='no_show'),'upcoming',count(*) filter(where status in ('pending','confirmed') and scheduled_start>now())),count(*),count(*) filter(where status='cancelled') into counts,total,cancelled from public.appointments where scheduled_start>=p_since::timestamp at time zone 'UTC' and scheduled_start<(p_until+1)::timestamp at time zone 'UTC';
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into trends from (select (scheduled_start at time zone 'UTC')::date as day,count(*) bookings from public.appointments where scheduled_start>=p_since::timestamp at time zone 'UTC' and scheduled_start<(p_until+1)::timestamp at time zone 'UTC' group by 1 order by 1) r;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into utilization from (select d.user_id doctor_id,p.full_name,
 (select count(*) from public.appointments a where a.doctor_id=d.user_id and a.status in ('pending','confirmed','completed','no_show') and a.scheduled_start>=p_since::timestamp at time zone 'UTC' and a.scheduled_start<(p_until+1)::timestamp at time zone 'UTC') occupied_slots,
 (select count(*) from public.doctor_availability s where s.doctor_id=d.user_id and s.scheduled_start>=p_since::timestamp at time zone 'UTC' and s.scheduled_start<(p_until+1)::timestamp at time zone 'UTC') offered_slots
 from public.doctor_profiles d join public.profiles p on p.id=d.user_id order by d.user_id limit 100) r;
 return jsonb_build_object('patients',(select count(*) from public.profiles where role='patient'),'doctors',(select count(*) from public.profiles where role='doctor'),'awaitingVerification',(select count(*) from public.doctor_applications where status='pending'),'approvedDoctors',(select count(*) from public.doctor_profiles where verification_status='approved'),'appointments',counts,'trends',trends,'utilization',utilization,'cancellationRate',case when total=0 then 0 else cancelled/total end,'timezone','UTC');
end $$;
revoke all on function public.admin_list(text,integer,text,text),public.admin_action(text,uuid,text,jsonb),public.admin_metrics(date,date) from public,anon;
grant execute on function public.admin_list(text,integer,text,text),public.admin_action(text,uuid,text,jsonb),public.admin_metrics(date,date) to authenticated;
-- Repair pre-existing Auth profiles without ever accepting a metadata role.
insert into public.profiles(id,full_name) select id,left(coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''),'Patient'),200) from auth.users on conflict(id) do nothing;
insert into public.patient_profiles(user_id) select id from public.profiles where role='patient' on conflict do nothing;
commit;
