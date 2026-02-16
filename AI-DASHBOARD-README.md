# BizObs AI Dashboard Generator

## Quick Start

### 1. Install Ollama (One-Time Setup)

**Automated:**
```bash
./setup-ollama.sh
```

**Manual:**

**Linux/EC2/Azure:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2:1.5b  # Lightweight: 934 MB
```

**macOS:**
```bash
brew install ollama
ollama pull qwen2:1.5b  # Lightweight: 934 MB
```

**Windows:**
1. Download from https://ollama.com/download/windows
2. Install and run
3. Open terminal: `ollama pull qwen2:1.5b`

**Alternative Models:**
```bash
# Balanced quality (2 GB)
ollama pull llama3.2

# Higher quality (4.9 GB - requires 6GB+ free disk)
ollama pull llama3.1
```

### 2. Start BizObs

```bash
npm start
# or
node server.js
```

### 3. Verify AI is Ready

```bash
curl http://localhost:8080/api/ai-dashboard/health
```

Should show:
```json
{
  "success": true,
  "ollamaAvailable": true,
  "ready": true,
  "message": "Ollama is ready with model qwen2:1.5b"
}
```

## Configuration

Edit `.env` file:

```bash
# Ollama endpoint (default: localhost)
OLLAMA_ENDPOINT=http://localhost:11434

# Model to use (default: lightweight)
OLLAMA_MODEL=qwen2:1.5b  # 934 MB - default

# Alternative models:
# OLLAMA_MODEL=llama3.2      # 2.0 GB - latest, efficient
# OLLAMA_MODEL=phi3:mini     # 2.3 GB - balanced
# OLLAMA_MODEL=mistral       # 4.1 GB - higher quality
# OLLAMA_MODEL=llama3.1      # 4.9 GB - best quality (needs 6GB+ free)
```

**Model Selection:**
- **qwen2:1.5b** (default): Works on systems with <2 GB free disk
- **llama3.2**: Better quality, needs 3 GB free disk
- **llama3.1**: Best quality, needs 6 GB free disk

## API Endpoints

### Generate Dashboard
```bash
POST /api/ai-dashboard/generate
{
  "journeyData": {
    "company": "TechCorp",
    "industry": "Technology", 
    "journeyType": "User Signup",
    "steps": [...]
  }
}
```

### Preview Dashboard
```bash
POST /api/ai-dashboard/preview
{
  "journeyData": {...}
}
```

### Health Check
```bash
GET /api/ai-dashboard/health
```

### List Skills
```bash
GET /api/ai-dashboard/skills
```

## Features

✅ **Zero Cost** - Self-hosted LLM, no API fees  
✅ **Cross-Platform** - Works on Linux/Windows/macOS  
✅ **Private** - All data stays on your infrastructure  
✅ **Offline** - Works without internet after setup  
✅ **Auto-Fallback** - Uses rule-based templates if Ollama unavailable  

## System Requirements

- **RAM:** 8GB minimum, 16GB recommended
- **Disk:** 5GB for llama3.1 model
- **CPU:** Any modern processor (GPU optional but faster)

## Dynatrace Monitoring

See [DYNATRACE-MONITORING.md](./DYNATRACE-MONITORING.md) for monitoring Ollama with Dynatrace.

## Troubleshooting

**Ollama not starting:**
```bash
# Check status
systemctl status ollama    # Linux
brew services list          # macOS

# Restart
sudo systemctl restart ollama    # Linux
brew services restart ollama     # macOS
```

**Model not installed:**
```bash
ollama list                 # List installed models
ollama pull llama3.1       # Install model
```

**Connection refused:**
```bash
# Check Ollama is listening
curl http://localhost:11434/api/tags

# Check firewall allows port 11434
```

## Alternative Models

```bash
# Smaller/faster
ollama pull llama3.1:8b

# Larger/better quality
ollama pull llama3.1:70b

# Code-optimized
ollama pull qwen2.5-coder
```

Update `.env` after pulling new model:
```bash
OLLAMA_MODEL=qwen2.5-coder
```
