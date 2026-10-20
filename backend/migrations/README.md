# Database migrations — HelloDoc

HelloDoc has exactly one application database: a Supabase PostgreSQL project.
There is no MySQL path, no second account store and no ORM migration runner. The
files in this directory are the source of truth for the schema, but **the local
files are not proof of what a database contains**: Supabase's migration ledger is
written by the tooling that applied a file, and this project has applied several
migrations as individual statements. Always verify objects (see
[VERIFY.sql](VERIFY.sql)) before applying anything.

Migrations are run by an operator with a privileged database connection. The web
application never runs DDL, never receives a service-role key in the browser and
must never be used to apply a migration.

## 1. File classes

| Class | Files | Rule |
| --- | --- | --- |
| **Migrations** | `003`, `005`, `006`, `008`, `009`, `010`, `011`, `012` | Apply in numeric order, exactly once per database. |
| **Test-only SQL** | `004_supabase_rls_tests.sql`, `007_security_regression.sql` | Never apply as migrations. They are rollback-only probes, and `007` inserts synthetic `auth.users` fixtures. Run only on a disposable project. |
| **Obsolete MySQL** | `001_patient_foundation.sql`, `002_doctor_workspace.sql` | Deleted with the MySQL backend. They do not exist and must never be recreated or executed in PostgreSQL. |
| **Verification** | `VERIFY.sql` | Read-only `SELECT`s. Safe on production. Run after any migration. |

`004` also expects psql variables and synthetic Auth users created through the
Auth API; it is a specification of the expected permission matrix, not a script
that can be pasted into production.

### Applied vs pending, and rollbacks

There are **no down/rollback migrations** in this repository. Recovery means
restore from backup (or Supabase PITR) plus targeted repair of the missing
objects (§7), not running a reverse script. `004` and `007` are tests, not rollback
scripts.

- **Connected dev project (`fsqtjdavnfjnwsbswqel`):** 003–012 are applied and
  verified as of 2026-10-20; nothing is pending. The ledger only records some of
  them (see §5).
- **Any new project:** every file is pending until applied in the order below.
- **Any other existing project:** a file is effectively pending wherever its
  marker in `VERIFY.sql` §8 is `false`. Treat only those files (or the individual
  missing objects) as pending; do not replay the whole sequence.

## 2. Order, purpose and supersession

Apply in this order. Several later files deliberately redefine objects created by
earlier ones — for those objects only the **last** definition is current.

1. **`003_supabase_foundation.sql`** — `profiles`, `patient_profiles`,
   `doctor_profiles`, `doctor_applications`, `doctor_availability`,
   `appointments`, `appointment_status_history`; the `btree_gist` extension in
   `extensions`; exclusion constraints; the signup trigger; booking/application/
   availability/status RPCs; directory and activity RPCs; grants, RLS policies and
   the first indexes.
   *No `begin/commit` wrapper: if it fails midway, objects created before the
   failure remain.*
2. **`005_admin_management.sql`** — `admin_audit_logs`, `private.admin_bootstrap`,
   profile `phone`/`suspended`, application review fields, `is_active()`,
   `is_admin()`, `require_active()`, `require_admin()`, `bootstrap_first_admin()`,
   admin list/metrics/action RPCs, and six restrictive `active_account` policies.
   It **renames** the 003 RPCs to `internal_*` and recreates public wrappers that
   enforce suspension. Transaction-wrapped.
3. **`006_directory_suspension.sql`** — replaces `public_doctors`,
   `public_slots` and `book_appointment` so suspended doctors disappear from the
   directory, slots and booking; adds locking during booking; adds
   `submit_doctor_application` (legacy, see §3). Transaction-wrapped.
4. **`008_doctor_applicant.sql`** — historical `doctor_applicant` role and the
   four-role constraint, plus the corresponding signup trigger. Its role model is
   superseded by 009. No transaction wrapper.
5. **`009_doctor_self_service.sql`** — doctor accounts from signup with pending
   verification: adds professional columns, migrates `doctor_applicant` to
   `doctor`, narrows the role check to **`patient` / `doctor` / `admin`**,
   replaces the signup trigger (`account_type` based) and `admin_action`
   (approval, rejection, `request_resubmission`), adds `update_own_profile`,
   `update_own_doctor_profile` and `resubmit_doctor_application`.
   Transaction-wrapped.
6. **`010_clinical_assessments.sql`** — `assessments` (frozen model output,
   separate doctor decision), `is_approved_doctor()`, `assigned_patients()`,
   `assessment_view()`, the freeze trigger and the three assessment policies.
   Transaction-wrapped.
