# HelloDoc Supabase backend — verification record

> **Status:** this file is a dated record of what was checked and when. The
> canonical instructions are in [README.md](README.md) in this directory; the
> root [README.md](../../README.md) describes setup and the feature set. Claims
> below that predate 2026-10-20 are historical and are not re-verified unless the
> dated check says so.

## Applied database

Connected project: **Hellodoc**, `fsqtjdavnfjnwsbswqel` (eu-west-1).

**Verified read-only on 2026-10-20** against the live catalog (not against the
migration ledger, which is incomplete):

- 9 public tables, all with RLS enabled: `profiles`, `patient_profiles`,
  `doctor_profiles`, `doctor_applications`, `doctor_availability`,
  `appointments`, `appointment_status_history`, `admin_audit_logs`,
  `assessments`.
- 35 public functions — the complete set defined by migrations 003–012 (including
  the internal `internal_*` wrappers, `is_active`/`is_admin`/`require_active`/
  `require_admin`, `is_approved_doctor`, `is_own_assessment`, `assessment_view`
  and `doctor_consultation`).
- 17 public policies, including six restrictive `active_account` policies from
  005 and the three assessment policies from 010/011.
- 2 non-internal triggers: `create_patient_profile_after_signup` on `auth.users`
  and `assessments_freeze_model` on `public.assessments`.
- 23 columns on `assessments`, including `supersedes_id`, and the
  `assessments_single_revision` partial unique index.
- Role constraint is the 009 version (`patient`/`doctor`/`admin`); the 008
  four-role constraint no longer exists.

**Ledger discrepancy:** `supabase_migrations.schema_migrations` records only
`003`, `005`, `006`, an 008 entry named `doctor_applicant_role`, and two `010`
entries. There is **no ledger row for 009, 011 or 012**, although their objects
are present and were confirmed by inspecting function bodies, policies,
constraints and indexes. The ledger therefore cannot be used to decide whether a
migration is applied. Use [VERIFY.sql](VERIFY.sql).

`001` and `002` were **MySQL-only** migrations and were deleted with the MySQL
backend; never execute them in PostgreSQL. `004` is an older test specification,
not a migration. `007_security_regression.sql` is a rollback-only executable
**test**, not a migration. Apply order, clean-install steps, per-object mapping and
recovery instructions live in [README.md](README.md).

## Clinical assessments (010–012)

Applied 2026-10-20: `010_clinical_assessments.sql` (through the connected
migration API, which recorded two `010` ledger entries), then
`011_assessment_revisions.sql` and `012_doctor_consultation.sql` as individual SQL
statements. No ledger row exists for 011 or 012; objects were verified afterwards
with [VERIFY.sql](VERIFY.sql) (§6 of [README.md](README.md)).

`011` supersedes three objects created by `010` — the insert policy, the freeze
trigger function and `assessment_view` — so only the 011 definitions are current.

- `assessments` stores one row per model run: doctor, patient, optional appointment, patient-reported and doctor-added model symptoms, free-text observations, duration/note, frozen model output (condition, model version, guidance, optional confidence) and the doctor's own editable assessment and plan.
- The model verdict and the assessment identity are immutable (trigger); only `doctor_assessment`, `plan` and report metadata can change. A symptom correction is a new row with `supersedes_id`, so the earlier prediction is never overwritten. A partial unique index allows one revision per record, which also blocks duplicate submissions.
- RLS: read for the recording doctor, the patient and an active admin; insert only for an approved, unsuspended doctor with an existing appointment with that patient; update only for the recording doctor. There is no delete policy. The superseded-row check runs through `is_own_assessment` because a policy cannot query its own table directly (SQLSTATE 42P17).
- `assigned_patients()` returns only the caller's own patients with their most relevant appointment; `assessment_view()` re-checks authorization before returning a record and its lineage.
- `012_doctor_consultation.sql` adds `doctor_consultation(appointment)`: the appointment must belong to the calling approved doctor (otherwise `P0002`, reported as 404), and the response supplies the stored patient name/email, appointment time/status, the patient's stated reason and the latest assessment already recorded for that visit. The browser sends only an appointment id.
- The Flask model receives symptom identifiers only. Patient identifiers, notes, duration and observations stay in Express/Supabase; the internal token still protects `/internal/*` and public `/predict` remains closed. `/internal/assess` reports `confidenceSupported: false` because the bundled linear SVC is trained with `probability=False`; no percentage is shown or derived from symptom counts.

