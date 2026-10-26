-- HelloDoc schema verification (READ-ONLY).
--
-- Run against the Supabase project as a privileged role (SQL editor or a
-- database connection owned by the project). It contains SELECT statements
-- only: no INSERT/UPDATE/DELETE, no DDL, no RLS changes. It is safe to run on
-- production and can be pasted into the Supabase SQL editor.
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f backend/migrations/VERIFY.sql
--
-- Never put the connection string in a committed file, a browser variable or
-- application code.
--
-- Expected state (verified 2026-10-26 on the connected dev project):
--   11 public tables, RLS enabled on all of them
--   40 public functions
--   19 public policies
--   2 non-internal triggers (auth.users signup + assessments freeze)
--   24 columns on public.assessments, including supersedes_id and clinic_patient_id
--   assessments_single_revision (partial unique index) present
--
-- A mismatch is a finding, not something to "fix" by rerunning a whole
-- migration file. See README.md in this directory for the safe procedure.

-- 1. Tables and Row Level Security ------------------------------------------------
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- 2. Functions -------------------------------------------------------------------
select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       p.provolatile as volatility
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname, arguments;

-- 3. Policies --------------------------------------------------------------------
select tablename, policyname, cmd, roles::text as roles, permissive
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- 4. Triggers (public plus the auth.users signup trigger) ------------------------
select c.relname as table_name,
       t.tgname as trigger_name,
       p.proname as function_name,
       t.tgenabled as enabled          -- 'O' = enabled
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal and n.nspname in ('public', 'auth')
order by c.relname, t.tgname;

-- 5. Assessment columns ----------------------------------------------------------
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'assessments'
order by ordinal_position;

-- 6. Assessment indexes ----------------------------------------------------------
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'assessments'
order by indexname;

-- 7. Role and status constraints (009 must narrow roles to three) ----------------
select conrelid::regclass::text as table_name,
       conname,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.profiles'::regclass,
                   'public.doctor_profiles'::regclass,
                   'public.doctor_applications'::regclass)
  and contype = 'c'
order by 1, 2;

-- 8. Per-migration markers -------------------------------------------------------
-- Each row should read present = true. A false row tells you which migration's
-- final definition is missing, independently of the migration ledger.
with checks as (
  select '005 active_account restrictive policies (6 expected)' as check_name,
         (select count(*) from pg_policies
           where schemaname = 'public' and policyname = 'active_account') = 6 as present
  union all
  select '006 public directory excludes suspended doctors',
         coalesce(position('suspended' in pg_get_functiondef(to_regprocedure('public.public_doctors()'))) > 0, false)
  union all
  select '009 signup trigger uses account_type',
         coalesce(position('account_type' in pg_get_functiondef(to_regprocedure('public.create_patient_profile()'))) > 0, false)
  union all
  select '009 admin approval supports resubmission',
         coalesce(position('request_resubmission' in pg_get_functiondef(to_regprocedure('public.admin_action(text,uuid,text,jsonb)'))) > 0, false)
  union all
  select '009 self-service profile RPCs exist',
         to_regprocedure('public.update_own_profile(text,text)') is not null
         and to_regprocedure('public.update_own_doctor_profile(text,text,text,integer)') is not null
         and to_regprocedure('public.resubmit_doctor_application(text,text,text,text,integer)') is not null
  union all
  select '010 assessments table and approval helper exist',
         to_regclass('public.assessments') is not null
         and to_regprocedure('public.is_approved_doctor(uuid)') is not null
  union all
  select '010 doctor-scoped patient list exists',
         to_regprocedure('public.assigned_patients()') is not null
  union all
  select '011 supersedes lineage column exists',
         exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'assessments'
                    and column_name = 'supersedes_id')
  union all
  select '011 one-revision-per-record index exists',
         to_regclass('public.assessments_single_revision') is not null
  union all
  select '011 insert policy uses is_own_assessment (not the 010 definition)',
         coalesce((select position('is_own_assessment' in pg_get_expr(polwithcheck, polrelid)) > 0
                     from pg_policy
                    where polrelid = 'public.assessments'::regclass
                      and polname = 'assessments_insert'), false)
  union all
  select '011 assessment view exposes revision lineage',
         coalesce(position('latestRevisionId' in pg_get_functiondef(to_regprocedure('public.assessment_view(uuid)'))) > 0, false)
  union all
  select '012 consultation RPC exists',
         to_regprocedure('public.doctor_consultation(uuid)') is not null
  union all
  select '013 walk-in tables and RLS exist',
         to_regclass('public.clinic_patients') is not null
         and to_regclass('public.clinic_patient_audit') is not null
         and coalesce((select relrowsecurity from pg_class where oid = 'public.clinic_patients'::regclass), false)
         and coalesce((select relrowsecurity from pg_class where oid = 'public.clinic_patient_audit'::regclass), false)
  union all
  select '013 walk-in RPCs exist',
         to_regprocedure('public.doctor_clinic_patients()') is not null
         and to_regprocedure('public.doctor_clinic_patient_matches(text,text,date)') is not null
         and to_regprocedure('public.doctor_register_clinic_patient(text,date,text,text,uuid)') is not null
         and to_regprocedure('public.doctor_start_walkin_consultation(uuid,text)') is not null
         and to_regprocedure('public.doctor_book_clinic_appointment(uuid,uuid,text,uuid)') is not null
  union all
  select '013 patient source constraints exist',
         exists (select 1 from pg_constraint where conrelid = 'public.appointments'::regclass and conname = 'appointments_patient_source')
         and exists (select 1 from pg_constraint where conrelid = 'public.assessments'::regclass and conname = 'assessments_patient_source')
) select check_name, present from checks order by check_name;

