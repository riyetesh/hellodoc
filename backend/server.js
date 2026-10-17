require("dotenv").config();

const path = require("path");
const fs = require("fs");
const net = require("net");
const { spawn } = require("child_process");
const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const session = require("express-session");
const crypto = require("crypto");
const { withTransaction, run } = require("./transaction");

const app = express();

if (process.env.NODE_ENV === "production" && !process.env.APP_ORIGIN) {
  throw new Error("APP_ORIGIN is required in production");
}
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("X-Frame-Options", "DENY");
  res.set("Content-Security-Policy", "frame-ancestors 'none'");
  next();
});
app.use(cors({ origin: false }));
app.use(express.json({ limit: "16kb" }));
app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  const allowed = process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
  if (origin && origin !== allowed && !(process.env.NODE_ENV !== "production" && origin === `${req.protocol}://${req.get("host")}`)) return res.status(403).json({ message: "Invalid origin" });
  if (!origin && req.get("sec-fetch-site") === "cross-site") return res.status(403).json({ message: "Invalid origin" });
  // Browser mutations must be same-origin; non-browser clients must supply the
  // configured origin. Reject absent headers instead of trusting a forged Host.
  if (!origin && req.get("sec-fetch-site") !== "same-origin") return res.status(403).json({ message: "Origin required" });
  next();
});

if (Boolean(process.env.SUPABASE_URL) !== Boolean(process.env.SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error('Both Supabase URL and publishable key must be configured together');
}
if (process.env.NODE_ENV === 'production' && (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error('Supabase credentials required in production; legacy MySQL mode is local-only');
}
if (process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY) {
  app.use('/api', require('./supabase-routes')({}));
} else {
// Legacy MySQL mode: disabled entirely when Supabase is configured.
// Session configuration for authenticated users
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));


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
  timezone: 'Z',
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
// Small per-process throttle for credential endpoints; use a shared store for multi-instance deployments.
const authAttempts = new Map();
function throttle(req, res, next) {
  const key = req.ip + ':' + req.path;
  const now = Date.now();
  const entry = authAttempts.get(key);
  const current = entry && entry.until > now ? entry : { count: 0, until: now + 15 * 60 * 1000 };
  if (current.count >= 20) return res.status(429).json({ message: "Too many attempts; try again later" });
  current.count++;
  authAttempts.set(key, current);
  if (authAttempts.size > 10000) {
    for (const [item, value] of authAttempts) if (value.until <= now) authAttempts.delete(item);
    if (authAttempts.size > 10000) authAttempts.delete(authAttempts.keys().next().value);
  }
  next();
}
router.use(["/login", "/signup"], throttle);

// Signup
router.post("/signup", async (req, res) => {
  const body = req.body || {};
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = body.password || "";
  const dob = body.dob || "";
  const sex = body.sex || "";

  if (body.role !== undefined && body.role !== "patient") {
    return res.status(403).json({ message: "Roles cannot be assigned at registration" });
  }
  if (!firstName || !lastName || !email || !password || !dob || !sex) {
    return res.status(400).json({ message: "All fields are required" });
  }
  if (firstName.length > 100 || lastName.length > 100 || email.length > 254 || typeof password !== "string" || typeof dob !== "string" || typeof sex !== "string" || password.length > 1024) {
    return res.status(400).json({ message: "Invalid account details" });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ message: "Please enter a valid email address" });
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ message: "Password must be at least 8 characters long" });
  }
  if (!DATE_RE.test(dob) || Number.isNaN(Date.parse(dob)) || dob > new Date().toISOString().slice(0, 10)) {
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
          if (err.code === "ER_ACCESS_DENIED_ERROR") {
            console.error("Signup database connection failed:", err.code);
            return res.status(503).json({ message: "Patient signup is unavailable: the local MySQL database rejected the configured credentials. Check the backend DB settings." });
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
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = body.password || "";

  if (typeof email !== "string" || typeof password !== "string" || email.length > 254 || password.length > 1024 || !email || !password) {
    return res
      .status(400)
      .json({ message: "Email and password are required" });
  }

  pool.query(
    "SELECT id, password, role FROM users WHERE email = ?",
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

      // Set session for server-side auth tracking
      req.session.regenerate((sessionError) => {
        if (sessionError) return res.status(500).json({ message: "Login failed" });
        req.session.userId = user.id;
        req.session.email = email;
        return res.status(200).json({
          message: "Login successful", userId: user.id, role: user.role
        });
      });
    }
  );
});

