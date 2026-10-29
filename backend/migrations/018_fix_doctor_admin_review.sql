begin;
create or replace function public.admin_action(p_action text,p_target uuid,p_reason text,p_details jsonb default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare app public.doctor_applications; visit public.appointments;
begin
 perform public.require_admin();
 if p_reason is null or length(trim(p_reason)) not between 5 and 500 then raise exception 'Review reason required' using errcode='22023'; end if;
 if p_action in ('approve_doctor','reject_doctor','request_resubmission') then
   select * into app from public.doctor_applications where applicant_id=p_target for update;
   if not found or app.status not in ('pending','resubmission_required') then raise exception 'Reviewable doctor application required'; end if;
   if p_action='approve_doctor' then
     if coalesce(p_details->>'verification_confirmed','false')<>'true' then raise exception 'Independent verification required'; end if;
     update public.profiles set role='doctor',updated_at=now() where id=p_target and not suspended and role='doctor';
     if not found then raise exception 'Active doctor account required'; end if;
     update public.doctor_profiles
       set specialty=app.specialty,qualifications=app.qualifications,institution=app.institution,
           years_experience=app.years_experience,verification_status='approved',
           is_accepting_appointments=true,updated_at=now()
       where user_id=p_target;
     if not found then
       insert into public.doctor_profiles(user_id,specialty,qualifications,institution,years_experience,verification_status,is_accepting_appointments)
       values(p_target,app.specialty,app.qualifications,app.institution,app.years_experience,'approved',true);
     end if;
   elsif p_action='reject_doctor' then
     update public.doctor_profiles set verification_status='rejected',is_accepting_appointments=false,updated_at=now() where user_id=p_target;
   else
     update public.doctor_profiles set verification_status='resubmission_required',is_accepting_appointments=false,updated_at=now() where user_id=p_target;
   end if;
   update public.doctor_applications set status=case p_action when 'approve_doctor' then 'approved' when 'reject_doctor' then 'rejected' else 'resubmission_required' end,
     review_reason=trim(p_reason),reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now() where applicant_id=p_target;
 elsif p_action in ('suspend','reactivate') then
   update public.profiles set suspended=(p_action='suspend'),updated_at=now() where id=p_target and role<>'admin';
   if not found then raise exception 'Patient or doctor required'; end if;
   if p_action='suspend' then update public.doctor_profiles set is_accepting_appointments=false,updated_at=now() where user_id=p_target; end if;
 elsif p_action='update_doctor' then
   update public.doctor_profiles set specialty=coalesce(p_details->>'specialty',specialty),professional_bio=coalesce(p_details->>'bio',professional_bio),
     consultation_fee=coalesce((p_details->>'fee')::numeric,consultation_fee),
     is_accepting_appointments=coalesce((p_details->>'accepting')::boolean,is_accepting_appointments),updated_at=now() where user_id=p_target;
   if not found then raise exception 'Doctor required'; end if;
 elsif p_action='cancel_appointment' then
   select * into visit from public.appointments where id=p_target for update;
   if not found or visit.status not in ('pending','confirmed') or visit.scheduled_start<=now() then raise exception 'Future active appointment required'; end if;
   update public.appointments set status='cancelled',cancelled_at=now(),updated_at=now() where id=p_target;
   insert into public.appointment_status_history(appointment_id,previous_status,new_status,actor_id) values(p_target,visit.status,'cancelled',auth.uid());
 else raise exception 'Invalid administrative action'; end if;
 insert into public.admin_audit_logs(actor_id,action,target_id,metadata) values(auth.uid(),p_action,p_target,jsonb_build_object('reason',trim(p_reason)));
end $$;
revoke all on function public.admin_action(text,uuid,text,jsonb) from public,anon;
grant execute on function public.admin_action(text,uuid,text,jsonb) to authenticated;
commit;