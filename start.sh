#!/bin/bash

cleanup() {
    echo "Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

echo "Starting backend..."
(cd backend && source venv/bin/activate && uvicorn main:app --reload) &
BACKEND_PID=$!

echo "Starting frontend..."
(cd frontend && npm run dev) &
FRONTEND_PID=$!

echo ""
echo "Services running:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop all services"

wait
