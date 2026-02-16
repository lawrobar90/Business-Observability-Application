# ✅ Feature Flag API - HTTPS Error Fix

## Problem

```bash
curl https://3.209.41.33:8080/api/feature_flag

[ERROR] TypeError: error sending request for url (https://3.209.41.33:8080/api/feature_flag): 
client error (Connect): received corrupt message of type InvalidContentType
```

## Root Cause

Port **8080** is running **HTTP** (not HTTPS). Using `https://` causes a TLS handshake error.

## Solution

✅ **Use HTTP instead of HTTPS:**

```bash
# ❌ Wrong
curl https://3.209.41.33:8080/api/feature_flag

# ✅ Correct
curl http://3.209.41.33:8080/api/feature_flag
```

---

## Enhanced Feature Flag API

### Query Parameters Added

You can now filter flags by journey and company:

```bash
# Global flags
curl http://3.209.41.33:8080/api/feature_flag

# Filter by journey
curl "http://3.209.41.33:8080/api/feature_flag?journey=Banking-Mortgage"

# Filter by company
curl "http://3.209.41.33:8080/api/feature_flag?companyName=BT"

# Both
curl "http://3.209.41.33:8080/api/feature_flag?journey=Retail-Checkout&companyName=Amazon"
```

### Response Format

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
  "filter": {
    "journey": "Banking-Mortgage",
    "company": "BT"
  },
  "timestamp": "2026-02-12T13:47:54.726Z",
  "note": "Currently returns global flags. Per-journey/company overrides can be added in future."
}
```

**Note**: Currently all queries return the same global flags. The `filter` field shows what was requested. In the future, you could implement per-journey or per-company flag overrides.

---

## All Working Endpoints

### 1. GET All Flags (with optional filters)
```bash
curl http://3.209.41.33:8080/api/feature_flag
curl "http://3.209.41.33:8080/api/feature_flag?journey=X&companyName=Y"
```

### 2. GET Specific Flag
```bash
curl http://3.209.41.33:8080/api/feature_flag/errors_per_transaction
```

### 3. PUT to Update Flag
```bash
curl -X PUT http://3.209.41.33:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0}'
```

### 4. DELETE to Reset Flag
```bash
curl -X DELETE http://3.209.41.33:8080/api/feature_flag/errors_per_transaction
```

---

## Dynatrace Workflow Configuration

### External Requests Allowlist

Add to Dynatrace Settings → General → External Requests:

```
http://3.209.41.33:8080
```

**⚠️ Use `http://` not `https://`**

### Workflow HTTP Action

```json
{
  "action": "HTTP Request",
  "method": "PUT",
  "url": "http://3.209.41.33:8080/api/feature_flag/errors_per_transaction",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "value": 0
  }
}
```

### Dynamic Journey/Company Filtering

```json
{
  "action": "HTTP Request",
  "method": "GET",
  "url": "http://3.209.41.33:8080/api/feature_flag?journey={{event.journey}}&companyName={{event.company}}"
}
```

---

## Testing from Command Line

```bash
# Test global flags
curl http://3.209.41.33:8080/api/feature_flag

# Test with journey filter
curl "http://3.209.41.33:8080/api/feature_flag?journey=Banking-Mortgage"

# Test disable (self-healing)
curl -X PUT http://3.209.41.33:8080/api/feature_flag/errors_per_transaction \
  -H "Content-Type: application/json" \
  -d '{"value": 0}'

# Test reset
curl -X DELETE http://3.209.41.33:8080/api/feature_flag/errors_per_transaction

# Verify
curl http://3.209.41.33:8080/api/feature_flag/errors_per_transaction
```

---

## Future Enhancement: Per-Journey Overrides

If you want different error rates per journey/company in the future:

```javascript
// In server.js
const journeyOverrides = {
  'Banking-Mortgage': {
    errors_per_transaction: 0.15  // Higher error rate for mortgage
  },
  'Retail-Checkout': {
    errors_per_transaction: 0.05  // Lower error rate for checkout
  }
};

app.get('/api/feature_flag', (req, res) => {
  const { journey } = req.query;
  
  // Merge global flags with journey-specific overrides
  const flags = {
    ...globalFeatureFlags,
    ...(journey && journeyOverrides[journey] || {})
  };
  
  res.json({ success: true, flags, ... });
});
```

---

## Summary

✅ **Fixed**: Changed from HTTPS to HTTP  
✅ **Enhanced**: Added query parameters (`?journey=X&companyName=Y`)  
✅ **Tested**: All endpoints working from external IP  
✅ **Documented**: Updated all docs with correct HTTP URLs  

**Use `http://` not `https://` for all API calls!**
