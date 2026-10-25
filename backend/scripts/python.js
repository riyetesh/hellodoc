#!/usr/bin/env node
"use strict";

/*
 * Runs `python -m pytest ...` with the first usable interpreter:
 * .venv, Algo/.venv, then python3/python on PATH.
 *
 * The project keeps its virtualenv in one of those two places, and a bare
 * `python` command is not guaranteed to exist on POSIX or on Windows. All
 * arguments are forwarded to pytest, and its exit code is preserved.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const isWindows = process.platform === "win32";
const venvPython = (dir) =>
  path.join(root, dir, isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");

const candidates = [venvPython(".venv"), venvPython(path.join("Algo", ".venv"))]
  .filter((candidate) => fs.existsSync(candidate))
  .concat(isWindows ? ["python", "py"] : ["python3", "python"]);

for (const command of candidates) {
  const probe = spawnSync(command, ["-m", "pytest", "--version"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) continue;
  const run = spawnSync(command, ["-m", "pytest", ...process.argv.slice(2)], {
    cwd: root,
    stdio: "inherit",
  });
  if (run.error) {
    console.error(`Could not run ${command} -m pytest: ${run.error.message}`);
    process.exit(1);
  }
  process.exit(run.status === null ? 1 : run.status);
}

console.error(
  "No Python interpreter found. Create Algo/.venv and install requirements-dev.txt, " +
    "or put python3/python on PATH."
);
process.exit(127);