7. **`011_assessment_revisions.sql`** — `supersedes_id` lineage, the
   one-revision-per-record unique index, `is_own_assessment()`, and **replacements**
   for the freeze trigger function, the insert policy and `assessment_view`.
   Transaction-wrapped, idempotent.
8. **`012_doctor_consultation.sql`** — `doctor_consultation(appointment)` for the
   appointment-scoped predictor. Transaction-wrapped, idempotent.

**Authoritative definitions after all eight:** the 009 version of the signup
trigger, `admin_action` and profile/resubmission RPCs; the 006 version of
`public_doctors`, `public_slots` and `book_appointment`; the 011 version of the
assessment trigger function, insert policy and view; plus `012`.

> `010` alone is **not** a valid assessment schema. Its insert policy compares
> unqualified columns (so the patient/appointment match is ineffective) and its
> view lacks revision lineage. `011` corrects both. A database that stops at 010
> is misconfigured even though every object name exists.

## 3. Object inventory

### Supabase-managed objects the schema depends on

`auth.users` (signup trigger target and email lookup in `assessment_view` /
`doctor_consultation`), `auth.uid()`, the `anon`/`authenticated`/`service_role`
roles and the `extensions` schema are provided by Supabase. These migrations
reference but do not create them. The app also relies on GoTrue password login,
refresh and recovery; those are project configuration, not database migrations.

### Tables

| Table | Created in | Later changes | Used by |
| --- | --- | --- | --- |
| `public.profiles` | 003 | `phone`, `suspended` (005); role check replaced by 008 then 009 | every API path |
| `public.patient_profiles` | 003 | — | signup trigger; patient identity |
| `public.doctor_profiles` | 003 | `qualifications` (005); `institution`, `years_experience`, 4-value status (009) | directory, doctor dashboard, admin |
| `public.doctor_applications` | 003 | qualifications/evidence/review fields (005); `institution`, `years_experience`, 4-value status (009) | signup, status, resubmission, admin review |
| `public.doctor_availability` | 003 | — | availability, directory slots, booking |
| `public.appointments` | 003 | duration check (005) | patient/doctor/admin appointments |
| `public.appointment_status_history` | 003 | — | written by status RPCs |
| `public.admin_audit_logs` | 005 | — | admin audit list |
| `private.admin_bootstrap` | 005 | — | first-admin one-time lock |
| `public.assessments` | 010 | `supersedes_id` + indexes (011) | clinical predictor, PDF report |

### RPCs called by the application or its operator script

| Function (final definition) | File | Access | Called from |
| --- | --- | --- | --- |
| `book_appointment(uuid,uuid,text)` | 006 | authenticated | `POST /api/patient/appointments` |
| `change_appointment_status(uuid,text)` | 005 | authenticated | patient cancel, doctor status |
| `add_doctor_slot(timestamptz)` | 005 | authenticated | `POST /api/doctor/availability` |
| `assigned_patient_names()` | 005 | authenticated | doctor dashboard, appointment detail |
| `doctor_activity(date,date)` | 005 | authenticated | `GET /api/doctor/analytics` |
| `patient_activity()` | 005 | authenticated | `GET /api/patient/overview` |
| `public_doctors()` | 006 | anon + authenticated | directory, `/api/health` probe |
| `public_slots(uuid)` | 006 | anon + authenticated | `GET /api/doctors/:id/slots` |
| `admin_metrics(date,date)` | 005 | authenticated (admin only inside) | `GET /api/admin/overview` |
| `admin_list(text,integer,text,text)` | 005 | authenticated (admin only inside) | `GET /api/admin/:kind` |
| `admin_action(text,uuid,text,jsonb)` | 009 | authenticated (admin only inside) | `POST /api/admin/actions` |
| `bootstrap_first_admin(uuid)` | 005 | **service_role only** | `backend/bootstrap-admin.js` |
| `update_own_profile(text,text)` | 009 | authenticated | `PATCH /api/patient/profile` |
| `update_own_doctor_profile(text,text,text,integer)` | 009 | authenticated | `PATCH /api/doctor/profile` |
| `resubmit_doctor_application(text,text,text,text,integer)` | 009 | authenticated | `POST /api/doctor/application/resubmit` |
| `is_approved_doctor(uuid)` | 010 | authenticated | policy + assessment RPCs |
| `assigned_patients()` | 010 | authenticated, approved doctor | `GET /api/doctor/patients` |
| `assessment_view(uuid)` | 011 | authenticated | assessment detail + PDF |
| `is_own_assessment(uuid,uuid)` | 011 | authenticated | assessment insert policy |
| `doctor_consultation(uuid)` | 012 | authenticated, approved doctor | `GET /api/doctor/appointments/:id/consultation` |

