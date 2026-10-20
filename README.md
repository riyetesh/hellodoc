# HelloDoc — patient and doctor workflow prototype

**Supabase backend implemented; launch verification incomplete:** [Setup, first-admin bootstrap, permissions and verification report](backend/migrations/SUPABASE.md). Migrations 003, 005, 006 and 008 are recorded as applied to the connected Hellodoc project; 009 (self-service doctor accounts and resubmission) still has to be applied. `/admin` supports real metrics, paginated lists, clinician review, account suspension and audited cancellation. No first administrator has been provisioned. Database role regression and 33 Node checks pass (including the Supabase-only wiring, auth-page and role-model tests); mailbox/browser/concurrency/deployment tests remain pending. Supabase Auth/PostgreSQL is the only account backend; the legacy MySQL/mysql2 implementation has been removed, and the API fails closed without configuration. Do not enter real patient information before launch checks and security/privacy review.

HelloDoc uses static HTML/CSS/JavaScript pages (existing HelloDoc branding), an Express API backed by Supabase Auth and PostgreSQL, a separate Flask/scikit-learn symptom service, and a separate optional Vite/React chatbot. It is **not** a clinically validated product or a deployed EHR. The prediction model is experimental decision support, not a diagnosis. For urgent symptoms, seek local emergency care; this site does not monitor patients continuously.

## What works in the code

- **Patient (stage 1):** account registration/login, own appointments, doctor directory populated from approved profiles, slot booking/cancellation, own symptom submissions and published assessments, care plans and prescriptions in [My health](patient.html). No clinical records or appointment state are authoritative in browser storage.
- **Doctor (stage 2):** approved accounts can see only assigned appointments and associated submissions in the [workspace](doctor.html), confirm/reschedule/cancel visits, save draft assessments/plans/prescriptions, publish records with an audit log, create/complete follow-up tasks, inspect model output separately from their assessment, offer discrete slots and view appointment counts. Published records are immutable through the API; a correction requires a new record (not yet linked to the original).
- **Synchronization (stage 3):** both dashboards read the same Supabase PostgreSQL tables on load/refresh. Appointment writes go through scoped RPCs that commit or refuse atomically, and status history is written in the same transaction. There is no email, SMS, push, WebSocket or background reminder job. The former MySQL clinical tables (symptoms, assessments, care plans, prescriptions, notifications) were removed with the MySQL backend; those panels render empty instead of demo data.

## Local setup

1. Install Node dependencies using `npm ci --prefix backend` and `npm ci --prefix chatbot`; install Python dependencies with `python -m pip install -r requirements.txt` in a project virtual environment. The optional chatbot requires a separately configured API endpoint; **do not put private API keys in `VITE_*` variables**, which are shipped to the browser.
2. Copy [backend/.env.example](backend/.env.example) to an untracked `backend/.env`; set `SUPABASE_URL`, the public `SUPABASE_PUBLISHABLE_KEY` (never a service-role or secret key) and `APP_ORIGIN`. To use the model through Express, configure the same strong `PREDICTION_INTERNAL_TOKEN` for both services and set `FLASK_ORIGIN` to a private loopback origin. Flask must not expose its internal route to untrusted networks.
3. Apply the Supabase migrations (003, 005, 006, 008, 009) following [migration instructions](backend/migrations/README.md). No first administrator is provisioned automatically: register and confirm an account, then run `node backend/bootstrap-admin.js` with a server-only `SUPABASE_SERVICE_ROLE_KEY`. An administrator must verify clinicians before approving them; signup cannot assign `doctor` or `admin`, and fictional doctors must not be seeded.
4. Start with `node backend/server.js` (Express defaults to port 5000 and auto-starts local Flask on 5001 if available), or use `./start.sh` / `start.bat`. Open the Express origin for patient and doctor pages. The optional chatbot runs with `npm run dev --prefix chatbot` (default Vite 5173); it is not automatically embedded in the static site.

## Authentication, roles and sessions

Supabase Auth is the only identity authority. The browser never holds a Supabase key: [Scripts/login.js](Scripts/login.js) and the other pages call same-origin `/api/auth/*`, and [backend/supabase-routes.js](backend/supabase-routes.js) exchanges credentials server-side for HTTP-only `hd_access`/`hd_refresh` cookies. Refresh happens through the refresh cookie; logout revokes the Supabase session and clears both cookies.

