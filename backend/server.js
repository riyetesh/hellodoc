require("dotenv").config();

const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn } = require("child_process");
const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const session = require("express-session");
const crypto = require("crypto");

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

// Session configuration for authenticated users
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// JWT secret for token-based authentication
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const JWT_EXPIRY = process.env.JWT_EXPIRY || "24h";

// Connection pool created lazily (mysql2 pools connect on first query), so the
// service boots on Vercel even when the database is temporarily unreachable.
// All credentials come from environment variables, never hardcode them.
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "hello_doc",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  // Set DB_SSL=true when your hosted MySQL requires TLS.
  ...(process.env.DB_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEX_VALUES = ["male", "female", "other"];

function dbError(res, err) {
  // Log the real error server-side; never leak internals to the client.
  console.error("Database error:", err.code || err.message);
  return res
    .status(503)
    .json({ message: "Database unavailable. Please try again later." });
}

const router = express.Router();

// Signup
router.post("/signup", async (req, res) => {
  const body = req.body || {};
  const firstName = (body.firstName || "").trim();
  const lastName = (body.lastName || "").trim();
  const email = (body.email || "").trim();
  const password = body.password || "";
  const dob = body.dob || "";
  const sex = body.sex || "";

  if (!firstName || !lastName || !email || !password || !dob || !sex) {
    return res.status(400).json({ message: "All fields are required" });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ message: "Please enter a valid email address" });
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ message: "Password must be at least 8 characters long" });
  }
  if (!DATE_RE.test(dob)) {
    return res.status(400).json({ message: "Date of birth must be YYYY-MM-DD" });
  }
  if (!SEX_VALUES.includes(sex)) {
    return res.status(400).json({ message: "Invalid value for sex" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql =
      "INSERT INTO users (firstName, lastName, email, password, dob, sex) VALUES (?, ?, ?, ?, ?, ?)";
    pool.query(
      sql,
      [firstName, lastName, email, hashedPassword, dob, sex],
      (err) => {
        if (err) {
          if (err.code === "ER_DUP_ENTRY") {
            return res
              .status(409)
              .json({ message: "An account with this email already exists" });
          }
          return dbError(res, err);
        }
        return res.status(201).json({ message: "Signup successful" });
      }
    );
  } catch (error) {
    console.error("Signup error:", error.message);
    return res.status(500).json({ message: "Error creating user" });
  }
});

// Login
router.post("/login", (req, res) => {
  const body = req.body || {};
  const email = (body.email || "").trim();
  const password = body.password || "";

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Email and password are required" });
  }

  pool.query(
    "SELECT id, password FROM users WHERE email = ?",
    [email],
    async (err, results) => {
      if (err) return dbError(res, err);

      // Identical message for "no user" and "wrong password" so the API
      // does not reveal which emails are registered.
      const invalidResponse = () =>
        res.status(401).json({ message: "Invalid email or password" });

      const user = results && results[0];
      if (!user) return invalidResponse();

      let match = false;
      try {
        match = await bcrypt.compare(password, user.password);
      } catch {
        match = false;
      }
      if (!match) return invalidResponse();

      // Generate JWT token for the authenticated user
      const token = jwt.sign(
        { userId: user.id, email: email },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );

      // Set session for server-side auth tracking
      req.session.userId = user.id;
      req.session.email = email;

      return res.status(200).json({
        message: "Login successful",
        userId: user.id,
        token: token
      });
    }
  );
});

// Current user endpoint - checks session first, then JWT
router.get("/current-user", (req, res) => {
  // Check session first
  if (req.session && req.session.userId) {
    return res.json({ userId: req.session.userId, email: req.session.email });
  }

  // Check Authorization header for JWT
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return res.json({ userId: decoded.userId, email: decoded.email });
    } catch {
      return res.status(401).json({ message: "Invalid or expired token" });
    }
  }

  return res.status(401).json({ message: "Not authenticated" });
});

// Own profile endpoint.
//
// The symptom-report service needs the authenticated user's own basic fields
// to render an optional patient block. This route returns ONLY the caller's
// own record, and only after the session cookie or Bearer JWT has been
// verified. It never accepts a user id from the query string, body or any
// other client-supplied value, so one account can never read another's row.
router.get("/profile", (req, res) => {
  res.set("Cache-Control", "no-store");

  // Session first (server-side, cookie is httpOnly and signed).
  let userId = req.session && req.session.userId ? req.session.userId : null;

  // Otherwise a properly verified Bearer JWT.
  if (!userId) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      try {
        const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
        userId = decoded.userId;
      } catch {
        userId = null;
      }
    }
  }

  if (!userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  pool.query(
    "SELECT id, firstName, lastName, email FROM users WHERE id = ?",
    [userId],
    (err, results) => {
      if (err) return dbError(res, err);
      const user = results && results[0];
      // The account no longer exists: do not fabricate a profile.
      if (!user) {
        return res.status(404).json({ message: "Profile not found" });
      }
      // Only the caller's own identifying fields leave the API.
      return res.json({
        userId: user.id,
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      });
    }
  );
});

// Logout endpoint - clears session
router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Logout failed" });
    }
    res.clearCookie("connect.sid");
    return res.json({ message: "Logged out successfully" });
  });
});

// Health check (useful to confirm the function is live on Vercel).
app.get(["/health", "/api/health", "/api/auth/health"], (req, res) => {
  res.json({ status: "ok" });
});

