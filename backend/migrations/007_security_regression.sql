-- TEST ONLY, not a schema migration. Run via trusted SQL editor; all fixtures roll back.
-- SET ROLE authenticated makes policy probes run without postgres RLS bypass.
begin;
insert into auth.users(id,raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111','{"full_name":"Synthetic A","role":"admin"}'),
 ('22222222-2222-4222-8222-222222222222','{"full_name":"Synthetic B"}'),
 ('33333333-3333-4333-8333-333333333333','{"full_name":"Synthetic clinician"}'),
 ('44444444-4444-4444-8444-444444444444','{"full_name":"Synthetic reviewer"}');
do $$ begin if (select role from public.profiles where id='11111111-1111-4111-8111-111111111111')<>'patient' then raise exception 'Metadata role escalation'; end if; end $$;
update public.profiles set role='admin' where id='44444444-4444-4444-8444-444444444444';
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
 if (select count(*) from public.profiles)<>1 then raise exception 'Cross-profile RLS failure'; end if;
 begin update public.profiles set role='admin'; raise exception 'Role update allowed'; exception when insufficient_privilege then null; end;
 begin perform public.admin_list('patients'); raise exception 'Patient admin escalation'; exception when insufficient_privilege then null; end;
 begin perform public.bootstrap_first_admin('11111111-1111-4111-8111-111111111111'); raise exception 'Public bootstrap allowed'; exception when insufficient_privilege then null; end;
 begin perform count(*) from public.admin_audit_logs; raise exception 'Audit disclosure'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select public.submit_doctor_application('Synthetic specialty','TEST-NOT-A-LICENSE','Synthetic qualifications','TEST-ONLY verification reference');
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
select public.admin_action('approve_doctor','33333333-3333-4333-8333-333333333333','Synthetic test only','{"verification_confirmed":true}');
do $$ begin if (public.admin_metrics(current_date,current_date)->>'approvedDoctors')::int<>1 then raise exception 'Incorrect admin metrics'; end if; end $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$ begin
 begin perform public.admin_list('patients'); raise exception 'Doctor admin escalation'; exception when insufficient_privilege then null; end;
end $$;
select public.add_doctor_slot(now()+interval '2 days');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.book_appointment((select id from public.doctor_availability limit 1),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select public.book_appointment((select id from public.doctor_availability limit 1),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ begin
 if (select count(*) from public.appointments)<>1 then raise exception 'Idempotency failure'; end if;
 begin perform public.change_appointment_status((select id from public.appointments limit 1),'confirmed'); raise exception 'Patient confirmation allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
do $$ begin
 if exists(select 1 from public.appointments) then raise exception 'Cross-patient appointment disclosure'; end if;
 begin perform public.book_appointment((select id from public.doctor_availability limit 1),gen_random_uuid()); raise exception 'Double booking allowed'; exception when exclusion_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
select public.admin_action('suspend','11111111-1111-4111-8111-111111111111','Synthetic suspension test');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ begin
 if exists(select 1 from public.appointments) then raise exception 'Suspended read allowed'; end if;
 begin perform public.patient_activity(); raise exception 'Suspended RPC allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'Authorization regression passed; fixtures rolled back' as result;
rollback;
