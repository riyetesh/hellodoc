-- Doctor applicants have a separate least-privilege role.
-- New applicants do not receive patient records or doctor capabilities.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['patient'::text, 'doctor_applicant'::text, 'doctor'::text, 'admin'::text]));

CREATE OR REPLACE FUNCTION public.create_patient_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_name text;
  v_role text;
  v_specialty text;
  v_license text;
  v_qualifications text;
  v_evidence text;
BEGIN
  v_name := left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), 'HelloDoc user'), 200);
  v_role := CASE WHEN new.raw_user_meta_data->>'account_type' = 'doctor_applicant' THEN 'doctor_applicant' ELSE 'patient' END;

  IF v_role = 'doctor_applicant' THEN
    v_specialty := trim(coalesce(new.raw_user_meta_data->>'specialty', ''));
    v_license := trim(coalesce(new.raw_user_meta_data->>'license_number', ''));
    v_qualifications := trim(coalesce(new.raw_user_meta_data->>'qualifications', ''));
    v_evidence := trim(coalesce(new.raw_user_meta_data->>'evidence_reference', ''));
    IF length(v_specialty) NOT BETWEEN 2 AND 120
       OR length(v_license) NOT BETWEEN 3 AND 120
       OR length(v_qualifications) NOT BETWEEN 5 AND 2000
       OR length(v_evidence) NOT BETWEEN 5 AND 1000 THEN
      RAISE EXCEPTION 'Valid doctor application details required' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.profiles(id, full_name, role)
  VALUES (new.id, v_name, v_role);

  IF v_role = 'doctor_applicant' THEN
    INSERT INTO public.doctor_applications(applicant_id, specialty, license_number, qualifications, evidence_reference)
    VALUES (new.id, v_specialty, v_license, v_qualifications, v_evidence);
  ELSE
    INSERT INTO public.patient_profiles(user_id) VALUES (new.id);
  END IF;

  RETURN new;
END
$function$;
