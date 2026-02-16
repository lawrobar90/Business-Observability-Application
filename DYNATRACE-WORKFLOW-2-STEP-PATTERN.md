# 🔄 Dynatrace Workflow - 2-Step Feature Flag Control

## Overview

This workflow demonstrates how to:
1. **GET** currently running companies/journeys from the Feature Flag API
2. **POST** to disable errors for those specific companies using the response from step 1

## Workflow Configuration

### Step 1: Get Currently Running Companies

**Action**: HTTP Request  
**Method**: GET  
**URL**: `http://3.209.41.33:8080/api/feature_flag`

**Response** (saved as `step1_response`):
```json
{
  "success": true,
  "flags": {
    "errors_per_transaction": 0.1,
    "errors_per_visit": 0.001,
    "errors_per_minute": 0.5,
    "regenerate_every_n_transactions": 100
  },
  "currently_running": {
    "companies": ["Retail", "Banking", "TestCo"],
    "journeys": [],
    "active_by_company": {
      "Retail": {
        "companyName": "Retail",
        "domain": "https://www.retail.com",
        "services": ["BasketCreationService-Retail", "SlotSelectionService-Retail"],
        "journeyType": null
      },
      "Banking": {
        "companyName": "Banking",
        "domain": "https://www.banking.com",
        "services": ["CustomerResponseService-Banking"],
        "journeyType": null
      }
    },
    "total_companies": 3,
    "total_journeys": 0
  },
  "timestamp": "2026-02-12T13:52:59.916Z"
}
```

### Step 2: Disable Errors for Those Companies

**Action**: HTTP Request  
**Method**: POST  
**URL**: `http://3.209.41.33:8080/api/feature_flag`  
**Headers**: `Content-Type: application/json`

**Body** (using data from Step 1):
```json
{
  "action": "disable",
  "companies": "{{ _.step1_response.currently_running.companies }}"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Errors disabled",
  "action": "disable",
  "applied_to": {
    "companies": ["Retail", "Banking", "TestCo"],
    "journeys": "all"
  },
  "flags": {
    "errors_per_transaction": 0,
    "errors_per_visit": 0.001,
    "errors_per_minute": 0.5,
    "regenerate_every_n_transactions": 100
  },
  "timestamp": "2026-02-12T13:53:00.010Z"
}
```

---

## Dynatrace Workflow JSON

```json
{
  "title": "Self-Healing - Disable Errors for Running Companies",
  "description": "Gets currently running companies and disables errors for them",
  "trigger": {
    "eventTrigger": {
      "filterQuery": "event.type == \"PROBLEM_OPEN\" AND matchesPhrase(event.title, \"error rate\")"
    }
  },
  "tasks": {
    "get_running_companies": {
      "name": "get_running_companies",
      "action": "dynatrace.http.request:1",
      "description": "Get currently running companies from Feature Flag API",
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
      "description": "Disable errors for running companies",
      "input": {
        "method": "POST",
        "url": "http://3.209.41.33:8080/api/feature_flag",
        "headers": {
          "Content-Type": "application/json"
        },
        "payload": {
          "action": "disable",
          "companies": "{{ result('get_running_companies').currently_running.companies }}"
        }
      },
      "position": {
        "x": 0,
        "y": 2
      },
      "predecessors": ["get_running_companies"]
    },
    "send_notification": {
      "name": "send_notification",
      "action": "dynatrace.slack:1",
      "description": "Notify team",
      "input": {
        "channel": "#bizobs-alerts",
        "message": "🛡️ Self-Healing Activated!\nDisabled errors for: {{ result('get_running_companies').currently_running.companies | join(', ') }}\nTotal companies affected: {{ result('get_running_companies').currently_running.total_companies }}"
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

---

## POST API Options

### Option 1: Disable with Action Shortcut
```bash
curl -X POST http://3.209.41.33:8080/api/feature_flag \
  -H "Content-Type: application/json" \
  -d '{
    "action": "disable",
    "companies": ["Retail", "Banking"]
  }'
