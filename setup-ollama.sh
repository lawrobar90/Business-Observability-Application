#!/bin/bash

# BizObs AI Dashboard - Ollama Setup Script
# Works on Linux, Windows (WSL), macOS, EC2, Azure

echo "🤖 Setting up Ollama for BizObs AI Dashboard Generator"
echo ""

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="mac"
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    OS="windows"
else
    OS="linux"
fi

echo "📍 Detected OS: $OS"
echo ""

# Install Ollama
if command -v ollama &> /dev/null; then
    echo "✅ Ollama already installed"
    ollama --version
else
    echo "📥 Installing Ollama..."
    
    if [[ "$OS" == "mac" ]]; then
        if command -v brew &> /dev/null; then
            brew install ollama
        else
            echo "⚠️  Homebrew not found. Download from: https://ollama.com"
            exit 1
        fi
    elif [[ "$OS" == "windows" ]]; then
        echo "⚠️  Please download Ollama from: https://ollama.com/download/windows"
        exit 1
    else
        # Linux/EC2/Azure
        curl -fsSL https://ollama.com/install.sh | sh
    fi
fi

echo ""
echo "🔄 Starting Ollama service..."

# Start Ollama (if not running)
if [[ "$OS" == "linux" ]]; then
    sudo systemctl enable ollama
    sudo systemctl start ollama
elif [[ "$OS" == "mac" ]]; then
    brew services start ollama
fi

sleep 2

# Check if Ollama is responding
if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "✅ Ollama service is running"
else
    echo "❌ Ollama service not responding. Please check installation."
    exit 1
fi

echo ""
echo "📥 Pulling llama3.1 model (4.9 GB - this may take a few minutes)..."
ollama pull llama3.1

echo ""
echo "✅ Ollama setup complete!"
echo ""
echo "📊 To verify:"
echo "   curl http://localhost:11434/api/tags"
echo ""
echo "🚀 To start BizObs:"
echo "   npm start"
echo ""
echo "🔍 Check AI health:"
echo "   curl http://localhost:8080/api/ai-dashboard/health"
