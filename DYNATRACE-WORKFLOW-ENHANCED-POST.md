# Dynatrace Self-Healing Workflow - Enhanced POST Endpoint

## Overview

The Feature Flag API POST endpoint has been enhanced to accept the **full GET response payload directly**, eliminating the need for payload extraction in your Dynatrace workflows.

---

## How It Works

### Before (Old Method):
1. GET `/api/feature_flag` → Returns full response
2. Extract `currently_running.companies` from response
3. POST with extracted array: `{"action": "disable", "companies": [...]}`

### After (Enhanced Method):
1. GET `/api/feature_flag` → Returns full response
2. POST the entire GET response → Endpoint automatically extracts and processes
3. Returns detailed change summary

---

## Enhanced POST Endpoint Behavior

### Automatic Detection

The POST endpoint now detects three types of payloads:

1. **Full GET Response** (NEW - recommended for workflows):
   ```json
   {
     "success": true,
     "flags": {...},
     "currently_running": {
       "companies": ["Retail", "BT"],
       "journeys": [],
       ...
     }
   }
   ```
   → Automatically extracts companies/journeys and disables errors

2. **Explicit Action**:
   ```json
   {
     "action": "disable",
     "companies": ["Retail", "BT"]
   }
   ```

3. **Direct Flag Update**:
   ```json
   {
     "flags": {
       "errors_per_transaction": 0
     }
   }
   ```

---

## Enhanced Response Format

When you POST the full GET payload, you get a detailed response showing:

```json
{
  "success": true,
  "message": "Feature flags disabled for 4 companies",
  "action": "disable",
  "changes": [
    {
      "flag": "errors_per_transaction",
      "previous_value": 0.1,
      "new_value": 0
    }
  ],
  "applied_to": {
    "companies": ["Retail", "BT", "Banking", "TestCo"],
    "journeys": "all",
    "total_affected": 4
  },
  "flags": {
    "errors_per_transaction": 0,
    "errors_per_visit": 0.001,
    "errors_per_minute": 0.5,
    "regenerate_every_n_transactions": 100
  },
  "previous_flags": {
    "errors_per_transaction": 0.1,
    "errors_per_visit": 0.001,
    "errors_per_minute": 0.5,
    "regenerate_every_n_transactions": 100
  },
  "timestamp": "2026-02-12T13:58:14.216Z"
}
```

### Key Response Fields:

| Field | Description |
|-------|-------------|
| **`changes`** | Array of modifications showing flag name, previous value, and new value |
| **`applied_to.companies`** | List of affected company names |
| **`applied_to.total_affected`** | Count of affected entities |
| **`flags`** | Current flag values **after** the change |
| **`previous_flags`** | Flag values **before** the change |
| **`message`** | Human-readable summary (e.g., "Feature flags disabled for 4 companies") |

---

## Simplified Dynatrace Workflow

### Workflow JSON (with Enhanced POST)

```json
{
  "title": "Self-Healing - Disable Errors (Enhanced)",
  "description": "Uses direct payload forwarding - no extraction needed",
  "trigger": {
    "eventTrigger": {
      "filterQuery": "event.type == \"PROBLEM_OPEN\" AND matchesPhrase(event.title, \"error rate\")"
    }
  },
  "tasks": {
    "get_running_companies": {
      "name": "get_running_companies",
      "action": "dynatrace.http.request:1",
      "description": "Get currently running companies",
      "input": {
        "method": "GET",
        "url": "http://3.209.41.33:8080/api/feature_flag"
      },
      "position": {
        "x": 0,
        "y": 1
      }
    },
    "disable_errors": {
      "name": "disable_errors",
      "action": "dynatrace.http.request:1",
      "description": "Send entire GET response to disable errors",
      "input": {
        "method": "POST",
        "url": "http://3.209.41.33:8080/api/feature_flag",
        "headers": {
          "Content-Type": "application/json"
        },
        "payload": "{{ result(\"get_running_companies\").body }}"
      },
      "position": {
        "x": 0,
        "y": 2
      },
      "predecessors": ["get_running_companies"]
    },
    "log_changes": {
      "name": "log_changes",
      "action": "dynatrace.log.event:1",
      "description": "Log what was changed",
      "input": {
        "message": "Self-Healing: {{ result(\"disable_errors\").body.message }}. Changed {{ result(\"disable_errors\").body.changes[0].flag }} from {{ result(\"disable_errors\").body.changes[0].previous_value }} to {{ result(\"disable_errors\").body.changes[0].new_value }}. Affected companies: {{ result(\"disable_errors\").body.applied_to.companies | join(\", \") }}"
      },
      "position": {
        "x": 0,
        "y": 3
      },
      "predecessors": ["disable_errors"]
    }
  }
}
```

