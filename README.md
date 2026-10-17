# HelloDoc — patient and doctor workflow prototype

**Supabase backend implemented; launch verification incomplete:** [Setup, first-admin bootstrap, permissions and verification report](backend/migrations/SUPABASE.md). Migrations 003, 005 and 006 are applied to the connected Hellodoc project. `/admin` supports real metrics, paginated lists, clinician review, account suspension and audited cancellation. No first administrator has been provisioned. Database role regression and 22 Node checks pass; mailbox/browser/concurrency/deployment tests remain pending. With `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` configured, the API uses Supabase Auth/PostgreSQL exclusively. Production fails closed without configuration. The MySQL documentation below is retained legacy history, not the current Supabase feature/status report. Do not enter real patient information before launch checks and security/privacy review.

HelloDoc uses static HTML/CSS/JavaScript pages (existing HelloDoc branding), an Express/MySQL API, a separate Flask/scikit-learn symptom service, and a separate optional Vite/React chatbot. It is **not** a clinically validated product or a deployed EHR. The prediction model is experimental decision support, not a diagnosis. For urgent symptoms, seek local emergency care; this site does not monitor patients continuously.

## What works in the code

- **Patient (stage 1):** account registration/login, own appointments, doctor directory populated from approved profiles, slot booking/cancellation, own symptom submissions and published assessments, care plans and prescriptions in [My health](patient.html). No clinical records or appointment state are authoritative in browser storage.
- **Doctor (stage 2):** approved accounts can see only assigned appointments and associated submissions in the [workspace](doctor.html), confirm/reschedule/cancel visits, save draft assessments/plans/prescriptions, publish records with an audit log, create/complete follow-up tasks, inspect model output separately from their assessment, offer discrete slots and view appointment counts. Published records are immutable through the API; a correction requires a new record (not yet linked to the original).
- **Synchronization (stage 3):** both dashboards query the same MySQL tables on load/refresh. Appointment changes and publication return success only after database commit; in-app notifications are persisted in the same transaction for booking, cancellation, status change, rescheduling, symptom submission tied to a visit, care-plan/assessment/prescription publication and follow-up creation. Notifications have read/unread state; there is no email, SMS, push, WebSocket or background reminder job. Upcoming appointments appear in dashboard lists, but no automatic upcoming reminder is implemented. If a post-commit refresh fails, the client reports that separately; reload retrieves the saved record.

## Local setup

1. Install Node dependencies using `npm ci --prefix backend` and `npm ci --prefix chatbot`; install Python dependencies with `python -m pip install -r requirements.txt` in a project virtual environment. The optional chatbot requires a separately configured API endpoint; **do not put private API keys in `VITE_*` variables**, which are shipped to the browser.
2. Copy [backend/.env.example](backend/.env.example) to an untracked `backend/.env`; configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, optional `DB_SSL`, `APP_ORIGIN`, and a strong `SESSION_SECRET`. To use the model through Express, configure the same strong `PREDICTION_INTERNAL_TOKEN` for both services and set `FLASK_ORIGIN` to a private loopback origin. Flask must not expose its internal route to untrusted networks.
3. Inspect `SHOW CREATE TABLE users`, take a verified backup, and follow [migration instructions](backend/migrations/README.md) for `001_patient_foundation.sql` then `002_doctor_workspace.sql`. **Neither migration has been applied automatically.** Existing users become patients. An administrator must verify clinicians offline and assign role `doctor` and an approved doctor profile via a controlled process; signup cannot do this. Do not seed fictional doctors or patient data.
4. Start with `node backend/server.js` (Express defaults to port 5000 and auto-starts local Flask on 5001 if available), or use `./start.sh` / `start.bat`. Open the Express origin for patient and doctor pages. The optional chatbot runs with `npm run dev --prefix chatbot` (default Vite 5173); it is not automatically embedded in the static site.

## API overview