Three roles live in `public.profiles.role`: `patient`, `doctor` and `admin`. Every page's navbar offers exactly two actions — **Login** and **Sign Up** — and both open [login.html](login.html) / [signup.html](signup.html); there are no role-specific login links or buttons elsewhere. The login page is one form with a Patient / Doctor / Admin segmented control (Patient selected by default), and the sign-up page offers only Patient and Doctor. Self-signup can never assign a role: the trigger derives it from `account_type`, and login compares the selected portal with the stored role, refuses mismatches (`WRONG_PORTAL`) and suspended accounts, then routes patients to `patient.html`, doctors to `doctor.html` and admins to `/admin` (`POST /api/admin/actions` remains the only way to grant admin).

Doctor verification is explicit and auditable. Registering as a doctor creates the Auth account with role `doctor` plus a `doctor_profiles` row and a `doctor_applications` row in status `pending`; the doctor can sign in immediately and [doctor.html](doctor.html) shows the verification status, profile and resubmission form. Clinical features stay closed: the route guard and the RPCs require `verification_status = 'approved'`, so a pending doctor gets 403 from appointments, availability, analytics and the predictor. Only an administrator can move the status (`approve_doctor`, `reject_doctor`, `request_resubmission`) through `/api/admin/actions`, which audits the reviewer, the reason and the target. A rejected or reopened application can be resubmitted by the doctor through `POST /api/doctor/application/resubmit`, which never changes role or status by itself.

Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `PREDICTION_INTERNAL_TOKEN`) are never read by browser code or exposed through `/api`; the service-role key is used only by the one-off [bootstrap-admin.js](backend/bootstrap-admin.js) script. The API additionally rejects a service-role or secret key placed in the publishable-key slot.

## API overview

- `/api/auth/signup`, `/api/auth/doctor-signup`, `/api/auth/login`, `/api/auth/current-user`, `/api/auth/profile`, `/api/auth/recover`, `/api/auth/recover/complete`, `/api/auth/logout`: Supabase Auth only, with HTTP-only access/refresh cookies. Identity, role, suspension and doctor approval are re-read from PostgreSQL on every private request; no client-supplied id or role is trusted.
- `/api/doctors`, `/api/doctors/:id/slots`: database-backed directory and free discrete slots.
- `/api/patient/overview`, `POST /api/patient/appointments`, `PATCH /api/patient/appointments/:id/cancel`: own rows only. Booking and cancellation run through security-definer RPCs that enforce role, ownership and slot rules inside PostgreSQL.
- `/api/doctor/application-status`, `POST /api/doctor/apply`, `GET /api/doctor/dashboard`, `GET /api/doctor/appointments/:id`, `PATCH /api/doctor/appointments/:id/status`, `GET|POST /api/doctor/availability`, `GET /api/doctor/analytics`, `GET /api/doctor/symptoms`, `POST /api/doctor/predict`: the guard re-checks role and `verification_status='approved'` on every request, and queries are limited to the doctor's own assignments.
- `/api/admin/overview`, `/api/admin/{patients,doctors,appointments,audit}`, `POST /api/admin/actions`: admin role only; metrics, clinician review, suspension and audited actions run through security-definer RPCs. Flask `/internal/predict` stays shared-token restricted and `/predict` browser POST is disabled; model output is never auto-published or prescribed.

## Testing and deployment status

Run `python -m pytest -q`, `node --test tests/*.test.js`, `npm run build --prefix chatbot`, and `node --check backend/server.js`. The Node suites stub Supabase, so they verify routing, guards, validation and configuration, but they do **not** demonstrate real Auth delivery, durable persistence, cross-device isolation or live RLS behavior. The serialized model was produced with scikit-learn 1.5.1 while declared/runtime dependencies use 1.6.1: a version warning remains, and no clinical accuracy has been established.

The existing [vercel.json](vercel.json) describes a multi-service deployment, but its runtime routing, static assets and Flask internal endpoint have **not** been re-verified since the MySQL removal. Do not treat it as a ready-to-deploy production configuration. The per-process login throttle is not a durable multi-instance rate limiter, and there is no durable reminder queue. Review actual bundle/dependency sizes and entry points before modifying deployment configuration; avoid publicly exposing Flask. No deployment has been performed.

## Privacy and clinical limitations

This is a prototype; **do not enter real patient information** until security, clinical, privacy and operational reviews are completed. Obtain and record meaningful consent for health data, define lawful access and retention periods, audit clinical read/write access, limit privileged DB users, test backup/restore and incident response, enforce transport security, add durable shared sessions and distributed rate limits, and verify role/ownership behavior against a real migrated database. Medical information in the current API includes free-text inputs; notifications deliberately avoid symptom details but are in-app only. File upload/document management, full break/leave/duration-aware scheduling, active reminders, clinician verification workflow, linked amendments, reliable timing/feedback analytics, medical model validation and end-to-end integration tests remain incomplete. No legal or regulatory compliance is claimed.

