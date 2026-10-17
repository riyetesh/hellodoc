// Never run in a web handler. Credentials are read only from the process environment.
const { createClient } = require('@supabase/supabase-js');
async function main() {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, ADMIN_EMAIL: email, ADMIN_BOOTSTRAP_CONFIRM: confirm } = process.env;
  if (!url || !key || !email || confirm !== 'provision-first-admin') throw new Error('Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL and ADMIN_BOOTSTRAP_CONFIRM=provision-first-admin in a private shell.');
  const api = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let user;
  for (let page = 1; ; page++) {
    const result = await api.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) throw new Error('Unable to inspect Auth accounts');
    user = result.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (user || result.data.users.length < 100) break;
  }
  if (!user?.email_confirmed_at) throw new Error('First register this email through HelloDoc and confirm its email. No role was changed.');
  const result = await api.rpc('bootstrap_first_admin', { p_user: user.id });
  if (result.error) throw new Error('Bootstrap refused: confirm the account and ensure the one-time bootstrap has not already been consumed.');
  console.log('First administrator provisioned. Sign in through HelloDoc and open /admin.');
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = main;