- `/api/auth/signup`, `/api/auth/login`, `/api/auth/current-user`, `/api/auth/profile`, `/api/auth/logout`: signed, HTTP-only session cookie. Identity and role are re-read from MySQL for private requests; doctors additionally require an approved profile.
- `/api/doctors`, `/api/doctors/:id/slots`: database-backed directory and free discrete slots.
- `/api/patient/overview`, `POST /api/patient/appointments`, `PATCH /api/patient/appointments/:id/cancel`, `POST /api/patient/symptoms`, `PATCH /api/patient/notifications/:id/read`: own-data only. Overview exposes only published clinical records.
- `/api/doctor/dashboard?date=&status=`, `/api/doctor/appointments/:id`, `PATCH /api/doctor/appointments/:id/status`, `PATCH /api/doctor/appointments/:id/reschedule`, `POST /api/doctor/appointments/:id/predictions`, `POST /api/doctor/appointments/:id/{assessments,care-plans,prescriptions,tasks}`, `PATCH /api/doctor/appointments/:id/{assessments,care-plans,prescriptions}/:recordId/publish`, `PATCH /api/doctor/tasks/:id/complete`, `GET|POST /api/doctor/availability`, `DELETE /api/doctor/availability/:id`, `GET /api/doctor/analytics`, `GET /api/doctor/notifications`, `PATCH /api/doctor/notifications/:id/read`: approved doctor and owned visits/records only.
- Flask `/internal/predict`: shared-token restricted; accepts exact training symptom identifiers. `/predict` browser POST is disabled. Model output is stored separately with version fingerprint and submission reference, never automatically published or prescribed.

## Testing and deployment status

Run `python -m pytest -q`, `node --test tests/patient_api.test.js tests/doctor_api.test.js`, `npm run lint --prefix chatbot`, `npm run build --prefix chatbot`, and `node --check backend/server.js`. Node workflow tests use an in-memory DB stub; they do **not** demonstrate durable persistence, isolation across devices or actual MySQL transaction behavior. The serialized model was produced with scikit-learn 1.5.1 while declared/runtime dependencies use 1.6.1: a version warning remains, and no clinical accuracy has been established.

The existing [vercel.json](vercel.json) describes a multi-service deployment, but its runtime routing, static assets, Flask internal endpoint and persistent MySQL/session compatibility have **not** been verified. Do not treat it as a ready-to-deploy production configuration. The current `express-session` MemoryStore, per-process login throttle and no durable reminder queue are unsafe for a multi-instance deployment. Review actual bundle/dependency sizes and entry points before modifying deployment configuration; avoid publicly exposing Flask. No deployment has been performed.

## Privacy and clinical limitations

This is a prototype; **do not enter real patient information** until security, clinical, privacy and operational reviews are completed. Obtain and record meaningful consent for health data, define lawful access and retention periods, audit clinical read/write access, limit privileged DB users, test backup/restore and incident response, enforce transport security, add durable shared sessions and distributed rate limits, and verify role/ownership behavior against a real migrated database. Medical information in the current API includes free-text inputs; notifications deliberately avoid symptom details but are in-app only. File upload/document management, full break/leave/duration-aware scheduling, active reminders, clinician verification workflow, linked amendments, reliable timing/feedback analytics, medical model validation and end-to-end integration tests remain incomplete. No legal or regulatory compliance is claimed.

## Doctor onboarding and isolated demos

Patients register at `signup.html`; clinicians register independently at
`doctor-apply.html` (no patient account). Supabase Auth's signup trigger atomically
creates a `doctor_applicant` profile and one pending application, not a patient
profile or an approved clinician. Public metadata can select only the
least-privilege applicant path, never doctor/admin authority. Email confirmation
remains enabled. Keep the confirmation instructions on screen; after confirming,
use the doctor sign-in link. Existing cookie-based login, refresh and logout are
shared across roles. Server-verified roles route patients to `patient.html`,
applicants to `doctor-portal.html`, approved doctors to `doctor.html`, and admins
to `/admin`. Pending/rejected applicants have no clinical permissions.

Administrators independently verify credentials before approval, using the
existing audited admin workflow. The status API reads only the authenticated
applicant's application under RLS and verifies approved doctor profiles before
workspace redirection. Suspended accounts are denied access; missing/inconsistent
applications require retry/support, never implicit approval.

`demo.html` is public and contains fictional patient/doctor views, keyboard tab
navigation (arrows/Home/End), example fees and schedules. Actions only update the
page, explicitly save nothing, and make no API calls. Real registration links
are separate from simulated actions.

### Database reconciliation (2026-10-17)

Apply PostgreSQL migrations in order: 003, 005, 006, 008. Files 001/002 are legacy
MySQL; 004/007 are tests, not migrations. Live migration history confirms 008's
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
FLASK_AUTOSTART=false npm start
```

From the repository root:
```
node --test tests/supabase_routes.test.js tests/patient_api.test.js tests/doctor_api.test.js tests/production.test.js
python -m pytest -q
node backend/build-static.js
```

There is no TypeScript/typecheck script. Current verification: 24 Node tests and
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
