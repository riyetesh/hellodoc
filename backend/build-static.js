const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const output = process.argv[2]
  ? path.resolve(root, process.argv[2])
  : path.join(root, 'dist');

// This script deletes and recreates its output directory. Refuse a path that is
// the repository itself (or one of its ancestors), which would delete source.
if (output === root || root.startsWith(output + path.sep)) {
  throw new Error(`Refusing to use ${output} as the static output directory`);
}

// An explicit allowlist, not "every .html in the repository": a future private
// or half-finished page must never become public just because of where it lives.
const PAGES = [
  'index.html',
  'login.html',
  'signup.html',
  'recover.html',
  'doctor.html',
  'doctor-apply.html',
  'doctor-portal.html',
  'prediction.html',
  'patient.html',
  'admin.html',
  'appointments.html',
  'dashboard.html',
  'help.html',
  'story.html',
];
const ASSET_DIRECTORIES = ['Styles', 'Scripts', 'Asset', 'images'];
const REQUIRED_ASSETS = [
  'Styles/app.css',
  'Scripts/nav.js',
  'Asset/favicon.svg',
];

// A build must be reproducible: remove files left by an earlier build so a
// deleted source file cannot remain publicly served.
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const shouldCopy = (src) => {
  const base = path.basename(src);
  if (base.startsWith('.') || base === 'node_modules') return false;
  // Directories are filtered by name by the caller; for files, publish web
  // assets only (never source maps, docs, logs, keys or env files).
  if (fs.statSync(src).isFile() && /\.(?:md|map|log|env|pem|key|p12)$/i.test(base)) return false;
  return true;
};

for (const page of PAGES) {
  const source = path.join(root, page);
  if (!fs.existsSync(source)) throw new Error(`Missing public page: ${page}`);
  fs.copyFileSync(source, path.join(output, page));
}

for (const directory of ASSET_DIRECTORIES) {
  const source = path.join(root, directory);
  if (!fs.existsSync(source)) throw new Error(`Missing public asset directory: ${directory}`);
  fs.cpSync(source, path.join(output, directory), { recursive: true, filter: shouldCopy });
}

for (const relative of [...PAGES, ...REQUIRED_ASSETS]) {
  if (!fs.existsSync(path.join(output, relative))) {
    throw new Error(`Static build is missing required file: ${relative}`);
  }
}

// These must never be part of the public deployment, even if a future change
// widens the allowlist.
const FORBIDDEN_TOP_LEVEL = ['backend', 'tests', 'Algo', 'node_modules', 'Waiting page', 'web', 'chatbot', 'child_process'];
for (const entry of fs.readdirSync(output)) {
  if (FORBIDDEN_TOP_LEVEL.includes(entry) || entry.startsWith('.env')) {
    throw new Error(`Static build contains a private path: ${entry}`);
  }
}

console.log(`Static HelloDoc pages built to ${path.relative(root, output) || output}; backend, secrets and experimental models excluded.`);