// Current user endpoint uses the signed server session.
router.get("/current-user", (req, res) => {
  // Resolve current role from the database; never trust a role from the browser or token.
  resolveIdentity(req, res, (user) => res.json({ userId: user.id, email: user.email, role: user.role, user: { firstName: user.firstName } }));
});

function identityId(req) {
  return req.session && req.session.userId || null;
}

function resolveIdentity(req, res, next) {
  res.set("Cache-Control", "private, no-store");
  const id = identityId(req);
  if (!id) return res.status(401).json({ message: "Not authenticated" });
  pool.query("SELECT id, email, firstName, lastName, role FROM users WHERE id = ?", [id], (err, rows) => {
    if (err) return dbError(res, err);
    if (!rows || !rows[0]) return res.status(401).json({ message: "Not authenticated" });
    next(rows[0]);
  });
}

function patient(req, res, next) {
  resolveIdentity(req, res, (user) => user.role === "patient" ? next(user) : res.status(403).json({ message: "Patient access required" }));
}

function verifiedDoctor(req, res, next) {
  resolveIdentity(req, res, (user) => {
    if (user.role !== "doctor") return res.status(403).json({ message: "Doctor access required" });
    pool.query("SELECT verification_status FROM doctor_profiles WHERE user_id = ?", [user.id], (err, rows) => {
      if (err) return dbError(res, err);
      if (rows?.[0]?.verification_status !== "approved") return res.status(403).json({ message: "Doctor approval required" });
      next(user);
    });
  });
}

// Own profile endpoint.
//
// The symptom-report service needs the authenticated user's own basic fields
// to render an optional patient block. This route returns ONLY the caller's
// own record, and only after the session cookie has been verified. It never accepts a user id from the query string, body or any
// other client-supplied value, so one account can never read another's row.
router.get("/profile", (req, res) => {
  res.set("Cache-Control", "no-store");

  const userId = identityId(req);

  if (!userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }  pool.query("SELECT id, firstName, lastName, email FROM users WHERE id = ? AND role = 'patient'",
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
  if (!identityId(req)) return res.status(401).json({ message: "Not authenticated" });
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: "Logout failed" });
    }
    res.clearCookie("connect.sid", { sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    return res.json({ message: "Logged out successfully" });
  });
});

// Patient records are always scoped to the identity resolved server-side.
const care = express.Router();
const positiveId = (value) => /^[1-9]\d*$/.test(String(value || ""));
const text = (value, max = 2000) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

care.get("/doctors", (req, res) => {
  pool.query(`SELECT d.user_id AS id, CONCAT(u.firstName, ' ', u.lastName) AS name,
    d.specialty, d.language, d.consultation_type AS consultationType, d.fee,
    (SELECT DATE_FORMAT(MIN(v.starts_at), '%Y-%m-%dT%H:%i:00') FROM doctor_availability v WHERE v.doctor_id = d.user_id AND v.starts_at > NOW() AND NOT EXISTS (SELECT 1 FROM doctor_time_off l WHERE l.doctor_id = v.doctor_id AND l.starts_at < v.ends_at AND l.ends_at > v.starts_at) AND NOT EXISTS
      (SELECT 1 FROM appointments a WHERE a.doctor_id = v.doctor_id AND a.starts_at = v.starts_at AND a.status <> 'cancelled')) AS nextSlot
    FROM doctor_profiles d JOIN users u ON u.id = d.user_id
    WHERE d.verification_status = 'approved' AND u.role = 'doctor'`, (err, rows) => err ? dbError(res, err) : res.json(rows));
});