## Doctor onboarding and isolated demos

Patients register at `signup.html`; clinicians switch that page to **Doctor Sign
Up** and submit both basic and professional details. Supabase Auth's signup trigger
creates a `doctor` profile, a pending `doctor_profiles` row and one pending
application in a single transaction. Public metadata can select only the doctor
path, never doctor/admin authority by itself. Email confirmation remains enabled.
Keep the confirmation instructions on screen; after confirming, sign in through
the Doctor tab on `login.html`. Cookie login, refresh and logout are shared across
roles. Server-verified roles route patients to `patient.html`, doctors to
`doctor.html` (pending verification included) and admins to `/admin`.
`doctor-apply.html` and `doctor-portal.html` now redirect to the shared pages so
old bookmarks keep working without a second registration form.

Administrators independently verify credentials before approval, using the
existing audited admin workflow. The status API reads only the authenticated
doctor's application under RLS and the dashboard reports verification state before
any clinical tool is shown. Suspended accounts are denied access; missing/inconsistent
applications require retry/support, never implicit approval.

`demo.html` is public and contains fictional patient/doctor views, keyboard tab
navigation (arrows/Home/End), example fees and schedules. Actions only update the
page, explicitly save nothing, and make no API calls. Real registration links
are separate from simulated actions.

### Database reconciliation (2026-10-17)

Apply PostgreSQL migrations in order: 003, 005, 006, 008, 009. Files 004/007 are tests,
not migrations; legacy MySQL migrations 001/002 were removed with the MySQL backend. Migration 009 is required for self-service doctor accounts (role `doctor` at signup, pending verification, resubmission and the profile-update RPCs). Live history confirms 008's
effects are already applied as `20261017101108 / doctor_applicant_role`; do not
reapply it blindly. The live trigger and four-role constraint match 008.
Primary keys enforce one profile/application per Auth user. No additional schema
migration was necessary for the portal corrections. Rollback-only synthetic SQL
checks verified applicant creation, absence of patient/doctor profiles, role
escalation denial and cross-account application isolation. No records retained.

### Local development and verification

```
npm ci --prefix backend
cd backend
# Create ignored .env using .env.example placeholders:
# SUPABASE_URL=https://YOUR_PROJECT.supabase.co
# SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_KEY
# APP_ORIGIN=http://localhost:5000
# FLASK_AUTOSTART=false npm start  (run from backend/ so .env is loaded)
```

From the repository root:
```
node --test tests/app.test.js tests/supabase_routes.test.js tests/production.test.js
python -m pytest -q
node backend/build-static.js
```

There is no TypeScript/typecheck script. Current verification: 33 Node tests and
77 Python tests passed. Python reports the existing serialized model version
warning. Browser verification confirmed keyboard demo switching and schedule
toggling without any `/api/` requests. Auth API tests use stubs; SQL tests exercise
real PostgreSQL policies but not a full Auth mailbox flow. Confirmation delivery,
authenticated browser refresh/logout/revocation and two-device behavior still
need controlled-mailbox E2E testing. The in-process auth limiter is not a durable
multi-instance rate limiter; Supabase Auth's own limits also apply.

### Vercel preview deployment

Use the existing linked project and feature branch, never merge/main or promote
to production without approval. `vercel.json` defines static allowlisted output
and a separate Express `backend/production.js` entrypoint. The latest inspected
failure was schema validation of `services.web.framework: null`; omit that
optional field instead. Environment names `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` must exist for preview/production. Production requires
`APP_ORIGIN`; preview derives its trusted origin from Vercel's `VERCEL_URL` when
APP_ORIGIN is absent. Never derive it from request Host. Keep Flask disabled on
Vercel. After pushing the feature branch, inspect its preview build result and
verify HTML/CSS/JS plus auth/status API routes on the deployed origin. A local
build alone does not establish that Vercel accepts this multi-service config.
No production deployment is authorized by these instructions.

