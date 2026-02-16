#!/bin/bash

# BizObs Application Stop Script
cd "$(dirname "$0")"

echo "🛑 Stopping BizObs Application..."

# Check if PM2 is managing the app
if command -v pm2 &> /dev/null && pm2 describe bizobs-app > /dev/null 2>&1; then
    echo "📦 Stopping PM2 managed process..."
    pm2 stop bizobs-app
    pm2 delete bizobs-app
    echo "✅ BizObs Application stopped (PM2)"
else
    echo "📦 Stopping processes manually..."
    
    # Stop using PID file if available
    if [ -f server.pid ]; then
        PID=$(cat server.pid)
        if kill -0 $PID 2>/dev/null; then
            echo "🔍 Stopping process with PID: $PID"
            kill $PID
            sleep 2
            
            # Force kill if still running
            if kill -0 $PID 2>/dev/null; then
                echo "⚠️  Force killing stubborn process..."
                kill -9 $PID
            fi
        fi
        rm -f server.pid
    fi
    
    # Kill any remaining processes
    pkill -f "partner-powerup-bizobs" 2>/dev/null || true
    sleep 1
    
    echo "✅ BizObs Application stopped"
fi

# Stop LoadRunner processes
echo "🛑 Stopping LoadRunner processes..."
pkill -f "loadrunner-simulator.js" 2>/dev/null && echo "✅ LoadRunners stopped" || echo "ℹ️  No LoadRunners running"

# Verify no processes are left running on port 4000
if lsof -i :4000 > /dev/null 2>&1; then
    echo "⚠️  Warning: Port 4000 is still in use"
    echo "   Run: sudo lsof -i :4000 to investigate"
else
    echo "✅ Port 4000 is free"
fi