## Runtime and authentication

Existing static pages → same-origin Express → Supabase Auth/PostgREST. Routine API requests use only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, with verified user JWTs. Tokens are HTTP-only SameSite=Lax cookies, Secure in production. Session restoration uses getUser/refreshSession. Roles come from PostgreSQL, never editable metadata. Auth trigger always creates patient identity/profile rows. Public signup rejects role assignments. Suspension denies private API access and database operations. Profile fields cannot be directly updated by clients, including role.

Signup returns confirmation instructions unless an authenticated session exists. Whether email confirmation is enforced is a **project setting** and is not verified here: earlier notes in this repository claimed both "confirmation on" and "confirmation off (`mailer_autoconfirm: true`)". Check Auth → Providers → Email in the Supabase dashboard before relying on either. The application handles both paths. Sign in after confirming; this server-cookie app does not consume the confirmation redirect's implicit browser session. Recovery supports both the standard Supabase recovery fragment and a token_hash fragment; fragments are removed from the URL immediately, are not stored in browser storage, and are sent only to same-origin password completion. Logout attempts Supabase session revocation and clears cookies; failures are reported rather than claimed successful. Existing access JWTs may remain valid until expiry after refresh-session revocation, as with standard Supabase Auth.

Supabase Site URL now uses `https://hellodoc-r1-e09f.vercel.app`; exact root/recover URLs for production and this VM preview were allowlisted. Password minimum is eight. Auth health was ACTIVE_HEALTHY. No custom SMTP is configured; built-in email limits/restrictions remain. Email delivery, confirmation and recovery must be tested with a real controlled mailbox. Never disable confirmation to get a passing test.

Local start:
```
npm ci --prefix backend
cd backend        # dotenv loads backend/.env relative to the working directory
npm start         # Express on PORT or 5000; Flask autostarts on 5001
```
Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `APP_ORIGIN` (matching the
origin you open) privately. `FLASK_AUTOSTART=false` disables the local model.
dotenv loads `.env` from the working directory, so launch the server from `backend/` (or use `npm start --prefix backend`, which does that) to pick up `backend/.env`. Exported process variables take precedence. Never expose service keys in public variables. Production fails closed if Supabase or APP_ORIGIN are missing. The legacy MySQL implementation has been removed: Supabase is the only account backend and the API fails closed while it is unconfigured.

## First administrator

**Current dev project:** one administrator profile exists and
`private.admin_bootstrap` is consumed, so `bootstrap_first_admin` will refuse a
second bootstrap. The account's email and password are deliberately not recorded
here. This is a development convenience, not a production default: rotate or
replace the account before any real deployment. (The earlier statement that no
administrator had been provisioned was true when written and is now outdated.)

Bootstrap has no HTTP endpoint and public admin signup does not exist. For a
**fresh** project, use this one-time procedure:

1. Register the intended administrator email through HelloDoc and confirm the mailbox. This initially creates a patient account. Choose your own strong password; do not send credentials in chat.
2. On a trusted machine or private CI job, configure these **private process environment** values:
   - `SUPABASE_URL=https://<project-ref>.supabase.co` (the confirmed project URL)
   - `SUPABASE_SERVICE_ROLE_KEY` from the Supabase dashboard (server-only; never commit or paste in chat).
   - `ADMIN_EMAIL` equal to the confirmed email.
   - `ADMIN_BOOTSTRAP_CONFIRM=provision-first-admin`