care.get("/patient/overview", (req, res) => patient(req, res, (user) => {
  pool.query(`SELECT a.id, a.starts_at AS startsAt, a.status, a.reason,
    CONCAT(u.firstName, ' ', u.lastName) AS doctorName, d.specialty
    FROM appointments a JOIN users u ON u.id = a.doctor_id JOIN doctor_profiles d ON d.user_id = a.doctor_id
    WHERE a.patient_id = ? ORDER BY a.starts_at DESC`, [user.id], (err, appointments) => {
    if (err) return dbError(res, err);
    pool.query("SELECT id, symptoms, duration, created_at AS createdAt FROM symptom_submissions WHERE patient_id = ? ORDER BY created_at DESC", [user.id], (symptomError, symptoms) => {
      if (symptomError) return dbError(res, symptomError);
      pool.query(`SELECT c.id, c.advice, c.follow_up AS followUp, c.published_at AS publishedAt,
        CONCAT(u.firstName, ' ', u.lastName) AS author
        FROM care_plans c JOIN appointments a ON a.id = c.appointment_id JOIN users u ON u.id = c.doctor_id
        WHERE a.patient_id = ? AND c.published_at IS NOT NULL ORDER BY c.published_at DESC`, [user.id], (planError, plans) => {
        if (planError) return dbError(res, planError);
        pool.query(`SELECT p.id, p.medication, p.instructions, p.status, p.published_at AS publishedAt,
          CONCAT(u.firstName, ' ', u.lastName) AS prescriber FROM prescriptions p
          JOIN appointments a ON a.id = p.appointment_id JOIN users u ON u.id = p.doctor_id
          WHERE a.patient_id = ? AND p.published_at IS NOT NULL ORDER BY p.published_at DESC`, [user.id], (rxError, prescriptions) => {
          if (rxError) return dbError(res, rxError);
          pool.query(`SELECT c.id, c.assessment, c.created_at AS createdAt,
            CONCAT(u.firstName, ' ', u.lastName) AS author FROM clinical_assessments c
            JOIN appointments a ON a.id = c.appointment_id JOIN users u ON u.id = c.doctor_id
            WHERE a.patient_id = ? AND c.published_at IS NOT NULL ORDER BY c.created_at DESC`, [user.id], (assessmentError, assessments) => {
            if (assessmentError) return dbError(res, assessmentError);
            pool.query("SELECT id, message, read_at AS readAt, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50", [user.id], (noteError, notifications) => {
              if (noteError) return dbError(res, noteError);
              res.json({ profile: { firstName: user.firstName, lastName: user.lastName, email: user.email }, appointments, symptoms, assessments, carePlans: plans, prescriptions, notifications });
            });
          });
        });
      });
    });
  });
}));

care.patch("/patient/notifications/:id/read", (req, res) => patient(req, res, (user) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ message: "Invalid notification" });
  pool.query("UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND user_id = ?", [req.params.id, user.id], (err, result) => {
    if (err) return dbError(res, err);
    return result.affectedRows ? res.json({ status: "read" }) : res.status(404).json({ message: "Notification not found" });
  });
}));

care.get("/doctors/:id/slots", (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ message: "Invalid doctor" });
  pool.query(`SELECT DATE_FORMAT(v.starts_at, '%Y-%m-%dT%H:%i:00') AS startsAt FROM doctor_availability v
    JOIN doctor_profiles d ON d.user_id = v.doctor_id WHERE v.doctor_id = ?
    AND d.verification_status = 'approved' AND v.starts_at > NOW() AND NOT EXISTS (SELECT 1 FROM doctor_time_off l WHERE l.doctor_id = v.doctor_id AND l.starts_at < v.ends_at AND l.ends_at > v.starts_at) AND NOT EXISTS
    (SELECT 1 FROM appointments a WHERE a.doctor_id = v.doctor_id AND a.starts_at = v.starts_at AND a.status <> 'cancelled')
    ORDER BY v.starts_at LIMIT 100`, [req.params.id], (err, rows) => err ? dbError(res, err) : res.json(rows));
});