Legacy RPCs still present but **not used by the current API**:
`apply_as_doctor` / `internal_apply_as_doctor` and `submit_doctor_application`.
`007_security_regression.sql` still calls `submit_doctor_application`, so the
function is kept for the test; do not treat it as the application's application
path.

### Internal helpers (not granted to clients)

`internal_book_appointment`, `internal_apply_as_doctor`,
`internal_add_doctor_slot`, `internal_change_appointment_status`,
`internal_assigned_patient_names`, `internal_doctor_activity`,
`internal_patient_activity` (005), `require_active`, `require_admin` (005),
`freeze_assessment_model` (011 final), `create_patient_profile` (009 final,
trigger function on `auth.users`).

### Triggers, indexes, extension

- Triggers: `create_patient_profile_after_signup` on `auth.users` (003; function
  body replaced by 008/009) and `assessments_freeze_model` on
  `public.assessments` (010; function replaced by 011).
- Indexes: `appointments_patient_start`, `appointments_doctor_start`,
  `availability_doctor_start`, `history_appointment` (003);
  `assessments_doctor_created`, `assessments_patient_created`,
  `assessments_appointment` (010); `assessments_supersedes`,
  `assessments_single_revision` (011, partial unique).
- Extension: `btree_gist` in schema `extensions` (003), required by the
  exclusion constraints that prevent overlapping appointments and slots.
- RLS policies (17, as inspected on 2026-10-20):
  - `profiles`: `profiles_own` (select).
  - `patient_profiles`: `patient_own`, `active_account`.
  - `doctor_profiles`: `doctors_public_or_own` (anon + authenticated),
    `active_account`.
  - `doctor_applications`: `doctor_application_own`, `active_account`.
  - `doctor_availability`: `slots_public` (anon + authenticated),
    `slots_doctor`, `active_account`.
  - `appointments`: `appointments_own`, `active_account`.
  - `appointment_status_history`: `history_own`, `active_account`.
  - `assessments`: `assessments_read`, `assessments_insert`,
    `assessments_update` (no delete policy).
  - `admin_audit_logs`: no policy; reachable only through security-definer
    admin RPCs.

  The six `active_account` policies come from 005 (created in a loop); 003
  creates the ownership/public policies; 010 creates the three assessment
  policies and 011 replaces `assessments_insert`.

## 4. Clean install on an empty Supabase project

Use this only for a **new, empty** project.

1. Create the Supabase project and keep the database password/connection string
   private. Do not commit it and do not put it in browser variables.
2. Confirm the project has no application tables:
   ```sql
   select table_name from information_schema.tables where table_schema = 'public';
   ```
   It should return no HelloDoc tables. If it returns any, stop: this is not a
   clean project.
3. Apply `003_supabase_foundation.sql`. Because it has no `begin/commit`, wrap it
   in an explicit transaction when your tool allows:
   ```sql
   begin;
   -- contents of 003_supabase_foundation.sql
   commit;
   ```
4. Apply `005`, then `006`, then `008`, then `009` in that order. Keep each file
   as one transaction (005/006/009 already contain `begin`/`commit`).
5. Apply `010`, then `011`, then `012`.
6. Run [VERIFY.sql](VERIFY.sql). Every per-migration marker and privilege check
   must be `true`; see §6 for expected counts.
7. Configure Supabase Auth: set the site URL and allowed redirect URLs for the
   deployment (`/recover.html` is required for password recovery). Decide
   explicitly whether email confirmation is on; the application supports both.
8. Do **not** seed fictional doctors or patients. Create the first administrator
   with the documented bootstrap procedure (§8).
9. Start the app with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and
   `APP_ORIGIN` configured, then smoke-test in §6.5.

Never run `004` or `007` as part of a clean install.

## 5. Existing project — safe procedure

1. **Take a backup / confirm PITR** before touching a project that holds data.
2. **Inspect, don't assume.** Run `VERIFY.sql` (read-only) and record the output.
   Compare object-by-object with §3.
