# HelloDoc — patient and doctor workflow prototype

HelloDoc is a working prototype of a two-sided clinic app: patients register and
book appointments, approved doctors manage visits and record a clinical
assessment with an experimental symptom model, and administrators verify
clinicians. It is **not** a clinically validated product, a deployed EHR, or
production-ready. Do not enter real patient information before security, privacy
and clinical review.

- **Backend:** Node/Express API ([backend/app.js](backend/app.js)), Supabase Auth
  and PostgreSQL only. There is no MySQL path or second account store.
- **Model:** a separate private Flask/scikit-learn service
  ([Algo/main.py](Algo/main.py)) reached over a shared server-only token.
- **Frontend:** static HTML/CSS/JS served by the same Express process locally.
- **Database:** Supabase project `fsqtjdavnfjnwsbswqel` (dev only). Schema objects
  match migrations through `012` as inspected read-only on 2026-10-20; the
  Supabase migration ledger is **incomplete** (see
  [migration guide](backend/migrations/README.md)).

## What works in the code

- **Patient:** registration/login/password recovery, doctor directory, booking
  and cancelling own appointments. `PATCH /api/patient/profile` updates name and
  phone, but the patient page has no profile editor yet. The patient dashboard
  shows visits and appointment metrics only; clinical results, prescriptions,
  care plans, tasks and notifications are absent from both the page and the API
  response rather than shown as empty panels.
- **Doctor:** verification status and resubmission, access to appointments
  assigned to them, confirmation/completion/no-show/cancellation of visits,
  availability slot creation, 30-day analytics, and the clinical assessment
  workflow:
  - open an appointment and load the server-verified patient and consultation
    context;
  - search the model's exact 132-symptom vocabulary with a keyboard-first
    combobox, separating patient-reported symptoms, doctor-added symptoms and
    free-text observations the model cannot interpret;
  - run the private model, then review the prediction, dataset guidance and the
    doctor's own assessment and plan on a dedicated results page;
  - edit a symptom list as an append-only revision (the original prediction is
    never overwritten), and download a PDF generated from the same stored record;
  - create assessments only from an appointment: the browser sends the
    appointment id, the server resolves the patient through
    `doctor_consultation`, rejects a mismatched patient id, and returns the
    existing record instead of duplicating an already-assessed appointment;
  - save notes with the version that was loaded, so a second tab's newer save
    produces a visible conflict instead of silently overwriting it.
- **Administrator:** real metrics, paginated patient/doctor/appointment/audit
  lists, clinician approval/rejection/resubmission requests, consultation fee and
  accepting-appointments updates, suspension/reactivation and audited
  appointment cancellation.
- **Model:** 132 binary symptom features, 41 conditions, model version hash and
  lookup guidance from the bundled datasets. The serialized linear SVC was
  trained with `probability=False`, so there is **no calibrated probability**;
  no confidence percentage is displayed and no number is derived from symptom
  counts.
- **Optional chatbot:** a separate Vite/React app in [chatbot](chatbot) that is
  not embedded in the clinical workflow.

## Implementation status

This table is the source of truth for what the interface may claim. "Verified"
means covered by a local test or a local run; it never means checked against a
live Supabase project or a deployment.

