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

- **Patient:** registration/login/password recovery, own profile and phone
  update, doctor directory, booking and cancelling own appointments. The patient
  dashboard shows visits and appointment metrics; it does not yet show clinical
  results, prescriptions or care plans.
- **Doctor:** verification status and resubmission, attendance of assigned
  appointments, confirmation/completion/no-show/cancellation of visits,
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
  lists, clinician approval/rejection/resubmission requests, suspension and
  audited appointment cancellation.
- **Model:** 132 binary symptom features, 41 conditions, model version hash and
  lookup guidance from the bundled datasets. The serialized linear SVC was
  trained with `probability=False`, so there is **no calibrated probability**;
  no confidence percentage is displayed and no number is derived from symptom
  counts.
- **Optional chatbot:** a separate Vite/React app in [chatbot](chatbot) that is
  not embedded in the clinical workflow.

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

1. Install Node 20+ and, for the model, Python 3.11+.
2. Install dependencies:
   ```bash
   npm ci --prefix backend
   npm ci --prefix chatbot        # optional
   python -m venv .venv
   .venv/Scripts/pip install -r requirements.txt   # POSIX: .venv/bin/pip
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
   that service private.
4. Apply the database migrations **before** using private pages:
   `003 → 005 → 006 → 008 → 009 → 010 → 011 → 012`. Follow
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
through audited `/api/admin/actions`.

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
  `/symptoms`, `/patients`, `/assessments`, `/assessments/:id`,
  `/assessments/:id/report.pdf`; `POST /api/doctor/availability`,
  `/assessments`, `/assessments/:id/revision`, `/predict`;
  `PATCH /api/doctor/appointments/:id/status`,
  `/assessments/:id` (doctor assessment/plan only).
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
npm ci --prefix backend                          # Node 20+ dependencies (Express, Supabase JS)
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
npm run test:node           # all 52 Node tests (live integration tests skip)
npm run test:routes         # routes, auth pages, production guards and model transport
npm run test:assessment     # Supabase assessment, revision and consultation authorization
npm run test:pdf            # PDF report rendering	npm run test:python         # full pytest run, including the retired UI tests (see below)
npm run test:python:current # clinical model, results privacy, design contract, pages
npm run test:live           # live HTTP/Data API checks; skips unless configured
```

### Commands from `backend/`

```bash
cd backend
npm test                    # same 52 Node tests, resolved through ../tests
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

- **Node:** 48 passed, 4 skipped, 0 failed.
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

[vercel.json](vercel.json) describes two Vercel services: `web` (static build via
`backend/build-static.js`) and `backend` (`backend/production.js`, an Express
entrypoint), with `/api/*` rewritten to the backend and `/admin` served from the
static build. The Flask model is **not** deployed there; a deployment that needs
predictions must point `FLASK_ORIGIN` at a separate private model service and
supply the matching token. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` per
environment, and `APP_ORIGIN` for production. Preview derives its trusted origin
from `VERCEL_URL`.

No deployment is performed by this repository, and migrations are never run by a
deploy. Earlier Vercel deployment notes in [SUPABASE.md](backend/migrations/SUPABASE.md)
and [PRODUCTION_REPAIR.md](backend/PRODUCTION_REPAIR.md) are **historical records**
and are not re-verified here; treat their URLs, build results and environment
claims as unconfirmed until re-tested.

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
