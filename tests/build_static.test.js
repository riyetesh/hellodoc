const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

test('the static build contains required public files and no private source', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'hellodoc-static-'));
  try {
    // Simulate a dirty previous build: the new build must remove leftovers.
    fs.writeFileSync(path.join(output, 'stale-secret.txt'), 'must not survive');

    const run = spawnSync(process.execPath, [path.join(root, 'backend', 'build-static.js'), output], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const required = [
      'index.html', 'login.html', 'signup.html', 'recover.html', 'doctor.html',
      'prediction.html', 'patient.html', 'admin.html', 'appointments.html',
      'dashboard.html', 'help.html', 'story.html',
      'Styles/app.css', 'Scripts/nav.js', 'Asset/favicon.svg',
    ];
    for (const relative of required) {
      assert.ok(fs.existsSync(path.join(output, relative)), `missing ${relative}`);
    }
    assert.equal(fs.existsSync(path.join(output, 'stale-secret.txt')), false);

    // Every link, script, stylesheet, image and CSS url() that is served from
    // the deployment must exist in the built output, not just in the source
    // tree, because the static service only ever sees the build directory.
    const missing = [];
    const resolve = (from, reference) => {
      const clean = reference.split('#')[0].split('?')[0];
      if (!clean) return null;
      if (clean.startsWith('/')) return path.join(output, clean.slice(1));
      return path.resolve(path.dirname(path.join(output, from)), clean);
    };
    for (const relative of walk(output).map((file) => path.relative(output, file))) {
      if (/\.html$/i.test(relative)) {
        const html = fs.readFileSync(path.join(output, relative), 'utf8');
        for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
          const reference = match[1];
          if (reference.startsWith('//')) continue;
          if (/^(?:https?:|mailto:|tel:|data:|#)/.test(reference)) continue;
          if (reference.startsWith('/api/')) continue;
          const target = resolve(relative, reference);
          if (target && !fs.existsSync(target)) missing.push(`${relative} -> ${reference}`);
        }
      }
      if (/\.css$/i.test(relative)) {
        const css = fs.readFileSync(path.join(output, relative), 'utf8');
        for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
          const reference = match[1].trim().replace(/^["']|["']$/g, '');
          if (/^(?:data:|https?:)/.test(reference)) continue;
          const target = resolve(relative, reference);
          if (target && !fs.existsSync(target)) missing.push(`${relative} -> ${reference}`);
        }
      }
    }
    assert.deepEqual(missing, [], `references missing from the built output:\n${missing.join('\n')}`);

    const files = walk(output).map((file) => path.relative(output, file));
    for (const file of files) {
      assert.ok(!file.startsWith('backend' + path.sep), `backend source copied: ${file}`);
      assert.ok(!file.startsWith('tests' + path.sep), `tests copied: ${file}`);
      assert.ok(!file.startsWith('node_modules' + path.sep), `dependencies copied: ${file}`);
      assert.ok(!file.startsWith('Waiting page' + path.sep), `unrelated app copied: ${file}`);
      assert.ok(!/(?:^|[\\/])\.env(?:\.|$)/.test(file), `.env copied: ${file}`);
      assert.ok(!/(?:^|[\\/])(?:server|production|build-static|model-client|report-pdf)\.js$/.test(file), `backend script copied: ${file}`);
    }

    const publicText = files
      .filter((file) => /\.(?:html|js|css|svg|json)$/i.test(file))
      .map((file) => fs.readFileSync(path.join(output, file), 'utf8'))
      .join('\n');
    for (const marker of ['SUPABASE_SERVICE_ROLE_KEY', 'PREDICTION_INTERNAL_TOKEN', 'SUPABASE_SECRET_KEY', 'sb_secret_']) {
      assert.equal(publicText.includes(marker), false, `secret marker exposed: ${marker}`);
    }
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