| Claimed feature | Status | Evidence or limit |
| --- | --- | --- |
| Patient signup, login, logout, password recovery | Implemented, not end to end verified | Routes and guards are unit tested with a stubbed Supabase client. Mailbox delivery, confirmation and recovery links were not exercised. |
| Doctor directory, slot listing, booking, cancellation | Implemented, not end to end verified | UI and API exist; booking tests mock the database RPCs. No disposable project was booked against. |
| Patient name and phone update | Partially implemented | `PATCH /api/patient/profile` works; the patient page has no profile editor, only a read only summary. |
| Doctor registration, verification and resubmission | Implemented, not end to end verified | Doctor UI shows pending, rejected and resubmission states; admin approval is wired. No live reviewer flow was run. |
| Doctor availability, analytics and appointment status changes | Implemented, not end to end verified | Present in the doctor workspace; covered by route tests with mocked RPCs. |
| Clinical assessment: create, revise, view, download PDF | Implemented, not end to end verified | Appointment bound creation, revision lineage, conflicts and the PDF renderer are tested. No real doctor account completed the flow. |
| Dataset guidance: precautions, medication, diet, workout | Implemented, locally verified | Sourced by lookup from bundled datasets and labelled as general guidance requiring clinician review on both the page and the PDF. This is not medical advice or a prescription. |
| Model confidence | Planned or unavailable | The shipped linear SVC was fitted with `probability=False`, so no number is shown and none is inferred. |
| Patient clinical results, prescriptions, care plans, tasks, notifications | Planned or unavailable | The patient page shows appointments and metrics only, and the API omits these fields instead of returning empty placeholder arrays. Row level security lets a patient read their own assessment row, but no API route or page exposes it yet. |
| Appointment rescheduling | Planned or unavailable | Patients cancel and book again; there is no reschedule action. |
| Doctor reviews, ratings, messaging, payments or refunds | Planned or unavailable | No UI, route, table or provider integration exists. |
| Account deletion | Planned or unavailable | No deletion route, RPC or UI exists, and the help centre now says a request is handled manually. |
| Public symptom checker | Withdrawn | Express `/predict` and Flask `/predict` return 403; the model is reachable only through the authenticated doctor assessment workflow. |
| `POST /api/doctor/predict` | Implemented helper, unused by the UI | Returns a single label and model version; the assessment workflow uses `/api/doctor/assessments`. It is not a diagnosis and no page links to it. |
| Email confirmations and recovery delivery | Depends on Supabase settings, not verified | The UI explains what to do if confirmation is enabled; delivery was not tested. |
| Vercel deployment | Configured, not production verified | See the deployment status table below. |

## Repository layout

| Path | Purpose |
| --- | --- |
| `backend/` | Express API, Supabase routes, PDF writer, model client, migrations |
| `Scripts/`, `Styles/`, `*.html` | Static pages (auth, patient, doctor, admin, assessment) |
| `Algo/` | Private Flask prediction service, datasets and serialized model |
| `tests/` | Node (`node:test`) and Python (`pytest`) checks |
| `chatbot/` | Optional React chatbot, deployed separately or not at all |
| `web/` | Static build workspace used by the Vercel config |

## Local setup

1. Install Node 22+ (`@supabase/supabase-js` 2.118 requires it) and, for the model, Python 3.12.
2. Install dependencies:
   ```bash
   npm ci --prefix backend
   npm ci --prefix chatbot        # optional
   python -m venv Algo/.venv
   Algo/.venv/Scripts/pip install -r Algo/requirements.txt   # POSIX: Algo/.venv/bin/pip
   ```
3. Create an ignored `backend/.env` from [backend/.env.example](backend/.env.example)
   and set:
   - `SUPABASE_URL` — project URL;
   - `SUPABASE_PUBLISHABLE_KEY` — the public browser key (a `sb_secret_` or
     service-role key is rejected);
   - `APP_ORIGIN` — the exact local origin, e.g. `http://localhost:5000`.
   Model values (`FLASK_AUTOSTART`, `FLASK_PORT`, `FLASK_ORIGIN`,
   `PREDICTION_INTERNAL_TOKEN`) are optional locally: the backend can start Flask
   on 5001 and generate a shared per-run token. Only set `FLASK_ORIGIN` and
   `PREDICTION_INTERNAL_TOKEN` together for an external model service, and keep
   that service private. The local autostart needs `Algo/.venv` (or `python` on
   `PATH`) with `Algo/requirements.txt` installed; without it the symptom picker
   is unavailable but clinical records can still be saved.