### Key Simplifications:

1. **No payload extraction needed** - Just use `{{ result("get_running_companies").body }}`
2. **Detailed logging available** - Access `changes`, `previous_flags`, and `applied_to` fields
3. **Count tracking** - Use `applied_to.total_affected` for metrics

---

## Command-Line Testing

### Test the 2-Step Enhanced Workflow:

```bash
# Step 1: GET currently running companies
RESULT=$(curl -s http://3.209.41.33:8080/api/feature_flag)

# Step 2: POST entire result directly (no extraction needed!)
curl -X POST http://3.209.41.33:8080/api/feature_flag \
  -H "Content-Type: application/json" \
  -d "$RESULT" | python3 -c "import sys, json; print(json.dumps(json.load(sys.stdin), indent=2))"
```

### Pretty-Print the Changes:

```bash
# Get and disable in one pipeline
curl -s http://3.209.41.33:8080/api/feature_flag | \
  curl -X POST http://3.209.41.33:8080/api/feature_flag \
    -H "Content-Type: application/json" \
    -d @- | \
  python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"✅ {d['message']}\")
print(f\"\\nChanges:\")
for change in d['changes']:
    print(f\"  • {change['flag']}: {change['previous_value']} → {change['new_value']}\")
print(f\"\\nAffected: {', '.join(d['applied_to']['companies'])} ({d['applied_to']['total_affected']} total)\")
"
```

**Output Example:**
```
✅ Feature flags disabled for 4 companies

Changes:
  • errors_per_transaction: 0.1 → 0

Affected: Retail, BT, Banking, TestCo (4 total)
```

---

## Re-Enable Errors

To turn errors back on, use the explicit action format:

```bash
curl -X POST http://3.209.41.33:8080/api/feature_flag \
  -H "Content-Type: application/json" \
  -d '{
    "action": "enable",
    "companies": ["Retail", "BT", "Banking", "TestCo"]
  }' | python3 -c "import sys, json; print(json.dumps(json.load(sys.stdin), indent=2))"
```

Or simply reset all flags:

```bash
curl -X DELETE http://3.209.41.33:8080/api/feature_flag/errors_per_transaction
```

---

## Benefits of Enhanced POST

✅ **Simpler Workflows** - No payload extraction needed  
✅ **Detailed Change Tracking** - Before/after values for all changes  
✅ **Count Metrics** - Know exactly how many entities were affected  
✅ **Better Logging** - Message field provides human-readable summaries  
✅ **Backward Compatible** - Old workflows still work  
✅ **Automatic Detection** - Endpoint intelligently handles all payload formats

---

## Workflow Comparison

### Old Workflow (3 lines of config):
```json
{
  "payload": "{ \"action\": \"disable\", \"companies\": {{ result(\"step1\").body.currently_running.companies }} }"
}
```

### New Workflow (1 line of config):
```json
{
  "payload": "{{ result(\"step1\").body }}"
}
```

**Result**: Simpler configuration, more detailed response!

---

## Error Handling

If you send an invalid payload, you'll get helpful guidance:

```json
{
  "success": false,
  "error": "Missing action or valid payload in request body",
  "hint": "Send the full GET response from /api/feature_flag, or specify action: \"disable\"|\"enable\"",
  "expected": {
    "option1": "Send full GET /api/feature_flag response",
    "option2": {
      "action": "disable|enable",
      "companies": ["CompanyName"]
    },
    "option3": {
      "flags": { "errors_per_transaction": 0 }
    }
  }
}
```

---

## Related Documentation

- [Feature Flag API Quick Reference](FEATURE-FLAG-API-QUICK-REFERENCE.md)
- [Dynatrace Self-Healing Workflow Guide](DYNATRACE-SELF-HEALING-WORKFLOW.md)
- [2-Step Workflow Pattern (Original)](DYNATRACE-WORKFLOW-2-STEP-PATTERN.md)
- [Workflow Deployment Status](WORKFLOW-DEPLOYMENT-STATUS.md)

---

**Last Updated**: 2026-02-12  
**Feature Added**: Enhanced POST endpoint with automatic payload detection and detailed change tracking
