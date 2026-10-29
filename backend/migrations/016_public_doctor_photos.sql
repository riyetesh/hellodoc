-- Return public doctor profile photos to the directory API.
-- Keep the public payload limited to fields used by the public directory.
begin;

drop function if exists public.public_doctors();

create function public.public_doctors()
returns table(
  id uuid,
  name text,
  specialty text,
  fee numeric,
  bio text,
  accepting_appointments boolean,
  profile_image_url text
)
language sql
security definer
set search_path = ''
as $$
  select
    d.user_id,
    p.full_name,
    d.specialty,
    d.consultation_fee,
    d.professional_bio,
    d.is_accepting_appointments,
    d.profile_image_url
  from public.doctor_profiles d
  join public.profiles p on p.id = d.user_id
  where p.role = 'doctor'
    and d.verification_status = 'approved'
  order by p.full_name
  limit 100
$$;

revoke all on function public.public_doctors() from public;
grant execute on function public.public_doctors() to anon, authenticated;

commit;
