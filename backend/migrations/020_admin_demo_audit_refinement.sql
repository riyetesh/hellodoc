-- 020: log demo workspace entry once, not on each API request.
begin;
create or replace function public.admin_demo_doctor_profile(p_doctor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 select jsonb_build_object('id',p.id,'fullName',p.full_name,'role',p.role,'suspended',p.suspended,'email',u.email,
 'verificationStatus',coalesce(d.verification_status,'pending'),'specialty',d.specialty,'institution',d.institution,
 'isAcceptingAppointments',coalesce(d.is_accepting_appointments,false))
 into result from public.profiles p join auth.users u on u.id=p.id left join public.doctor_profiles d on d.user_id=p.id
 where p.id=p_doctor and p.role='doctor' and not p.suspended;
 if result is null then raise exception 'Doctor unavailable for demo workspace' using errcode='P0002'; end if;
 return result;
end $$;
create or replace function public.admin_demo_workspace_opened(p_doctor uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles where id=p_doctor and role='doctor' and not suspended) then
   raise exception 'Doctor unavailable for demo workspace' using errcode='P0002';
 end if;
 insert into public.admin_audit_logs(actor_id,action,target_id,metadata)
 values(auth.uid(),'demo_workspace_opened',p_doctor,jsonb_build_object('mode','admin_demo'));
 return true;
end $$;
revoke all on function public.admin_demo_workspace_opened(uuid) from public,anon;
grant execute on function public.admin_demo_workspace_opened(uuid) to authenticated;
commit;
