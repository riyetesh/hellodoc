begin;
create or replace function public.admin_update_user(p_target uuid,p_full_name text,p_phone text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_role text;
begin
  perform public.require_admin();
  if p_target is null or p_full_name is null or length(trim(p_full_name)) not between 1 and 200
     or (p_phone is not null and length(trim(p_phone)) > 40)
     or (p_phone is not null and trim(p_phone) <> '' and trim(p_phone) !~ '^[+() -0-9]{6,40}$') then
    raise exception 'Valid name and phone are required' using errcode='22023';
  end if;
  select role into target_role from public.profiles where id=p_target for update;
  if target_role is null or target_role='admin' then raise exception 'Patient or doctor account required' using errcode='42501'; end if;
  update public.profiles set full_name=trim(p_full_name),phone=nullif(trim(coalesce(p_phone,'')),''),updated_at=now() where id=p_target;
  update public.patient_profiles set phone=nullif(trim(coalesce(p_phone,'')),''),updated_at=now() where user_id=p_target;
  insert into public.admin_audit_logs(actor_id,action,target_id,metadata)
  values(auth.uid(),'update_user',p_target,jsonb_build_object('role',target_role,'fields',jsonb_build_array('full_name','phone')));
end $$;
revoke all on function public.admin_update_user(uuid,text,text) from public,anon;
grant execute on function public.admin_update_user(uuid,text,text) to authenticated;

create or replace function public.admin_delete_user(p_target uuid,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare target_role text;
begin
  perform public.require_admin();
  if p_target is null or p_target=auth.uid() then raise exception 'Cannot delete this account' using errcode='42501'; end if;
  if p_reason is null or length(trim(p_reason)) not between 5 and 500 then raise exception 'A reason between 5 and 500 characters is required' using errcode='22023'; end if;
  select role into target_role from public.profiles where id=p_target for update;
  if target_role is null or target_role='admin' or target_role not in ('patient','doctor') then raise exception 'Patient or doctor account required' using errcode='42501'; end if;
  insert into public.admin_audit_logs(actor_id,action,target_id,metadata)
  values(auth.uid(),'delete_user',p_target,jsonb_build_object('role',target_role,'reason',trim(p_reason)));
  delete from auth.users where id=p_target;
  if not found then raise exception 'Auth account not found'; end if;
end $$;
revoke all on function public.admin_delete_user(uuid,text) from public,anon;
grant execute on function public.admin_delete_user(uuid,text) to authenticated;
commit;