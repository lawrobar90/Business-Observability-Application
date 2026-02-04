# 🚀 Quick Start: Automated Dynatrace Configuration

This guide shows you how to automatically configure all required Dynatrace settings for the BizObs application.

## ⚡ Fastest Method (Node.js Script)

### Prerequisites
1. **Create an API Token**:
   - Go to Dynatrace → **Settings** → **Access tokens** → **Generate new token**
   - Name: `BizObs Configuration`
   - Required scopes:
     - ✓ `Read settings` (`settings.read`)
     - ✓ `Write settings` (`settings.write`)
     - ✓ `Read configuration` (`ReadConfig`)
     - ✓ `Write configuration` (`WriteConfig`)
   - Copy the token (starts with `dt0c01.`)

### Deploy Configuration

```bash
# 1. Set environment variables
export DT_ENVIRONMENT='https://your-tenant.dynatrace.com'
export DT_API_TOKEN='dt0c01.XXX...'

# 2. Run automated configuration
npm run configure:dynatrace
```

**That's it!** ✅ All configurations including OneAgent features will be deployed automatically.

---

## 🔧 Alternative: Monaco (Monitoring as Code)

If you prefer using Monaco CLI:

### Install Monaco
```bash
# macOS/Linux with Homebrew
brew install dynatrace/dynatrace/monaco

# Or download binary
curl -L https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-linux-amd64 -o monaco
chmod +x monaco
sudo mv monaco /usr/local/bin/
```

### Deploy with Monaco
```bash
# Set environment variables
export DT_ENVIRONMENT='https://your-tenant.dynatrace.com'
export DT_API_TOKEN='dt0c01.XXX...'

# Deploy
npm run configure:monaco
```

---

## ⚙️ What Gets Configured

The automated deployment configures:

### 0. **OneAgent Features** ✨ NEW - Now Automated!
- **Node.js Business Events**: Enabled automatically
- No manual UI steps required!

### 1. **Business Event Capture Rule**
- **Name**: BizObs App
- **Trigger**: Captures requests to `/process` endpoint
- **Data Extraction**:
  - Event Provider: `companyName` from request body
  - Event Type: `stepName` from request body
  - Category: "BizObs App"
  - Full request body stored in `rqBody` field

### 2. **Service Naming Rule**
- **Name**: Holistic API Rules
- **Format**: `{ProcessGroup:DetectedName}`
- **Ensures consistent service naming across all BizObs services**

### 3. **OpenPipeline Pipeline**
- **Name**: BizObs Template Pipeline
- **Processor 1 - JSON Parser**:
  ```dql
  parse rqBody, "JSON:json" 
  | fieldsFlatten json 
  | parse json.additionalFields, "JSON:additionalFields" 
  | fieldsFlatten json.additionalFields, prefix:"additionalfields."
  ```
- **Processor 2 - Error Field**:
  ```dql
  fieldsAdd event.type = if(json.hasError == true, 
    concat(event.type, ``, " - Exception"), 
    else:{`event.type`})
  ```

### 4. **Dynamic Routing**
- **Name**: BizObs App
- **Condition**: `matchesValue(event.category, "BizObs App")`
- **Target**: Routes events to BizObs Template Pipeline

---

## ✅ No Manual Steps Required!

Everything is now fully automated! After running the configuration:

### 1. Restart Node.js Application (Recommended)
```bash
# If running locally
./restart.sh

# If in Codespaces
pkill -f "node server.js" && bash .devcontainer/start-app.sh
```

### 2. Run Test Simulations
- Open BizObs UI (port 8080)
- Create a customer journey
- Start simulation
- Observe events flowing into Dynatrace

---

## ✅ Validation

### Check Configuration in Dynatrace UI

1. **Business Event Capture Rule**:
   ```
   Settings → Business Analytics → OneAgent
   → Look for "BizObs App" capture rule
   ```

2. **Service Naming**:
   ```
   Settings → Server-side Service monitoring → Service naming rules
   → Look for "Holistic API Rules"
   ```

3. **OpenPipeline**:
   ```
   OpenPipeline → Business events → Pipelines
   → Look for "BizObs Template Pipeline"
   ```

4. **Dynamic Routing**:
   ```
   OpenPipeline → Business events → Dynamic routing
   → Look for "BizObs App" (should be ENABLED)
   ```

### Validate with DQL Queries

Open **Notebooks** and run these queries:

**Check if events are being captured:**
```dql
fetch bizevents
| filter isNotNull(rqBody)
| filter matchesValue(event.category, "BizObs App")
| summarize count(), by:{event.type, json.stepName}
| sort count() desc
```

**View events for specific company:**
```dql
fetch bizevents
| filter json.companyName == "YOUR_COMPANY_NAME"
| summarize count(), by:{event.type, json.stepIndex, json.stepName}
| sort json.stepIndex asc
```

**Expected result**: You should see 12+ event types (6 journey steps + 6 error variants)

---

## 🚨 Troubleshooting

### "Insufficient permissions" error
- Your API token needs `settings.write` scope
- Recreate token with all required scopes listed above

### "Schema not found" error
- Your Dynatrace version might not support Settings API v2
- Try manual configuration following [DynatraceConfig.md](../DynatraceConfig.md)

### Pipeline not receiving events
1. Check Dynamic Routing is **ENABLED**
2. Verify Business Event Capture Rule has correct trigger (`/process`)
3. Ensure OneAgent Features is enabled (Node.js Business Events)
4. Restart Node.js application

### No events appearing in Dynatrace
1. Check OneAgent is installed and running
2. Verify application is instrumented (check Smartscape)
3. Run test simulation and wait 1-2 minutes for processing
4. Check incoming business events: `fetch bizevents | limit 100`

---

## 📚 Additional Resources

- **Full Manual Guide**: [DynatraceConfig.md](../DynatraceConfig.md)
- **Monaco Documentation**: [dynatrace-monaco/README.md](../dynatrace-monaco/README.md)
- **Dynatrace Settings API**: https://www.dynatrace.com/support/help/dynatrace-api/environment-api/settings
- **Business Events**: https://www.dynatrace.com/support/help/how-to-use-dynatrace/business-analytics

---

## 🎯 Next Steps

After successful configuration:

1. ✅ Create customer journeys in BizObs UI
2. ✅ Run simulations with different personas
3. ✅ Deploy dashboards via MCP server (click "Deploy to Dynatrace")
4. ✅ View business metrics in Dynatrace Notebooks
5. ✅ Analyze journey performance and errors

**Happy observing! 🎉**
