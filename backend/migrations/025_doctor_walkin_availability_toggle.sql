-- Let an approved doctor switch walk-in availability from the workspace.
-- The existing is_accepting_appointments flag is also checked by the public
-- walk-in queue and directory booking flow, so the UI reflects that shared state.
begin;

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
     set is_accepting_appointments = p_available,
         updated_at = now()
   where user_id = auth.uid();

  return p_available;
end;
$$;

revoke all on function public.set_own_walkin_availability(boolean) from public, anon;
grant execute on function public.set_own_walkin_availability(boolean) to authenticated;

commit;