care.post("/patient/appointments", (req, res) => patient(req, res, (user) => {
  const { doctorId, startsAt, reason = "" } = req.body || {};
  if (!positiveId(doctorId) || !text(startsAt, 30) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(startsAt) || Number.isNaN(Date.parse(startsAt)) || new Date(startsAt) <= new Date() || typeof reason !== "string" || reason.length > 500) {
    return res.status(400).json({ message: "Invalid appointment details" });
  }
  withTransaction(pool, async (conn) => {
    const doctors = await run(conn, "SELECT user_id FROM doctor_profiles WHERE user_id = ? AND verification_status = 'approved' FOR UPDATE", [doctorId]);
    if (!doctors.length) return { unavailable: true };
    const result = await run(conn, `INSERT INTO appointments (patient_id, doctor_id, starts_at, reason)
      SELECT ?, v.doctor_id, v.starts_at, ? FROM doctor_availability v
      WHERE v.doctor_id = ? AND v.starts_at = ? AND v.starts_at > NOW() AND NOT EXISTS (SELECT 1 FROM doctor_time_off l WHERE l.doctor_id = v.doctor_id AND l.starts_at < v.ends_at AND l.ends_at > v.starts_at) AND NOT EXISTS
      (SELECT 1 FROM appointments a WHERE a.doctor_id = v.doctor_id AND a.starts_at = v.starts_at AND a.status <> 'cancelled')`,
      [user.id, reason.trim(), doctorId, startsAt.replace("T", " ")]);
    if (!result.affectedRows) return { unavailable: true };
    await run(conn, "INSERT INTO notifications (user_id, message) VALUES (?, ?), (?, ?)", [doctorId, "New appointment request. Open your workspace to review it.", user.id, "Appointment requested. Check your appointments for updates."]);
    return { id: result.insertId };
  }).then((result) => result.unavailable ? res.status(409).json({ message: "This slot is no longer available" }) : res.status(201).json({ id: result.id, status: "pending" }))
    .catch((err) => err.code === "ER_DUP_ENTRY" ? res.status(409).json({ message: "This slot is no longer available" }) : dbError(res, err));
}));

care.patch("/patient/appointments/:id/cancel", (req, res) => patient(req, res, (user) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ message: "Invalid appointment" });
  withTransaction(pool, async (conn) => {
    const visits = await run(conn, "SELECT doctor_id FROM appointments WHERE id = ? AND patient_id = ? AND status IN ('pending','upcoming','rescheduled') FOR UPDATE", [req.params.id, user.id]);
    if (!visits.length) return false;
    await run(conn, "UPDATE appointments SET status = 'cancelled' WHERE id = ? AND patient_id = ?", [req.params.id, user.id]);
    await run(conn, "INSERT INTO notifications (user_id, message) VALUES (?, ?), (?, ?)", [visits[0].doctor_id, "An appointment was cancelled. Review your schedule.", user.id, "Your appointment was cancelled."]);
    return true;
  }).then((updated) => updated ? res.json({ status: "cancelled" }) : res.status(404).json({ message: "Appointment not found" })).catch((err) => dbError(res, err));
}));