3. **Never rerun a whole migration file** to "make sure". The files are not all
   idempotent, and one of them actively regresses a later fix:

   | File | Effect of rerunning |
   | --- | --- |
   | 003 | Fails at the first `create table`; because it has no transaction, nothing is rolled back. |
   | 005 | Fails on existing columns; worse, it renames the current public RPCs to `internal_*` again, breaking wrappers. |
   | 006 | Replaces most functions, then fails on `create function submit_doctor_application` (already exists); its transaction rolls back. |
   | 008 | Drops and re-adds the role constraint, then replaces the trigger function. Not transaction-wrapped: a failure between the two leaves the role constraint missing. |
   | 009 | Fails at `create function update_own_profile` (no `OR REPLACE`); transaction rolls back. |
   | 010 | **Regresses 011**: recreates the old insert policy, old freeze function and old view. If it is ever rerun, immediately reapply 011 and re-verify. |
   | 011 | Idempotent (`if not exists`, `create or replace`, `drop policy if exists`). |
   | 012 | Idempotent (`create or replace` + grants). |

4. **Apply only what is missing**, one logical statement at a time, in a
   transaction, then rerun `VERIFY.sql`. Prefer `create or replace` when repairing
   a function that already exists.
5. **Do not fabricate ledger rows.** The Supabase migration history is metadata,
   not the schema. `supabase migration repair` only annotates history; using it to
   claim a migration is applied without verifying objects makes future operators
   trust a false record.

### Current known variance on the connected dev project

Verified read-only on 2026-10-20 against `fsqtjdavnfjnwsbswqel`:

- Objects match the file set **through 012** (9 public tables, 35 public
  functions, 17 policies, 2 triggers, 23 columns on `assessments`, revision index
  present).
- The migration ledger records only `003`, `005`, `006`, `doctor_applicant_role`
  (008 under a non-standard name) and two `010` entries. **`009`, `011` and `012`
  are absent from the ledger even though their objects exist**, because they were
  applied as individual statements.
- One administrator exists and `private.admin_bootstrap` is consumed; earlier
  notes claiming "no administrator provisioned" are historical.
- `public.assessments` carries Supabase default table grants for `anon`
  (`arwdDxtm`). RLS has no anon policy, so an anonymous REST read returns `200 []`
  and writes are refused; nevertheless this is wider than other tables and should
  be hardened by revoking anon privileges in a future migration. Do not disable
  RLS to "fix" it.

## 6. Verification checklist

