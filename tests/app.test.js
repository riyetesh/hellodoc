const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, validateConfig, isPublicKey } = require('../backend/app');

const configured = {
  url: 'https://example.supabase.co',
  key: 'sb_publishable_test',
  origin: 'https://hellodoc.example',
};

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`, server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('only the public browser key is accepted; service-role credentials are refused', () => {
  assert.equal(isPublicKey('sb_publishable_test'), true);
  assert.equal(isPublicKey('sb_secret_test'), false);
  const anonJwt = `header.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.signature`;
  const serviceJwt = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  assert.equal(isPublicKey(anonJwt), true);
  assert.equal(isPublicKey(serviceJwt), false);
  assert.equal(validateConfig({ ...configured, key: 'sb_secret_test' }), false);
  assert.equal(validateConfig({ ...configured, origin: 'https://hellodoc.example/' }), false);
  assert.equal(validateConfig({ ...configured, url: 'http://example.supabase.co' }), false);
  assert.equal(validateConfig(configured), true);
});

test('unconfigured API fails closed with 503 instead of any fallback authentication', async () => {
  const app = createApp({ config: { url: '', key: '', origin: '' } });
  await withServer(app, async (origin) => {
    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), {
      status: 'unavailable',
      application: 'running',
      configuration: 'invalid',
      supabase: 'not_checked',
    });
    for (const route of ['/api/auth/login', '/api/auth/signup', '/api/auth/current-user', '/api/admin/patients']) {
      const response = await fetch(`${origin}${route}`, {
        method: route.endsWith('login') || route.endsWith('signup') ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: route.endsWith('login') || route.endsWith('signup') ? '{}' : undefined,
      });
      assert.equal(response.status, 503, route);
      assert.equal((await response.json()).code, 'CONFIGURATION_UNAVAILABLE');
    }
  });
});

test('configuration is rejected when only one Supabase variable is present', () => {
  assert.equal(validateConfig({ url: 'https://example.supabase.co', key: '', origin: 'https://hellodoc.example' }), false);
  assert.equal(validateConfig({ url: '', key: 'sb_publishable_test', origin: 'https://hellodoc.example' }), false);
  assert.equal(createApp({ config: { url: 'https://example.supabase.co', key: '', origin: 'https://hellodoc.example' } }).locals.configured, false);
});

test('cookie-authenticated mutations reject foreign origins and accept the trusted origin', async () => {
  const app = createApp({ config: configured });
  await withServer(app, async (origin) => {
    const foreign = await fetch(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'https://attacker.invalid' },
    });
    assert.equal(foreign.status, 403);
    assert.equal((await foreign.json()).message, 'Invalid origin');

    const trusted = await fetch(`${origin}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: configured.origin },
    });
    assert.notEqual(trusted.status, 403);
  });
});

test('same-host origin is trusted only for the local development entrypoint', async () => {
  const devApp = createApp({ config: configured, allowSameHostOrigin: true });
  await withServer(devApp, async (origin) => {
    const response = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Origin: origin } });
    assert.notEqual(response.status, 403);
  });
  const strictApp = createApp({ config: configured });
  await withServer(strictApp, async (origin) => {
    const response = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Origin: origin } });
    assert.equal(response.status, 403);
  });
});

test('unknown API routes return JSON 404 and never HTML', async () => {
  const app = createApp({ config: configured });
  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/does-not-exist`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /application\/json/);
  });
});

test('static dev server refuses to expose backend, tests and secret paths', async () => {
  const devApp = require('../backend/server');
  await withServer(devApp, async (origin) => {
    assert.equal((await fetch(`${origin}/`)).status, 200);
    for (const path of ['/backend/package.json', '/backend/.env', '/tests/app.test.js', '/ALGO/main.py', '/.freebuff/server.log']) {
      const response = await fetch(`${origin}${path}`);
      assert.equal(response.status, 404, path);
    }
  });
});