3. Run `node backend/bootstrap-admin.js` from the repository root after `npm ci --prefix backend`.
4. Clear the privileged key and bootstrap variables from the shell/job. The running web application does not need them.
5. Log in through the normal HelloDoc login form. Admin login redirects to `/admin`; existing logged-in users can visit `/admin` directly.

The script looks up an existing confirmed Auth account; it never creates a password, automatically confirms a mailbox or silently promotes an unconfirmed email. A locked database singleton makes reruns for the same user idempotent, blocks a different first admin after consumption, and records an audit entry. Existing admins also block initial bootstrap. Only service_role may execute it. Do not use bootstrap as a general admin invitation system.

## Admin management

`/admin` reuses app.css typography, colors, buttons, header and panels. Its static document contains no private records; every `/api/admin/*` operation independently requires verified Auth identity plus active database admin role. Database RPCs check this again. Patients/doctors get 403; signed-out users get 401.

- Real counts: patient/doctor registrations, pending applications, approved clinicians, upcoming/status counts.
- Inclusive UTC date range up to 367 days for appointment metrics/trends; account counts are all-time.
- Cancellation rate = cancelled appointments / all appointments scheduled in the range (zero for empty range).
- Utilization = non-cancelled bookings / offered 30-minute slots scheduled in range. First 100 clinicians, explicitly labelled; not revenue or clinical outcomes.
- Name-searchable patient, application and appointment lists, 25/page; status filtering on applications/appointments.
- Application specialty, private license, qualifications, evidence reference, reason and reviewer history. Evidence is a reference, not a file upload. Administrators must independently verify the clinician. Software does not validate a medical license itself.
- Approve/reject with mandatory reason; approval requires explicit verification attestation. Approvals atomically assign doctor role and create approved clinician profile.
- Suspend/reactivate non-admin accounts; suspension disables new doctor bookings. Reactivation does not silently re-enable booking; set availability deliberately.
- Fee/accepting updates through UI; specialty/bio supported by the restricted action RPC.
- Admin cancellation only for future pending/confirmed appointments; immutable history and audit entry. No arbitrary medical-note changes.
- Audit browser shows acting administrator, action, target, time and minimal reason. Do not put medical details in reasons.

Remaining UI gaps: appointment date/UUID filters beyond status/name search, detailed appointment inspector, evidence uploads, full specialty/bio edit controls, aggregate trend zero-filling, utilization pagination beyond first 100 clinicians. Rejected applicants cannot resubmit yet.

## Role-permission matrix

| Resource / action | Anonymous | Patient | Approved doctor | Active admin |
|---|---|---|---|---|
| Public directory/eligible slots | approved only | same | same | same |
| Profile | none | own read | own read | own read; minimal patients through admin RPC |
| Patient profile | none | own read | none | no clinical fields via admin UI |
| Applications | none | own read/submit | own read | paginated review via RPC |
| Availability | eligible public slots | same | own read/add | no arbitrary raw writes |
| Appointments | none | own read/book/future cancel | assigned read/status | paginated minimal list/future cancellation |
| Admin metrics / actions / audit | none | denied | denied | restricted RPCs |
| Role updates | none | denied | denied | only defined doctor approval; first admin via private bootstrap |
| Direct application table writes | denied | denied | denied | denied |

RLS enabled on every public application table. No ordinary client writes bypass RPCs. SECURITY DEFINER functions use empty search_path and qualified relations; internal functions cannot be executed by anon/authenticated. Suspension restricts reads and wrapper RPCs. JWT roles are not trusted as application roles.

## Bookings

Appointments persist in PostgreSQL, not localStorage. Eligible approved clinicians + future open slots only. Thirty-minute UTC timestamptz slots; exclusion constraints protect both clinician and patient overlapping pending/confirmed ranges. Slot lock and account lock protect booking against competing reservations/suspension; per-patient advisory lock serializes retries. Same idempotency key returns the same booking. Patients cannot confirm; doctors can confirm/cancel assigned future appointments, complete/no-show confirmed finished appointments. No fabricated booking confirmations or notifications are emitted. Notifications/clinical tables from the old MySQL implementation are not available in Supabase; corresponding screens show no records, not imported/demo records.

