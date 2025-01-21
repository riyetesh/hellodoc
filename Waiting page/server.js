const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Simulated waiting state
let status = "waiting";

// Endpoint to fetch the current status
app.get('/api/status', (req, res) => {
    res.json({ status });
});

// Endpoint to update the status (simulate completion)
app.post('/api/status', (req, res) => {
    const { newStatus } = req.body;
    status = newStatus || "waiting";
    res.json({ message: "Status updated successfully", status });
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
