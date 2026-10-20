const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const services = config.services || {};
const inService = (name, file) => path.join(root, services[name].root, file);

test('every service points at a directory that exists in the repository', () => {
  assert.ok(Object.keys(services).length >= 2, 'expected the web and backend services');
  for (const [name, service] of Object.entries(services)) {
    assert.equal(typeof service.root, 'string', `${name} needs a root`);
    assert.ok(fs.existsSync(path.join(root, service.root)), `${name} root is missing: ${service.root}`);
    assert.ok(fs.statSync(path.join(root, service.root)).isDirectory(), `${name} root is not a directory`);
  }
});

test('the backend service has a real Express entrypoint and an installable lockfile', () => {
  const backend = services.backend;
  assert.equal(backend.framework, 'express');
  assert.ok(fs.existsSync(inService('backend', backend.entrypoint)), 'entrypoint file is missing');
  // The entrypoint must export the API app; a stray script would deploy a process
  // that answers nothing.
  const entrypoint = fs.readFileSync(inService('backend', backend.entrypoint), 'utf8');
  assert.match(entrypoint, /module\.exports\s*=\s*app/, 'entrypoint must export the Express app');
  assert.match(backend.installCommand || '', /npm ci/, 'install must be reproducible from the lockfile');
  assert.ok(fs.existsSync(inService('backend', 'package-lock.json')), 'npm ci requires backend/package-lock.json');
});

test('the web service builds the static site into its own output directory', () => {
  const web = services.web;
  assert.equal(web.outputDirectory, 'dist');
  assert.equal(web.buildCommand, 'npm run build');
  const manifest = JSON.parse(fs.readFileSync(inService('web', 'package.json'), 'utf8'));
  assert.match(manifest.scripts.build, /backend\/build-static\.js/, 'the build must use the audited static builder');
  assert.ok(
    fs.existsSync(path.join(root, 'backend', 'build-static.js')),
    'the builder referenced by web/package.json must exist'
  );
  const serviceRoot = path.resolve(root, web.root);
  const output = path.resolve(serviceRoot, web.outputDirectory);
  assert.ok(
    output.startsWith(serviceRoot + path.sep),
    'the published output must stay inside the web service root'
  );
});

test('routing sends /api to the backend, everything else to the static site, and never relies on a service path', () => {
  const rewrites = config.rewrites || [];
  assert.ok(rewrites.length >= 2, 'expected an API and a catch-all rewrite');
  assert.deepEqual(rewrites.at(-1), { source: '/(.*)', destination: { service: 'web' } });
  assert.deepEqual(rewrites[0], { source: '/api/(.*)', destination: { service: 'backend' } });

  for (const rule of rewrites) {
    const destination = rule.destination;
    assert.ok(destination && services[destination.service], `rewrite targets an unknown service: ${JSON.stringify(rule)}`);
    // `path` selects an internal route without changing the path the code sees.
    // A static service has no such route table, so mapping /admin through it is
    // not verifiable here; use a redirect to a real file instead.
    assert.equal(destination.path, undefined, `rewrite must not use an unverifiable service path: ${JSON.stringify(rule)}`);
  }

  const targeted = new Set(rewrites.map((rule) => rule.destination.service));
  for (const name of Object.keys(services)) {
    assert.ok(targeted.has(name), `${name} has no public route and can never receive traffic`);
  }
});

test('the /admin URL resolves to a real public page', () => {
  const redirect = (config.redirects || []).find((rule) => rule.source === '/admin');
  assert.ok(redirect, '/admin must keep working for the post-login redirect');
  assert.equal(redirect.destination, '/admin.html');
  assert.ok(fs.existsSync(path.join(root, 'admin.html')), 'admin.html must exist to be served');
});

test('build and runtime settings live inside services, not at the top level', () => {
  const topLevelOnly = ['functions', 'buildCommand', 'installCommand', 'devCommand', 'ignoreCommand', 'outputDirectory', 'framework'];
  for (const key of topLevelOnly) {
    assert.equal(config[key], undefined, `${key} is invalid at the top level when services are used`);
  }
});

test('the backend declares the Node runtime it is tested with', () => {
  const manifest = JSON.parse(fs.readFileSync(inService('backend', 'package.json'), 'utf8'));
  assert.ok(manifest.engines && manifest.engines.node, 'backend/package.json must pin a Node engine for the deployment runtime');
  assert.match(manifest.engines.node, /2[0-9]/);
});
