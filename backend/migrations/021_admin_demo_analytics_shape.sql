-- 021: match the doctor analytics response contract in demo mode.
begin;
create or replace function public.admin_demo_analytics(p_doctor uuid,p_since date,p_until date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare total_count bigint; completed_count bigint; cancelled_count bigint; no_show_count bigint; result jsonb;
begin
 if not public.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if;
 if p_until<p_since then raise exception 'Invalid date range' using errcode='22023'; end if;
 if not exists(select 1 from public.profiles where id=p_doctor and role='doctor' and not suspended) then raise exception 'Doctor unavailable' using errcode='P0002'; end if;
 select count(*),count(*) filter(where a.status='completed'),count(*) filter(where a.status='cancelled'),count(*) filter(where a.status='no_show')
 into total_count,completed_count,cancelled_count,no_show_count
 from public.appointments a where a.doctor_id=p_doctor and a.scheduled_start>=p_since::timestamp at time zone 'UTC' and a.scheduled_start<(p_until+1)::timestamp at time zone 'UTC';
 result:=jsonb_build_object('total',total_count,'counts',jsonb_build_object('completed',completed_count,'cancelled',cancelled_count,'no_show',no_show_count),
 'cancellationRate',case when total_count=0 then 0 else cancelled_count::numeric/total_count end);
 return result;
end $$;
revoke all on function public.admin_demo_analytics(uuid,date,date) from public,anon;
grant execute on function public.admin_demo_analytics(uuid,date,date) to authenticated;
commit;