4. Apply the database migrations **before** using private pages:
   `003 → 005 → 006 → 008 → 009 → 010 → 011 → 012 → 013 → 014`. Follow
   [backend/migrations/README.md](backend/migrations/README.md) — it contains the
   clean-install sequence, the safe procedure for an existing project, the object
   inventory and the recovery steps. Never apply a migration through the web app,
   and never put a service-role key in browser code or a `VITE_*` variable.
5. Start the app:
   ```bash
   npm start --prefix backend    # Express on 5000, Flask autostarts on 5001
   # or ./start.sh / start.bat, which also launches the optional chatbot on 5173
   ```
   Run the server through npm (or from `backend/`) so dotenv finds
   `backend/.env`; launching `node backend/server.js` from the repository root
   skips that file and the API fails closed with 503.
   Open `http://localhost:5000`. `FLASK_AUTOSTART=false` disables the local model.
6. Provision the first administrator only when needed: register and confirm an
   address through HelloDoc, then run `node backend/bootstrap-admin.js` in a
   private shell with `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL` and
   `ADMIN_BOOTSTRAP_CONFIRM=provision-first-admin`. The RPC is one-time and
   audited; public admin signup does not exist. The dev project already has an
   administrator and its bootstrap is consumed, so the script will refuse there.

## Database and migrations

There is one database (Supabase PostgreSQL). Migrations are operator-run; the
application never performs DDL.

- **Migrations:** `003`, `005`, `006`, `008`, `009`, `010`, `011`, `012`.
  `008` is the historical `doctor_applicant` step; `009` narrows the roles to
  `patient`/`doctor`/`admin` and supersedes its trigger. `011` replaces parts of
  `010` (the assessment insert policy, freeze function and view), so an install
  that stops at `010` is incomplete.
- **Test-only SQL:** `004_supabase_rls_tests.sql` and
  `007_security_regression.sql`. Never apply them to production.
- **Obsolete MySQL:** `001`/`002` were deleted with the MySQL backend; never
  recreate them.

The migration ledger is not authoritative: the connected dev project records
`003`, `005`, `006`, an 008 entry under a different name and two `010` entries,
while `009`, `011` and `012` exist but have no ledger rows (they were applied as
individual statements). Verify objects with
[`VERIFY.sql`](backend/migrations/VERIFY.sql), which checks RLS, functions,
policies, triggers, constraints and a marker for every migration. See the
[migration guide](backend/migrations/README.md) for expected counts, the
existing-project procedure, and recovery from partial application.

## Authentication, roles and sessions

Supabase Auth is the only identity authority. Browser code never holds a Supabase
key: pages call same-origin `/api/auth/*`, and
[backend/supabase-routes.js](backend/supabase-routes.js) exchanges credentials
for HTTP-only `hd_access`/`hd_refresh` cookies.

Three roles live in `public.profiles.role`: `patient`, `doctor`, `admin`.
Registration can create a patient or a doctor (pending verification); it can never
grant `admin`. Login compares the selected portal with the database role and
refuses mismatches (`WRONG_PORTAL`) and suspended accounts. A doctor account can
sign in immediately, but clinical endpoints and RPCs require
`verification_status = 'approved'`; only an administrator can change that status,
through audited `/api/admin/actions`. Every protected request re-reads the
profile, so a suspension or role change applies on the next request rather than
when the cookie expires; suspended pages keep the reason on screen instead of
pretending it is the wrong login portal.

Server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `PREDICTION_INTERNAL_TOKEN`) are
never read by browser code or returned by `/api`.

## API overview

- **Auth:** `POST /api/auth/signup`, `/doctor-signup`, `/login`, `/recover`,
  `/recover/complete`, `/logout`; `GET /api/auth/current-user`, `/profile`.
- **Profiles:** `PATCH /api/patient/profile`, `PATCH /api/doctor/profile`,
  `POST /api/doctor/application/resubmit`, `GET /api/doctor/application-status`.