Preview verification outcome: commit `bdbce70` deployed successfully as
`dpl_8ywGHRtbikNo9gdZh8FxS3QdwRCj` (READY), at
https://hellodoc-abmtmcozc-r1-e09f.vercel.app . The second observed failure,
`MULTIPLE_FRAMEWORKS_SERVICE` (root Flask/Django detection), was fixed by the
isolated dependency-free `web` workspace. Its build generates `web/dist` using
the same static allowlist; backend builds only the Express entrypoint. Vercel
completed its build in 6 seconds with one Node function; the oversized Python
function is no longer part of this preview. No exact compressed bundle size was
reported. Deployment Protection redirects the browser to Vercel login, so
post-deployment HTML/API tests are blocked until an authorized reviewer signs in.
Protection was not disabled, and production was not deployed. Existing PR:
https://github.com/riyetesh/hellodoc/pull/3 . Its branch now includes these fixes.
The build still reports 11 dependency vulnerabilities (2 moderate, 7 high,
2 critical); dependency remediation and mailbox E2E remain launch blockers.

### Authentication/predictor architecture repair

Patient and doctor registration remain distinct endpoints and trigger paths.
Login uses one Supabase identity authority, but the UI now sends `portal` as
`patient` or `doctor`. The server checks that intent against the database role
before issuing cookies; it cannot grant a role. Applicants use doctor login and
are routed to the status portal. Approved clinicians additionally need an
approved doctor profile. Administrators retain their existing dashboard.
Legacy API callers may omit portal; all protected APIs still enforce roles.
Patient signup collects only name/email/password, not unused demographics, and
retains confirmation instructions instead of auto-dismissing them. HTTP-only
cookies, refresh, logout and RLS are retained; this is not a second auth system.

The doctor predictor now initializes independently of appointment analytics and
availability failures. Model failures distinguish missing configuration,
unreachable service and invalid symptom selections. Run local Express with
`FLASK_AUTOSTART=true` (or omit that opt-out) and installed project Python
dependencies; it generates a shared per-run internal token and starts Flask on
loopback with the debugger off. A real authenticated prediction was verified end
to end: 132 symptoms offered, `Fungal infection` for rash/itching symptoms and
`Allergy` for sneezing/chills, a model version hash, and anonymous 403 denial.

Local setup for the model: `python -m venv Algo/.venv` then
`Algo/.venv/Scripts/pip install -r Algo/requirements.txt` (POSIX:
`Algo/.venv/bin/pip`). The pickled `Algo/models/svc.pkl` was trained with
scikit-learn 1.5.1, so `requirements.txt` pins that exact version: 1.6.x loads it
with an `InconsistentVersionWarning` that explicitly warns of invalid results.
Express looks for `Algo/.venv`, `.venv` or `venv` before falling back to a system
`python`, so no PATH changes are needed.

Vercel does not run the Python model in the existing Node deployment. Its
predictor requires BOTH server-only `FLASK_ORIGIN` (a reachable private model
service) and `PREDICTION_INTERNAL_TOKEN` (matching the model service). Never put
the token in browser variables or expose unprotected Flask routes. No model
hosting was provisioned or deployed during this repair. Full authenticated
browser prediction, mailbox confirmation/refresh/revocation and deployed model
connectivity remain unverified. Do not remove approval checks to test with
fictional seeded doctors: those identities are deliberately banned from login.

### Authentication acceptance status (2026-10-20)

Implemented in this repository: one navbar with exactly **Login** and **Sign Up** on every page; `login.html` with Patient (default) / Doctor / Admin tabs; `signup.html` with Patient (default) / Doctor tabs and no public admin sign-up; server-side portal-vs-role enforcement with `WRONG_PORTAL`; Supabase-only accounts; doctors created as role `doctor` with pending verification, a status dashboard and resubmission; admin review through `/api/admin/actions` with confirmations and audit logging; password recovery with a confirmation field and visibility toggle; session-expiry redirects on patient and doctor dashboards.

Verified here (Node, stubbed Supabase): 35 checks pass — `node --test tests/app.test.js tests/auth_pages.test.js tests/supabase_routes.test.js tests/production.test.js tests/model_transport.test.js`. Two of them cover session resilience: a transient Supabase failure must not discard the refresh cookie, and five concurrent requests must share a single token refresh. Browser-checked: role tabs and defaults, dynamic doctor fields, inline validation, password toggles, navbar contents at desktop and mobile widths, signed-out redirect from `/doctor.html`.

The local workspace is configured against Supabase project `fsqtjdavnfjnwsbswqel` (public publishable key only, in the gitignored `backend/.env`), and migration `009_doctor_self_service.sql` **is applied**: new columns/constraints, the rewritten signup trigger (role `doctor` + pending profile + pending application), the three profile/resubmission RPCs with `authenticated`-only execute rights, and an `admin_action` that upserts approval and supports `request_resubmission`. Verified live against the project: `/api/health` 200 with `supabase: connected`, `/api/doctors` 200 with real rows, `/api/auth/current-user` and `/api/admin/patients` 401 when anonymous, invalid credentials 401, and a foreign `Origin` rejected with 403.

