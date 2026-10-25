require("dotenv").config();

// Local development entrypoint: the Supabase-only API from app.js plus the
// static HelloDoc pages it serves, and (optionally) the private Flask model.
// Account data, sessions and roles come exclusively from Supabase.
const path = require("path");
const fs = require("fs");
const net = require("net");
const crypto = require("crypto");
const express = require("express");
const { spawn } = require("child_process");
const { createApp } = require("./app");

// Same-origin localhost is trusted in development so another local port works;
// APP_ORIGIN still authorizes any other origin.
const app = createApp({ allowSameHostOrigin: process.env.NODE_ENV !== "production" });

if (!app.locals.configured) {
  console.warn(
    "[config] Supabase is not configured. Pages are served, but every /api request returns 503.\n" +
      "[config] Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (public key only) in backend/.env."
  );
}

// Admin document contains no private data; every data/action request is authorized separately.
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "..", "admin.html")));

// Locally, also serve the site's static pages from this server so the
// frontend's relative /api/... URLs resolve during development.
// On Vercel the CDN serves the static files before any function runs.
if (!process.env.VERCEL) {
  const publicRoot = path.join(__dirname, "..");
  app.use((req, res, next) => {
    const pathname = req.path;
    if (
      /^\/(?:backend|tests|venv|\.venv|Algo|chatbot|dist|web)(?:\/|$)/i.test(pathname) ||
      /\.(?:json|lock|md|txt|toml|sh|bat|log|env|py|sql)$/i.test(pathname) ||
      /(?:^|\/)\../.test(pathname)
    ) {
      return res.status(404).end();
    }
    next();
  });
  app.use(express.static(publicRoot, { dotfiles: "ignore", index: "index.html" }));
}

// The legacy public predictor is closed; doctor-only prediction uses the
// verified appointment API and Flask's internal token-protected endpoint.
app.all("/predict", (req, res) =>
  res.status(403).json({ message: "Symptom checks are available only in the approved doctor workflow." })
);
app.use("/static", (req, res) => res.status(403).end());


const PORT = Number(process.env.PORT) || 5000;

// ---------------------------------------------------------------------------
// Auto-start the Flask symptom service (local development only).
// ---------------------------------------------------------------------------
// In local development the backend starts the private model process once.
// Vercel runs separate functions; its Flask service must be configured there.
const FLASK_PORT = Number(process.env.FLASK_PORT) || 5001;
let flaskChild = null;
let flaskShuttingDown = false;

function resolvePythonCommand() {
  // Prefer an absolute path into a local virtualenv so we don't depend on the
  // caller's PATH or an activated venv. Windows uses Scripts/, POSIX uses bin/.
  const isWin = process.platform === "win32";
  for (const directory of [path.join("Algo", ".venv"), ".venv", "venv"]) {
    const venvPython = path.join(
      __dirname,
      "..",
      directory,
      isWin ? "Scripts" : "bin",
      isWin ? "python.exe" : "python"
    );
    if (fs.existsSync(venvPython)) return { command: venvPython, args: [] };
  }
  // Fall back to a system interpreter (Windows installations commonly expose python, not py).
  return { command: isWin ? "python" : "python3", args: [] };
}

function startFlaskService() {
  // Only auto-start when running locally as a real process (not on Vercel),
  // and allow opting out with FLASK_AUTOSTART=false.
  if (process.env.VERCEL || process.env.FLASK_AUTOSTART === "false" || process.env.FLASK_ORIGIN) return;
  if (!process.env.PREDICTION_INTERNAL_TOKEN) {
    process.env.PREDICTION_INTERNAL_TOKEN = crypto.randomBytes(32).toString("hex");
  }

  // Don't spawn a second process when the port is already occupied.
  isPortInUse(FLASK_PORT, (inUse) => {
    if (inUse) {
      console.warn(`[autostart] Port ${FLASK_PORT} is occupied. Set FLASK_PORT to a free port to start the private model.`);
      return;
    }

    const { command, args } = resolvePythonCommand();
    const scriptPath = path.join(__dirname, "..", "Algo", "main.py");

    try {
      flaskChild = spawn(command, [...args, scriptPath], {
        cwd: path.join(__dirname, "..", "Algo"),
        env: {
          ...process.env,
          FLASK_PORT: String(FLASK_PORT),
          // Single process (no Werkzeug reloader) so we can kill it cleanly, and
          // never the interactive debugger: this service holds the model and a
          // shared internal token.
          FLASK_NO_RELOADER: "1",
          FLASK_DEBUG: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      console.warn(`[autostart] Could not start symptom service: ${err.message}`);
      console.warn("[autostart] Doctor-only model unavailable. Install Python and requirements.txt to enable it.");
      return;
    }

    flaskChild.stdout.on("data", (data) => {
      process.stdout.write(`[flask] ${data}`);
    });
    flaskChild.stderr.on("data", (data) => {
      process.stderr.write(`[flask] ${data}`);
    });

    flaskChild.on("error", (err) => {
      console.warn(`[autostart] Failed to launch symptom service: ${err.message}`);
      console.warn("[autostart] Doctor-only model unavailable. Check Python and requirements.txt.");
      flaskChild = null;
    });

    flaskChild.on("exit", (code, signal) => {
      flaskChild = null;
      if (!flaskShuttingDown) {
        console.warn(`[autostart] Symptom service exited unexpectedly (code=${code}, signal=${signal}).`);
      }
    });

    console.log(`[autostart] Starting symptom service on port ${FLASK_PORT} (pid ${flaskChild.pid})…`);
  });
}

function isPortInUse(port, callback) {
  const socket = net.connect({ port, host: "127.0.0.1" }, () => {
    socket.destroy();
    callback(true);
  });
  socket.on("error", () => callback(false));
  socket.setTimeout(1000, () => {
    socket.destroy();
    callback(false);
  });
}

function stopFlaskService() {
  flaskShuttingDown = true;
  if (flaskChild) {
    try {
      flaskChild.kill();
    } catch {
      /* ignore */
    }
    flaskChild = null;
  }
}

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startFlaskService();
  });

  // Tear the child down on normal exit and on interrupts so we don't leave an
  // orphaned Python process holding port 5001.
  process.on("exit", stopFlaskService);
  process.on("SIGINT", () => {
    stopFlaskService();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopFlaskService();
    process.exit(0);
  });
}

module.exports = app;
