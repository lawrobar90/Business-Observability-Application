#!/bin/bash
set -e

# Quick Deploy Script for BizObs with AI Dashboard Generator
# Installs Ollama, downloads llama3.1 model, starts services
# Usage: ./quick-deploy.sh

echo "🚀 BizObs Quick Deploy"
echo "===================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     MACHINE=Linux;;
    Darwin*)    MACHINE=Mac;;
    CYGWIN*)    MACHINE=Windows;;
    MINGW*)     MACHINE=Windows;;
    *)          MACHINE="UNKNOWN:${OS}"
esac

echo "📋 Detected OS: $MACHINE"
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Node.js
if ! command_exists node; then
    echo -e "${RED}❌ Node.js not found${NC}"
    echo "Please install Node.js v18+ from https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js version too old (found v$NODE_VERSION, need v18+)${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js $(node -v)${NC}"

# Install Ollama if not present
if ! command_exists ollama; then
    echo ""
    echo "📦 Installing Ollama..."
    
    if [ "$MACHINE" = "Linux" ]; then
        curl -fsSL https://ollama.com/install.sh | sh
    elif [ "$MACHINE" = "Mac" ]; then
        if command_exists brew; then
            brew install ollama
        else
            echo -e "${RED}❌ Homebrew not found. Install from https://brew.sh/${NC}"
            exit 1
        fi
    else
        echo -e "${RED}❌ Unsupported OS for auto-install${NC}"
        echo "Please install Ollama manually from https://ollama.com/download"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Ollama installed${NC}"
else
    echo -e "${GREEN}✅ Ollama already installed${NC}"
fi

# Start Ollama service
echo ""
echo "🔄 Starting Ollama service..."
if [ "$MACHINE" = "Linux" ]; then
    if command_exists systemctl; then
        sudo systemctl enable ollama 2>/dev/null || true
        sudo systemctl start ollama 2>/dev/null || true
    else
        nohup ollama serve > /tmp/ollama.log 2>&1 &
    fi
elif [ "$MACHINE" = "Mac" ]; then
    if command_exists brew; then
        brew services start ollama 2>/dev/null || nohup ollama serve > /tmp/ollama.log 2>&1 &
    else
        nohup ollama serve > /tmp/ollama.log 2>&1 &
    fi
fi

# Wait for Ollama to be ready
echo "⏳ Waiting for Ollama to start..."
for i in {1..30}; do
    if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Ollama is ready${NC}"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ Ollama failed to start${NC}"
        exit 1
    fi
done

# Check if model is already downloaded
MODEL_EXISTS=$(ollama list | grep -c "qwen2:1.5b" || true)

if [ "$MODEL_EXISTS" -eq 0 ]; then
    echo ""
    echo "📥 Downloading qwen2:1.5b model (934 MB, ~30 seconds)..."
    echo -e "${YELLOW}☕ Lightweight model for quick deployment${NC}"
    
    # Download model with progress
    ollama pull qwen2:1.5b
    
    echo -e "${GREEN}✅ Model downloaded${NC}"
else
    echo -e "${GREEN}✅ qwen2:1.5b model already downloaded${NC}"
fi

# Install Node dependencies
echo ""
echo "📦 Installing Node.js dependencies..."
npm install --production
echo -e "${GREEN}✅ Dependencies installed${NC}"

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env configuration..."
    cat > .env << EOF
# BizObs Configuration
PORT=8080

# Ollama Configuration (AI Dashboard Generator)
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=qwen2:1.5b

# Alternative models (uncomment to use):
# OLLAMA_MODEL=llama3.2      # 2.0 GB - Latest, efficient
# OLLAMA_MODEL=phi3:mini     # 2.3 GB - Balanced quality
# OLLAMA_MODEL=mistral       # 4.1 GB - Higher quality
# OLLAMA_MODEL=llama3.1      # 4.9 GB - Best quality (needs 6GB+ free)

# Service Port Range
SERVICE_START_PORT=8081
SERVICE_END_PORT=8120
EOF
    echo -e "${GREEN}✅ .env created${NC}"
fi

# Create logs directory
mkdir -p logs

# Kill any existing server
pkill -f "node server.js" 2>/dev/null || true

# Start server
echo ""
echo "🚀 Starting BizObs server..."
nohup node server.js > logs/server.log 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > server.pid

# Wait for server to start
echo "⏳ Waiting for server to start..."
for i in {1..20}; do
    if curl -s http://localhost:8080/api/ai-dashboard/health >/dev/null 2>&1; then
        echo -e "${GREEN}✅ Server is ready${NC}"
        break
    fi
    sleep 1
    if [ $i -eq 20 ]; then
        echo -e "${RED}❌ Server failed to start. Check logs/server.log${NC}"
        exit 1
    fi
done

# Check AI Dashboard status
echo ""
echo "🤖 Checking AI Dashboard Generator..."
HEALTH=$(curl -s http://localhost:8080/api/ai-dashboard/health)
AI_READY=$(echo $HEALTH | grep -c '"ready":true' || true)

if [ "$AI_READY" -eq 1 ]; then
    echo -e "${GREEN}✅ AI Dashboard Generator ready${NC}"
else
    echo -e "${YELLOW}⚠️  AI Dashboard in fallback mode (model still loading)${NC}"
fi

# Print summary
echo ""
echo "═══════════════════════════════════════════════════"
echo -e "${GREEN}🎉 BizObs Deployment Complete!${NC}"
echo "═══════════════════════════════════════════════════"
echo ""
echo "🌐 Access BizObs:"
echo "   http://localhost:8080"
echo ""
echo "🤖 AI Dashboard API:"
echo "   http://localhost:8080/api/ai-dashboard/health"
echo ""
echo "📊 Ollama Service:"
echo "   http://localhost:11434"
echo ""
echo "📝 Server Logs:"
echo "   tail -f logs/server.log"
echo ""
echo "🛑 Stop Server:"
echo "   pkill -f 'node server.js'"
echo ""
echo "🔄 Restart Server:"
echo "   ./quick-deploy.sh"
echo ""
echo "═══════════════════════════════════════════════════"
echo ""
echo "Next Steps:"
echo "1. Open http://localhost:8080 in your browser"
echo "2. Create a business journey"
echo "3. Click 'Generate AI Dashboard'"
echo "4. Deploy to Dynatrace"
echo ""
echo "📖 Documentation:"
echo "   - AI Dashboard: AI-DASHBOARD-README.md"
echo "   - Monitoring: DYNATRACE-MONITORING.md"
echo "   - Quick Start: QUICK-START.md"
echo ""
