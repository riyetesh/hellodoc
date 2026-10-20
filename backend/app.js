'use strict';

// The one API surface for HelloDoc. Both entrypoints use it:
//   - server.js      local development (adds static pages + model autostart)
//   - production.js  Vercel (API only; static files come from the CDN)
// Supabase is the only account backend. There is no MySQL/express-session path:
// when Supabase is not configured the API fails closed instead of degrading to
// a second, weaker authentication system.

const express = require('express');

const PUBLIC_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readConfig(env = process.env) {
  return {
    url: env.SUPABASE_URL || '',
    key: env.SUPABASE_PUBLISHABLE_KEY || '',
    origin:
      env.APP_ORIGIN ||
      (env.VERCEL_ENV === 'preview' && env.VERCEL_URL ? `https://${env.VERCEL_URL}` : ''),
  };
}

// Only the public browser key is acceptable: the publishable key, or a legacy
// anon JWT. A service-role/secret key must never be usable by this process.
function isPublicKey(key) {
  if (typeof key !== 'string' || !key) return false;
  if (key.startsWith('sb_publishable_')) return true;
  if (key.startsWith('sb_secret_')) return false;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url')).role === 'anon';
  } catch {
    return false;
  }
}

// Operator-facing diagnostics. Values are never echoed, only the name of the
// setting and what is wrong with it, so this is safe for a health response.
function configProblems(config) {
  const problems = [];
  if (!config || !config.url) problems.push('SUPABASE_URL is missing');
  else {
    try {
      if (new URL(config.url).protocol !== 'https:') problems.push('SUPABASE_URL must be an https project URL');
    } catch {
      problems.push('SUPABASE_URL is not a valid URL');
    }
  }
  if (!config || !config.key) problems.push('SUPABASE_PUBLISHABLE_KEY is missing');
  else if (!isPublicKey(config.key)) {
    problems.push('SUPABASE_PUBLISHABLE_KEY must be the publishable/anon key; secret keys are rejected');
  }
  if (!config || !config.origin) problems.push('APP_ORIGIN is missing');
  else {
    try {
      if (new URL(config.origin).origin !== config.origin) {
        problems.push('APP_ORIGIN must be a bare origin with no path, e.g. https://example.com');
      }
    } catch {
      problems.push('APP_ORIGIN is not a valid origin');
    }
  }
  return problems;
}

function validateConfig(config) {
  // The project URL must be HTTPS and the trusted origin must be a bare origin,
  // never derived from request headers.
  return configProblems(config).length === 0;
}

function createApp({ config = readConfig(), allowSameHostOrigin = false } = {}) {
  const app = express();
  const problems = configProblems(config);
  const configured = problems.length === 0;
  if (!configured) {
    // One structured line is what an operator sees in the deployment log; the
    // API stays up so /api/health can report the same diagnosis.
    console.error(JSON.stringify({ event: 'configuration_invalid', problems }));
  }
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set(PUBLIC_HEADERS);
    next();
  });

  // Readiness: exercises the Data API, schema and directory RPC without private
  // rows. It answers even when configuration is invalid so deployments stay
  // inspectable.
  const health = async (req, res) => {
    if (!configured) {
      return res.status(503).json({
        status: 'unavailable',
        application: 'running',
        configuration: 'invalid',
        problems,
        supabase: 'not_checked',
      });
    }
    try {
      const response = await globalThis.fetch(`${config.url}/rest/v1/rpc/public_doctors`, {
        method: 'POST',
        headers: { apikey: config.key, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        console.error(JSON.stringify({ event: 'supabase_readiness_failed', status: response.status }));
        return res.status(503).json({
          status: 'unavailable',
          application: 'running',
          configuration: 'valid',
          supabase: 'unavailable',
        });
      }
      if (!Array.isArray(await response.json())) throw new Error('Invalid directory response');
      res.json({ status: 'ok', application: 'running', configuration: 'valid', supabase: 'connected' });
    } catch (error) {
      console.error(JSON.stringify({ event: 'supabase_readiness_failed', errorType: error.name }));
      res.status(503).json({
        status: 'unavailable',
        application: 'running',
        configuration: 'valid',
        supabase: 'unavailable',
      });
    }
  };
  app.get(['/health', '/api/health', '/api/auth/health'], health);

  app.use('/api', (req, res, next) =>
    configured
      ? next()
      : res.status(503).json({
          code: 'CONFIGURATION_UNAVAILABLE',
          message: 'Service configuration is unavailable. Contact support.',
        })
  );

  app.use(express.json({ limit: '16kb' }));

  // CSRF defense for cookie-authenticated mutations. Browsers attach Origin to
  // cross-site writes; a same-origin fetch may omit it but then sets
  // sec-fetch-site. Anything else is refused.
  app.use((req, res, next) => {
    if (!MUTATING_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    const expected = config.origin;
    const sameHost = allowSameHostOrigin && origin === `${req.protocol}://${req.get('host')}`;
    if (origin && (origin === expected || sameHost)) return next();
    if (!origin && req.get('sec-fetch-site') === 'same-origin') return next();
    return res.status(403).json({ message: 'Invalid origin' });
  });

  // Required lazily: supabase-routes throws unless it receives a URL and key.
  if (configured) app.use('/api', require('./supabase-routes')(config));
  app.use('/api', (req, res) => res.status(404).json({ message: 'API route not found' }));

  app.use((error, req, res, next) => {
    console.error(JSON.stringify({ event: 'request_failed', errorType: error.name }));
    res
      .status(error.type === 'entity.parse.failed' ? 400 : 500)
      .json({ message: 'Unable to process request' });
  });

  app.locals.config = config;
  app.locals.configured = configured;
  return app;
}

module.exports = { createApp, readConfig, validateConfig, configProblems, isPublicKey };
