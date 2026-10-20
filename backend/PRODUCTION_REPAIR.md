# Production repair handoff — 2026-10-17

## Confirmed diagnosis

- GitHub main fetched successfully at `156de93` (new update database not working). Contrary to the initial report, it already contains `backend/supabase-routes.js`, the Supabase switch in server.js, and migration 003. It still lacks migrations 005/006, first-admin bootstrap, admin frontend and static build script. Older Vercel config still bundles root Flask plus other services.
- Vercel deployment inspection succeeds with the connected integration in this session (not 403). Last inspected production attempt `dpl_F2H8Z8nurmAFvwDN78rvBZvtbABp` failed with `LAMBDA_SIZE_EXCEEDED`: 625.04 MB Python bundle, 500 MB maximum. Its source predates current GitHub main.
- An unauthenticated request to `https://hellodoc-r1-e09f.vercel.app/api/health` returns **302 to vercel.com/sso-api**. Following redirects yields HTTP 200 HTML for Vercel sign-in, not HelloDoc JSON. `hellodoc-two.vercel.app/api/health` returns 404. Production API behavior beyond protection is not verified. Do not diagnose a database outage from the HTML response.
- Supabase public schema/migration metadata matches applied migrations 003, 005 and 006; all eight public tables have RLS. Zero Auth users/profiles. No SQL was applied in this repair.
- Environment names SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY exist for preview/production; values are masked and were not decrypted. Production APP_ORIGIN is the canonical host above. Preview lacks APP_ORIGIN; the new entrypoint uses Vercel's trusted VERCEL_URL for preview only, never request Host.

## Implementation

`backend/production.js` is the explicit Vercel Express entrypoint. It imports no MySQL, bcrypt, local sessions or Python launcher. Missing/invalid configuration remains inspectable and API requests fail closed instead of starting legacy MySQL. Privileged keys are rejected in the publishable-key slot.

`/api/health` and `/api/auth/health` return safe JSON:
- 200: running, configuration valid, Supabase connected via the real public_doctors Data API RPC.
- 503: configuration invalid / not checked, or valid / Supabase unavailable.
- Platform startup failure: no application JSON; inspect Vercel logs.

The probe has a five-second timeout and never reads patient rows. Errors log operation, upstream status/code/type, not passwords, tokens, URLs, payloads or medical data. Login now displays backend-safe service errors instead of masking everything as invalid credentials.

vercel.json declares explicit static frontend and Node backend services, preserving `/api` paths exactly (per Vercel Services routing). `/admin` selects static admin.html; private requests remain authorized in the backend. Python/ML and optional chatbot source remain untouched but are not launched in this core deployment; configure a private FLASK_ORIGIN/PREDICTION_INTERNAL_TOKEN separately if prediction is needed. Do not publicly route its internal endpoint. The static install uses backend's lockfile rather than installing legacy root dependencies. Native install scripts are unnecessary for the production-only entrypoint. Both entrypoints now share `backend/app.js`; the legacy MySQL stack (server.js MySQL branch, `transaction.js`, `doctor-routes.js`, `mysql2`/`express-session`/`bcrypt` dependencies and MySQL migrations 001/002) was deleted, so no account path can fall back to MySQL.

## Verification performed

- 22 Node tests passed (production entrypoint/configuration/connectivity/CSRF, Supabase/admin stubs and legacy regressions).
- Actual new production.js process against Hellodoc: `/api/health` 200 with supabase=connected; `/api/doctors` 200 `[]`; `/api/admin/patients` 401.
- Static build succeeded; production.js syntax passed.
- No new migration needed or rerun. Existing 003/005/006 schema confirmed by remote metadata.
- Vercel CLI 64.5.0 production build could not run: **The request is missing an authentication token**.
- GitHub push dry-run could not authenticate: **fatal: could not read Username for 'https://github.com': No such device or address**.
- No controlled mailbox was provided, so signup/email confirmation/login/session refresh/logout and signed-in dashboard acceptance tests remain pending. No synthetic account or admin was provisioned in this repair.

## Required authorized handoff

1. Authenticate GitHub in the environment that will push this reviewed branch. Workspace is an imported Git snapshot without a configured remote and with unrelated differences from main; do not force-push this snapshot over main. Apply the repair commit onto current main via cherry-pick/PR, resolving against newer source while preserving unrelated changes. Missing migration files must be committed, **not rerun**.
2. Authenticate Vercel CLI privately with `vercel login`, or connect a trusted CI deployment credential. Do not paste tokens in chat. Link the **existing** project `prj_jFbKTPOO82ObVUAvEHvFu96ZfO7s` in team `team_qabOOY1rIVj2LyGZvA46UpyH`; do not create a project.
3. Run `vercel build --prod --yes --project prj_jFbKTPOO82ObVUAvEHvFu96ZfO7s` and resolve any builder errors before deploying. This config has not passed a Vercel build yet.
4. Deploy a preview of the reconciled Git commit to the existing project. Verify its exact origin/redirect allowlist and run `/api/health`, directory and authenticated flow checks. Only promote to production after validation.
5. Keep Deployment Protection in place unless the owner deliberately configures public production access in Vercel. Use owner SSO or a privately configured automation bypass for verification; this repair did not disable protection.
6. Set production SUPABASE_URL to the confirmed Hellodoc URL and a matching publishable key if readiness reports configuration/upstream failure. Keep APP_ORIGIN equal to the canonical production URL; do not overwrite unrelated environment variables. Names alone do not prove secret values are correct.
7. Use a controlled mailbox to register a synthetic patient, confirm email, verify profile trigger, log in, restore/refresh, load dashboard, recover password and log out. Verify patient/doctor admin denials. No public admin registration is available; use documented private bootstrap only.

## Acceptance status

NOT COMPLETE: no new deployment reached READY, production Data API connectivity is not verified through deployed code, and confirmed-account dashboard tests are blocked by unpublished code/protection/mailbox. Local connectivity is verified, not a substitute for deployed verification.