// Vercel's rewrite preserves the full path, so the same router is mounted at
// both the public /api/auth prefix and the legacy /auth prefix.
app.use("/api/auth", router);
app.use("/auth", router);

// Legacy /auth prefix is mounted in parallel with /api/auth so older clients
// or direct links using the /auth/* path still resolve the same routes.

// Locally, also serve the site's static pages from this server so the
// frontend's relative /api/... URLs resolve during development.
// On Vercel the CDN serves the static files before any function runs.
if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, ".."), { dotfiles: "ignore" }));
}

// Legacy /accounts/* paths that previously pointed at the retired
// Login-and-dashboard/New-login service now serve its static HTML pages.
// New-login's own server.js has been removed; these routes are no longer
// proxied to a separate process.
if (!process.env.VERCEL) {
  app.use("/accounts", express.static(path.join(__dirname, "..", "Login-and-dashboard", "New-login"), { dotfiles: "ignore" }));
}


// Local dev convenience: proxy the Flask symptom-checker routes to the Algo
// app so the whole site can be exercised through one origin on port 5000.
// On Vercel these paths are routed to the Flask service by vercel.json
// rewrites, and this middleware is never registered.
if (!process.env.VERCEL) {
  const http = require("http");

  const proxyRequest = (targetOrigin, req, res, offlineHint) => {
    const headers = { ...req.headers };
    delete headers.host; // let http.request derive the correct Host header
    const upstream = http.request(
      targetOrigin + req.originalUrl,
      { method: req.method, headers },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(res);
      }
    );
    upstream.on("error", () => {
      if (!res.headersSent) {
        res.status(502).json({ message: offlineHint });
      }
    });
    req.pipe(upstream);
  };

  const FLASK_ORIGIN = process.env.FLASK_ORIGIN || "http://127.0.0.1:5001";
  const flaskHint =
    "Symptom service is not running. Start everything with: ./start.sh (requires Python)";

  app.get("/predict", (req, res) => proxyRequest(FLASK_ORIGIN, req, res, flaskHint));
  app.post("/predict", (req, res) => proxyRequest(FLASK_ORIGIN, req, res, flaskHint));
  app.use("/static", (req, res) => proxyRequest(FLASK_ORIGIN, req, res, flaskHint));
}

// Local dev convenience: route the retired new-login service pages so their
// static HTML can still be opened from the same origin during development.
// The new-login service itself has been removed; these pages are served as-is.
if (!process.env.VERCEL) {
  app.use("/accounts", express.static(path.join(__dirname, "..", "Login-and-dashboard", "New-login"), { dotfiles: "ignore" }));
}

const PORT = Number(process.env.PORT) || 5000;

// ---------------------------------------------------------------------------
// Auto-start the Flask symptom service (local development only).
// ---------------------------------------------------------------------------
// Historically the symptom predictor had to be launched separately
// (`python Algo/main.py` or `./start.sh`). To make the site "just work" from a
// single command, the backend now spawns the Flask app as a child process when
// it boots, and tears it down on shutdown. On Vercel none of this runs, the
// platform routes /predict to the Algo service via vercel.json rewrites.
const FLASK_PORT = Number(process.env.FLASK_PORT) || 5001;
let flaskChild = null;
let flaskShuttingDown = false;

function resolvePythonCommand() {
  // Prefer an absolute path into a local virtualenv so we don't depend on the
  // caller's PATH or an activated venv. Windows uses Scripts/, POSIX uses bin/.
  const isWin = process.platform === "win32";
  const venvPython = path.join(
    __dirname,
    "..",
    "venv",
    isWin ? "Scripts" : "bin",
    isWin ? "python.exe" : "python3"
  );
  if (fs.existsSync(venvPython)) {
    return { command: venvPython, args: [] };
  }
  // Fall back to a system interpreter. `py` is the Windows launcher.
  return { command: isWin ? "py" : "python3", args: [] };
}

function startFlaskService() {
  // Only auto-start when running locally as a real process (not on Vercel),
  // and allow opting out with FLASK_AUTOSTART=false.
  if (process.env.VERCEL) return;
  if (process.env.FLASK_AUTOSTART === "false") return;

  // If something is already listening on the Flask port (e.g. the developer
  // launched it manually, or start.sh did), don't spawn a duplicate.
  isPortInUse(FLASK_PORT, (inUse) => {
    if (inUse) {
      console.log(`[autostart] Symptom service already running on port ${FLASK_PORT}.`);
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
          // Single process (no Werkzeug reloader) so we can kill it cleanly.
          FLASK_NO_RELOADER: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      console.warn(`[autostart] Could not start symptom service: ${err.message}`);
      console.warn(
        "[autostart] /predict will return 502. Install Python 3.8+ and requirements.txt, or set FLASK_AUTOSTART=false."
      );
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
      console.warn(
        "[autostart] /predict will return 502. Ensure Python 3.8+ is installed and requirements.txt is satisfied."
      );
      flaskChild = null;
    });

    flaskChild.on("exit", (code, signal) => {
      flaskChild = null;
      if (!flaskShuttingDown) {
        console.warn(
          `[autostart] Symptom service exited unexpectedly (code=${code}, signal=${signal}).`
        );
      }
    });

    console.log(
      `[autostart] Starting symptom service on port ${FLASK_PORT} (pid ${flaskChild.pid})…`
    );
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
  app.listen(PORT, () => {
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

// Vercel detects the Express app via this export (entrypoint: server.js).
module.exports = app;
