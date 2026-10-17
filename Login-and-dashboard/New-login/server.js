// Legacy placeholder only.
// The New-login auth service has been retired. Authentication and account
// routes now live in backend/server.js and are exposed under /api/auth/*.
//
// This file is intentionally empty so the folder can remain in the repo as
// static HTML/CSS reference without running a second Express server.
"use strict";
module.exports = function () {
  throw new Error("Login-and-dashboard/New-login/server.js is retired. Use backend/server.js.");
};
