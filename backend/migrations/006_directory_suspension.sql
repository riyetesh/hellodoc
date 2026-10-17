begin;
create or replace function public.public_doctors() returns table(id uuid,name text,specialty text,fee numeric,bio text,accepting_appointments boolean) language sql security definer set search_path='' as $$
 select d.user_id,p.full_name,d.specialty,d.consultation_fee,d.professional_bio,d.is_accepting_appointments from public.doctor_profiles d join public.profiles p on p.id=d.user_id where p.role='doctor' and not p.suspended and d.verification_status='approved' order by p.full_name limit 100
$$;
create or replace function public.public_slots(p_doctor uuid) returns table(id uuid,scheduled_start timestamptz) language sql security definer set search_path='' as $$
 select s.id,s.scheduled_start from public.doctor_availability s join public.doctor_profiles d on d.user_id=s.doctor_id join public.profiles p on p.id=d.user_id
 where s.doctor_id=p_doctor and p.role='doctor' and not p.suspended and s.status='open' and s.scheduled_start>now()+interval '5 minutes' and d.verification_status='approved' and d.is_accepting_appointments
 and not exists(select 1 from public.appointments a where a.doctor_id=s.doctor_id and a.status in ('pending','confirmed') and a.scheduled_start<s.scheduled_end and a.scheduled_end>s.scheduled_start) order by s.scheduled_start limit 100
$$;
create or replace function public.book_appointment(p_slot uuid,p_key uuid,p_reason text default null) returns public.appointments language plpgsql security definer set search_path='' as $$ begin
 perform public.require_active();
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 -- Lock the clinician account against concurrent suspension for the transaction.
 perform 1 from public.profiles p join public.doctor_availability s on s.doctor_id=p.id where s.id=p_slot and p.role='doctor' and not p.suspended for share of p;
 if not found then raise exception 'Slot unavailable'; end if;
 return public.internal_book_appointment(p_slot,p_key,p_reason);
end $$;
create function public.submit_doctor_application(p_specialty text,p_license text,p_qualifications text,p_evidence text) returns public.doctor_applications language plpgsql security definer set search_path='' as $$
declare result public.doctor_applications; begin
 perform public.require_active();
 if p_qualifications is null or length(trim(p_qualifications)) not between 5 and 2000 or p_evidence is null or length(trim(p_evidence)) not between 5 and 1000 then raise exception 'Qualifications and evidence reference required'; end if;
 result:=public.internal_apply_as_doctor(p_specialty,p_license);
 update public.doctor_applications set qualifications=trim(p_qualifications),evidence_reference=trim(p_evidence) where applicant_id=auth.uid() returning * into result;
 return result;
end $$;
revoke all on function public.submit_doctor_application(text,text,text,text) from public,anon;
grant execute on function public.submit_doctor_application(text,text,text,text) to authenticated;
commit;
