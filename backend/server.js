

const express = require("express");
const mysql = require("mysql");
const bcrypt = require("bcrypt");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Database Connection
const db = mysql.createConnection({
  host: "localhost",
  user: "root", // Change if necessary
  password: "kiit", // Change if necessary
  database: "hello_doc", // Ensure the database exists
});

db.connect((err) => {
  if (err) {
    console.error("Database connection failed: ", err);
  } else {
    console.log("Connected to MySQL Database ✅");
  }
});

// Signup Route
app.post("/auth/signup", async (req, res) => {
  const { firstName, lastName, email, password, dob, sex } = req.body;

  // Hash Password
  const hashedPassword = await bcrypt.hash(password, 10);

  const sql =
    "INSERT INTO users (firstName, lastName, email, password, dob, sex) VALUES (?, ?, ?, ?, ?, ?)";
  db.query(sql, [firstName, lastName, email, hashedPassword, dob, sex], (err) => {
    if (err) {
      return res.status(500).json({ message: "Error creating user", error: err });
    }
    res.status(201).json({ message: "Signup successful" });
  });
});

// Login Route
app.post("/auth/login", (req, res) => {
  const { email, password } = req.body;

  const sql = "SELECT * FROM users WHERE email = ?";
  db.query(sql, [email], async (err, results) => {
    console.log(results);
    if (err) {
      return res.status(500).json({ message: "Error checking user" });
    }
    if (results.length === 0) {
      return res.status(401).json({ message: "User not found" });
    }

    // Compare hashed password
    const user = results[0];
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    res.status(200).json({ message: "Login successful", userId: user.id });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
