# Clinical workspace implementation / verification

## Migration dependency

Apply `migrations/026_clinical_workspace.sql` only after 025, first to an isolated database. It has NOT been applied or executed by the agent. This repository uses numbered operator-run SQL rather than a Supabase CLI migration directory. No live data was modified.

026 adds doctor-scoped, versioned consultation drafts; transactional bulk slot creation/removal; queue-to-appointment linkage; idempotent completion with an existing assessment; and preservation of symptoms on model-free records. Existing model status vocabulary remains `completed` / `unavailable` for compatibility: `unavailable` means no model result and does not distinguish deliberate omission from outage. A future schema/report change should distinguish those reasons.

Restart the Express server after updating backend routes. Before 026 is applied, secure drafts, queue consultation entry, bulk slot changes and the new completion endpoint explicitly report unavailable/failure; the legacy single-slot endpoint remains usable. Do not use the new completion controls with real patients until migration tests pass.

## Implemented

- Explicit session Start only; wizard navigation cannot start sessions. Patient switching is blocked during a session. Session timing metadata (appointment identifier and start/end timestamps, no clinical text) survives same-tab refresh. No cross-tab session lease is implemented.
- Documentation independent of prediction; model symptoms keep their provenance when prediction is skipped. Treatment/follow-up plan exposed before review. Previously reached steps remain navigable; future steps disabled; focus management and reduced-motion handling added.
- Optional model retry including reconnecting vocabulary. `/` focuses symptoms; Ctrl/Cmd+Enter saves only from Review, never completes the appointment.
- Clinical drafts no longer written into sessionStorage. Authenticated API uses optimistic versions; conflicting tabs are not overwritten. Drafts are loaded only after appointment authorization; draft JSON cannot set patient identity. Failed saves remain visible. Drafts remain in the database until completion; retention/expiry policy is not implemented.
- Save report and complete appointment are separate operations. Completion is explicit, saved report required, duplicate completion idempotent; queue state and draft cleanup are transactional. Report creation precedes completion, so partial failure preserves the report. New edits to an already saved record must be revised instead of silently ignored.
- Bulk 30-minute windows and weekly repetition up to 200 slots, local timezone display, copy start time to another date, guarded removal. Recurrence materializes dated slots, not an indefinitely recurring schedule. Editing means remove and recreate; no atomic move UI yet. Existing booking deletion prohibited.
- Queue waiting duration, visible-dialog polling every 20 seconds, direct authorized account-patient appointment creation without duplicate clinic registration. Queue remains `called` while consulting, not a separate persisted `in_consultation` status. Manual Mark seen removed in favor of completion through the saved assessment.

## Actual verification

Node suite: 99 tests, 95 pass, 4 skip. Includes contract checks for new lifecycle/privacy paths and existing mocked authorization/assessment tests. These are NOT database concurrency or browser integration tests.

Maintained Python suite: 46 pass, 9 fail. Failures: home product preview, consultation demo isolation contract, dash punctuation, illustration safety, preserved story photos, story title, shared nav, About destination, story structure. See `.workspace-python.log` while present. These failures were not repaired as unrelated page changes were outside the clinical workflow scope.

JavaScript syntax checks run on assessment, doctor, consultation and backend routes. Static build covered by Node tests. No lint script exists. No real doctor account actions, production database changes, sign-in flow, PDF download through browser, local Postgres migration execution, responsive screenshots, or measured speed comparison were completed.

## Outstanding product work / release gates

- Test migration against an isolated Supabase/PostgreSQL instance with two doctors, two patients, suspended/unapproved users, simultaneous draft writers, duplicate queue starts, overlapping slots and booked-slot removal.
- Signed-in end-to-end browser coverage, responsive/keyboard audit and full authorization isolation checks.
- Secure per-doctor configurable templates (existing heading-only templates retained); structured medication and follow-up fields; patient history/allergies/medications only when actually stored and authorized.
- Full dashboard hierarchy and CSS consolidation; dedicated treatment wizard stage (current five stages retain Decision support and combine Assessment & plan).
- Persistent cross-tab consultation lock and audit-grade server session timestamps; draft retention policy and deletion/version UX.
- Live video transport is NOT configured; no simulated patient feed.
- Queue dashboard integration beyond its current dialog and richer in-consultation state; do not label polling as realtime.
- Measure click counts and documentation time with disposable data; no speedup claim is supported yet.
