-- 022: return appointment context required by the doctor patient selector.
begin;
create or replace function public.admin_demo_assigned_patients(p_doctor uuid)
returns table(patient_id uuid,full_name text,email text,appointment_id uuid,appointment_start timestamptz,appointment_status text,assessment_count bigint)
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 if not exists(select 1 from public.profiles where id=p_doctor and role='doctor' and not suspended) then raise exception 'Doctor unavailable' using errcode='P0002'; end if;
 return query
 with mine as (select distinct a.patient_id as pid from public.appointments a where a.doctor_id=p_doctor and a.patient_id is not null),
 pick as (
   select m.pid,coalesce(
    (select a.id from public.appointments a where a.doctor_id=p_doctor and a.patient_id=m.pid and a.status in ('pending','confirmed') and a.scheduled_start>=now() order by a.scheduled_start limit 1),
    (select a.id from public.appointments a where a.doctor_id=p_doctor and a.patient_id=m.pid order by a.scheduled_start desc limit 1)
   ) as appt from mine m
 )
 select p.id,p.full_name,u.email::text,a.id,a.scheduled_start,a.status,
  (select count(*) from public.assessments s where s.doctor_id=p_doctor and s.patient_id=p.id)
 from pick join public.profiles p on p.id=pick.pid join auth.users u on u.id=p.id
 left join public.appointments a on a.id=pick.appt
 order by coalesce(a.scheduled_start,now()) desc,p.full_name;
end $$;
revoke all on function public.admin_demo_assigned_patients(uuid) from public,anon;
grant execute on function public.admin_demo_assigned_patients(uuid) to authenticated;
commit;