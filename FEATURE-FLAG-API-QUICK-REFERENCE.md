# 🚀 Feature Flag API - Quick Reference

**Base URL**: `http://your-server:8080/api/feature_flag`  
**⚠️ Important**: Use **HTTP** not HTTPS (port 8080 is HTTP only)

## RESTful Design

| HTTP Method | Endpoint | Action | Body | Query Params |
|------------|----------|--------|------|--------------|
| **GET** | `/api/feature_flag` | Get all flags | - | `?journey=X&companyName=Y` |
| **GET** | `/api/feature_flag/:flag_name` | Get specific flag | - | - |
| **PUT** | `/api/feature_flag/:flag_name` | Set flag value | `{"value": X}` | - |
| **DELETE** | `/api/feature_flag/:flag_name` | Reset to default | - | - |

---

## Available Flags

```javascript
{
  errors_per_transaction: 0.1,        // 10% error rate (0-1)
  errors_per_visit: 0.001,            // 0.1% error rate
  errors_per_minute: 0.5,             // 0.5 errors per minute
  regenerate_every_n_transactions: 100 // Regenerate flags every 100 transactions
}
```

---

## Common Use Cases

### Get All Flags (Global)
```bash
curl http://3.209.41.33:8080/api/feature_flag
```

### Get Flags for Specific Journey
```bash
curl "http://3.209.41.33:8080/api/feature_flag?journey=Banking-Mortgage"
```

### Get Flags for Specific Company
```bash
curl "http://3.209.41.33:8080/api/feature_flag?companyName=BT"
```

### Get Flags for Journey + Company
```bash
curl "http://3.209.41.33:8080/api/feature_flag?journey=Retail-Checkout&companyName=Amazon"
```

**Response:**
```json
{
  "success": true,
  "flags": {
    "errors_per_transaction": 0.1,
    "errors_per_visit": 0.001,
    "errors_per_minute": 0.5,
    "regenerate_every_n_transactions": 100
  },
  "defaults": {...},
  "filter": {
    "journey": "Retail-Checkout",
    "company": "Amazon"
  },
  "timestamp": "2026-02-12T...",
  "note": "Currently returns global flags. Per-journey/company overrides can be added in future."
}
```

### Self-Healing (Disable Errors)
```bash
curl -X PUT http://3.209.41.33:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0}'
```

### Reset After 1000 Customers
```bash
curl -X DELETE http://3.209.41.33:8080/api/feature_flag/errors_per_transaction
```

### Set Custom Error Rate (5%)
```bash
curl -X PUT http://3.209.41.33:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0.05}'
```

### Get Current Value
```bash
curl http://3.209.41.33:8080/api/feature_flag/errors_per_transaction
```

---

## ⚠️ HTTPS vs HTTP

**❌ Wrong (will fail with TLS error):**
```bash
curl https://3.209.41.33:8080/api/feature_flag
# Error: client error (Connect): received corrupt message of type InvalidContentType
```

**✅ Correct:**
```bash
curl http://3.209.41.33:8080/api/feature_flag
```

Port 8080 is HTTP only. If you need HTTPS, use a reverse proxy (nginx) or add TLS to the Node.js server.

---

## Response Format

### Full Response Example

```json
{
  "success": true,
  "flags": {
    "errors_per_transaction": 0.1,
    "errors_per_visit": 0.001,
    "errors_per_minute": 0.5,
    "regenerate_every_n_transactions": 100
  },
  "defaults": {
    "errors_per_transaction": 0.1,
    "errors_per_visit": 0.001,
    "errors_per_minute": 0.5,
    "regenerate_every_n_transactions": 100
  },
  "currently_running": {
    "companies": ["BT", "Retail", "Banking"],
    "journeys": ["Telecom-ServiceActivation", "Retail-Checkout"],
    "active_by_company": {
      "BT": {
        "companyName": "BT",
        "industry": "Telecommunications",
        "domain": "www.bt.com",
        "services": ["OrderPlacementService-BT", "EligibilityCheckService-BT"],
        "journeyType": "Telecom-ServiceActivation"
      },
      "Retail": {
        "companyName": "Retail",
        "domain": "https://www.retail.com",
        "services": ["CheckoutService-Retail", "BasketCreationService-Retail"],
        "journeyType": "Retail-Checkout"
      }
    },
    "total_companies": 3,
    "total_journeys": 2
  },
  "filter": {
    "journey": null,
    "company": null
  },
  "timestamp": "2026-02-12T13:50:58.417Z"
}
```

