# Monitoring Ollama LLM with Dynatrace

## Overview

Monitor your self-hosted Ollama LLM to track:
- AI request rates and response times
- Model performance and throughput
- Resource usage (CPU, RAM, GPU)
- Error rates and availability
- Business metrics (dashboards generated, success rate)
- **GenAI Spans** - Prompt/completion tracking per [Dynatrace AI Observability](https://docs.dynatrace.com/docs/observe/dynatrace-for-ai-observability/models-and-platforms/ollama)

## 1. GenAI Observability (Primary)

The BizObs application automatically captures GenAI spans following Dynatrace standards.

**✅ No Configuration Required**
- No OTLP endpoints or API tokens needed
- No OpenTelemetry SDK installation
- Works automatically with Dynatrace OneAgent
- Spans captured via structured console logs

**Captured Attributes:**
- `gen_ai.system`: "ollama"
- `gen_ai.request.model`: Model name (e.g., "llama3.1")
- `gen_ai.prompt.0.content`: User prompt (truncated to 1000 chars)
- `gen_ai.completion.0.content`: AI response (truncated to 1000 chars)
- `gen_ai.usage.prompt_tokens`: Token count for prompt
- `gen_ai.usage.completion_tokens`: Token count for completion
- `llm.request.type`: "completion"
- `duration_ms`: Request duration in milliseconds

**How it works:**
1. Every Ollama API call is instrumented with GenAI span attributes
2. Spans are logged to console in structured JSON format
3. Dynatrace OneAgent automatically captures these log entries
4. Spans appear in Dynatrace UI under "AI Observability"

**View in Dynatrace:**
```dql
fetch spans
| filter gen_ai.system == "ollama"
| summarize avg(duration_ms), count(), by: {gen_ai.request.model}
```

## 2. Ollama Process Monitoring

Dynatrace OneAgent automatically detects Ollama as a process:

**What you get:**
- ✅ Process CPU and memory usage
- ✅ Process availability
- ✅ Thread counts
- ✅ Auto-restart detection

**Service name:** `ollama`  
**Process group:** `ollama-service`

## 2. HTTP API Monitoring

Ollama exposes HTTP endpoints on port 11434. Monitor with custom requests:

**Key Endpoints:**
- `GET /api/tags` - List models
- `POST /api/generate` - Generate completions
- `GET /api/version` - Ollama version

**Setup:**
Add HTTP monitor or use Dynatrace Synthetic:

```javascript
// Synthetic test for Ollama health
const response = await fetch('http://localhost:11434/api/tags');
const data = await response.json();
assert(data.models.length > 0, 'No models installed');
```

## 3. Query GenAI Spans

**All GenAI requests:**
```dql
fetch spans
| filter gen_ai.system == "ollama"
| fields timestamp, gen_ai.request.model, duration_ms, 
         gen_ai.usage.prompt_tokens, gen_ai.usage.completion_tokens
| sort timestamp desc
```

**Average performance by model:**
```dql
fetch spans
| filter gen_ai.system == "ollama"
| summarize 
    avg_duration = avg(duration_ms),
    total_requests = count(),
    avg_prompt_tokens = avg(gen_ai.usage.prompt_tokens),
    avg_completion_tokens = avg(gen_ai.usage.completion_tokens),
    by: {gen_ai.request.model}
```

**Failed AI requests:**
```dql
fetch logs
| filter content contains "[AI Dashboard]" and content contains "error"
| fields timestamp, content
| sort timestamp desc
```

**Token usage over time:**
```dql
fetch spans
| filter gen_ai.system == "ollama"
| makeTimeseries 
    total_prompt_tokens = sum(gen_ai.usage.prompt_tokens),
    total_completion_tokens = sum(gen_ai.usage.completion_tokens),
    interval: 5m
```

## 4. BizObs AI Dashboard Metrics

The BizObs server automatically logs AI operations:

**Add to `/routes/ai-dashboard.js`:**

```javascript
// After successful AI generation
console.log('[AI Dashboard] AI_GENERATION_SUCCESS', {
  company: journeyData.company,
  industry: journeyData.industry,
  method: generationMethod,
  duration_ms: Date.now() - startTime,
  tile_count: Object.keys(dashboard.tiles).length
});

// After failure
console.log('[AI Dashboard] AI_GENERATION_FAILURE', {
  error: error.message,
  fallback: true
});
```

**Query with DQL:**
```dql
fetch logs
| filter content contains "AI_GENERATION"
| summarize 
    total = count(),
    successes = countIf(content contains "SUCCESS"),
    failures = countIf(content contains "FAILURE"),
    by: {bin(timestamp, 5m)}
| fieldsAdd success_rate = (successes / total) * 100
```

## 4. Business Events for AI Operations

Send AI dashboard generations as business events:

**Add to `/routes/ai-dashboard.js`:**

```javascript
import { sendBusinessEvent } from '../middleware/dynatrace-metadata.js';

// After dashboard generation
await sendBusinessEvent({
  'event.type': 'bizevents.ai.dashboard.generated',
  'event.provider': 'ollama',
  'company': journeyData.company,
  'industry': journeyData.industry,
  'journey_type': journeyData.journeyType,
  'generation_method': generationMethod,
  'tile_count': Object.keys(dashboard.tiles).length,
  'duration_ms': generationDuration,
  'success': true
});
```

**Query:**
```dql
fetch bizevents
| filter event.type == "bizevents.ai.dashboard.generated"
| summarize 
    count(),
    avg_duration = avg(duration_ms),
    avg_tiles = avg(tile_count),
    by: {generation_method, industry}
```

## 5. Resource Metrics

### CPU Usage
```dql
timeseries cpu = avg(dt.process.cpu.usage), 
  by: {dt.entity.process_group}, 
  filter: {dt.entity.process_group == "ollama-service"}
```

### Memory Usage
```dql
timeseries memory = avg(dt.process.memory.usage), 
  by: {dt.entity.process_group}, 
  filter: {dt.entity.process_group == "ollama-service"}
```

### GPU Usage (if available)
```dql
timeseries gpu = avg(dt.host.gpu.usage), 
  by: {dt.entity.host}
```

## 6. Create AI Dashboard

**Dashboard tiles:**

1. **GenAI Request Rate**
```dql
fetch spans
| filter gen_ai.system == "ollama"
| makeTimeseries requests = count(), interval: 5m
```

2. **GenAI Success Rate**
```dql
fetch logs
| filter content contains "[AI Dashboard]"
| summarize 
    total = count(),
    successes = countIf(content contains "✅"),
    failures = countIf(content contains "error"),
    by: {bin(timestamp, 1h)}
| fieldsAdd success_rate = (successes / total) * 100
```

3. **GenAI Response Time (P50, P95, P99)**
```dql
fetch spans
| filter gen_ai.system == "ollama"
| summarize 
    p50 = percentile(duration_ms, 50),
    p95 = percentile(duration_ms, 95),
    p99 = percentile(duration_ms, 99),
    by: {gen_ai.request.model}
```

4. **Token Usage Over Time**
```dql
fetch spans
| filter gen_ai.system == "ollama"
| makeTimeseries 
    prompt_tokens = sum(gen_ai.usage.prompt_tokens),
    completion_tokens = sum(gen_ai.usage.completion_tokens),
    interval: 5m
```

5. **Ollama Resource Usage**
```dql
timeseries 
    cpu = avg(dt.process.cpu.usage),
    memory = avg(dt.process.memory.usage),
  by: {dt.entity.process_group},
  filter: {dt.entity.process_group == "ollama-service"}
```

6. **Generation Method Distribution**
```dql
fetch logs
| filter content contains "AI_GENERATION_SUCCESS"
| parse content, "LD 'method': LD:method"
| summarize count(), by: {method}
```

## 7. Alerts

Create alerts for:

**Ollama Down:**
```dql
fetch events
| filter event.type == "PROCESS_UNAVAILABLE"
| filter process.name == "ollama"
```

**High Failure Rate:**
```dql
fetch logs
| filter content contains "AI_GENERATION"
| summarize 
    failures = countIf(content contains "FAILURE"),
    total = count()
| fieldsAdd failure_rate = (failures / total) * 100
| filter failure_rate > 20
```

**Slow Response:**
```dql
fetch logs
| filter content contains "duration_ms"
| parse content, "DURATION:LD 'duration_ms': INT:duration"
| summarize p95 = percentile(duration, 95)
| filter p95 > 30000  // Alert if P95 > 30 seconds
```

## 8. SLI/SLO for AI Service

**Service Level Indicators:**
- Availability: 99.5%
- P95 Response Time: < 10 seconds
- Success Rate: > 95%

**Create SLO in Dynatrace:**
```
Metric: Custom metric from logs
Threshold: 95% success rate
Evaluation: 7-day rolling window
```

## 9. Model Performance Tracking

Track which models perform best:

```javascript
// Log model info
console.log('[AI Dashboard] MODEL_PERFORMANCE', {
  model: OLLAMA_MODEL,
  response_time_ms: duration,
  token_count: estimateTokens(dashboard),
  quality_score: validateDashboard(dashboard) // Custom quality metric
});
```

## 10. Cost Tracking

Even though Ollama is free, track compute costs:

```dql
fetch logs
| filter content contains "AI_GENERATION_SUCCESS"
| parse content, "LD 'duration_ms': INT:duration"
| summarize 
    total_requests = count(),
    total_compute_minutes = sum(duration) / 60000
| fieldsAdd 
    estimated_cost_per_min = 0.10,  // Your EC2/Azure cost
    total_cost = (total_compute_minutes * estimated_cost_per_min)
```

## Quick Dashboard Creation

Use the AI Dashboard Generator itself to create the monitoring dashboard:

```bash
curl -X POST http://localhost:8080/api/ai-dashboard/generate \
  -H "Content-Type: application/json" \
  -d '{
    "journeyData": {
      "company": "BizObs",
      "industry": "AI/ML",
      "journeyType": "Ollama LLM Monitoring",
      "steps": [
        {"name": "request_received"},
        {"name": "model_inference"},
        {"name": "response_generated"}
      ]
    }
  }'
```

## Bonus: GPU Monitoring

If using GPU for Ollama:

```bash
# Install NVIDIA integration
# Dynatrace will auto-discover GPU metrics

# Query GPU usage
timeseries gpu_util = avg(dt.host.gpu.utilization)
timeseries gpu_mem = avg(dt.host.gpu.memory.used)
```

---

**Next Steps:**
1. Deploy OneAgent to your Ollama host
2. Add business events to AI dashboard route
3. Create dashboard from templates above
4. Set up alerts for availability and performance
5. Track AI operations as part of your BizObs observability
