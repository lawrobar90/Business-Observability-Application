# Continuous Journey Generation - User Guide

## 🎯 Overview

The Continuous Journey Generator automatically creates realistic customer journey data for BizObs **without manual intervention**. Once enabled, it runs in the background and continuously simulates customer transactions, perfect for:

- **Load testing** - Constant traffic generation
- **Demo environments** - Always-on realistic data
- **Self-healing testing** - Trigger automated remediation workflows
- **Performance monitoring** - Continuous observability data

## 🚀 Quick Start

### Enable Continuous Journeys

```bash
# Set environment variable
export ENABLE_CONTINUOUS_JOURNEYS=true

# Start BizObs
npm start
```

The journey generator will automatically start and run in the background!

### Custom Configuration

```bash
# Generate journeys every 15 seconds (default: 30s)
export JOURNEY_INTERVAL_MS=15000

# Use 10 customers per batch (default: 5)
export JOURNEY_BATCH_SIZE=10

# Start BizObs
export ENABLE_CONTINUOUS_JOURNEYS=true
npm start
```

## 📊 What Gets Generated

### Journey Templates

The generator uses pre-configured journey templates:

#### 1. **E-Commerce Journey**
- **Customers**: Alice Johnson, Bob Smith, Carol Williams
- **Steps**:
  1. Browse Products → ProductCatalog service
  2. Add to Cart → ShoppingCart service
  3. Checkout → CheckoutService
  4. Payment → PaymentProcessor
  5. Order Confirmation → OrderService

#### 2. **Banking Journey**
- **Customers**: Wayne Enterprises, Stark Industries, Umbrella Corporation
- **Steps**:
  1. Login → AuthService
  2. Account Overview → AccountService
  3. Transfer Funds → TransferService
  4. Transaction History → HistoryService
  5. Logout → AuthService

### Batch Execution

Every interval (default 30s):
1. **Random template selected** (E-Commerce or Banking)
2. **Random customers chosen** from template's customer list
3. **Parallel execution** of N journeys (default 5)
4. **Error simulation** included (if `errorInjectionEnabled=true`)
5. **Statistics logged** (success rate, total count, errors)

## 📈 Console Output

```
🚀 Starting Continuous Journey Generator
   API: http://localhost:8080
   Interval: 30000ms
   Batch Size: 5
✅ Connected to BizObs API
✅ Continuous journey generation started

🔄 Running batch at 2026-02-04T10:30:00.000Z
✅ [1] Journey completed: Alice Johnson - E-Commerce Journey
✅ [2] Journey completed: Wayne Enterprises - Banking Journey
✅ [3] Journey completed: Bob Smith - E-Commerce Journey
✅ [4] Journey completed: Stark Industries - Banking Journey
✅ [5] Journey completed: Carol Williams - E-Commerce Journey
📊 Stats - Total: 5, Errors: 0, Success Rate: 100.0%

🔄 Running batch at 2026-02-04T10:30:30.000Z
✅ [6] Journey completed: Umbrella Corporation - Banking Journey
❌ Journey failed: Alice Johnson - 500
✅ [7] Journey completed: Wayne Enterprises - Banking Journey
✅ [8] Journey completed: Bob Smith - E-Commerce Journey
✅ [9] Journey completed: Carol Williams - E-Commerce Journey
📊 Stats - Total: 9, Errors: 1, Success Rate: 90.0%
```

## 🛠️ Configuration Options

| Environment Variable | Description | Default | Example |
|---------------------|-------------|---------|---------|
| `ENABLE_CONTINUOUS_JOURNEYS` | Enable/disable auto-generation | `false` | `true` |
| `JOURNEY_INTERVAL_MS` | Milliseconds between batches | `30000` | `15000` |
| `JOURNEY_BATCH_SIZE` | Journeys per batch | `5` | `10` |
| `BIZOBS_API_URL` | BizObs API endpoint | `http://localhost:8080` | `http://localhost:8080` |

## 🎭 Use Cases

### 1. Load Testing
Generate constant traffic to test performance under load:
```bash
export ENABLE_CONTINUOUS_JOURNEYS=true
export JOURNEY_INTERVAL_MS=5000    # Every 5 seconds
export JOURNEY_BATCH_SIZE=20        # 20 journeys per batch
npm start
```

**Result**: 240 journeys per minute (20 × 12)

### 2. Self-Healing Demo
Trigger self-healing workflows with continuous errors:
```bash
export ENABLE_CONTINUOUS_JOURNEYS=true
export JOURNEY_INTERVAL_MS=10000    # Every 10 seconds
export JOURNEY_BATCH_SIZE=10        # 10 journeys
npm start
```

**Flow**:
1. Generator creates journeys with some errors
2. Davis detects high error rate
3. Workflow disables `errorInjectionEnabled`
4. Errors stop automatically
5. Problem resolves
6. Recovery workflow re-enables flag

### 3. Demo Environment
Keep demo always active with realistic data:
```bash
export ENABLE_CONTINUOUS_JOURNEYS=true
export JOURNEY_INTERVAL_MS=30000    # Every 30 seconds
export JOURNEY_BATCH_SIZE=5         # 5 journeys
npm start
```

**Result**: 10 journeys per minute, continuous BizEvents

