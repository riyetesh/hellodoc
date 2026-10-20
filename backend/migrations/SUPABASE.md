# HelloDoc Supabase backend — setup and verification

## Applied database

Connected project: **Hellodoc**, `fsqtjdavnfjnwsbswqel` (eu-west-1). Inspected before changes: no public tables, migrations or Auth accounts. No legacy import or fictional clinician directory was created.

Applied via connected migration API on 2026-10-17:
- `003_supabase_foundation.sql`: profiles, patient_profiles, doctor_profiles, doctor_applications, doctor_availability, appointments, appointment_status_history; Auth trigger, RLS, scoped RPCs and GiST conflict constraints.
- `005_admin_management.sql`: admin_audit_logs, private.admin_bootstrap, profile phone/suspension, qualification/review fields, restricted admin RPCs, repair for missing profiles and idempotent first-admin operation.
- `006_directory_suspension.sql`: suspended clinicians excluded from directory/slots/booking, clinician locking during booking and qualification/evidence application RPC.

`001` and `002` were **MySQL-only** migrations and were deleted together with the MySQL backend; never execute them in PostgreSQL. `004` is an older test specification, not a migration. `007_security_regression.sql` is a rollback-only executable **test**, not a migration. Remote migration versions are API-generated timestamps; names map to the files above. An initial 005 attempt failed on an alias and rolled back; the corrected transaction succeeded.

## Runtime and authentication

Existing static pages → same-origin Express → Supabase Auth/PostgREST. Routine API requests use only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, with verified user JWTs. Tokens are HTTP-only SameSite=Lax cookies, Secure in production. Session restoration uses getUser/refreshSession. Roles come from PostgreSQL, never editable metadata. Auth trigger always creates patient identity/profile rows. Public signup rejects role assignments. Suspension denies private API access and database operations. Profile fields cannot be directly updated by clients, including role.

Signup returns confirmation instructions unless an authenticated session exists. Email confirmation remains enabled. Sign in after confirming; this server-cookie app does not consume the confirmation redirect's implicit browser session. Recovery supports both the standard Supabase recovery fragment and a token_hash fragment; fragments are removed from the URL immediately, are not stored in browser storage, and are sent only to same-origin password completion. Logout attempts Supabase session revocation and clears cookies; failures are reported rather than claimed successful. Existing access JWTs may remain valid until expiry after refresh-session revocation, as with standard Supabase Auth.

Supabase Site URL now uses `https://hellodoc-r1-e09f.vercel.app`; exact root/recover URLs for production and this VM preview were allowlisted. Password minimum is eight. Auth health was ACTIVE_HEALTHY. No custom SMTP is configured; built-in email limits/restrictions remain. Email delivery, confirmation and recovery must be tested with a real controlled mailbox. Never disable confirmation to get a passing test.

Local start:
```
npm ci --prefix backend
# Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and APP_ORIGIN privately.
FLASK_AUTOSTART=false PORT=3000 npm start --prefix backend
```
Environment is loaded by dotenv relative to the working directory. Use exported variables, or deliberately launch from the directory containing your ignored .env. Never expose service keys in public variables. Production fails closed if Supabase or APP_ORIGIN are missing. The legacy MySQL implementation has been removed: Supabase is the only account backend and the API fails closed while it is unconfigured.

## First administrator — not yet provisioned

No administrator email or password was chosen, and no real administrator account was created. Bootstrap has no HTTP endpoint or public signup page.

1. Register the intended administrator email through HelloDoc and confirm the mailbox. This initially creates a patient account. Choose your own strong password; do not send credentials in chat.
2. On a trusted machine or private CI job, configure these **private process environment** values:
   - `SUPABASE_URL=https://fsqtjdavnfjnwsbswqel.supabase.co`
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

- 22 Node tests passed: legacy regression stubs, Supabase route stubs, admin role/validation/suspension tests, live HTTP and anonymous Data API permission checks.
- Live PostgreSQL rollback regression passed under SET LOCAL ROLE authenticated and explicit synthetic subjects: trigger metadata role ignored, own profiles only, role mutation denied, patient/doctor admin denied, public bootstrap denied, audit denied, doctor application/approval, approved count, booking persistence within transaction, idempotency, patient-confirmation denied, cross-patient reads denied, overlapping booking rejected, suspended reads/RPCs denied. SQL fixtures are not Auth API signup tests. All fixtures rolled back; zero Auth users remained.
- Static allowlisted build succeeded. JS syntax checks passed. No project TypeScript/typecheck script exists.
- Live directory returned `[]` from actual Supabase (no approved clinician seeded). Admin/private endpoints return 401 signed out; foreign-origin writes and role escalation rejected.
- Python test attempt blocked: pytest is not installed in restored environment. No Python tests claimed passed.
- Dependency install reported **11 vulnerabilities (2 moderate, 7 high, 2 critical)** in backend dependencies. Lockfile preserved; no blind dependency upgrade. Audit remediation remains required.

NOT VERIFIED: complete Auth signup/confirmation/login/refresh/recovery/logout using controlled mailbox, real bootstrap/sign-in, authenticated PostgREST JWT matrix, simultaneous competing transactions, second-device persistence, interactive browser behavior, new deployed Vercel runtime. Database sequential exclusion testing is not a concurrent-request measurement. Browser automation is unavailable; owner must perform interactive checks. Do not enter real patient information.

## Vercel status and remaining deployment

Existing project `hellodoc`, `prj_jFbKTPOO82ObVUAvEHvFu96ZfO7s`; no duplicate created. Latest inspected production `dpl_F2H8Z8nurmAFvwDN78rvBZvtbABp` is ERROR: root Python bundle **625.04 MB**, above 500 MB. Existing Supabase-linked URL/publishable env names target preview/production; secret values were not decrypted.

Added only production `APP_ORIGIN=https://hellodoc-r1-e09f.vercel.app` and preview/production `FLASK_AUTOSTART=false`; no unrelated env values overwritten. Preview APP_ORIGIN must match the exact preview host before testing mutations. Multiple production aliases require an explicit trusted origin configuration; currently only the canonical hostname above is supported for mutations.

Local vercel.json now proposes an allowlisted static web service plus existing Express backend. The oversized Python root/experimental ML/chatbot services are excluded from this deployment configuration, **not deleted from source**. Prediction returns unavailable unless a separately configured private model service exists. Do not imply medical model validation. This packaging change requires Vercel build verification; only local static build has run.

No new Vercel deployment was created. The integration cannot upload this workspace as a directory; it accepts inline files or a Git source. The current workspace changes are not in GitHub, and deploying main would redeploy old code. Review, commit and push the changes through your normal workflow (not performed without authorization), then deploy the existing project and inspect build/runtime logs. Verify the multi-service schema is accepted by the installed Vercel builder; production routing and 500 MB resolution remain pending, not established by local build.

Before launch: configure SMTP, complete mailbox/browser and concurrent-booking tests, provision first admin, remove obsolete preview redirect after VM retirement, remediate dependency audit, enforce distributed rate limiting, add admin MFA enforcement, review privacy/retention/audit access/backups and legal/clinical requirements. No healthcare compliance is claimed.
