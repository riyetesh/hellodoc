🌐 Disease Prediction & Doctor Finder Platform
Welcome to our Disease Prediction & Doctor Finder project! 🚑 This web-based platform is designed to make healthcare more accessible and efficient for everyone. Whether you're feeling under the weather 🤒 or looking for the best doctor nearby 🩺, we've got you covered!

🌟 Features
🧠 AI-Powered Disease Prediction: Enter your symptoms, and let our smart algorithms predict potential health conditions.
📍 Find Nearby Doctors: Get recommendations for doctors based on your predicted condition and location.
📅 Easy Appointment Booking: Schedule appointments with a few clicks, no hassle!
🔒 Secure & Private: Your health data is safe with us.

🚀 Tech Stack
Here’s what we’re using to build this awesome platform:

Frontend: React.js 🌟
Backend: Python (Django/Flask) 🐍
Database: MongoDB 🍃
Machine Learning: TensorFlow & Scikit-learn 🤖
 
🏗️ Project Roadmap
✅ Planning & Design: Wireframes and feature planning.
🚧 Development: Currently working on core features.
🛠️ Testing: Ensuring everything runs smoothly.
🎉 Launch: Coming soon!
🤝 Contributions Welcome!
We’d love for you to contribute and make this project even better! 🫶

Report issues 🐛
Suggest features 💡
Submit pull requests 🔧
📧 Contact Us
Feel free to reach out if you have any questions or ideas:


💙 Our Team

 Ritesh Yadav
 Sanjay Sah
 Bijay Prasad Shah Rauniyar
 Anuj Kumar Prajapati
 Hariom Gupta
 Purushotam Prasad Kurmi

---

📦 Quick Start

## Local Development

Run all services with a single command:

### Linux / macOS

```bash
chmod +x start.sh
./start.sh
```

### Windows

Double-click `start.bat` or run:

```cmd
start.bat
```

This starts:

- **Flask Prediction Service** - Port 5001 (Python required)
- **Node.js Backend** - Port 5000 (Node.js required)
- **React Chatbot** - Port 5173 (npm required)

Then open:

- Main App: http://localhost:5000
- Chatbot: http://localhost:5173 (if started)

## Deployment (Vercel)

The project is configured for Vercel deployment with multiple services:

- `/api/*` → Backend service (Express)
- `/` → Flask app service
- `/predict` → Flask prediction endpoint

See `vercel.json` for service configuration.
