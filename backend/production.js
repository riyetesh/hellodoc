require('dotenv').config();

// Vercel entrypoint. Static files are served by the CDN service (see vercel.json),
// so this file exposes the API only. Account data, sessions and roles all come
// from Supabase through app.js.
const { createApp } = require('./app');

const app = createApp();

if (require.main === module) app.listen(Number(process.env.PORT) || 3000, '0.0.0.0');

module.exports = app;
