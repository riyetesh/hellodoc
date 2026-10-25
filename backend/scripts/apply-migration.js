#!/usr/bin/env node
/* Applies one SQL migration with a privileged database connection.
 *
 * This is operator tooling, not application code: it is never imported by the
 * server, never runs from a request and never sees a user session. The
 * connection string is read from SUPABASE_DB_URL (or DATABASE_URL) in
 * backend/.env or the private shell, and is never printed.
 *
 *   node backend/scripts/apply-migration.js 013_walkin_patients.sql
 *
 * The file is executed inside one transaction: a failure rolls everything back,
 * so a half-applied migration cannot be left behind.
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = path.join(__dirname, '..', 'migrations');

function fail(message) {
  console.error(`\n${message}\n`);
  process.exitCode = 1;
}

async function main() {
  const name = process.argv[2];
  if (!name) return fail('Usage: node backend/scripts/apply-migration.js <file.sql>');

  // Only a plain file name inside the migrations directory may be executed.
  if (!/^[0-9a-z_]+\.sql$/i.test(name) || name.includes('/') || name.includes('\\')) {
    return fail('Pass a migration file name such as 013_walkin_patients.sql');
  }
  const file = path.join(MIGRATIONS, name);
  if (!fs.existsSync(file)) return fail(`No such migration: backend/migrations/${name}`);

  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) {
    return fail([
      'No privileged database connection is configured, so nothing was applied.',
      '',
      'Add the connection string (Supabase → Project Settings → Database → Connection string → URI)',
      'to backend/.env as a new line, then run this command again:',
      '',
      '  SUPABASE_DB_URL=postgresql://…',
      '',
      'Never commit that line. It is already covered by .gitignore.',
    ].join('\n'));
  }

  let Client;
  try {
    ({ Client } = require('pg'));
  } catch {
    return fail('The pg driver is missing. Run `npm install` in backend/ first.');
  }

  const sql = fs.readFileSync(file, 'utf8');
  const client = new Client({
    connectionString: url,
    // Supabase presents a certificate that Node does not ship a root for; the
    // connection is still TLS.
    ssl: { rejectUnauthorized: false },
    application_name: 'hellodoc-migration',
  });

  try {
    await client.connect();
  } catch (error) {
    return fail(`Could not connect to the database (${error.code || 'connection error'}). Nothing was applied.`);
  }

  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('commit');
    // PostgREST caches the schema; a new function is invisible until it reloads.
    await client.query("notify pgrst, 'reload schema'");
    console.log(`Applied backend/migrations/${name} and asked PostgREST to reload its schema.`);
  } catch (error) {
    try { await client.query('rollback'); } catch { /* the transaction is already gone */ }
    // The message and SQLSTATE only: never the statement, which may contain data.
    fail(`Migration rolled back: ${error.message}${error.code ? ` (SQLSTATE ${error.code})` : ''}`);
  } finally {
    await client.end().catch(() => {});
  }
}

main();
