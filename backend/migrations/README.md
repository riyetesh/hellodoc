# Database migrations

HelloDoc has one database: the Supabase PostgreSQL project. The former MySQL
migrations `001_patient_foundation.sql` and `002_doctor_workspace.sql` were removed
together with the MySQL backend (`mysql2`, `express-session`, `backend/transaction.js`
and `backend/doctor-routes.js`). Nothing in this repository talks to MySQL any more.

Apply the PostgreSQL files in this order against the Supabase project:

1. `003_supabase_foundation.sql` — profiles, patient/doctor profiles, applications,
   availability, appointments, status history, the signup trigger and the scoped
   RPCs, grants and RLS policies.
2. `005_admin_management.sql` — `suspended`, `require_active()`, admin metrics,
   paginated admin lists, audited admin actions and first-admin bootstrap.
3. `006_directory_suspension.sql` — public directory/slot RPCs that exclude
   suspended clinicians, plus metadata-based doctor applications.
4. `008_doctor_applicant.sql` — the four-role constraint (`patient`,
   `doctor_applicant`, `doctor`, `admin`) and the signup trigger that creates either
   a pending application or a patient profile.
5. `009_doctor_self_service.sql` — doctor accounts from signup with pending
   verification, professional detail columns and the stricter signup trigger.
6. `010_clinical_assessments.sql` — `assessments` (frozen model output, separate
   doctor decision), its RLS policies, the immutability trigger and the
   `assigned_patients` / `assessment_view` RPCs.
7. `011_assessment_revisions.sql` — `supersedes_id` lineage so a symptom
   correction is appended as a new revision instead of rewriting the stored
   prediction, plus the insert policy and lineage fields in `assessment_view`.
8. `012_doctor_consultation.sql` — `doctor_consultation(appointment)` returning
   the stored patient identity and any already-recorded symptoms for one
   appointment the caller attends; another doctor's appointment is reported as
   not found.

`004_supabase_rls_tests.sql` and `007_security_regression.sql` are rollback-only
tests, not migrations. Do not run them against production data.

Rules that must hold after any change:

- Self-signup never grants `doctor` or `admin`; only `admin_action` can promote an
  applicant, and it records the reviewer and reason in the audit log.
- Direct writes to account, appointment and application tables are revoked from
  `anon` and `authenticated`; state changes go through security-definer RPCs.
- RLS stays enabled on every table, and suspended profiles are denied by
  `require_active()` as well as by the policies.

Verify with remote migration metadata that each file's effects are present before
reapplying anything, and see [SUPABASE.md](SUPABASE.md) for the first-admin bootstrap
and verification record.