care.post("/patient/symptoms", (req, res) => patient(req, res, (user) => {
  const { symptoms, duration, history = "", medications = "", allergies = "", notes = "", appointmentId = null } = req.body || {};
  if (!text(symptoms) || !text(duration, 120) || [history, medications, allergies, notes].some((v) => typeof v !== "string" || v.length > 2000) || (appointmentId !== null && !positiveId(appointmentId))) {
    return res.status(400).json({ message: "Invalid questionnaire" });
  }
  withTransaction(pool, async (conn) => {
    let doctorId = null;
    if (appointmentId !== null) {
      const visits = await run(conn, "SELECT doctor_id FROM appointments WHERE id = ? AND patient_id = ? AND status IN ('pending','upcoming','rescheduled') FOR UPDATE", [appointmentId, user.id]);
      if (!visits.length) return null;
      doctorId = visits[0].doctor_id;
    }
    const result = await run(conn, `INSERT INTO symptom_submissions (patient_id, appointment_id, symptoms, duration, history, medications, allergies, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [user.id, appointmentId, symptoms.trim(), duration.trim(), history.trim(), medications.trim(), allergies.trim(), notes.trim()]);
    if (doctorId) await run(conn, "INSERT INTO notifications (user_id, message) VALUES (?, ?)", [doctorId, "New symptom questionnaire for an assigned visit. Review it in your workspace."]);
    return result.insertId;
  }).then((id) => id ? res.status(201).json({ id }) : res.status(404).json({ message: "Appointment not found" })).catch((err) => dbError(res, err));
}));

app.use("/api", care);
app.post("/api/doctor/apply", (req, res) => res.status(503).json({ message: "Doctor applications require the Supabase backend and its reviewed database migration. This local MySQL backend cannot accept applications." }));
app.use("/api/doctor", require("./doctor-routes")({ pool, verifiedDoctor, dbError }));
app.use("/api/auth", router);
app.use("/auth", router);
} // end legacy MySQL mode

// Admin document contains no private data; every data/action request is authorized separately.
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin.html')));

// Health check (useful to confirm the function is live on Vercel).
app.get(["/health", "/api/health", "/api/auth/health"], (req, res) => {
  res.json({ status: "ok" });
});

// Vercel's rewrite preserves the full path, so the same router is mounted at
// both the public /api/auth prefix and the legacy /auth prefix.

// Legacy /auth prefix is mounted in parallel with /api/auth so older clients
// or direct links using the /auth/* path still resolve the same routes.

// Locally, also serve the site's static pages from this server so the
// frontend's relative /api/... URLs resolve during development.
// On Vercel the CDN serves the static files before any function runs.
if (!process.env.VERCEL) {
  const publicRoot = path.join(__dirname, "..");
  app.use((req, res, next) => {
    const pathname = req.path;
    if (/^\/(?:backend|tests|venv|Algo|chatbot|child_process|\.freebuff|Login-and-dashboard|Login and dashboard)(?:\/|$)/i.test(pathname) || /(?:^|\/)\./.test(pathname)) {
      return res.status(404).end();
    }
    next();
  });
  app.use(express.static(publicRoot, { dotfiles: "ignore", index: "index.html" }));
}

// The legacy public predictor is closed; doctor-only prediction uses the
// verified appointment API and Flask's internal token-protected endpoint.
app.all("/predict", (req, res) => res.status(403).json({ message: "Symptom checks are available only in the approved doctor workflow." }));
app.use("/static", (req, res) => res.status(403).end());

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
    const venvPython = path.join(__dirname, "..", directory, isWin ? "Scripts" : "bin", isWin ? "python.exe" : "python");
    if (fs.existsSync(venvPython)) return { command: venvPython, args: [] };
  }
  // Fall back to a system interpreter (Windows installations commonly expose python, not py).
  return { command: isWin ? "python" : "python3", args: [] };
}

function startFlaskService() {
  // Only auto-start when running locally as a real process (not on Vercel),
  // and allow opting out with FLASK_AUTOSTART=false.
  if (process.env.VERCEL || process.env.FLASK_AUTOSTART === "false" || process.env.FLASK_ORIGIN) return;
  if (!process.env.PREDICTION_INTERNAL_TOKEN) process.env.PREDICTION_INTERNAL_TOKEN = crypto.randomBytes(32).toString('hex');

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
          // Single process (no Werkzeug reloader) so we can kill it cleanly.
          FLASK_NO_RELOADER: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      console.warn(`[autostart] Could not start symptom service: ${err.message}`);
      console.warn(
        "[autostart] Doctor-only model unavailable. Install Python and requirements.txt to enable it."
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
        "[autostart] Doctor-only model unavailable. Check Python and requirements.txt."
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
  app.listen(PORT, '0.0.0.0', () => {
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
