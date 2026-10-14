#!/bin/bash
# Unified startup script for HelloDoc
# Run this script to start all services with one command

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Starting HelloDoc Platform ===${NC}"
echo ""

# Track all PIDs for cleanup
PIDS=()

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Stopping services...${NC}"
    for pid in "${PIDS[@]}"; do
        kill $pid 2>/dev/null
    done
    exit 0
}

trap cleanup SIGINT SIGTERM

# Check if Python is available
if command -v python3 &> /dev/null || command -v python &> /dev/null; then
    PYTHON_CMD=$(command -v python3 || command -v python)
    echo -e "${GREEN}[1/3]${NC} Starting Flask prediction service on port 5001..."
    echo "       Command: $PYTHON_CMD Algo/main.py"
    echo ""
    # Start Flask in background
    $PYTHON_CMD Algo/main.py > /dev/null 2>&1 &
    FLASK_PID=$!
    PIDS+=($FLASK_PID)
    echo -e "       ${GREEN}✓${NC} Flask service started (PID: $FLASK_PID)"
else
    echo -e "${YELLOW}[WARNING]${NC} Python not found. Symptom prediction will not work."
    echo "          Install Python 3.8+ to enable disease prediction."
    FLASK_PID=""
fi

echo ""

# Check if Node is available
if command -v node &> /dev/null; then
    echo -e "${GREEN}[2/3]${NC} Starting Node.js backend on port 5000..."
    echo "       Command: node backend/server.js"
    echo ""
    # Start Node backend
    node backend/server.js > /dev/null 2>&1 &
    NODE_PID=$!
    PIDS+=($NODE_PID)
    echo -e "       ${GREEN}✓${NC} Node backend started (PID: $NODE_PID)"
else
    echo -e "${YELLOW}[WARNING]${NC} Node.js not found. Auth and doctor features will not work."
    NODE_PID=""
fi

# Check if npm is available for chatbot
if command -v npm &> /dev/null && [ -f "chatbot/package.json" ]; then
    echo -e "${GREEN}[3/3]${NC} Starting Chatbot (Vite) on port 5173..."
    echo "       Command: cd chatbot && npm run dev"
    echo ""
    # Start chatbot in background
    (cd chatbot && npm run dev -- --host 0.0.0.0) > /dev/null 2>&1 &
    CHATBOT_PID=$!
    PIDS+=($CHATBOT_PID)
    echo -e "       ${GREEN}✓${NC} Chatbot started (PID: $CHATBOT_PID)"
else
    echo -e "${YELLOW}[INFO]${NC} Chatbot not started. Run: cd chatbot && npm run dev"
fi

echo ""
echo -e "${GREEN}=== All services started ===${NC}"
echo ""
echo -e "${GREEN}Access points:${NC}"
echo "  • Main App:     ${YELLOW}http://localhost:5000${NC}"
echo "  • Chatbot:      ${YELLOW}http://localhost:5173${NC} (if started)"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop all services.${NC}"
echo ""

# Wait for any process to exit
wait -n
