# Patient foundation migration

This repository contains no tracked baseline users schema. Before applying `001_patient_foundation.sql`, verify the existing `users` table has `id INT` as primary key and the existing signup columns (`firstName`, `lastName`, `email`, `password`, `dob`, `sex`). Check `SHOW CREATE TABLE users;` and take a full backup. If `id` has a different type, adjust every referencing column to exactly match its type before applying. Do **not** run this against production without reviewing the schema and backup.

Apply once against the configured MySQL 8 database using a dedicated migration account:

```bash
mysql -h localhost -u MIGRATION_USER -p hello_doc < backend/migrations/001_patient_foundation.sql
```

The DDL is additive: existing accounts default to `patient`; no doctor accounts are seeded or approved. To provision a doctor, an authorized administrator must verify credentials offline, then create/assign the user role and doctor profile with `verification_status='approved'` through a controlled administrative procedure. No public API can approve or self-assign a doctor role. Doctor availability must be populated by an administrator before booking opens. Appointments are never migrated from browser localStorage because those records are untrusted and have no verified owner.

MySQL DDL commits independently. If an operation fails, inspect `SHOW TABLES` and `SHOW COLUMNS FROM users`, then apply only missing statements; don't blindly rerun the whole file. To roll back **before new data is written**, back up again, then drop in reverse dependency order: `audit_logs`, `notifications`, `prescriptions`, `care_plans`, `clinical_assessments`, `symptom_submissions`, `appointments`, `doctor_availability`, `doctor_profiles`, `schema_migrations`; finally drop `users.role`. Rolling back after new data exists will delete it: restore from the backup or plan a data-preserving reverse migration instead. This migration has not been applied automatically.

## Doctor workspace migration (002)

After verifying `001_patient_foundation` is applied and taking a backup, inspect existing tables for conflicting names/columns, then apply `002_doctor_workspace.sql` with the same migration account. It adds publication timestamps to assessments, care-plan detail fields, separate model predictions and follow-up tasks, and schedule/time-off tables. It does not backfill or publish existing assessments; they remain drafts. DDL is non-transactional; on partial failure inspect each table/column and apply only missing statements. Do not drop this migration after clinical data exists; a rollback needs a reviewed data-preserving migration.

For local model use, set the same high-entropy `PREDICTION_INTERNAL_TOKEN` on Express and Flask. Keep Flask on loopback or a private network: a shared token is not suitable for a publicly exposed Flask service. The saved `svc.pkl` has 132 features ordered exactly like `symptoms_dict`, 41 classes represented by `diseases_list`, and was serialized using scikit-learn 1.5.1; the current 1.6.1 environment warns on load. Outputs are experimental, not validated for clinical use; do not use for autonomous diagnosis or prescribing. Free-text patient submissions are not converted to symptom IDs automatically: only exact comma-separated training identifiers pass validation. Clinicians must assess independently.

Current scheduling supports discrete administrator/doctor-entered availability slots and blocks exact slot collisions with a unique index. Break/leave and duration/consultation-type scheduling are not yet fully operational; do not rely on this for production scheduling. No existing data or migration was applied in this workspace because local MySQL access was denied.