### 6.1 Automated script

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f backend/migrations/VERIFY.sql
```

`SUPABASE_DB_URL` belongs in a private shell or CI secret, never in
`backend/.env`, a browser variable or a committed file. The script is read-only,
so it is also safe to paste into the Supabase SQL editor.

### 6.2 Expected results

| Check | Expected |
| --- | --- |
| Public tables | 9: `admin_audit_logs`, `appointment_status_history`, `appointments`, `assessments`, `doctor_applications`, `doctor_availability`, `doctor_profiles`, `patient_profiles`, `profiles` |
| RLS | enabled on all 9 |
| Public functions | 35 |
| Public policies | 17 (`active_account` contributes 6) |
| Non-internal triggers | 2 |
| `assessments` columns | 23, including `supersedes_id` |
| `assessments` indexes | 6, including `assessments_single_revision` and `assessments_supersedes` |
| Role check | `patient`, `doctor`, `admin` only (009) |
| Per-migration markers | all `true` |
| Privilege checks | all `true` |

### 6.3 Per-migration markers

`VERIFY.sql` §8 checks a distinctive string from each migration's final
definition, so a missing or stale object is visible even when the ledger is
wrong:

- 005: six `active_account` policies.
- 006: `public_doctors()` contains `suspended`.
- 009: signup trigger contains `account_type`; `admin_action` contains
  `request_resubmission`; the three profile RPCs exist with the exact signatures.
- 010: `assessments` and `is_approved_doctor(uuid)` exist; `assigned_patients()`
  exists.
- 011: `supersedes_id` column; `assessments_single_revision`; insert policy
  mentions `is_own_assessment`; `assessment_view` mentions `latestRevisionId`.
- 012: `doctor_consultation(uuid)` exists.

### 6.4 RLS and authorization invariants

- RLS stays enabled on every public table; no migration disables it.
- `anon` may read only the public directory and open slots; private tables grant
  nothing (except the `assessments` ACL noted above, which RLS still filters).
- A doctor reads only their own appointments and the patients they actually
  attend; `assigned_patients`, `assigned_patient_names`, `assessment_view` and
  `doctor_consultation` re-check `auth.uid()` inside `security definer` functions.
- Patients read their own appointments and assessments. Administrators can read
  assessment rows under the policy and use the admin RPCs for the other lists;
  they have no direct write path outside `admin_action`.
- `bootstrap_first_admin` is executable only by `service_role`; admin RPCs are
  executable by `authenticated` but check the admin role internally.
- Assessment writes are insert/update only (no delete policy); the model output is
  frozen by trigger and only the doctor's assessment/plan/report metadata can
  change.

### 6.5 Application smoke test

With a running server and a configured project:

```bash
curl -s http://127.0.0.1:5000/api/health          # 200, supabase "connected"
curl -s http://127.0.0.1:5000/api/doctors         # 200, JSON array
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5000/api/admin/patients  # 401
```

Then sign in as an approved doctor and open one appointment: the consultation
context, symptom search, prediction, revision and PDF endpoints should all
succeed. Use synthetic data only. A 403 on an assessment endpoint usually means a
stale policy (010 instead of 011) or a non-approved doctor.

## 7. Recovery from a failed or partially applied migration

General rules: stop applying, snapshot the current state, identify the last
successful statement from the error output, and repair only what is missing inside
an explicit transaction. Never disable RLS, never drop a table on a database with
data, and never re-run a file whose hazards are listed in §5.

- **003 failed midway** (no transaction): inspect which tables/functions/policies
  exist. Create only the missing ones, keeping the original order because later
  objects reference earlier ones. If the project is disposable, recreate it and
  run the clean install instead.
- **005 failed midway**: check whether the `internal_*` functions exist and whether
  the public wrappers still exist. Complete the renames/wrappers manually with
  `create or replace`; do not rerun the file, which would rename the wrappers
  again.
- **006 failed midway**: earlier `create or replace` statements are already
  effective; repair the remaining function with `create or replace`.
- **008 failed midway**: re-drop/re-add the role constraint and `create or
  replace` the trigger function. Re-running is effectively the repair, but wrap it
  in a transaction.
- **009 failed midway**: columns and constraints use `if not exists`/`drop ...
  if exists` and are safe to complete; the three functions must be created with
  `create or replace` when repairing (the file uses `create function`).
- **010 followed by 011 was reapplied**: reapply 011 and rerun `VERIFY.sql` §8.
  This is the one "regression" repair you are likely to need.
- **Policies missing/duplicated**: drop the *specific* policy and recreate it from
  the current file; do not toggle RLS. A policy on `assessments` that queries
  `assessments` raises `42P17` (infinite recursion) — that is why 011 uses
  `is_own_assessment`.
- **Ledger inconsistent**: record reality in the operations log; only use
  `supabase migration repair` after object verification, and never in place of it.

## 8. Environment and first administrator

Application (server-side only): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`
(public key — a service-role/`sb_secret_` key is rejected), `APP_ORIGIN`
(production), and optionally `PORT`. Preview deployments derive the origin from
`VERCEL_URL`. Start the API from `backend/` (`npm start --prefix backend`) so
dotenv loads `backend/.env`; launching `node backend/server.js` from the
repository root skips that file and every `/api` request returns 503.

Model service: `FLASK_AUTOSTART`, `FLASK_PORT`, `FLASK_ORIGIN`,
`PREDICTION_INTERNAL_TOKEN`. The local backend can start Flask and generate a
shared token; when Flask runs separately both values must match and the service
must stay private.

First administrator (one-time, private shell only):

1. Register the intended address through HelloDoc and confirm the mailbox.
2. In a private shell set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ADMIN_EMAIL` and `ADMIN_BOOTSTRAP_CONFIRM=provision-first-admin`.
3. Run `node backend/bootstrap-admin.js` after `npm ci --prefix backend`.
4. Clear those variables afterwards. The web application never needs the
   service-role key; do not add it to `backend/.env` used by the server, Vercel
   web environment variables, or any `VITE_*` variable.
5. The RPC is one-time and audit-logged. If an administrator already exists (as on
   the connected dev project), it refuses — that is correct. Rotate or replace the
   account instead of trying to force another bootstrap.

## 9. Current verification status

| Date | Check | Result |
| --- | --- | --- |
| 2026-10-20 | Read-only catalog inspection of the connected project | 9 tables/9 RLS, 35 functions, 17 policies, 2 triggers, assessment lineage present |
| 2026-10-20 | `VERIFY.sql` per-migration markers and privilege checks | all `true` |
| 2026-10-20 | Node test suite | 68 tests: 64 passed, 4 skipped (live/optional) / 0 failed (see root README) |
| 2026-10-20 | Python test suite | 64 passed, 14 pre-existing failures in legacy form/navigation tests |
| 2026-10-20 | Ledger cross-check | ledger is incomplete (009/011/012 missing); objects verified instead |

The local `backend/.env` and Vercel environment values were not decrypted during
this inspection; environment **names** are documented, values are not verified.
Mailbox delivery, concurrent bookings and deployed runtime behavior remain
unverified. Do not treat this prototype as production-ready.
