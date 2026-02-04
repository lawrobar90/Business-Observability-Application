/**
 * Dynatrace Dashboard Deployer for BizObs Journeys
 * Uses Dashboard API version 20 format
 */

import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DT_ENVIRONMENT = process.env.DT_ENVIRONMENT;
const DT_TOKEN = process.env.DT_PLATFORM_TOKEN;

/**
 * Normalize Sprint environment URLs
 */
function normalizeSprintUrl(environment) {
  if (environment.includes('.sprint.apps.dynatracelabs.com')) {
    return environment.replace('.sprint.apps.dynatracelabs.com', '.sprint.dynatracelabs.com');
  }
  return environment;
}

/**
 * Get journey-type-specific tiles
 */
function getJourneyTypeTiles(journeyType, companyName, tileId, startY) {
  const tiles = {};
  const layouts = {};
  let currentTileId = tileId;
  let currentY = startY;
  
  const journeyTypeLower = (journeyType || '').toLowerCase();
  
  // E-commerce / Purchase Journeys
  if (journeyTypeLower.includes('purchase') || journeyTypeLower.includes('checkout') || journeyTypeLower.includes('order')) {
    // Cart Abandonment Rate
    tiles[currentTileId] = {
      title: "🛒 Cart Abandonment Rate",
      type: "data",
      query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | summarize abandoned = countIf(contains(toString(steps), "cart") and journeyStatus != "completed"), total = countIf(contains(toString(steps), "cart")) | fieldsAdd abandonmentRate = (toDouble(abandoned) / toDouble(total)) * 100`,
      visualization: "singleValue",
      visualizationSettings: {
        singleValue: { label: "ABANDONMENT", recordField: "abandonmentRate", colorThresholdTarget: "background" },
        thresholds: [{
          id: 1, field: "abandonmentRate", isEnabled: true,
          rules: [
            { id: 1, color: { Default: "#dc2626" }, comparator: "≥", value: 50 },
            { id: 2, color: { Default: "#f5d30f" }, comparator: "≥", value: 30 }
          ]
        }],
        unitsOverrides: [{ identifier: "abandonmentRate", unitCategory: "percentage", baseUnit: "percent", decimals: 1, suffix: "%", delimiter: true }]
      },
      querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
      davis: { enabled: false, davisVisualization: { isAvailable: true } }
    };
    layouts[currentTileId] = { x: 0, y: currentY, w: 6, h: 2 };
    currentTileId++;
    
    // Average Order Value
    tiles[currentTileId] = {
      title: "💳 Average Order Value",
      type: "data",
      query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | filter journeyStatus == "completed" | summarize avgOrderValue = avg(businessValue)`,
      visualization: "singleValue",
      visualizationSettings: {
        singleValue: { label: "AVG ORDER", recordField: "avgOrderValue", colorThresholdTarget: "background", prefixIcon: "MoneyIcon" },
        thresholds: [],
        unitsOverrides: [{ identifier: "avgOrderValue", unitCategory: "currency", baseUnit: "usd", decimals: 2, suffix: "$", delimiter: true }]
      },
      querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
      davis: { enabled: false, davisVisualization: { isAvailable: true } }
    };
    layouts[currentTileId] = { x: 6, y: currentY, w: 6, h: 2 };
    currentTileId++;
    currentY += 2;
  }
  
  // Support / Service Journeys
  if (journeyTypeLower.includes('support') || journeyTypeLower.includes('service') || journeyTypeLower.includes('ticket')) {
    // First Response Time
    tiles[currentTileId] = {
      title: "⏱️ Avg First Response Time",
      type: "data",
      query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | summarize avgFirstResponse = avg(firstResponseTime)`,
      visualization: "singleValue",
      visualizationSettings: {
        singleValue: { label: "RESPONSE TIME", recordField: "avgFirstResponse", colorThresholdTarget: "background" },
        thresholds: [{
          id: 1, field: "avgFirstResponse", isEnabled: true,
          rules: [
            { id: 1, color: { Default: "#2ab06f" }, comparator: "<", value: 300 },
            { id: 2, color: { Default: "#f5d30f" }, comparator: "<", value: 600 }
          ]
        }],
        unitsOverrides: [{ identifier: "avgFirstResponse", unitCategory: "time", baseUnit: "second", decimals: 1, suffix: " sec", delimiter: true }]
      },
      querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
      davis: { enabled: false, davisVisualization: { isAvailable: true } }
    };
    layouts[currentTileId] = { x: 0, y: currentY, w: 6, h: 2 };
    currentTileId++;
    
    // Resolution Rate
    tiles[currentTileId] = {
      title: "✅ First Contact Resolution",
      type: "data",
      query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | summarize resolved = countIf(journeyStatus == "completed"), total = count() | fieldsAdd resolutionRate = (toDouble(resolved) / toDouble(total)) * 100`,
      visualization: "singleValue",
      visualizationSettings: {
        singleValue: { label: "FCR RATE", recordField: "resolutionRate", colorThresholdTarget: "background" },
        thresholds: [{
          id: 1, field: "resolutionRate", isEnabled: true,
          rules: [
            { id: 1, color: { Default: "#2ab06f" }, comparator: "≥", value: 70 },
            { id: 2, color: { Default: "#f5d30f" }, comparator: "≥", value: 50 }
          ]
        }],
        unitsOverrides: [{ identifier: "resolutionRate", unitCategory: "percentage", baseUnit: "percent", decimals: 1, suffix: "%", delimiter: true }]
      },
      querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
      davis: { enabled: false, davisVisualization: { isAvailable: true } }
    };
    layouts[currentTileId] = { x: 6, y: currentY, w: 6, h: 2 };
    currentTileId++;
    currentY += 2;
  }
  
  // Onboarding / Registration Journeys
  if (journeyTypeLower.includes('onboard') || journeyTypeLower.includes('registration') || journeyTypeLower.includes('signup')) {
    // Completion Rate
    tiles[currentTileId] = {
      title: "📝 Onboarding Completion",
      type: "data",
      query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | summarize completed = countIf(journeyStatus == "completed"), total = count() | fieldsAdd completionRate = (toDouble(completed) / toDouble(total)) * 100`,
      visualization: "singleValue",
      visualizationSettings: {
        singleValue: { label: "COMPLETION", recordField: "completionRate", colorThresholdTarget: "background" },
        thresholds: [{
          id: 1, field: "completionRate", isEnabled: true,
          rules: [
            { id: 1, color: { Default: "#2ab06f" }, comparator: "≥", value: 80 },
            { id: 2, color: { Default: "#f5d30f" }, comparator: "≥", value: 60 }
          ]
        }],
        unitsOverrides: [{ identifier: "completionRate", unitCategory: "percentage", baseUnit: "percent", decimals: 1, suffix: "%", delimiter: true }]
      },
      querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
      davis: { enabled: false, davisVisualization: { isAvailable: true } }
    };
    layouts[currentTileId] = { x: 0, y: currentY, w: 6, h: 2 };
    currentTileId++;
    
    // Time to Complete
    tiles[currentTileId] = {
      title: "⏰ Time to Complete Onboarding",
      type: "data",
      query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | filter journeyStatus == "completed" | summarize avgTime = avg(totalDuration)`,
      visualization: "singleValue",
      visualizationSettings: {
        singleValue: { label: "AVG TIME", recordField: "avgTime", colorThresholdTarget: "background" },
        thresholds: [],
        unitsOverrides: [{ identifier: "avgTime", unitCategory: "time", baseUnit: "second", decimals: 1, suffix: " sec", delimiter: true }]
      },
      querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
      davis: { enabled: false, davisVisualization: { isAvailable: true } }
    };
    layouts[currentTileId] = { x: 6, y: currentY, w: 6, h: 2 };
    currentTileId++;
    currentY += 2;
  }
  
  return { tiles, layouts, nextTileId: currentTileId, nextY: currentY };
}

