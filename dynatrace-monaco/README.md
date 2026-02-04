# Automated Dynatrace Configuration with Monaco

This directory contains **Monaco (Monitoring as Code)** configurations to automatically deploy all required Dynatrace settings for the BizObs application.

## 🚀 Quick Start

### Prerequisites
1. **Install Monaco CLI**:
   ```bash
   # macOS/Linux
   curl -L https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-linux-amd64 -o monaco
   chmod +x monaco
   sudo mv monaco /usr/local/bin/
   
   # Or via Homebrew
   brew install dynatrace/dynatrace/monaco
   ```

2. **Create API Token**:
   - Go to Dynatrace → Settings → Access tokens
   - Name: `Monaco BizObs Config`
   - Scopes required:
     - ✓ `Read settings`
     - ✓ `Write settings`
     - ✓ `Read configuration`
     - ✓ `Write configuration`
     - ✓ `openpipeline.events`
     - ✓ `openpipeline.events_write`

### Deploy Configuration

1. **Set Environment Variables**:
   ```bash
   export DT_ENVIRONMENT='https://your-tenant.dynatrace.com'
   export DT_API_TOKEN='dt0c01.XXX...'
   ```

2. **Deploy All Configurations**:
   ```bash
   cd dynatrace-monaco
   monaco deploy manifest.yaml
   ```

3. **Verify Deployment**:
   - Check Dynatrace → Settings → Business Analytics → OneAgent
   - Check OpenPipeline → Business events → Pipelines
   - Run a test journey through BizObs app

## 📁 Configuration Structure

```
dynatrace-monaco/
├── manifest.yaml                    # Main deployment manifest
├── environments.yaml                # Environment definitions
├── bizevents-capture-rules/        # Business event capture rules
│   ├── config.yaml
│   └── rule.json
├── service-naming-rules/           # Service naming rules
│   ├── config.yaml
│   └── naming-rule.json
├── openpipeline/                   # OpenPipeline configurations
│   ├── config.yaml
│   ├── pipeline.json
│   └── routing.json
└── oneagent-features/              # OneAgent feature flags
    ├── config.yaml
    └── features.json
```

## 🎯 What Gets Deployed

### 1. OneAgent Features
- ✅ Node.js Business Events enabled

### 2. Business Event Capture Rule
- **Rule Name**: BizObs App
- **Trigger**: Request path starts with `/process`
- **Event Provider**: `companyName` from request body
- **Event Type**: `stepName` from request body
- **Category**: BizObs App
- **Data Fields**: Full request body as `rqBody`

### 3. Service Naming Rule
- **Name**: Holistic API Rules
- **Format**: `{ProcessGroup:DetectedName}`
- **Condition**: Detected process group name exists

### 4. OpenPipeline Pipeline
- **Name**: BizObs Template Pipeline
- **Processors**:
  1. **JSON Parser**: Parses `rqBody` and flattens JSON structure
  2. **Error Field**: Adds " - Exception" suffix to event type when `hasError == true`

### 5. Dynamic Routing
- **Route Name**: BizObs App
- **Condition**: `matchesValue(event.category, "BizObs App")`
- **Target**: BizObs Template Pipeline

## 🔧 Manual Configuration (If Monaco Fails)

If Monaco deployment fails due to API limitations:

1. **OneAgent Features**:
   - Settings → Preferences → OneAgent Features
   - Filter by "Business"
   - Enable: Node.js Business Events [Opt-in]

2. **Business Event Capture Rule**:
   - Settings → Business Analytics → OneAgent
   - Add new capture rule (see [DynatraceConfig.md](../DynatraceConfig.md))

3. **Service Naming**:
   - Settings → Server-side Service monitoring → Service naming rules
   - Create rule with format `{ProcessGroup:DetectedName}`

4. **OpenPipeline**:
   - OpenPipeline → Business events → Pipelines
   - Create "BizObs Template Pipeline" with DQL processors
   - Add Dynamic Routing rule

## 📊 Validation Queries

After deployment, run these queries in Notebooks to validate:

### Check Business Events
```dql
fetch bizevents
| filter isNotNull(rqBody)
| filter isNotNull(json.additionalFields) and isNotNull(json.stepIndex)
| summarize count(), by:{event.category, event.type}
```

### Journey Steps by Company
```dql
fetch bizevents
| filter isNotNull(rqBody)
| filter json.companyName == "YOUR_COMPANY_NAME"
| summarize count(), by:{event.type, json.stepName, json.stepIndex}
| sort json.stepIndex asc
```

### Time Spent per Step
```dql
fetch bizevents
| filter json.companyName == "YOUR_COMPANY_NAME"
| summarize TimeSpent = avg(toLong(json.estimatedDuration)), by:{event.type}
| fieldsAdd sla = if(TimeSpent >= 15, "✅", else:"❌")
```

## 🚨 Troubleshooting

### "Insufficient permissions" error
- Verify API token has all required scopes
- Try creating token with broader permissions

### "Schema not found" error
- Your Dynatrace version might not support Monaco v2
- Use manual configuration instead

### Pipeline not receiving events
- Check Dynamic Routing is **enabled**
- Verify capture rule trigger matches `/process` paths
- Run test journey and check incoming business events

## 🔄 Update Configuration

To update existing configuration:
```bash
monaco deploy manifest.yaml --force
```

To delete all configurations:
```bash
monaco delete manifest.yaml
```

## 📚 Additional Resources

- [Monaco Documentation](https://www.dynatrace.com/support/help/manage/configuration-as-code)
- [Dynatrace Settings API](https://www.dynatrace.com/support/help/dynatrace-api/environment-api/settings)
- [OpenPipeline Configuration](https://www.dynatrace.com/support/help/observe-and-explore/logs/lma-stream-processing)
- [Business Events](https://www.dynatrace.com/support/help/how-to-use-dynatrace/business-analytics)
