# LoadRunner Service Implementation

## Overview
Unified LoadRunner service architecture to ensure consistent bizevent generation across all journey steps.

## Problem Solved
- **Before**: Separate loadrunner-simulator.js processes per company using static test-config.json files
- **Issue**: Only step 1 (PackageSelection) generated bizevents despite all services executing
- **Root Cause**: Different payload structure between manual simulation and LoadRunner
- **After**: Single LoadRunner Service that uses same code path as manual "Run Journey Simulation" button

## Architecture

### New Endpoints

#### POST /api/loadrunner-service/start
Starts continuous load test using journey data from UI.

**Request:**
```json
{
  "journey": {
    "companyName": "BT",
    "domain": "bt.com",
    "industryType": "Telecommunications",
    "journeyType": "Purchase Journey",
    "steps": [...]
  },
  "customerProfile": {...},
  "traceMetadata": {...},
  "additionalFields": {...},
  "ratePerMinute": 2
}
```

**Response:**
```json
{
  "success": true,
  "loadTestId": "load_1770826582_a3f8d4e1",
  "companyName": "BT",
  "ratePerMinute": 2,
  "message": "Load test started for BT",
  "stepsCount": 6
}
```

#### POST /api/loadrunner-service/stop
Stops a running load test.

**Request:**
```json
{
  "loadTestId": "load_1770826582_a3f8d4e1"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Load test stopped",
  "stats": {
    "iterationCount": 47,
    "successCount": 47,
    "errorCount": 0
  }
}
```

#### GET /api/loadrunner-service/status
Get status of all active load tests.

**Response:**
```json
{
  "activeTests": 1,
  "tests": [
    {
      "id": "load_1770826582_a3f8d4e1",
      "companyName": "BT",
      "ratePerMinute": 2,
      "startTime": "2026-02-11T15:56:22.850Z",
      "runtime": 142,
      "stepsCount": 6,
      "iterations": 5,
      "success": 5,
      "errors": 0,
      "successRate": "100.00%"
    }
  ]
}
```

#### POST /api/loadrunner-service/stop-all
Stops all running load tests.

## UI Integration

### New Buttons in Step 4 (Single Simulation Mode)

1. **⚡ Start Continuous Load (LoadRunner)** - Starts load test with current journey
2. **⏹️ Stop LoadRunner** - Stops active load test
3. **Status Display** - Shows real-time stats: `47 journeys | 47 ✓ | 0 ✗ | 100.00%`

### Workflow

1. **Process Journey** (Step 3) → Journey data stored in `window.currentJourneyData`
2. **Click "Start Continuous Load"** → Prompts for rate (req/min)
3. **LoadRunner Service** → Spawns setInterval, repeatedly calls `/api/journey-simulation/simulate-journey`
4. **Each Iteration** → New correlationId, random customer profile, same journey structure
5. **Monitor Status** → UI polls `/api/loadrunner-service/status` every 5 seconds
6. **Stop When Done** → Click "Stop LoadRunner" to halt generation

## Benefits

### ✅ Guaranteed Bizevent Generation
- Uses **exact same payload structure** as manual simulation
- All 6 steps generate bizevents (not just step 1)
- Consistent with UI button behavior

### ✅ Dynamic Configuration
- No static test-config.json files needed
- Change journey in UI, restart load with new definition instantly
- No process management (ps, pkill, nohup) required

### ✅ Simplified Architecture
- Single LoadRunner service instead of multiple processes per company
- Centralized load test management
- Real-time status monitoring

### ✅ Better Observability
- Each journey has unique correlationId for tracing
- Customer diversity (8 different profiles, 4 priority levels)
- Clear logging: `[LoadRunner] ✅ lr_journey_xyz - Alice Thompson (Gold) - Critical - Success 47/47`

## Implementation Files

- **Route**: `/home/ec2-user/BizObs Generator/routes/loadrunner-service.js`
- **Server Registration**: `/home/ec2-user/BizObs Generator/server.js` (line ~30, ~401)
- **UI Buttons**: `/home/ec2-user/BizObs Generator/public/index.html` (lines 746-760)
- **UI Functions**: `/home/ec2-user/BizObs Generator/public/index.html` (lines 1490-1606)

## Migration from Old LoadRunner

### Old Approach (Deprecated)
```bash
# Separate process per company
cd "/home/ec2-user/BizObs Generator"
nohup node scripts/loadrunner-simulator.js loadrunner-tests/BT light-load &
```

### New Approach (Recommended)
```javascript
// From UI: Click "Start Continuous Load" button
// Internally calls:
POST /api/loadrunner-service/start
{
  journey: window.currentJourneyData.journey,
  ratePerMinute: 2
}
```

### Verification

Check DQL after 5 minutes of load:
```dql
fetch bizevents
| filter json.companyName == "BT"
| filter timestamp > now() - 5m
| summarize OrdersInStep = count(), by: {json.stepName}
| sort OrdersInStep desc
```

**Expected Result**: All 6 steps with similar counts (±10% variance)
```
PackageSelection: 10
EligibilityCheck: 10
OrderPlacement: 10
AppointmentScheduling: 10
EquipmentDispatch: 10
InstallationAndActivation: 10
```

## Troubleshooting

### Issue: LoadRunner button not appearing
- **Check**: Browser console for JavaScript errors
- **Fix**: Hard refresh (Ctrl+Shift+R) to clear cache

### Issue: "No journey data available"
- **Check**: Process journey in Step 3 first
- **Fix**: Make sure `window.currentJourneyData` has journey.steps array

### Issue: Load test starts but no bizevents
- **Check**: Service logs for errors: `tail -f logs/bizobs.log | grep LoadRunner`
- **Check**: Journey simulation endpoint working: `curl localhost:8080/api/journey-simulation/health`
- **Fix**: Verify all 6 child services running: `ps aux | grep Service | grep -v grep`

### Issue: UI status not updating
- **Check**: Browser console for polling errors
- **Fix**: Ensure `/api/loadrunner-service/status` endpoint accessible

## Performance Notes

- **Memory**: Each active load test adds ~10MB overhead
- **CPU**: Negligible (setInterval loop, no heavy computation)
- **Network**: HTTP requests to localhost (no external traffic)
- **Recommended Max**: 5 simultaneous load tests (10 req/min each = 50 req/min total)

## Future Enhancements

- [ ] Rate presets: Light (2/min), Medium (10/min), Heavy (60/min)
- [ ] Error injection: Random failures at configurable rate
- [ ] Duration limit: Auto-stop after N minutes
- [ ] History: Store past load test results
- [ ] Export: Download stats as CSV/JSON
- [ ] Multi-company: Start load tests for multiple companies simultaneously
- [ ] Throttling: Adaptive rate based on error rate

---

**Status**: ✅ Implemented and tested
**Date**: February 11, 2026
**Version**: 1.0.0