-- 9. Privilege and RLS spot checks ----------------------------------------------
-- Expected: true for every row. has_*_privilege accepts a missing object as
-- NULL, so a missing function shows up as present = false rather than an error.
-- Note: public.assessments carries Supabase's default table grants for anon and
-- authenticated (ALL). RLS has no anon policy, so anon reads return no rows and
-- writes are refused, but reducing anon to no privileges is a pending hardening
-- item (see README.md). Row access is what these checks assert, not ACL tidiness.
select 'authenticated can read assessments' as check_name,
       has_table_privilege('authenticated', 'public.assessments', 'SELECT') as present
union all
select 'assessments has RLS enabled',
       coalesce((select relrowsecurity from pg_class where oid = 'public.assessments'::regclass), false)
union all
select 'no anon policy exists on assessments',
       not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = 'assessments'
                      and roles::text like '%anon%')
union all
select 'authenticated can execute assessment_view',
       coalesce(has_function_privilege('authenticated',
         to_regprocedure('public.assessment_view(uuid)'), 'EXECUTE'), false)
union all
select 'authenticated cannot execute bootstrap_first_admin',
       not coalesce(has_function_privilege('authenticated',
         to_regprocedure('public.bootstrap_first_admin(uuid)'), 'EXECUTE'), false)
union all
select 'service_role can execute bootstrap_first_admin',
       coalesce(has_function_privilege('service_role',
         to_regprocedure('public.bootstrap_first_admin(uuid)'), 'EXECUTE'), false);

-- 10. Table ACLs (informational) -------------------------------------------------
-- assessments is expected to show anon=arwdDxtm on the current dev project
-- because the table was created through tooling that applies Supabase default
-- privileges. That is wider than the other tables; RLS still blocks anon rows.
select c.relname, c.relacl::text as acl
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;

-- 11. Migration ledger (informational only) --------------------------------------
-- This table is written by Supabase migration tooling/API, not by these files.
-- A missing row does NOT prove the objects are missing, and a present row does
-- NOT prove the current file contents were applied (011/012 were applied with
-- individual SQL statements, so they are absent here). Always trust sections
-- 1-9 over this table.
select version, name, created_by
from supabase_migrations.schema_migrations
order by version;