- **Directory and patient:** `GET /api/doctors`, `/doctors/:id/slots`,
  `/patient/overview`; `POST /api/patient/appointments`;
  `PATCH /api/patient/appointments/:id/cancel`.
- **Doctor:** `GET /api/doctor/overview`, `/dashboard`, `/appointments/:id`,
  `/appointments/:id/consultation`, `/availability`, `/analytics`,
  `/symptoms`, `/patients`, `/patients/:id/context`, `/assessments`, `/assessments/:id`,
  `/assessments/:id/report.pdf`; `POST /api/doctor/availability`,
  `/assessments`, `/assessments/:id/revision`, `/predict` (optional suggestion
  preview, no stored result), and the walk-in endpoints
  `GET /api/doctor/walkin/patients`, `/walkin/matches`,
  `POST /api/doctor/walkin/patients`, `/walkin/patients/:id/consultation`,
  `/walkin/patients/:id/appointment`;
  `PATCH /api/doctor/appointments/:id/status`,
  `/assessments/:id` (doctor assessment/plan only).

A walk-in email is a nullable contact detail on a clinical record. It never
creates an Auth user and is never treated as verified ownership. An assessment is
stored with `modelStatus: "completed"` after the model runs, or
`modelStatus: "unavailable"` when the doctor explicitly saves the consultation
without a prediction; the second state has no predicted disease, version,
confidence or guidance at all.
- **Admin:** `GET /api/admin/overview`, `/api/admin/:kind`;
  `POST /api/admin/actions`.

Every protected route re-checks identity, role, suspension and doctor approval
server-side. Appointment and assessment queries are scoped to the caller. The
model receives symptom identifiers only — no patient identifiers, notes or
appointment data — and Flask's internal routes require the shared token while the
public `/predict` route stays closed.

## Testing

All suites run offline by default. No Supabase project, Auth account or model
service is required: the Node API tests stub Supabase, and the Python predictor
tests load the bundled model locally.

### Setup

```bash
npm ci --prefix backend                          # Node 22+ dependencies (Express, Supabase JS)
python -m venv Algo/.venv                         # Python 3.12 for the model and pytest
Algo/.venv/Scripts/pip install -r requirements-dev.txt   # Windows
# POSIX: Algo/.venv/bin/pip install -r requirements-dev.txt
```

`scripts/python.js` finds `.venv`, `Algo/.venv`, then `python3`/`python`, so the
npm Python scripts work without activating the virtualenv. `requirements-dev.txt`
adds pytest to the runtime requirements.

### Commands from the repository root

```bash
npm test                    # maintained regression suite: Node + current Python suites
npm run test:node           # all 68 Node tests (live integration tests skip)
npm run test:routes         # routes, auth pages, production guards and model transport
npm run test:assessment     # Supabase assessment, revision and consultation authorization
npm run test:pdf            # PDF report rendering
npm run test:python         # full pytest run, including the retired UI tests (see below)
npm run test:python:current # clinical model, results privacy, design contract, pages
npm run test:live           # live HTTP/Data API checks; skips unless configured
```

### Commands from `backend/`

```bash
cd backend
npm test                    # same 68 Node tests, resolved through ../tests
npm run test:routes
npm run test:assessment
npm run test:pdf
npm run test:python:current
```

From the repository root the equivalent form is `npm test --prefix backend`.
These scripts run the tests from `backend/` without loading `backend/.env` into
unit tests: the production-configuration test stubs dotenv, so a local secrets
file cannot turn the missing-configuration case into a false pass.

### Optional live integration tests

`tests/live_http.test.js` is opt-in and skipped otherwise. Point it only at a
disposable server/project:

```bash
TEST_ORIGIN=http://127.0.0.1:5000 \
TEST_SUPABASE_URL=https://<disposable-ref>.supabase.co \
TEST_SUPABASE_PUBLISHABLE_KEY=<public key> \
npm run test:live
```