Email authentication (confirmation links, recovery delivery) is **deliberately deferred**. The project's built-in Auth mail quota is exhausted, so no confirmation or recovery message can currently be delivered; both the UI and the API surface a friendly message instead of Supabase's raw `email rate limit exceeded`. To make sign-up work without mail, confirmation is switched off on the project (`mailer_autoconfirm: true`), so sign-up returns a session immediately and sends nothing. When mail is implemented, configure custom SMTP (or raise Auth rate limits) and turn confirmation back on; the UI already handles both modes — it redirects when a session comes back and asks the visitor to confirm their email when one does not.

Verified live against the project with three throwaway accounts (two through the API, one through the browser sign-up form; all deleted afterwards and the database re-checked to confirm no residue): patient sign-up returns a session and `patient` role; submitting the real form on `/signup.html` redirects to `/patient.html` and renders the signed-in greeting; patient dashboard returns the profile and an empty appointment list; doctor sign-up creates role `doctor` with a `pending` verification status, a pending `doctor_profiles` row and a pending application, and the overview reports `pending` with the submitted details; clinical endpoints return 403 while pending; `/api/admin/*` returns 403 for both roles; doctor login through the patient portal returns `WRONG_PORTAL` 403 and doctor login through the doctor portal succeeds with `verificationStatus: pending`; resubmission while `pending` returns 409 as designed; a patient session on the doctor dashboard returns 403; logout returns 200 and the session is dead afterwards (401). Also verified live with the first administrator: approving a pending application unlocks that doctor's clinical dashboard (metrics, availability slot creation, analytics, predictor panel), a `resubmission_required` doctor sees the prefilled form and can resubmit back to `pending`, and the approved dashboard no longer exposes an internal reviewer note. The predictor was then verified live through the model service: both `/internal` routes answered with the autostart token, and the doctor dashboard listed 132 symptoms and returned a prediction in the panel. Still unverified live: password-recovery delivery and RLS isolation between two concurrently signed-in accounts.

### Doctor dashboard and sessions

The doctor dashboard used to sign doctors out at unpredictable moments. Two causes were fixed in `backend/supabase-routes.js`: the refresh cookie was deleted on *any* refresh failure, so a single Supabase blip, rate limit or 5xx ended a 30-day session; and concurrent requests (the dashboard loads several endpoints, plus the navbar's own session check) each spent the same rotating refresh token, so the losers of that race were treated as signed out. Refreshes are now shared per token and replayed from a short-lived cache, a definitive rejection still clears the session, and a transient failure returns 503 with the cookies intact. `Scripts/doctor.js` was also tightened: only a 401/403 from the dashboard's own bootstrap redirects to sign-in (a pending doctor, a paused model service or a 503 no longer bounces the page), the redundant `/auth/current-user` call before `/overview` was removed, and reviewer notes are shown only on rejected or resubmission-requested applications.

### Development administrator (local only)

A single administrator account exists on the current Supabase project so the review console is reachable during development:

| Email | Password |
| --- | --- |
| `admin@hellodoc.com` | `admin admin` |

It is a normal Supabase Auth account whose `profiles.role` was set to `admin` once by `public.bootstrap_first_admin`, which also wrote a `bootstrap_admin` row into the admin audit log. It was created by registering the address through the sign-up form (choosing the password) and then promoting it; nothing in the codebase seeds credentials.

**This is a deliberate development convenience, not a production default.** A guessed password on the account that can approve clinicians and suspend users is the highest-value target in the system. Before any real deployment: sign in, change the password through recovery (needs working SMTP), or delete the account and bootstrap a real administrator — see item 4 above. The bootstrap function is one-time and audit-logged, so it cannot be re-run to silently add a second admin.

Required manual setup:

1. `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (public key only) in the local `.env` or in Vercel project environment variables.
2. Apply migrations 003, 005, 006, 008 and 009 in order (see [migrations/README.md](migrations/README.md)).
3. Supabase Auth → URL configuration: set the site URL and add `/recover.html` to the allowed redirect URLs, or recovery emails will not return to HelloDoc.
4. Provision the first administrator with `node backend/bootstrap-admin.js` plus a server-only `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL` and `ADMIN_BOOTSTRAP_CONFIRM=provision-first-admin`. Public admin sign-up does not exist.
5. **Confirm email** is currently off on the project (`mailer_autoconfirm: true`) so sign-up can issue a session without mail. When email authentication is implemented, configure custom SMTP first and then re-enable confirmation; otherwise every sign-up and password-recovery request fails with the exhausted mail quota.
