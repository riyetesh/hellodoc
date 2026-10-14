require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(bodyParser.json());

// Lazy pool: connections open on first query so the function can boot on
// Vercel even if the database is briefly unreachable. Credentials come from
// environment variables — never hardcode them.
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "user_accounts",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  ...(process.env.DB_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEX_VALUES = ["male", "female", "other"];

function dbError(res, err) {
  console.error("Database error:", err.code || err.message);
  return res
    .status(503)
    .json({ message: "Database unavailable. Please try again later." });
}

// Constant-time compare used only for legacy rows that still store a
// plaintext password (see verifyPassword below).
function legacyMatch(plain, stored) {
  const a = Buffer.from(String(plain));
  const b = Buffer.from(String(stored));
  if (a.length !== b.length) {
    // Still perform a comparison to keep timing uniform.
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// Supports bcrypt hashes (current) and legacy plaintext rows so no existing
// user is locked out; successful legacy logins are upgraded to bcrypt below.
async function verifyPassword(plain, stored) {
  if (typeof stored === "string" && stored.startsWith("$2")) {
    return bcrypt.compare(plain, stored);
  }
  return legacyMatch(plain, stored);
}

// Signup
app.post(["/signup", "/accounts/signup", "/api/auth/signup"], async (req, res) => {
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
    const sql = `INSERT INTO users (first_name, last_name, email, password, dob, sex)
                 VALUES (?, ?, ?, ?, ?, ?)`;
    pool.query(
      sql,
      [firstName, lastName, email, hashedPassword, dob, sex],
      (err, result) => {
        if (err) {
          if (err.code === "ER_DUP_ENTRY") {
            return res.status(409).json({ message: "Email already exists" });
          }
          return dbError(res, err);
        }
        return res.json({ message: "Signup successful!", userId: result.insertId });
      }
    );
  } catch (error) {
    console.error("Signup error:", error.message);
    return res.status(500).json({ message: "Error saving user" });
  }
});

// Login
app.post(["/login", "/accounts/login", "/api/auth/login"], (req, res) => {
  const body = req.body || {};
  const email = (body.email || "").trim();
  const password = body.password || "";

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  pool.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
    if (err) return dbError(res, err);

    const user = results && results[0];
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    let match = false;
    try {
      match = await verifyPassword(password, user.password);
    } catch {
      match = false;
    }
    if (!match) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Transparently upgrade legacy plaintext rows to bcrypt.
    if (typeof user.password === "string" && !user.password.startsWith("$2")) {
      try {
        const upgraded = await bcrypt.hash(password, 10);
        pool.query(
          "UPDATE users SET password = ? WHERE id = ?",
          [upgraded, user.id],
          (upgradeErr) => {
            if (upgradeErr) {
              console.error("Password upgrade failed:", upgradeErr.code || upgradeErr.message);
            }
          }
        );
      } catch {
        // Non-fatal: login still succeeds with the legacy password.
      }
    }

    return res.json({
      message: "Login successful",
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
      },
    });
  });
});

// Session endpoint used by dashboard.js. There is no session/token store yet,
// so this honestly reports "not signed in" instead of 404-ing; the dashboard
// then redirects to the login page.
app.get(["/current-user", "/accounts/current-user", "/api/auth/current-user"], (req, res) => {
  res.status(401).json({ user: null });
});

app.get(["/health", "/api/health", "/accounts/health"], (req, res) => {
  res.json({ status: "ok" });
});

// Locally, also serve this service's own pages so relative fetches resolve
// against the same origin. On Vercel the CDN serves static files first.
if (!process.env.VERCEL) {
  app.use(express.static(__dirname));
}

const PORT = Number(process.env.PORT) || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Vercel detects the Express app via this export (entrypoint: server.js).
module.exports = app;