`TEST_ORIGIN` enables the page/API checks; `TEST_PUBLIC_ORIGIN` overrides the
origin used for the signup-role probe. The Data API check runs only when the
Supabase pair is set. Missing settings produce `SKIP`, never a pass. Do not use
production credentials, and never put a service-role key in these variables.

### Current results (2026-10-20)

- **Node:** 64 passed, 4 skipped, 0 failed. This includes build-output,
  deployment-configuration, private-prediction authorization and interface-copy
  tests.
- **Maintained Python suite:** 52 passed (`test:python:current`).
- **Full Python suite:** 65 passed, 13 failed (`test:python`). All 13 failures are
  in `tests/test_form_validation.py`, which guards the retired signup/login
  wiring: it imports the deleted `Scripts/login.js`, expects the removed
  date-of-birth/sex fields, and expects a validation form on the marketing
  `index.html`. The current auth pages are covered by `tests/auth_pages.test.js`.
  The module is retained and runnable, but CI does not run it. Do not treat the
  full command as passing until it is rewritten for the current pages.
- **CI:** [.github/workflows/tests.yml](.github/workflows/tests.yml) runs the Node
  suite and `test:python:current` on pushes and pull requests. It sets no
  Supabase or model secrets, so live tests skip.
- The Node API suites verify routing, guards, validation and configuration, not
  real Auth delivery, live RLS or durable persistence. RLS claims come from
  catalog inspection and the checked-in SQL tests, not from CI against the live
  project.

Extra sanity checks:

```bash
node backend/build-static.js       # static build
node --check backend/server.js     # syntax; there is no typecheck script
```

## Deployment

### How pages and API requests are served

- **Locally** (`npm start --prefix backend`): [backend/server.js](backend/server.js)
  serves `/api/*` from the same Express app used in production, serves the static
  pages from the repository root, maps `/admin` to `admin.html`, and auto-starts
  Flask on port 5001 unless `FLASK_ORIGIN` is set or `FLASK_AUTOSTART=false`.
- **On Vercel** ([vercel.json](vercel.json)): two services behind one domain.
  `web` runs `node ../backend/build-static.js web/dist` through `web/package.json`
  and publishes `web/dist`; `backend` runs `backend/production.js` with
  `npm ci --ignore-scripts`. Top-level routing is `/api/(.*)` → `backend`,
  `/admin` → `307 /admin.html`, and `/(.*)` → `web`. Services are internal until a
  rewrite targets them, and the original path is forwarded unchanged, so the
  browser's relative `/api/...` calls reach the same mounts in both environments.
- The Vercel project's **framework must be set to Services** in its build
  settings. Without it Vercel ignores `services` in `vercel.json`; this is a
  dashboard setting that cannot be verified from the repository.

### Static output

[backend/build-static.js](backend/build-static.js) copies an explicit allowlist of
14 public pages plus `Styles/`, `Scripts/`, `Asset/` and `images/`. It deletes and
recreates the output directory first (so a removed page cannot linger), skips
dotfiles, `node_modules` and `.md`/`.map`/`.log`/`.env`/`.pem`/`.key`/`.p12`
files, and fails the build when a required page or asset is missing, when the
output path would delete the repository, or when `backend`, `tests`, `Algo`,
`node_modules`, `web` or an `.env` file appears in the output.
[tests/build_static.test.js](tests/build_static.test.js) builds into a temporary
directory and checks required files, forbidden paths, secret markers and that
every HTML/CSS reference resolves inside the build.

### Environment variables