```

### Option 2: Disable with Journeys
```bash
curl -X POST http://3.209.41.33:8080/api/feature_flag \
  -H "Content-Type: application/json" \
  -d '{
    "action": "disable",
    "journeys": ["Retail-Checkout", "Banking-Mortgage"]
  }'
```

### Option 3: Set Specific Flag Values
```bash
curl -X POST http://3.209.41.33:8080/api/feature_flag \
  -H "Content-Type: application/json" \
  -d '{
    "flags": {
      "errors_per_transaction": 0,
      "regenerate_every_n_transactions": 200
    },
    "companies": ["Retail"]
  }'
```

### Option 4: Disable for All (No Filter)
```bash
curl -X POST http://3.209.41.33:8080/api/feature_flag \
  -H "Content-Type: application/json" \
  -d '{
    "action": "disable"
  }'
```

---

## Response Fields

### POST Response
```json
{
  "success": true,
  "message": "Errors disabled",
  "action": "disable",
  "applied_to": {
    "companies": ["Retail", "Banking"],
    "journeys": "all"
  },
  "flags": {
    "errors_per_transaction": 0,
    ...
  },
  "timestamp": "2026-02-12T..."
}
```

**Key Fields:**
- `message` - What action was performed
- `action` - The action that was executed (disable/enable)
- `applied_to.companies` - Which companies were affected
- `applied_to.journeys` - Which journeys were affected
- `flags` - New flag values after the change

---

## Complete Workflow Test

```bash
# Step 1: GET currently running
RESULT=$(curl -s http://3.209.41.33:8080/api/feature_flag)
echo "$RESULT" | jq '.currently_running.companies'

# Output: ["Retail", "Banking", "TestCo"]

# Step 2: Extract companies and POST
COMPANIES=$(echo "$RESULT" | jq '.currently_running.companies')
curl -X POST http://3.209.41.33:8080/api/feature_flag \
  -H "Content-Type: application/json" \
  -d "{\"action\": \"disable\", \"companies\": $COMPANIES}"

# Output:
# {
#   "success": true,
#   "message": "Errors disabled",
#   "applied_to": {
#     "companies": ["Retail", "Banking", "TestCo"],
#     ...
#   },
#   "flags": {
#     "errors_per_transaction": 0,
#     ...
#   }
# }

# Step 3: Verify errors are disabled
curl -s http://3.209.41.33:8080/api/feature_flag | jq '.flags.errors_per_transaction'

# Output: 0
```

---

## Re-enable After Problem Resolves

### Step 1: GET companies (same as before)

### Step 2: Enable errors
```json
{
  "action": "enable",
  "companies": "{{ _.step1_response.currently_running.companies }}"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Errors enabled",
  "applied_to": {
    "companies": ["Retail", "Banking", "TestCo"]
  },
  "flags": {
    "errors_per_transaction": 0.1
  }
}
```

---

## Error Handling

### Missing Action
```bash
curl -X POST http://3.209.41.33:8080/api/feature_flag \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response**:
```json
{
  "success": false,
  "error": "Missing action or flags in request body",
  "expected": {
    "action": "disable|enable",
    "or": {
      "flags": { "errors_per_transaction": 0 }
    },
    "optional": {
      "companies": ["CompanyName"],
      "journeys": ["JourneyType"]
    }
  }
}
```

---

## Benefits

✅ **Dynamic** - Automatically targets currently running companies  
✅ **Workflow-Friendly** - Step 2 uses Step 1's response  
✅ **Flexible** - Can filter by companies, journeys, or both  
✅ **Safe** - Returns what was affected in the response  
✅ **Traceable** - Logs show which companies/journeys were targeted  

---

## Summary

**2-Step Workflow Pattern:**

1. **GET** `/api/feature_flag` → Returns currently running companies/journeys
2. **POST** `/api/feature_flag` with `action: "disable"` and `companies` from Step 1 → Disables errors for those companies

**No manual filtering needed!** The GET automatically returns what's running, and POST uses that data to target the right systems. 🎯
