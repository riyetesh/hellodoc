require("dotenv").config();

const path = require("path");
const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const cors = require("cors");

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

// Connection pool created lazily (mysql2 pools connect on first query), so the
// service boots on Vercel even when the database is temporarily unreachable.
// All credentials come from environment variables — never hardcode them.
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

      return res.status(200).json({ message: "Login successful", userId: user.id });
    }
  );
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
    "Symptom service is not running locally. Start it with: python Algo/main.py (port 5001)";

  app.get("/predict", (req, res) => proxyRequest(FLASK_ORIGIN, req, res, flaskHint));
  app.post("/predict", (req, res) => proxyRequest(FLASK_ORIGIN, req, res, flaskHint));
  app.use("/static", (req, res) => proxyRequest(FLASK_ORIGIN, req, res, flaskHint));

  // Locally route the new-login service's API through the same origin so its
  // pages work no matter which server served the static HTML.
  const NEW_LOGIN_ORIGIN = process.env.NEW_LOGIN_ORIGIN || "http://127.0.0.1:3000";
  const newLoginHint =
    "New-login service is not running locally. Start it with: node Login-and-dashboard/New-login/server.js (port 3000)";
  app.use("/accounts", (req, res) => proxyRequest(NEW_LOGIN_ORIGIN, req, res, newLoginHint));
}

const PORT = Number(process.env.PORT) || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// Vercel detects the Express app via this export (entrypoint: server.js).
module.exports = app;
