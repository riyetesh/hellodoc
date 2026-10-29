# HelloDoc V2 deployment and recovery runbook

## Architecture

- Static HTML/CSS/JavaScript pages are served by Vercel's CDN.
- The Express API runs from `backend/production.js` and is exposed under `/api/*`.
- Supabase Auth owns credentials and sessions. The API uses HttpOnly cookies and a public/publishable key; no MySQL fallback exists.
- PostgreSQL stores profiles, doctor applications and verification, availability, appointments, clinical assessments, walk-in patient records, and audit history.
- Database permissions and RLS remain enabled even though this is a demonstration project. Do not use real patient data.

## Fresh-project migration order

Apply in order to a **new, empty** Supabase project:

1. `003_supabase_foundation.sql`
2. `005_admin_management.sql`
3. `006_directory_suspension.sql`
4. `008_doctor_applicant.sql`
5. `009_doctor_self_service.sql`
6. `010_clinical_assessments.sql`
7. `011_assessment_revisions.sql`
8. `012_doctor_consultation.sql`
9. `013_walkin_patients.sql`
10. `014_walkin_email_model_optional.sql`
11. `016_public_doctor_photos.sql`

The following are **not migrations** and must not be applied as schema changes:
- `004_supabase_rls_tests.sql` (test specification)
- `007_security_regression.sql` (rollback-safe regression test; run only as a test)
- `015_patient_walkin_queue.sql` (optional queue feature; not enabled in the current app)

Migration 016 adds `doctor_profiles.profile_image_url` before replacing `public_doctors()`. This dependency is required on a clean database.

## Verify after every migration batch

1. Check Supabase **Database → Migrations**; the applied sequence must match the list above.
2. Run `VERIFY.sql` in the SQL Editor and inspect every expected marker. A mismatch is a finding; do not blindly rerun an applied migration.
3. Run `007_security_regression.sql` in the SQL Editor. It uses synthetic rows inside a transaction and should report `Authorization regression passed; fixtures rolled back`.
4. Check **Database → Advisors** for new issues.
5. Check `GET /api/health` and `GET /api/auth/health` after deployment. A healthy app should report Supabase connected.
6. Test patient sign-up/login, doctor application and pending verification, admin login, and directory loading using test accounts only.

## Vercel environment

Set these variables for Production, Preview, and Development as appropriate:
- `SUPABASE_URL=https://<project-ref>.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` (or the legacy anon key only if required for compatibility)
- `APP_ORIGIN=https://<production-domain>` for Production; use the matching preview origin for Preview if preview authentication is tested.

Never put a Supabase service-role/secret key in Vercel frontend variables, any `NEXT_PUBLIC_*` variable, or committed files. The one-time admin bootstrap is a local operator task and must use a private shell with a service-role key; do not add that key to Vercel.

In Supabase **Authentication → URL Configuration**, set the Site URL to the production origin and add the production and preview login/confirmation redirect URLs actually used by this deployment. Do not add wildcard redirects for unrelated domains.

## Recovery and rollback rules

Supabase does not automatically reverse a migration just because a later migration fails. Treat each migration as an append-only, version-controlled change.

- **Before a schema change:** use a preview/staging project first. For a database with data, create and verify a backup/export using Supabase's backup/export facilities before applying DDL.
- **If a migration fails:** stop. Check whether it was recorded in the migration ledger and inspect the database before retrying. A failed transaction may roll back its own statements; never assume all tools or scripts are transactional.
- **If an applied migration has a bug:** do not edit/replay it. Create a new, forward-only corrective migration, test it on a disposable project, run `VERIFY.sql`, then apply it.
- **If the whole demo schema must be reset:** because reset is destructive, first confirm there is no data worth keeping. Create a fresh Supabase project and replay the clean migration order above; do not drop the existing project's schema as a troubleshooting shortcut.
- **Keep code and schema in sync:** commit migration SQL and this runbook to GitHub before/alongside applying schema changes. Keep a dated note of the Supabase migration ledger after each deployment.

## Current V2 baseline (2026-10-29)

- Project ref: `siqxxosjltaswqeswbhh`, region `eu-west-1`.
- Baseline tables: 11 public tables; all have RLS enabled; currently zero application rows.
- Applied schema migrations: 003, 005, 006, 008, 009, 010, 011, 012, 013, 014, 016.
- The regression test `007_security_regression.sql` passed and rolled back its fixtures.
- The public doctor directory function and auth signup trigger are present.
- This is a project/demo architecture, not suitable for real clinical records without a separate privacy, security, and clinical-safety review.
