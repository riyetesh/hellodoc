// Load required packages
const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');

// Create the app
const app = express();

// Allow requests from your frontend
app.use(cors());

// Let the app read JSON data
app.use(bodyParser.json());

// Create connection to MySQL
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root', // Change if you used a different username
    password: 'kiit', // Change to your MySQL password
    database: 'user_accounts'
});

// Connect to MySQL
db.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL database!');
});

// Handle signup requests
app.post('/signup', (req, res) => {
    const { firstName, lastName, email, password, dob, sex } = req.body;

    // Simple validation
    if (!firstName || !lastName || !email || !password || !dob || !sex) {
        return res.status(400).json({ message: 'All fields are required' });
    }

    // Insert into database
    const sql = `INSERT INTO users (first_name, last_name, email, password, dob, sex) 
                 VALUES (?, ?, ?, ?, ?, ?)`;
    
    db.query(sql, [firstName, lastName, email, password, dob, sex], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ message: 'Email already exists' });
            }
            
            return res.status(500).json({ message: 'Error saving to database' });
        }
        
        res.json({ 
            message: 'Signup successful!',
            userId: result.insertId 
        });
    });
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});


//login

// Login endpoint
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    // Simple validation
    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
    }

    // Check if user exists
    const sql = 'SELECT * FROM users WHERE email = ? AND password = ?';
    
    db.query(sql, [email, password], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ message: 'Database error' });
        }
        
        if (results.length === 0) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        
        // Successful login
        const user = results[0];
        res.json({ 
            message: 'Login successful',
            user: {
                id: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                email: user.email
            }
        });
    });
});