| Setting | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | yes | HTTPS project URL. Server-side only. |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Publishable or legacy anon key. A `sb_secret_`/service-role key is rejected with 503. |
| `APP_ORIGIN` | yes in production | Exact browser origin, e.g. `https://hellodoc.example`. Drives the CSRF origin check and the `Secure` cookie flag, and must be a bare origin. Preview deployments fall back to `https://$VERCEL_URL`. |
| `FLASK_ORIGIN` | only for predictions | Private URL of the model service reachable from the backend. Setting it disables the local Flask autostart. |
| `PREDICTION_INTERNAL_TOKEN` | with `FLASK_ORIGIN` | Shared with Flask's token-protected `/internal/*` routes. Server-side only; never in static assets. |
| `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `ADMIN_BOOTSTRAP_CONFIRM` | never at runtime | Only for the one-off `backend/bootstrap-admin.js` in a private shell. |
| `FLASK_PORT`, `FLASK_AUTOSTART` | local only | Model child process for development. |

Session cookies (`hd_access`, `hd_refresh`) are `HttpOnly`, `SameSite=Lax`, and
`Secure` whenever `APP_ORIGIN` is HTTPS, independent of `NODE_ENV`.

### Configuration failures

Missing or invalid configuration fails closed: every `/api` request returns
`503 CONFIGURATION_UNAVAILABLE`, while `/api/health` (and `/health`) answers with
`configuration: "invalid"` plus a `problems` list naming the setting (never its
value), and one `configuration_invalid` line is logged at startup. No setting
value is ever echoed in that list or in the logs. Static pages still load, so an
operator can inspect the deployment.

### The Flask model on Vercel

The Flask predictor is **not part of the Vercel deployment**: `Algo/` is excluded
from uploads, Vercel does not run `backend/server.js`, and its Express service
cannot spawn Python. `tests/deployment_config.test.js` enforces the two-service
configuration so a model service cannot be assumed silently. Until `FLASK_ORIGIN`
and `PREDICTION_INTERNAL_TOKEN` point at a separately deployed private model
(allowed origin only; never a public rewrite), `GET /api/doctor/symptoms`,
assessment creation/revision and `/api/doctor/predict` fail with a specific
`MODEL_*` code. The workspace no longer loses the consultation in that state:
symptom search is reported as unavailable, notes and observations stay usable,
and the doctor can explicitly save with `modelUnavailable: true`. That stores
`modelStatus: "unavailable"` with no predicted disease, version, confidence or
guidance. Local development is unaffected. The model artifact and vocabulary are
verified: Flask loads all 132 symptoms and returns a prediction with no
calibrated confidence.


To restore production predictions, deploy the included `render.yaml` blueprint
from the GitHub repository on Render. Set a long random value for
`PREDICTION_INTERNAL_TOKEN` in the Render service environment. After the service
deploys, add these two **server-side Production** variables in Vercel:
`FLASK_ORIGIN` = the Render service's base URL (for example,
`https://hellodoc-private-model.onrender.com`, without a path) and
`PREDICTION_INTERNAL_TOKEN` = the exact same token configured in Render. Do not
put the token in frontend code or expose it as a `NEXT_PUBLIC_*` variable.
Redeploy HelloDoc after saving the Vercel variables. Confirm symptom search
returns the 132 model symptoms and test an assessment with disposable data.

### Verification status

| Area | Status |
| --- | --- |
| Static build from the working tree | **Locally verified** (2026-10-20): build completes, required pages/assets present, no private paths or secret markers. |
| Node suite (routes, guards, PDF, build, deployment config, interface copy, walk-in, consultation) | **Locally verified** (2026-10-26, Node 22.20): 90 tests, 86 passed, 4 skipped (live and walk-in database cases that need migration 014), 0 failed. Node 20 cannot run this suite because `@supabase/supabase-js` 2.118 requires Node 22. |
| Python suites | **Locally verified** (2026-10-26, Python 3.12): maintained subset 50 passed, 5 skipped. `svc.pkl` unpickles with a scikit-learn version warning (built with 1.5.1, installed 1.6.1). |
| Private model service | **Locally verified** (2026-10-26): Flask started on a loopback port with the internal token, returned 132 labelled symptoms, and assessed `itching` + `skin_rash` as `Fungal infection` with `confidence: null`. Wrong token, unknown symptom, unreachable service and missing token produced `MODEL_AUTH`, `INVALID_SYMPTOMS`, `MODEL_UNREACHABLE` and `MODEL_NOT_CONFIGURED` respectively. |
| CI workflow | **Configured, not verified from this checkout.** [.github/workflows/tests.yml](.github/workflows/tests.yml) runs the Node suite and a static-build job, plus the maintained Python subset. Treat it as verified only after a green run is visible in Actions. |
| Vercel production deployment | **Not verified.** No deployment or environment change was made from this workspace; routing, the Services framework setting, environment variables and the live model gap were not exercised on Vercel. |