## Checks actually performed

### 2026-10-20 (current)

- Read-only catalog inspection of the connected project: table/function/policy/
  trigger/constraint/index inventory above; all migration markers and privilege
  spot checks in [VERIFY.sql](VERIFY.sql) returned `true`.
- Node: 52 tests passed, 0 failed against a running local server
  (`TEST_ORIGIN`/`TEST_PUBLIC_ORIGIN` set). The suite stubs Supabase, so this does
  not prove live RLS or Auth delivery.
- Python: 64 passed, 14 failed (Node available) / 59 passed, 7 skipped, 12 failed
  (Node absent). Every failure is a pre-existing legacy form-validation or
  shared-navbar test in files unchanged on `main`.
- Browser: appointment consultation → symptom search → prediction → revision →
  PDF and one-click return were exercised against the local stack with synthetic
  data only. Reports are generated on demand and not stored.
- DB connection strings, service-role keys and Vercel environment values were not
  decrypted or tested.

### Historical checks (superseded where they conflict)

- 22 Node tests passed at the time, and a live PostgreSQL rollback regression under
  `SET LOCAL ROLE authenticated` covered role escalation, cross-patient reads,
  booking idempotency and suspension. SQL fixtures were rolled back.
- The migration ledger was treated as authoritative at the time; that assumption
  is now known to be wrong (see above).
- An earlier attempt to run pytest was blocked because it was not installed; the
  suite now runs and reports the failures listed above.

NOT VERIFIED: mailbox delivery/confirmation/recovery, live Auth signup/login
against deployed code, cross-device session behavior, concurrent booking under
real load, deployed Vercel runtime, and two-doctor/two-patient RLS isolation with
real Auth JWTs. Do not enter real patient information.

## Vercel status and remaining deployment (historical, unverified)

> The deployment facts below were recorded during earlier repairs. They are not
> re-verified for this revision; treat build IDs, URLs and environment claims as
> unconfirmed.

Existing project `hellodoc`, `prj_jFbKTPOO82ObVUAvEHvFu96ZfO7s`; no duplicate created. Latest inspected production `dpl_F2H8Z8nurmAFvwDN78rvBZvtbABp` is ERROR: root Python bundle **625.04 MB**, above 500 MB. Existing Supabase-linked URL/publishable env names target preview/production; secret values were not decrypted.

Added only production `APP_ORIGIN=https://hellodoc-r1-e09f.vercel.app` and preview/production `FLASK_AUTOSTART=false`; no unrelated env values overwritten. Preview APP_ORIGIN must match the exact preview host before testing mutations. Multiple production aliases require an explicit trusted origin configuration; currently only the canonical hostname above is supported for mutations.

Local vercel.json now proposes an allowlisted static web service plus existing Express backend. The oversized Python root/experimental ML/chatbot services are excluded from this deployment configuration, **not deleted from source**. Prediction returns unavailable unless a separately configured private model service exists. Do not imply medical model validation. This packaging change requires Vercel build verification; only local static build has run.

No new Vercel deployment was created. The integration cannot upload this workspace as a directory; it accepts inline files or a Git source. The current workspace changes are not in GitHub, and deploying main would redeploy old code. Review, commit and push the changes through your normal workflow (not performed without authorization), then deploy the existing project and inspect build/runtime logs. Verify the multi-service schema is accepted by the installed Vercel builder; production routing and 500 MB resolution remain pending, not established by local build.

Before launch: configure SMTP, complete mailbox/browser and concurrent-booking tests, provision first admin, remove obsolete preview redirect after VM retirement, remediate dependency audit, enforce distributed rate limiting, add admin MFA enforcement, review privacy/retention/audit access/backups and legal/clinical requirements. No healthcare compliance is claimed.