/**
 * Deploy journey dashboard (version 20 format)
 */
async function deployJourneyDashboard(journeyConfig, options = {}) {
  const { companyName, domain, industryType, steps, journeyType } = journeyConfig;
  const { useMcpProxy = false, mcpServerUrl = null, environmentUrl = null } = options;
  
  console.log(`📊 Deploying dashboard for ${companyName}`);
  if (useMcpProxy) {
    console.log(`🔗 Using MCP server proxy: ${mcpServerUrl}`);
    console.log(`🌐 Dynatrace environment: ${environmentUrl}`);
  }
  
  const journeyName = journeyType || journeyConfig.journeyDetail || 'Customer Journey';
  
  // Build dashboard in version 20 format
  const dashboard = {
    version: 20,
    variables: [],
    tiles: {},
    layouts: {},
    importedWithCode: false,
    settings: {
      defaultTimeframe: {
        value: { from: "now()-7d", to: "now()" },
        enabled: true
      }
    }
  };
  
  let tileId = 0;
  
  // Header
  dashboard.tiles[tileId] = {
    type: "markdown",
    content: `# ${companyName} - ${journeyName}\n\n**Industry:** ${industryType} | **Domain:** ${domain || 'N/A'}`
  };
  dashboard.layouts[tileId] = { x: 0, y: 0, w: 24, h: 2 };
  tileId++;
  
  // Total Journeys
  dashboard.tiles[tileId] = {
    title: "💼 Total Journeys",
    type: "data",
    query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | summarize totalJourneys = count()`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "BUSINESS KPI", recordField: "totalJourneys", colorThresholdTarget: "background" },
      thresholds: [],
      unitsOverrides: [{ identifier: "totalJourneys", unitCategory: "unspecified", baseUnit: "count", decimals: 0, delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId] = { x: 0, y: 2, w: 6, h: 2 };
  tileId++;
  
  // Business Value
  dashboard.tiles[tileId] = {
    title: "💰 Total Business Value",
    type: "data",
    query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | summarize totalValue = sum(businessValue)`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "REVENUE", recordField: "totalValue", colorThresholdTarget: "background", prefixIcon: "MoneyIcon" },
      thresholds: [],
      unitsOverrides: [{ identifier: "totalValue", unitCategory: "currency", baseUnit: "usd", decimals: 0, suffix: "$", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId] = { x: 6, y: 2, w: 6, h: 2 };
  tileId++;
  
  // Satisfaction Score
  dashboard.tiles[tileId] = {
    title: "😊 Customer Satisfaction",
    type: "data",
    query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | summarize avgSatisfaction = avg(satisfactionScore)`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "CSAT SCORE", recordField: "avgSatisfaction", colorThresholdTarget: "background" },
      thresholds: [{
        id: 1, field: "avgSatisfaction", isEnabled: true,
        rules: [
          { id: 1, color: { Default: "#2ab06f" }, comparator: "≥", value: 4 },
          { id: 2, color: { Default: "#f5d30f" }, comparator: "≥", value: 3 }
        ]
      }],
      unitsOverrides: [{ identifier: "avgSatisfaction", decimals: 2, suffix: "/5.0" }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId] = { x: 12, y: 2, w: 6, h: 2 };
  tileId++;
  
  // NPS Score
  dashboard.tiles[tileId] = {
    title: "⭐ NPS Score",
    type: "data",
    query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | summarize avgNPS = avg(npsScore)`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "NET PROMOTER", recordField: "avgNPS", colorThresholdTarget: "background" },
      thresholds: [],
      unitsOverrides: [{ identifier: "avgNPS", decimals: 1 }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId] = { x: 18, y: 2, w: 6, h: 2 };
  tileId++;
  
  // Business Value Over Time
  dashboard.tiles[tileId] = {
    title: "📈 Business Value Trend",
    type: "data",
    query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | makeTimeseries value = sum(businessValue), bins:30`,
    visualization: "areaChart",
    visualizationSettings: {
      chartSettings: { fieldMapping: { leftAxisValues: ["value"], timestamp: "timeframe" } },
      thresholds: [],
      unitsOverrides: [{ identifier: "value", unitCategory: "currency", baseUnit: "usd", decimals: 0, suffix: "$", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId] = { x: 0, y: 4, w: 12, h: 4 };
  tileId++;
  
  // Journey Completion Rate
  dashboard.tiles[tileId] = {
    title: "✅ Journey Success Rate",
    type: "data",
    query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | summarize completed = countIf(journeyStatus == "completed"), total = count() | fieldsAdd successRate = (toDouble(completed) / toDouble(total)) * 100`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "COMPLETION RATE", recordField: "successRate", colorThresholdTarget: "background" },
      thresholds: [{
        id: 1, field: "successRate", isEnabled: true,
        rules: [
          { id: 1, color: { Default: "#2ab06f" }, comparator: "≥", value: 90 },
          { id: 2, color: { Default: "#f5d30f" }, comparator: "≥", value: 75 }
        ]
      }],
      unitsOverrides: [{ identifier: "successRate", unitCategory: "percentage", baseUnit: "percent", decimals: 1, suffix: "%", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId] = { x: 12, y: 4, w: 6, h: 2 };
  tileId++;
  
  // Average Journey Duration
  dashboard.tiles[tileId] = {
    title: "⏱️ Avg Journey Duration",
    type: "data",
    query: `fetch bizevents | filter event.type == "journey_data_persisted" | filter companyName == "${companyName}" | summarize avgDuration = avg(totalDuration)`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "PROCESSING TIME", recordField: "avgDuration", colorThresholdTarget: "background" },
      thresholds: [],
      unitsOverrides: [{ identifier: "avgDuration", unitCategory: "time", baseUnit: "second", decimals: 1, suffix: " sec", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId] = { x: 18, y: 4, w: 6, h: 2 };
  tileId++;
  
  // Add journey-type-specific tiles
  const journeyTypeTiles = getJourneyTypeTiles(journeyType, companyName, tileId, 6);
  Object.assign(dashboard.tiles, journeyTypeTiles.tiles);
  Object.assign(dashboard.layouts, journeyTypeTiles.layouts);
  tileId = journeyTypeTiles.nextTileId;
  let currentY = journeyTypeTiles.nextY;
  
  // Add step-specific tiles
  steps.forEach((step, idx) => {
    const row = currentY + Math.floor(idx / 2) * 4;
    const col = (idx % 2) * 12;
    
    dashboard.tiles[tileId] = {
      title: `Step ${idx + 1}: ${step.stepName}`,
      type: "data",
      query: `fetch logs | filter contains(dt.service.name, "${step.serviceName || step.stepName}") | filter loglevel in {"ERROR", "WARN"} | makeTimeseries errors = count(), bins:20`,
      visualization: "areaChart",
      visualizationSettings: {
        chartSettings: { fieldMapping: { leftAxisValues: ["errors"], timestamp: "timeframe" } },
        thresholds: [],
        unitsOverrides: []
      },
      querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
      davis: { enabled: false, davisVisualization: { isAvailable: true } }
    };
    dashboard.layouts[tileId] = { x: col, y: row, w: 12, h: 4 };
    tileId++;
  });
  
  // Save dashboard JSON to file (before deployment)
  try {
    const dashboardsDir = path.join(__dirname, '..', 'Generate KPI Dashboard', 'Generate KPI Dashboard', 'Generated_Dashboards');
    const sanitizedCompanyName = companyName.replace(/[^a-zA-Z0-9]/g, '_');
    const sanitizedJourneyType = journeyName.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${sanitizedCompanyName}_${sanitizedJourneyType}_dashboard.json`;
    const filepath = path.join(dashboardsDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(dashboard, null, 2));
    console.log(`💾 Dashboard JSON saved to: ${filename}`);
  } catch (saveError) {
    console.warn(`⚠️ Could not save dashboard JSON: ${saveError.message}`);
  }
  
  try {
    let authHeader, documentServiceUrl;
    
    // Use MCP proxy if configured
    if (useMcpProxy && mcpServerUrl) {
      console.log(`🔗 Deploying via MCP server proxy...`);
      
      // Send JSON-RPC request to MCP server to create the dashboard
      const mcpResponse = await fetch(mcpServerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: 'create_dynatrace_notebook',
            arguments: {
              content: JSON.stringify(dashboard, null, 2),
              name: `${companyName} - ${journeyName}`,
              type: 'dashboard'
            }
          }
        })
      });
      
      if (!mcpResponse.ok) {
        throw new Error(`MCP server request failed: ${mcpResponse.status} - ${mcpResponse.statusText}`);
      }
      
      const mcpResult = await mcpResponse.json();
      
      if (mcpResult.error) {
        throw new Error(`MCP error: ${mcpResult.error.message}`);
      }
      
      // Extract result from MCP response
      const notebookUrl = mcpResult.result?.content?.[0]?.text;
      const dashboardId = notebookUrl?.match(/notebooks\/([^\/\?]+)/)?.[1];
      
      console.log(`✅ Dashboard created via MCP server!`);
      console.log(`   Dashboard ID: ${dashboardId}`);
      console.log(`   Dashboard URL: ${notebookUrl}`);
      
      return {
        success: true,
        dashboardId,
        dashboardUrl: notebookUrl,
        companyName,
        industryType
      };
    }
    
    // Direct deployment (legacy)
    const isOAuthToken = DT_TOKEN.length > 100;
    authHeader = isOAuthToken ? `Bearer ${DT_TOKEN}` : `Api-Token ${DT_TOKEN}`;
    
    console.log(`📡 Deploying dashboard with ${isOAuthToken ? 'OAuth' : 'Platform'} token...`);
    
    documentServiceUrl = normalizeSprintUrl(DT_ENVIRONMENT);
    
    const response = await fetch(
      `${documentServiceUrl}/platform/classic/environment-api/v2/dashboards`,
      {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dashboard)
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Dashboard creation failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    const dashboardId = result.id;
    const dashboardUrl = `${DT_ENVIRONMENT}/ui/dashboards/${dashboardId}`;
    
    console.log(`✅ Dashboard created successfully!`);
    console.log(`   Dashboard ID: ${dashboardId}`);
    console.log(`   Dashboard URL: ${dashboardUrl}`);
    
    return {
      success: true,
      dashboardId,
      dashboardUrl,
      companyName,
      industryType
    };
    
  } catch (error) {
    console.error(`❌ Dashboard deployment failed:`, error.message);
    return {
      success: false,
      error: error.message,
      companyName,
      industryType
    };
  }
}

async function findExistingDashboard(companyName) {
  return [];
}

export { deployJourneyDashboard, findExistingDashboard };