No deployment is performed by this repository, and migrations are never run by a
deploy. Earlier Vercel notes in [SUPABASE.md](backend/migrations/SUPABASE.md) and
[PRODUCTION_REPAIR.md](backend/PRODUCTION_REPAIR.md) are **historical records** and
are not re-verified here; treat their URLs, build results and environment claims
as unconfirmed until re-tested.

### Manual deployment smoke checklist

Run against a preview deployment with disposable accounts, never production data.

1. **Build** — the `web` service build log shows `backend/build-static.js`
   completing; `web/dist` contains the 14 pages and the four asset directories.
2. **Routing** — `/api/health` returns 200 with `configuration: "valid"`; `/admin`
   redirects to `/admin.html`; an unknown `/api/...` path returns JSON 404, not an
   HTML page.
3. **Static assets** — open one page per section and confirm no 404s in the
   network panel for CSS, JS, images or fonts; `/Asset/favicon.svg` loads.
4. **Signup and login** — create a patient, confirm the session survives a reload,
   sign out, sign in again, and verify a wrong-portal login is refused.
5. **Doctor approval** — register a doctor, confirm clinical pages refuse while
   pending (`403 DOCTOR_NOT_VERIFIED`), then approve through an admin account and
   reload the doctor dashboard.
6. **Appointment creation** — as a patient, book a slot; the request returns 201
   and the appointment appears for the doctor.
7. **Symptom retrieval** — as the approved doctor, open the assessment form: it
   either lists model symptoms or shows the explicit model-unavailable message.
   A 503 here is the documented model gap, not a signup failure.
8. **Assessment saving** — save a record, then open the same appointment again and
   confirm it opens the existing record instead of creating a duplicate.
9. **Report loading and PDF** — reload the report page and download the PDF; check
   the filename, `application/pdf` content type and that the text matches the
   stored assessment.
10. **Authorization** — signed out, `/api/doctor/predict`, `/api/doctor/symptoms`
    and `/api/doctor/assessments` return 401/403 and never a model result.
11. **Secrets and cookies** — no `sb_secret_`/`SUPABASE_SERVICE_ROLE_KEY` value in
    page source or JS bundles; `hd_access` is `Secure`, `HttpOnly`, `SameSite=Lax`.
    Setting an invalid key must turn the API into 503, not a partial service.

## Privacy, clinical safety and limitations

This is a prototype. Do not enter real patient data. Predictions are experimental
decision support, not a diagnosis; the model has no calibrated confidence and no
clinical validation, so no confidence percentage is shown. The app does not infer
urgency or triage patients, and never replaces the doctor's independent
assessment. The model service is private and token-protected; patient identifiers
and clinical notes are never sent to it. Assessment rows are readable only by the
recording doctor, the patient and an active administrator, and are append-only
(no delete policy); the model output is frozen by trigger. PDFs are generated on
demand from the stored record and are not uploaded to public storage.

Open items before any real deployment: mailbox/confirmation/recovery testing with
a controlled mailbox, an independent security and RLS review (including the wider
default table grants on `public.assessments`, which currently rely on RLS to block
anonymous access), durable distributed rate limiting, backup/restore drills,
clinical model validation, and a completed privacy/retention policy. No legal or
regulatory compliance is claimed.
