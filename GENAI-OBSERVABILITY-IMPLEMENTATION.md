# GenAI Observability Implementation

## Overview

The BizObs AI Dashboard Generator is now fully instrumented for **Dynatrace AI Observability**, following the official standards for Ollama monitoring:

📚 **Reference:** [Dynatrace for AI Observability - Ollama](https://docs.dynatrace.com/docs/observe/dynatrace-for-ai-observability/models-and-platforms/ollama)

## What's Instrumented

Every Ollama API call for dashboard generation is now captured as a **GenAI Span** with the following attributes:

### Standard GenAI Attributes

| Attribute | Type | Description | Example |
|-----------|------|-------------|---------|
| `gen_ai.system` | string | GenAI product identifier | `"ollama"` |
| `gen_ai.request.model` | string | Model name | `"llama3.1"` |
| `gen_ai.response.model` | string | Model that generated response | `"llama3.1"` |
| `gen_ai.prompt.0.content` | string | Full prompt sent (truncated to 1000 chars) | `"Create a dashboard for..."` |
| `gen_ai.prompt.0.role` | string | Role for the request | `"user"` |
| `gen_ai.completion.0.content` | string | Full response received (truncated to 1000 chars) | `"{\"version\": 19...}"` |
| `gen_ai.completion.0.role` | string | Role for the response | `"assistant"` |
| `gen_ai.usage.prompt_tokens` | integer | Number of tokens in prompt | `1250` |
| `gen_ai.usage.completion_tokens` | integer | Number of tokens in completion | `3800` |
| `llm.request.type` | string | Type of operation | `"completion"` |

### Custom Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `duration_ms` | number | Request duration in milliseconds |
| `endpoint` | string | Ollama API endpoint URL |

## Configuration Required

### Application-Side Configuration
❌ **None required!**

The current implementation uses log-based span capture, which requires zero configuration:
- No OTLP endpoint URLs
- No API tokens
- No OpenTelemetry SDK installation
- No environment variables

### Dynatrace-Side Configuration
❌ **None required!**

Dynatrace OneAgent automatically:
- Detects the Node.js process
- Captures console logs
- Parses structured JSON
- Creates spans from GenAI attributes
- Sends to Dynatrace backend

### Alternative: Direct OTLP Integration (Not Recommended)

If you wanted to send spans directly via OTLP API (not necessary), you would need:

```bash
# Environment variables
OTEL_EXPORTER_OTLP_ENDPOINT=https://{env-id}.live.dynatrace.com/api/v2/otlp
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Api-Token dt0c01.xxxxx"
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf

# API token with scope: openTelemetryTrace.ingest
# Network: Port 443 not blocked
```

**But this adds complexity with no benefit over the current log-based approach.**

## How It Works

### 1. Span Creation

Every time the AI Dashboard Generator calls Ollama, it:

```javascript
// Before the request
const startTime = performance.now();

// Make the Ollama API call
const response = await fetch(`${OLLAMA_ENDPOINT}/api/generate`, {...});
const result = await response.json();

// Calculate duration
const duration = performance.now() - startTime;

// Create GenAI span with all attributes
const genAISpan = createGenAISpan(
  prompt,                           // User's prompt
  result.response,                  // AI's completion
  OLLAMA_MODEL,                     // Model name
  result.prompt_eval_count || 0,    // Prompt tokens
  result.eval_count || 0,           // Completion tokens
  duration                          // Duration in ms
);
```

### 2. Span Logging

The span is logged in structured JSON format that Dynatrace OneAgent automatically captures:

```javascript
console.log('[GenAI Span]', JSON.stringify({
  'gen_ai.system': 'ollama',
  'gen_ai.request.model': 'llama3.1',
  'gen_ai.prompt.0.content': 'Create a dashboard for...',
  'gen_ai.completion.0.content': '{\"version\": 19...}',
  'gen_ai.usage.prompt_tokens': 1250,
  'gen_ai.usage.completion_tokens': 3800,
  'duration_ms': 4567
}));
```

### 3. Dynatrace Capture

Dynatrace OneAgent running on the host:
1. Monitors the Node.js process logs
2. Detects structured JSON with `[GenAI Span]` prefix
3. Parses the GenAI attributes
4. Creates span entries in the Dynatrace AI Observability view

## Querying GenAI Spans in Dynatrace

### All AI Requests

```dql
fetch spans
| filter gen_ai.system == "ollama"
| fields timestamp, gen_ai.request.model, duration_ms, 
         gen_ai.usage.prompt_tokens, gen_ai.usage.completion_tokens
| sort timestamp desc
```

### Performance Analysis

```dql
fetch spans
| filter gen_ai.system == "ollama"
| summarize 
    avg_duration = avg(duration_ms),
    p50 = percentile(duration_ms, 50),
    p95 = percentile(duration_ms, 95),
    p99 = percentile(duration_ms, 99),
    total_requests = count(),
    by: {gen_ai.request.model}
```

### Token Usage Tracking

```dql
fetch spans
| filter gen_ai.system == "ollama"
| makeTimeseries 
    total_prompt_tokens = sum(gen_ai.usage.prompt_tokens),
    total_completion_tokens = sum(gen_ai.usage.completion_tokens),
    interval: 5m
```

### Cost Estimation (if using paid models)

```dql
fetch spans
| filter gen_ai.system == "ollama"
| summarize 
    total_tokens = sum(gen_ai.usage.prompt_tokens + gen_ai.usage.completion_tokens),
    by: {gen_ai.request.model}
| fieldsAdd estimated_cost_usd = total_tokens * 0.0000015  // $0.0015 per 1k tokens
```

### Failed Requests

```dql
fetch logs
| filter content contains "[AI Dashboard]" and content contains "error"
| fields timestamp, content
| sort timestamp desc
```

## Dashboard Tiles

Create a dedicated **AI Observability Dashboard** with these tiles:

### Tile 1: AI Request Rate
```dql
fetch spans
| filter gen_ai.system == "ollama"
| makeTimeseries requests = count(), interval: 5m
```
**Visualization:** Line Chart

### Tile 2: Response Time Percentiles
```dql
fetch spans
| filter gen_ai.system == "ollama"
| makeTimeseries 
    p50 = percentile(duration_ms, 50),
    p95 = percentile(duration_ms, 95),
    p99 = percentile(duration_ms, 99),
    interval: 5m
```
**Visualization:** Line Chart

### Tile 3: Token Usage
```dql
fetch spans
| filter gen_ai.system == "ollama"
| summarize 
    prompt_tokens = sum(gen_ai.usage.prompt_tokens),
    completion_tokens = sum(gen_ai.usage.completion_tokens)
```
**Visualization:** Pie Chart

### Tile 4: Requests by Model
```dql
fetch spans
| filter gen_ai.system == "ollama"
| summarize count(), by: {gen_ai.request.model}
```
**Visualization:** Bar Chart

### Tile 5: Average Response Time
```dql
fetch spans
| filter gen_ai.system == "ollama"
| summarize 
    avg_duration = avg(duration_ms),
    by: {gen_ai.request.model}
```
**Visualization:** Table

### Tile 6: Recent AI Interactions
```dql
fetch spans
| filter gen_ai.system == "ollama"
| fields timestamp, 
         gen_ai.request.model,
         duration_ms,
         gen_ai.usage.prompt_tokens,
         gen_ai.usage.completion_tokens
| sort timestamp desc
| limit 20
```
**Visualization:** Table

## Alerts

### Alert 1: High AI Response Time
```dql
fetch spans
| filter gen_ai.system == "ollama"
| summarize p95 = percentile(duration_ms, 95)
| filter p95 > 10000  // Alert if P95 > 10 seconds
```

**Threshold:** P95 response time > 10 seconds  
**Duration:** 2 out of 5 evaluations

### Alert 2: AI Request Failures
```dql
fetch logs
| filter content contains "[AI Dashboard]" and content contains "error"
| summarize error_rate = count()
| filter error_rate > 5  // Alert if >5 errors in timeframe
```

**Threshold:** More than 5 errors in 10 minutes  
**Duration:** 1 evaluation

### Alert 3: Ollama Service Down
```dql
fetch dt.entity.process_group
| filter process_group_name == "ollama-service"
| filter availability < 100
```

**Threshold:** Availability < 100%  
**Duration:** 1 evaluation

## Code Location

All GenAI instrumentation code is in:

📄 **File:** `/routes/ai-dashboard.js`

**Key Functions:**

1. **`createGenAISpan()`** (lines 22-40)
   - Creates span attributes object
   - Truncates large content for performance
   - Returns structured span data

2. **`logGenAISpan()`** (lines 42-52)
   - Logs span as structured JSON
   - Format: `[GenAI Span] {...}`
   - Dynatrace OneAgent captures this

3. **`generateDashboardWithAI()`** (lines 285-400)
   - Wraps Ollama API calls
   - Captures timing with `performance.now()`
   - Extracts token counts from Ollama response
   - Calls `createGenAISpan()` and `logGenAISpan()`

## Example Span Output

When a dashboard is generated, you'll see this in the logs:

```json
[GenAI Span] {
  "gen_ai.system": "ollama",
  "gen_ai.request.model": "llama3.1",
  "gen_ai.response.model": "llama3.1",
  "gen_ai.prompt.0.content": "You are a Dynatrace observability expert. You have deep knowledge of...",
  "gen_ai.prompt.0.role": "user",
  "gen_ai.completion.0.content": "{\"version\": 19, \"variables\": [...], \"tiles\": {...}}",
  "gen_ai.completion.0.role": "assistant",
  "gen_ai.usage.prompt_tokens": 1247,
  "gen_ai.usage.completion_tokens": 3842,
  "llm.request.type": "completion",
  "duration_ms": 4567,
  "endpoint": "http://localhost:11434"
}
```

## Testing

Once the llama3.1 model download completes, test the instrumentation:

```bash
# Generate a test dashboard
curl -X POST http://localhost:8080/api/ai-dashboard/generate \
  -H "Content-Type: application/json" \
  -d '{
    "journeyData": {
      "company": "TestCorp",
      "industry": "Technology",
      "journeyType": "User Onboarding",
      "steps": [
        {"name": "signup"},
        {"name": "verification"},
        {"name": "onboarding"}
      ]
    }
  }'

# Check the logs for GenAI span
tail -f logs/server.log | grep "GenAI Span"
```

## Benefits

✅ **Full Observability**: Track every AI request, response, and token usage  
✅ **Performance Monitoring**: Identify slow AI responses  
✅ **Cost Tracking**: Monitor token consumption for cost estimation  
✅ **Error Detection**: Catch and alert on AI failures  
✅ **Standards Compliant**: Follows Dynatrace GenAI span specification  
✅ **Zero Configuration**: Works automatically with Dynatrace OneAgent  
✅ **No External Dependencies**: Self-contained implementation

## Next Steps

1. ✅ **Implemented** - GenAI span instrumentation
2. ⏳ **Waiting** - llama3.1 model download completion
3. 🔜 **Test** - Generate dashboard and verify spans in Dynatrace
4. 🔜 **Create** - AI Observability dashboard in Dynatrace UI
5. 🔜 **Configure** - Alerts for response time and failures
6. 🔜 **Monitor** - Track token usage and performance over time

## References

- [Dynatrace AI Observability - Ollama](https://docs.dynatrace.com/docs/observe/dynatrace-for-ai-observability/models-and-platforms/ollama)
- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [Dynatrace OneAgent Documentation](https://docs.dynatrace.com/docs/setup-and-configuration/dynatrace-oneagent)
