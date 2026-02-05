# Dashboard JSON Download Feature

## Overview

The BizObs Generator now supports **dashboard JSON download** instead of requiring direct deployment through the Dynatrace MCP server. This removes the need for a platform token and allows users to manually upload dashboards to Dynatrace.

## Why This Change?

**Problem:** The Dynatrace MCP server requires a platform token (OAuth or API token with platform scope) to deploy dashboards programmatically. Many users don't have access to these credentials.

**Solution:** Generate a complete Dynatrace Dashboard v20 JSON file that users can download and manually upload through the Dynatrace UI.

## How It Works

### 1. **Generate Dashboard**
When you click "Generate Dashboard" in the BizObs UI:
- The system creates a complete Dynatrace dashboard configuration
- No API calls are made to Dynatrace
- No credentials are required

### 2. **Auto-Download**
The dashboard JSON file automatically downloads to your browser:
- File name format: `{CompanyName}_Dashboard.json`
- Contains all tiles, layouts, queries, and visualizations
- Compatible with Dynatrace Dashboard API v20

### 3. **Manual Upload**
Upload the JSON file to Dynatrace:
1. Open your Dynatrace environment
2. Navigate to **Dashboards**
3. Click **Import dashboard**
4. Select the downloaded JSON file
5. Dashboard appears instantly

## Dashboard Contents

Each generated dashboard includes:

### Core KPIs (All Journey Types)
- 💼 **Total Journeys** - Count of all customer journeys
- 💰 **Total Business Value** - Revenue/value generated
- ✅ **Journey Success Rate** - Completion percentage with color thresholds
- ⏱️ **Average Journey Duration** - Mean time to complete

### Journey-Type Specific Tiles

**E-Commerce/Purchase:**
- 🛒 Cart Abandonment Rate (with thresholds: >50% red, >30% yellow)
- 💵 Average Order Value

**Support/Service:**
- 🎯 First Response Time (< 300s green, < 600s yellow)
- ⏰ Average Resolution Time

**Onboarding:**
- 📊 Completion Rate
- 🕐 Time to Complete

### Visualizations
- 📈 **Journeys Over Time** - Line chart with hourly bins
- 📊 **Journey Status Distribution** - Pie chart by status
- 🔍 **Step Performance Details** - Table with last 100 journeys

## Technical Details

### API Endpoint
```http
POST /api/dynatrace/generate-dashboard-json
Content-Type: application/json

{
  "journeyConfig": {
    "companyName": "Acme Corp",
    "domain": "acme.com",
    "industryType": "E-Commerce",
    "journeyType": "purchase",
    "steps": [...]
  }
}
```

### Response
```json
{
  "ok": true,
  "success": true,
  "dashboardJson": { ... },
  "fileName": "Acme_Corp_Dashboard.json",
  "message": "Dashboard JSON generated. Download and upload to Dynatrace manually."
}
```

### Frontend Implementation
```javascript
// Auto-download using Blob API
const blob = new Blob([JSON.stringify(result.dashboardJson, null, 2)], { 
  type: 'application/json' 
});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = result.fileName;
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);
```

## Code Changes

### New Function: `generateDashboardJson()`
**File:** `scripts/dynatrace-dashboard-deployer.js`

Extracts dashboard building logic from `deployJourneyDashboard()` without the deployment step:
- Builds complete Dashboard v20 object
- Includes all tiles and layouts
- Returns JSON object (not string)
- No API calls, no credentials needed

### Updated Endpoint
**File:** `server.js`

Added new endpoint at line ~1623:
```javascript
app.post('/api/dynatrace/generate-dashboard-json', async (req, res) => {
  const { journeyConfig } = req.body;
  const { generateDashboardJson } = await import('./scripts/dynatrace-dashboard-deployer.js');
  const dashboardJson = generateDashboardJson(journeyConfig);
  const fileName = `${journeyConfig.companyName.replace(/[^a-z0-9]/gi, '_')}_Dashboard.json`;
  res.json({ ok: true, success: true, dashboardJson, fileName });
});
```

### Updated Frontend
**File:** `public/index.html`

Modified `deployDynatraceDashboard()` function (line ~6300):
- Removed MCP server configuration checks
- Changed to call `/api/dynatrace/generate-dashboard-json`
- Added auto-download logic using Blob API
- Updated success message with upload instructions

## Benefits

✅ **No Token Required** - Works without platform token or OAuth  
✅ **Offline Generation** - Create dashboards without Dynatrace connection  
✅ **Portable** - Save and share dashboard JSON files  
✅ **Safe** - Review dashboard before uploading  
✅ **Fast** - Instant generation, no API rate limits  
✅ **Compatible** - Standard Dynatrace Dashboard v20 format  

## Migration from MCP Deployment

**Old Workflow (Deprecated):**
1. Configure MCP server URL
2. Configure Dynatrace environment URL
3. Click "Generate Dashboard"
4. Wait for deployment
5. Requires platform token

**New Workflow:**
1. Click "Generate Dashboard"
2. JSON file downloads automatically
3. Open Dynatrace UI
4. Import dashboard
5. No credentials needed in BizObs

## Dynatrace Upload Instructions

### Via UI (Recommended)
1. Log into your Dynatrace environment
2. Click **Dashboards** in the left menu
3. Click **Import dashboard** button (top right)
4. Select the downloaded JSON file
5. Click **Import**
6. Dashboard loads with all tiles and data

### Via API (Advanced)
```bash
curl -X POST "https://{your-env}.live.dynatrace.com/api/v2/dashboards" \
  -H "Authorization: Api-Token {your-token}" \
  -H "Content-Type: application/json" \
  -d @Acme_Corp_Dashboard.json
```

## Troubleshooting

### Download Doesn't Start
- Check browser download settings
- Look for popup blocker notifications
- Check console for errors: F12 → Console

### Dashboard Import Fails
- Verify JSON file is valid (not empty)
- Check Dynatrace version compatibility (requires Dashboard API v20)
- Ensure BizEvents are configured in your environment

### Missing Data in Dashboard
- Make sure journeys have been executed first
- Check `fetch bizevents` queries have data
- Verify company name matches exactly (case-sensitive)

## Dashboard Customization

After importing, you can customize:
- Time range (default: last 7 days)
- Tile positions and sizes
- Color thresholds
- Add additional tiles
- Modify DQL queries

Changes are saved in Dynatrace, not in BizObs.

## Legacy MCP Deployment

The old MCP deployment endpoint still exists for backward compatibility:

```http
POST /api/dynatrace/deploy-dashboard-via-mcp
```

**Note:** This requires platform token and is not recommended. It will be removed in a future version.

## Related Documentation

- [Monaco Deployment Guide](MONACO-DEPLOYMENT-GUIDE.md) - Deploy automation workflows
- [Continuous Journeys Guide](CONTINUOUS-JOURNEYS-GUIDE.md) - Auto-generate journey data
- [Automation Complete](AUTOMATION-COMPLETE.md) - Full automation overview

## Support

For issues or questions:
1. Check browser console for errors
2. Verify JSON file downloads correctly
3. Test upload in Dynatrace UI
4. Check [Dynatrace Dashboard documentation](https://docs.dynatrace.com/docs/observe-and-explore/dashboards-classic)