### 4. Observability Testing
Generate data for dashboard and metric testing:
```bash
export ENABLE_CONTINUOUS_JOURNEYS=true
export JOURNEY_INTERVAL_MS=20000    # Every 20 seconds
export JOURNEY_BATCH_SIZE=8         # 8 journeys
npm start
```

**Result**: 24 journeys per minute, rich trace and metric data

## 🔍 Monitoring Journey Generation

### In BizObs Console
Watch real-time journey completions in server console:
```
[Continuous Journey] ✅ [142] Journey completed: Alice Johnson - E-Commerce Journey
[Continuous Journey] 📊 Stats - Total: 142, Errors: 3, Success Rate: 97.9%
```

### In Dynatrace

#### Query journey completions:
```dql
fetch bizevents
| filter event.provider == "BizObs"
| summarize count(), by: {journey.name, customer.name}
| sort count desc
```

#### Track error rate:
```dql
fetch bizevents
| filter event.provider == "BizObs"
| summarize 
    total = count(),
    errors = countIf(contains(status, "error"))
| fieldsAdd error_rate = (errors / total) * 100
```

#### Monitor self-healing actions:
```dql
fetch events
| filter event.type == "CUSTOM_DEPLOYMENT"
| filter contains(properties["application"], "BizObs")
| fields timestamp, properties["feature.flag"], properties["new.value"]
| sort timestamp desc
```

## 🛑 Stopping Generation

### Option 1: Stop BizObs
```bash
# Press Ctrl+C in terminal
^C
🛑 Received SIGINT, shutting down gracefully...
[Continuous Journey] Stopping generator...
```

### Option 2: Disable and Restart
```bash
# Unset environment variable
unset ENABLE_CONTINUOUS_JOURNEYS

# Restart BizObs
npm start
```

## 🐛 Troubleshooting

### Generator not starting
**Symptom**: No journey logs in console

**Solutions**:
1. Check environment variable:
   ```bash
   echo $ENABLE_CONTINUOUS_JOURNEYS
   # Should output: true
   ```

2. Verify BizObs server running:
   ```bash
   curl http://localhost:8080/health
   ```

### All journeys failing
**Symptom**: `❌ Journey failed` messages

**Solutions**:
1. Check BizObs API is accessible:
   ```bash
   curl http://localhost:8080/api/journey-simulation/simulate-journey
   ```

2. Check service-manager status:
   ```bash
   # In BizObs UI, check Services tab
   # All services should show "running"
   ```

3. Review error logs in console

### High error rate
**Symptom**: Success rate < 90%

**Expected behavior** if `errorInjectionEnabled=true`:
- Umbrella Corporation has 30% error rate (by design)
- Self-healing workflow will disable flag when errors spike
- Error rate should drop to near 0% after flag disabled

**Unexpected behavior**:
- Check service health
- Review journey-simulation.js error logic
- Check feature flag status: `curl http://localhost:8080/api/remediation/feature-flags`

## 🔗 Integration with Self-Healing

The continuous journey generator is designed to work seamlessly with self-healing workflows:

### Complete Flow

```
1. Generator ON + errorInjectionEnabled=true
   └─> Creates journeys with realistic errors
   
2. Error rate increases (>5%)
   └─> Davis Problem detected
   
3. Self-Healing Workflow triggered
   └─> POST /api/remediation/feature-flag
   └─> errorInjectionEnabled = false
   └─> CUSTOM_DEPLOYMENT event sent
   
4. Generator continues (errorInjectionEnabled=false)
   └─> Journeys complete without errors
   └─> Error rate drops
   
5. Problem resolves
   └─> Auto-Recovery Workflow triggered
   └─> errorInjectionEnabled = true
   └─> CUSTOM_DEPLOYMENT event sent
   
6. Back to step 1 (realistic simulation continues)
```

### Benefits

✅ **Fully automated** - No manual intervention needed
✅ **Realistic behavior** - Mirrors production scenarios
✅ **Self-correcting** - Workflows remediate issues automatically
✅ **Complete audit trail** - All changes tracked in Dynatrace Events
✅ **Continuous data** - Always-on observability

## 📝 Adding Custom Journeys

Edit `scripts/continuous-journey-generator.js` to add your own templates:

```javascript
const journeyTemplates = [
  {
    name: 'My Custom Journey',
    customers: ['Customer A', 'Customer B', 'Customer C'],
    steps: [
      { stepName: 'Step 1', serviceName: 'Service1' },
      { stepName: 'Step 2', serviceName: 'Service2' },
      { stepName: 'Step 3', serviceName: 'Service3' }
    ]
  },
  // ... existing templates
];
```

Restart BizObs to apply changes.

## 🎉 Best Practices

1. **Start small**: Begin with default settings (30s, 5 journeys)
2. **Monitor resources**: Watch CPU/memory usage during load testing
3. **Use in dev/test**: Don't enable in production without proper sizing
4. **Combine with self-healing**: Enable workflows for realistic demo
5. **Check Dynatrace**: Verify BizEvents and metrics are captured
6. **Adjust interval**: Tune `JOURNEY_INTERVAL_MS` based on your needs

---

**Ready to go?** Enable continuous journeys and watch your BizObs come to life! 🚀