**Key Fields:**
- `flags` - Current feature flag values (global)
- `defaults` - Default values for reference
- `currently_running` - **Real-time data** of what's actually running:
  - `companies` - Array of active company names
  - `journeys` - Array of active journey types
  - `active_by_company` - Detailed breakdown with services, industry, domain per company
  - `total_companies` - Count of active companies
  - `total_journeys` - Count of active journey types
- `filter` - Shows any query filters applied
- `timestamp` - Response timestamp

---

## Dynatrace Workflow Integration

**⚠️ Important**: Use `http://` not `https://` in workflow URLs

### Disable on Problem (Self-Healing)
```json
{
  "action": "HTTP Request",
  "method": "PUT",
  "url": "http://3.209.41.33:8080/api/feature_flag/errors_per_transaction",
  "headers": {"Content-Type": "application/json"},
  "body": {"value": 0}
}
```

### Reset After Problem Closes
```json
{
  "action": "HTTP Request",
  "method": "DELETE",
  "url": "http://3.209.41.33:8080/api/feature_flag/errors_per_transaction"
}
```

### Get Flags for Specific Journey (Monitoring)
```json
{
  "action": "HTTP Request",
  "method": "GET",
  "url": "http://3.209.41.33:8080/api/feature_flag?journey={{event.journey}}&companyName={{event.company}}"
}
```

---

## Response Examples

### Successful PUT
```json
{
  "success": true,
  "flag": "errors_per_transaction",
  "value": 0,
  "previous_value": 0.1,
  "message": "Feature flag 'errors_per_transaction' updated",
  "timestamp": "2026-02-12T13:44:57.805Z"
}
```

### Successful DELETE
```json
{
  "success": true,
  "flag": "errors_per_transaction",
  "value": 0.1,
  "previous_value": 0,
  "message": "Feature flag 'errors_per_transaction' reset to default",
  "timestamp": "2026-02-12T13:44:57.894Z"
}
```

### Error - Flag Not Found
```json
{
  "success": false,
  "error": "Feature flag 'invalid_flag' not found",
  "available_flags": [
    "errors_per_transaction",
    "errors_per_visit",
    "errors_per_minute",
    "regenerate_every_n_transactions"
  ]
}
```

---

## Server Logs

### Disable (Self-Healing)
```
⏸️  [Feature Flags API] errors_per_transaction: 0.1 → 0 (DISABLED - Self-healing active!)
```

### Reset to Default
```
🔄 [Feature Flags API] errors_per_transaction RESET: 0 → 0.1 (default)
```

### Custom Value
```
🎛️  [Feature Flags API] errors_per_transaction: 0.1 → 0.05
```

---

## Backward Compatibility

Old `/api/error-config` API still works:

```bash
# Old way (deprecated)
curl -X POST http://localhost:8080/api/error-config \
  -H "Content-Type: application/json" \
  -d '{"action": "disable"}'

# Logs: ⚠️ [Legacy API] /api/error-config POST called

# New way (recommended)
curl -X PUT http://localhost:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0}'
```

---

## Testing

```bash
# Run all tests
echo "=== GET specific flag ===" && \
curl -s http://localhost:8080/api/feature_flag/errors_per_transaction | python3 -m json.tool && \
echo -e "\n=== PUT to disable ===" && \
curl -s -X PUT http://localhost:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0}' | python3 -m json.tool && \
echo -e "\n=== DELETE to reset ===" && \
curl -s -X DELETE http://localhost:8080/api/feature_flag/errors_per_transaction | python3 -m json.tool
```

---

## Why This Design?

✅ **RESTful** - Standard HTTP methods match intent  
✅ **Scalable** - Add new flags, they work immediately  
✅ **Intuitive** - `/api/feature_flag/:flag_name` pattern  
✅ **Self-Documenting** - GET returns available flags  
✅ **Type-Safe** - Each flag has its own endpoint  
✅ **Reset-Friendly** - DELETE = back to defaults  
✅ **Future-Proof** - No code changes for new flags  

---

## Adding New Flags (Future)

Just add to `DEFAULT_FEATURE_FLAGS` in server.js:

```javascript
const DEFAULT_FEATURE_FLAGS = {
  errors_per_transaction: 0.1,
  errors_per_visit: 0.001,
  errors_per_minute: 0.5,
  regenerate_every_n_transactions: 100,
  // NEW FLAGS - instantly available!
  slow_response_enabled: false,
  cache_miss_rate: 0.05
};
```

Now you can use them immediately:

```bash
curl -X PUT http://localhost:8080/api/feature_flag/slow_response_enabled \
  -H "Content-Type: application/json" \
  -d '{"value": true}'

curl -X DELETE http://localhost:8080/api/feature_flag/cache_miss_rate
```

**No endpoint code changes needed!** 🎉
