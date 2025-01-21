import React, { useState, useEffect } from 'react';
import './App.css';

const App = () => {
    const [status, setStatus] = useState("waiting");

    useEffect(() => {
        // Poll the backend for status updates every 2 seconds
        const interval = setInterval(() => {
            fetch('http://localhost:5000/api/status')
                .then((response) => response.json())
                .then((data) => setStatus(data.status))
                .catch((err) => console.error(err));
        }, 2000);

        return () => clearInterval(interval); // Cleanup on unmount
    }, []);

    return (
        <div className="waiting-page">
            <div className="spinner"></div>
            <h1>Waiting for the process to complete...</h1>
            <p>Status: {status}</p>
            {status === "completed" && <p>The process is completed. You can proceed!</p>}
        </div>
    );
};

export default App;
