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
 * Analyze available fields from journey config to generate dynamic sections
 */
function analyzeAvailableFields(journeyConfig) {
  const { additionalFields, customerProfile, traceMetadata } = journeyConfig;
  
  const categories = [];
  const fieldMap = {
    // Revenue & Financial
    revenue: ['orderTotal', 'customerLifetimeValue', 'averageOrderValue', 'operationalCost', 'profitMargin', 'revenue', 'cost'],
    // Customer Insights
    customer: ['conversionRate', 'netPromoterScore', 'churnRisk', 'engagementScore', 'customerSegmentValue', 'customerSatisfaction', 'loyaltyTier', 'accountType'],
    // Performance & Operations  
    performance: ['processingTime', 'responseTime', 'throughput', 'resourceUtilization', 'efficiencyRating', 'queueTime', 'latency'],
    // Business Analytics
    analytics: ['marketSegment', 'productCategory', 'campaignId', 'referralSource', 'conversionFunnel', 'purchaseFrequency'],
    // Device & Channel
    channel: ['deviceType', 'location', 'channel', 'platform', 'browser', 'region', 'country'],
    // Errors & Quality
    quality: ['errorRate', 'hasError', 'errorMessage', 'httpStatus', 'successRate', 'failureReason']
  };
  
  // Check what fields are available
  const availableFieldNames = new Set();
  if (additionalFields) {
    Object.keys(additionalFields).forEach(key => availableFieldNames.add(key));
  }
  if (customerProfile) {
    Object.keys(customerProfile).forEach(key => availableFieldNames.add(key));
  }
  
  // Determine which categories have fields
  for (const [category, fields] of Object.entries(fieldMap)) {
    const matchingFields = fields.filter(f => availableFieldNames.has(f));
    if (matchingFields.length > 0) {
      categories.push({
        name: category,
        fields: matchingFields,
        count: matchingFields.length
      });
    }
  }
  
  return {
    categories,
    allFields: Array.from(availableFieldNames),
    hasRevenue: availableFieldNames.has('orderTotal') || availableFieldNames.has('revenue'),
    hasCustomerMetrics: availableFieldNames.has('conversionRate') || availableFieldNames.has('netPromoterScore'),
    hasPerformanceMetrics: availableFieldNames.has('processingTime') || availableFieldNames.has('responseTime'),
    hasChannelData: availableFieldNames.has('deviceType') || availableFieldNames.has('location')
  };
}

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
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize abandoned = countIf(contains(toString(steps), "cart") and journeyStatus != "completed"), total = countIf(contains(toString(steps), "cart")) | fieldsAdd abandonmentRate = (toDouble(abandoned) / toDouble(total)) * 100`,
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
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter journeyStatus == "completed" | summarize avgOrderValue = avg(businessValue)`,
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
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize avgFirstResponse = avg(firstResponseTime)`,
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
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize resolved = countIf(journeyStatus == "completed"), total = count() | fieldsAdd resolutionRate = (toDouble(resolved) / toDouble(total)) * 100`,
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
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize completed = countIf(journeyStatus == "completed"), total = count() | fieldsAdd completionRate = (toDouble(completed) / toDouble(total)) * 100`,
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
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter journeyStatus == "completed" | summarize avgTime = avg(totalDuration)`,
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
    variables: [
      {
        id: "journeyType",
        key: "journeyType",
        input: {
          type: "dqlQuery",
          query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter isNotNull(json.journeyType) | summarize types = collectDistinct(json.journeyType) | expand types`,
          resultField: "types"
        },
        defaultValue: journeyType || "*",
        multiple: false
      }
    ],
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
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize totalJourneys = countDistinct(json.correlationId)`,

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
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize totalValue = sum(additionalfields.transactionAmount)`,

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
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize avgSatisfaction = avg(json.satisfactionScore)`,

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
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize avgNPS = avg(npsScore)`,
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
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | makeTimeseries value = sum(businessValue), bins:30`,
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
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize completed = countIf(journeyStatus == "completed"), total = count() | fieldsAdd successRate = (toDouble(completed) / toDouble(total)) * 100`,
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
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize avgDuration = avg(totalDuration)`,
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
    
    // Use MCP proxy if configured (deploy dashboard via API using platform token)
    if (useMcpProxy && mcpServerUrl) {
      if (!DT_TOKEN) {
        throw new Error('Dashboard deployment requires DT_PLATFORM_TOKEN. MCP server does not support dashboard creation in this build.');
      }

      console.log(`🔗 Deploying dashboard via API (MCP proxy enabled)...`);

      const targetEnvironment = environmentUrl || DT_ENVIRONMENT;
      documentServiceUrl = normalizeSprintUrl(targetEnvironment);
      authHeader = `Api-Token ${DT_TOKEN}`;

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
      const dashboardUrl = `${targetEnvironment}/ui/dashboards/${dashboardId}`;

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

/**
 * Generate dashboard JSON (no deployment)
 * Returns comprehensive dashboard JSON matching enterprise standards
 */
function generateDashboardJson(journeyConfig) {
  const { companyName, domain, industryType, steps, journeyType, additionalFields, customerProfile } = journeyConfig;
  
  console.log(`📊 Generating dynamic dashboard for ${companyName}`);
  
  const journeyName = journeyType || journeyConfig.journeyDetail || 'Customer Journey';
  
  // Analyze available fields from config
  const availableFields = analyzeAvailableFields(journeyConfig);
  console.log(`📊 Detected ${availableFields.categories.length} field categories:`, availableFields.categories.map(c => c.name).join(', '));
  
  // Build dashboard
  const dashboard = {
    version: 20,
    variables: [{
      version: 2,
      key: "Step",
      type: "query",
      visible: true,
      editable: true,
      input: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | fields json.stepName | dedup json.stepName`,
      multiple: true,
      defaultValues: ["*"]
    }],
    tiles: {},
    layouts: {},
    importedWithCode: false,
    settings: {
      defaultTimeframe: {
        value: { from: "now()-24h", to: "now()" },
        enabled: true
      }
    }
  };
  
  let tileId = 0;
  let y = 0;
  
  // Helper to create filter clause with multi-select support
  const stepFilter = (allSteps = false) => {
    if (allSteps) {
      return `filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*"`;
    }
    return `filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step)`;
  };
  
  // ============ HEADER (Logo/Title) ============
  dashboard.tiles[tileId] = {
    type: "markdown",
    content: `# ${companyName}\n## ${journeyName} - Business Observability Dashboard\n\n**Industry:** ${industryType} | **Domain:** ${domain || 'N/A'}`
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 3 };
  y += 3;
  
  // ============ JOURNEY FLOW VISUALIZATION ============
  // Create visual flow representation of journey steps
  const stepNames = steps && steps.length > 0 ? steps.map(s => s.stepName || s.name || s).slice(0, 6) : [];
  const flowMarkdown = stepNames.length > 0 ? stepNames.map((step, idx) => {
    const arrow = idx < stepNames.length - 1 ? ' **→**' : '';
    return `**${idx + 1}. ${step}**${arrow}`;
  }).join(' ') : 'Journey steps will appear here';
  
  dashboard.tiles[tileId] = {
    type: "markdown",
    content: `## 🔄 Customer Journey Flow\n\n${flowMarkdown}\n\n---\n*End-to-end journey visualization with step-by-step metrics*`
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 3 };
  y += 3;
  
  // ============ STEP METRICS TABLE (Like your image) ============
  dashboard.tiles[tileId] = {
    title: "📊 Journey Step Metrics (All Steps)",
    type: "data",
    query: `fetch bizevents 
| filter event.kind == "BIZ_EVENT" 
| filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*"
| summarize 
 
    OrdersInStep = count(),
    SuccessRate = (countIf(isNull(additionalfields.hasError) or additionalfields.hasError == false) / count()) * 100,
    AvgTimeInStep = avg(additionalfields.processingTime),
    ErrorsInStep = countIf(additionalfields.hasError == true),
    ErrorRate = (countIf(additionalfields.hasError == true) / count()) * 100
  , by: {json.stepName}
| sort OrdersInStep desc`,
    visualization: "table",
    visualizationSettings: {
      chartSettings: { gapPolicy: "connect" },
      table: { 
        rowDensity: "condensed", 
        enableLineWrap: false, 
        firstVisibleRowIndex: 0, 
        columnWidths: {
          "json.stepName": 200,
          "OrdersInStep": 120,
          "SuccessRate": 120,
          "AvgTimeInStep": 120,
          "ErrorsInStep": 120,
          "ErrorRate": 120
        }
      },
      thresholds: [
        {
          id: 1,
          field: "SuccessRate",
          isEnabled: true,
          rules: [
            { id: 1, color: { Default: "#2ab06f" }, comparator: "≥", value: 95 },
            { id: 2, color: { Default: "#f5d30f" }, comparator: "≥", value: 85 },
            { id: 3, color: { Default: "#dc2626" }, comparator: "<", value: 85 }
          ]
        },
        {
          id: 2,
          field: "ErrorRate",
          isEnabled: true,
          rules: [
            { id: 1, color: { Default: "#dc2626" }, comparator: ">", value: 5 },
            { id: 2, color: { Default: "#f5d30f" }, comparator: ">", value: 2 },
            { id: 3, color: { Default: "#2ab06f" }, comparator: "≤", value: 2 }
          ]
        }
      ],
      unitsOverrides: [
        { identifier: "SuccessRate", unitCategory: "percentage", baseUnit: "percent", decimals: 2, suffix: "%", delimiter: true },
        { identifier: "AvgTimeInStep", unitCategory: "time", baseUnit: "milli_second", decimals: 0, suffix: "ms", delimiter: true },
        { identifier: "ErrorRate", unitCategory: "percentage", baseUnit: "percent", decimals: 2, suffix: "%", delimiter: true },
        { identifier: "OrdersInStep", unitCategory: "unspecified", baseUnit: "count", decimals: 0, delimiter: true }
      ]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 6 };
  y += 6;
  
  // ============ SECTION: Overall Journey Performance (ALL STEPS) ============
  dashboard.tiles[tileId] = {
    title: "",
    type: "data",
    query: `data record(a="Overall Journey Performance - All Steps")`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { labelMode: "none", isIconVisible: true, prefixIcon: "RocketIcon", colorThresholdTarget: "background" },
      thresholds: [{ id: 1, field: "a", isEnabled: true, rules: [{ id: 1, color: "#478ACA", comparator: "!=", value: "x" }] }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 1 };
  y += 1;
  
  // Total Journey Events (ALL STEPS - no filter)
  dashboard.tiles[tileId] = {
    title: "💼 Total Journey Events (All Steps)",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize total = count()`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "TOTAL EVENTS", recordField: "total", colorThresholdTarget: "background", prefixIcon: "ProcessesIcon" },
      thresholds: [],
      unitsOverrides: [{ identifier: "total", unitCategory: "unspecified", baseUnit: "count", decimals: 0, delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 6, h: 3 };
  
  // Overall Success Rate (ALL STEPS)
  dashboard.tiles[tileId] = {
    title: "✅ Overall Success Rate",
    type: "data",
    query: `fetch bizevents 
| filter event.kind == "BIZ_EVENT" 
| filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" 
| summarize 
    success = countIf(isNull(additionalfields.hasError) or additionalfields.hasError == false),
    total = count()
| fieldsAdd rate = (success / total) * 100`,
    visualization: "gauge",
    visualizationSettings: {
      chartSettings: { gapPolicy: "connect" },
      thresholds: [
        {
          id: 1,
          field: "rate",
          isEnabled: true,
          rules: [
            { id: 1, color: { Default: "#2ab06f" }, comparator: "≥", label: "Excellent", value: 95 },
            { id: 2, color: { Default: "#f5d30f" }, comparator: "≥", label: "Good", value: 85 },
            { id: 3, color: { Default: "#dc2626" }, comparator: "<", label: "Poor", value: 85 }
          ]
        }
      ],
      unitsOverrides: [{ identifier: "rate", unitCategory: "percentage", baseUnit: "percent", decimals: 2, suffix: "%", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 6, y: y, w: 6, h: 3 };
  
  // Total Revenue (ALL STEPS)
  dashboard.tiles[tileId] = {
    title: "💰 Total Revenue (All Steps)",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize revenue = sum(additionalfields.orderTotal)`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "REVENUE", recordField: "revenue", colorThresholdTarget: "background", prefixIcon: "MoneyIcon" },
      thresholds: [],
      unitsOverrides: [{ identifier: "revenue", unitCategory: "currency", baseUnit: "usd", decimals: 0, suffix: "$", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 12, y: y, w: 6, h: 3 };
  
  // Total Errors (ALL STEPS)
  dashboard.tiles[tileId] = {
    title: "❌ Total Errors (All Steps)",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize errors = countIf(additionalfields.hasError == true)`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "ERRORS", recordField: "errors", colorThresholdTarget: "background" },
      thresholds: [
        {
          id: 1,
          field: "errors",
          isEnabled: true,
          rules: [
            { id: 1, color: { Default: "#dc2626" }, comparator: ">", value: 10 },
            { id: 2, color: { Default: "#f5d30f" }, comparator: ">", value: 5 },
            { id: 3, color: { Default: "#2ab06f" }, comparator: "≤", value: 5 }
          ]
        }
      ],
      unitsOverrides: [{ identifier: "errors", unitCategory: "unspecified", baseUnit: "count", decimals: 0, delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 18, y: y, w: 6, h: 3 };
  y += 3;
  
  // Journey Events Over Time (ALL STEPS - area chart)
  dashboard.tiles[tileId] = {
    title: "📈 Journey Events Over Time (All Steps)",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | makeTimeseries events = count(), bins:30`,
    visualization: "areaChart",
    visualizationSettings: {
      chartSettings: { gapPolicy: "connect", seriesOverrides: [{ seriesId: ["events"], override: { color: "#2AB06F" }}]},
      thresholds: [],
      unitsOverrides: []
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 12, h: 4 };
  
  // Journey Steps Distribution (ALL STEPS)
  dashboard.tiles[tileId] = {
    title: "📊 Events by Step (All Steps)",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize count = count(), by: {json.stepName} | sort count desc | limit 10`,
    visualization: "categoricalBarChart",
    visualizationSettings: {
      chartSettings: { gapPolicy: "connect", categoricalBarChartSettings: { layout: "vertical" }},
      thresholds: [],
      unitsOverrides: []
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 12, y: y, w: 12, h: 4 };
  y += 4;
  
  // ============ SECTION: Filtered View (with Step variable) ============
  dashboard.tiles[tileId] = {
    title: "",
    type: "data",
    query: `data record(a="Filtered View - By Selected Step")`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { labelMode: "none", isIconVisible: true, prefixIcon: "FilterIcon", colorThresholdTarget: "background" },
      thresholds: [{ id: 1, field: "a", isEnabled: true, rules: [{ id: 1, color: "#7C38A1", comparator: "!=", value: "x" }] }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 1 };
  y += 1;
  
  // Total Journeys (FILTERED)
  dashboard.tiles[tileId] = {
    title: "💼 Total Journey Events (Filtered)",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize total = count()`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "TOTAL EVENTS", recordField: "total", colorThresholdTarget: "background", prefixIcon: "ProcessesIcon" },
      thresholds: [],
      unitsOverrides: [{ identifier: "total", unitCategory: "unspecified", baseUnit: "count", decimals: 0, delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 6, h: 3 };
  
  // Total Revenue (FILTERED)
  dashboard.tiles[tileId] = {
    title: "💰 Total Revenue (Filtered)",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize revenue = sum(additionalfields.orderTotal)`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "REVENUE", recordField: "revenue", colorThresholdTarget: "background", prefixIcon: "MoneyIcon" },
      thresholds: [],
      unitsOverrides: [{ identifier: "revenue", unitCategory: "currency", baseUnit: "usd", decimals: 0, suffix: "$", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 6, y: y, w: 6, h: 3 };
  
  // Average Order Value
  dashboard.tiles[tileId] = {
    title: "💵 Avg Order Value",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize avg = avg(additionalfields.orderTotal)`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "AOV", recordField: "avg", colorThresholdTarget: "background" },
      thresholds: [],
      unitsOverrides: [{ identifier: "avg", unitCategory: "currency", baseUnit: "usd", decimals: 2, suffix: "$", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 12, y: y, w: 6, h: 3 };
  
  // Customer LTV
  dashboard.tiles[tileId] = {
    title: "📈 Avg Customer LTV",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize ltv = avg(additionalfields.customerLifetimeValue)`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "LIFETIME VALUE", recordField: "ltv", colorThresholdTarget: "background", prefixIcon: "MoneyIcon" },
      thresholds: [],
      unitsOverrides: [{ identifier: "ltv", unitCategory: "currency", baseUnit: "usd", decimals: 0, suffix: "$", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 18, y: y, w: 6, h: 3 };
  y += 3;
  
  // Journey Events Over Time (area chart with multiple series)
  dashboard.tiles[tileId] = {
    title: "📈 Journey Events Over Time",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | makeTimeseries events = count(), bins:30`,
    visualization: "areaChart",
    visualizationSettings: {
      chartSettings: { gapPolicy: "connect", seriesOverrides: [{ seriesId: ["events"], override: { color: "#2AB06F" }}]},
      thresholds: [],
      unitsOverrides: []
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 12, h: 4 };
  
  // Journey Steps Distribution
  dashboard.tiles[tileId] = {
    title: "📊 Events by Step",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | summarize count = count(), by: {json.stepName} | sort count desc | limit 10`,
    visualization: "categoricalBarChart",
    visualizationSettings: {
      chartSettings: { categoricalBarChartSettings: { layout: "horizontal" }},
      thresholds: [],
      unitsOverrides: []
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 12, y: y, w: 12, h: 4 };
  y += 4;
  
  // ============ DYNAMIC SECTIONS BASED ON AVAILABLE FIELDS ============
  console.log(`📊 Creating ${availableFields.categories.length} dynamic sections`);
  
  // Revenue & Financial Section (if revenue fields exist)
  if (availableFields.hasRevenue) {
    dashboard.tiles[tileId] = {
      title: "",
      type: "data",
      query: `data record(a="Revenue & Financial Analytics")`,
      visualization: "singleValue",
      visualizationSettings: {
        singleValue: { labelMode: "none", isIconVisible: true, prefixIcon: "MoneyIcon", colorThresholdTarget: "background" },
        thresholds: [{ id: 1, field: "a", isEnabled: true, rules: [{ id: 1, color: "#2AB06F", comparator: "!=", value: "x" }] }]
      },
      querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
      davis: { enabled: false, davisVisualization: { isAvailable: true } }
    };
    dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 1 };
    y += 1;
    
    // Revenue tiles with multi-select support
    if (availableFields.allFields.includes('orderTotal')) {
      dashboard.tiles[tileId] = {
        title: "💰 Revenue by Step",
        type: "data",
        query: `fetch bizevents | ${stepFilter()} | summarize revenue = sum(additionalfields.orderTotal), by: {json.stepName} | sort revenue desc`,
        visualization: "categoricalBarChart",
        visualizationSettings: {
          chartSettings: { categoricalBarChartSettings: { layout: "horizontal" }},
          unitsOverrides: [{ identifier: "revenue", unitCategory: "currency", baseUnit: "usd", decimals: 0, suffix: "$", delimiter: true }]
        },
        querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
        davis: { enabled: false, davisVisualization: { isAvailable: true } }
      };
      dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 4 };
      y += 4;
    }
  }
  
  // Add more dynamic sections based on available field categories
  for (const category of availableFields.categories) {
    if (category.name === 'customer') {
      dashboard.tiles[tileId] = {
        title: "",
        type: "data",
        query: `data record(a="Customer Insights")`,
        visualization: "singleValue",
        visualizationSettings: {
          singleValue: { labelMode: "none", isIconVisible: true, prefixIcon: "UserIcon", colorThresholdTarget: "background" },
          thresholds: [{ id: 1, field: "a", isEnabled: true, rules: [{ id: 1, color: "#7C38A1", comparator: "!=", value: "x" }] }]
        },
        querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
        davis: { enabled: false, davisVisualization: { isAvailable: true } }
      };
      dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 1 };
      y += 1;
      
      // Add customer-specific tiles based on available fields
      let xPos = 0;
      if (category.fields.includes('conversionRate')) {
        dashboard.tiles[tileId] = {
          title: "🎯 Conversion Rate",
          type: "data",
          query: `fetch bizevents | ${stepFilter()} | summarize rate = avg(additionalfields.conversionRate) * 100`,
          visualization: "gauge",
          visualizationSettings: {
            thresholds: [{
              id: 1, field: "rate", isEnabled: true,
              rules: [
                { id: 1, color: { Default: "#2ab06f" }, comparator: "≥", value: 10 },
                { id: 2, color: { Default: "#f5d30f" }, comparator: "≥", value: 5 },
                { id: 3, color: { Default: "#dc2626" }, comparator: "<", value: 5 }
              ]
            }],
            unitsOverrides: [{ identifier: "rate", unitCategory: "percentage", baseUnit: "percent", decimals: 2, suffix: "%", delimiter: true }]
          },
          querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
          davis: { enabled: false, davisVisualization: { isAvailable: true } }
        };
        dashboard.layouts[tileId++] = { x: xPos, y: y, w: 6, h: 3 };
        xPos += 6;
      }
      if (category.fields.includes('netPromoterScore')) {
        dashboard.tiles[tileId] = {
          title: "⭐ Net Promoter Score",
          type: "data",
          query: `fetch bizevents | ${stepFilter()} | summarize nps = avg(toDouble(additionalfields.netPromoterScore))`,
          visualization: "gauge",
          visualizationSettings: {
            thresholds: [{
              id: 1, field: "nps", isEnabled: true,
              rules: [
                { id: 1, color: { Default: "#2ab06f" }, comparator: "≥", value: 50 },
                { id: 2, color: { Default: "#f5d30f" }, comparator: "≥", value: 0 },
                { id: 3, color: { Default: "#dc2626" }, comparator: "<", value: 0 }
              ]
            }],
            unitsOverrides: []
          },
          querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
          davis: { enabled: false, davisVisualization: { isAvailable: true } }
        };
        dashboard.layouts[tileId++] = { x: xPos, y: y, w: 6, h: 3 };
        xPos += 6;
      }
      if (xPos > 0) y += 3;
    }
    
    if (category.name === 'performance') {
      dashboard.tiles[tileId] = {
        title: "",
        type: "data",
        query: `data record(a="Performance & Operations")`,
        visualization: "singleValue",
        visualizationSettings: {
          singleValue: { labelMode: "none", isIconVisible: true, prefixIcon: "ChartLineIcon", colorThresholdTarget: "background" },
          thresholds: [{ id: 1, field: "a", isEnabled: true, rules: [{ id: 1, color: "#DC2626", comparator: "!=", value: "x" }] }]
        },
        querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
        davis: { enabled: false, davisVisualization: { isAvailable: true } }
      };
      dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 1 };
      y += 1;
      
      let xPos = 0;
      if (category.fields.includes('processingTime')) {
        dashboard.tiles[tileId] = {
          title: "⏱️ P90 Processing Time",
          type: "data",
          query: `fetch bizevents | ${stepFilter()} | summarize p90 = percentile(additionalfields.processingTime, 90)`,
          visualization: "singleValue",
          visualizationSettings: {
            singleValue: { label: "P90", recordField: "p90" },
            thresholds: [{
              id: 1, field: "p90", isEnabled: true,
              rules: [
                { id: 1, color: { Default: "#dc2626" }, comparator: ">", value: 5000 },
                { id: 2, color: { Default: "#f5d30f" }, comparator: ">", value: 2000 },
                { id: 3, color: { Default: "#2ab06f" }, comparator: "≤", value: 2000 }
              ]
            }],
            unitsOverrides: [{ identifier: "p90", unitCategory: "time", baseUnit: "milli_second", decimals: 0, suffix: "ms", delimiter: true }]
          },
          querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
          davis: { enabled: false, davisVisualization: { isAvailable: true } }
        };
        dashboard.layouts[tileId++] = { x: xPos, y: y, w: 8, h: 3 };
        xPos += 8;
      }
      if (xPos > 0) y += 3;
    }
    
    if (category.name === 'channel') {
      dashboard.tiles[tileId] = {
        title: "",
        type: "data",
        query: `data record(a="Device & Channel Analytics")`,
        visualization: "singleValue",
        visualizationSettings: {
          singleValue: { labelMode: "none", isIconVisible: true, prefixIcon: "DevicesIcon", colorThresholdTarget: "background" },
          thresholds: [{ id: 1, field: "a", isEnabled: true, rules: [{ id: 1, color: "#F5D30F", comparator: "!=", value: "x" }] }]
        },
        querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
        davis: { enabled: false, davisVisualization: { isAvailable: true } }
      };
      dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 1 };
      y += 1;
      
      if (category.fields.includes('deviceType')) {
        dashboard.tiles[tileId] = {
          title: "📱 Device Types",
          type: "data",
          query: `fetch bizevents | ${stepFilter()} | summarize count = count(), by: {additionalfields.deviceType}`,
          visualization: "donutChart",
          visualizationSettings: {
            chartSettings: { gapPolicy: "connect" },
            unitsOverrides: []
          },
          querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
          davis: { enabled: false, davisVisualization: { isAvailable: true } }
        };
        dashboard.layouts[tileId++] = { x: 0, y: y, w: 12, h: 4 };
      }
      if (category.fields.includes('location')) {
        dashboard.tiles[tileId] = {
          title: "🌍 Top Locations",
          type: "data",
          query: `fetch bizevents | ${stepFilter()} | summarize events = count(), by: {additionalfields.location} | sort events desc | limit 10`,
          visualization: "table",
          visualizationSettings: {
            table: { rowDensity: "condensed" },
            unitsOverrides: []
          },
          querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
          davis: { enabled: false, davisVisualization: { isAvailable: true } }
        };
        dashboard.layouts[tileId++] = { x: 12, y: y, w: 12, h: 4 };
      }
      y += 4;
    }
  }
  
  // ============ SECTION: Customer Insights ============
  dashboard.tiles[tileId] = {
    title: "",
    type: "data",
    query: `data record(a="Customer Insights")`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { labelMode: "none", isIconVisible: true, prefixIcon: "UserIcon", colorThresholdTarget: "background" },
      thresholds: [{ id: 1, field: "a", isEnabled: true, rules: [{ id: 1, color: "#7C38BC", comparator: "!=", value: "x" }] }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 1 };
  y += 1;
  
  // Conversion Rate
  dashboard.tiles[tileId] = {
    title: "🎯 Conversion Rate",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize rate = avg(additionalfields.conversionRate) * 100`,
    visualization: "gauge",
    visualizationSettings: {
      thresholds: [{ id: 1, field: "rate", isEnabled: true, rules: [
        { id: 1, color: { Default: "#2ab06f" }, comparator: "≥", label: "Good", value: 5 },
        { id: 2, color: { Default: "#f5d30f" }, comparator: "≥", label: "Fair", value: 2 },
        { id: 3, color: { Default: "#c62239" }, comparator: "<", label: "Poor", value: 2 }
      ]}],
      unitsOverrides: [{ identifier: "rate", unitCategory: "percentage", baseUnit: "percent", decimals: 2, suffix: "%", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 6, h: 3 };
  
  // NPS Score
  dashboard.tiles[tileId] = {
    title: "⭐ Net Promoter Score",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize nps = avg(toDouble(additionalfields.netPromoterScore))`,
    visualization: "gauge",
    visualizationSettings: {
      thresholds: [{ id: 1, field: "nps", isEnabled: true, rules: [
        { id: 1, color: { Default: "#2ab06f" }, comparator: "≥", label: "Excellent", value: 50 },
        { id: 2, color: { Default: "#f5d30f" }, comparator: "≥", label: "Good", value: 30 },
        { id: 3, color: { Default: "#c62239" }, comparator: "<", label: "Needs Work", value: 30 }
      ]}],
      unitsOverrides: []
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 6, y: y, w: 6, h: 3 };
  
  // High Churn Risk
  dashboard.tiles[tileId] = {
    title: "⚠️ High Churn Risk %",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize highRisk = countIf(additionalfields.churnRisk == "high"), total = count() | fieldsAdd pct = (toDouble(highRisk) / toDouble(total)) * 100`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "AT RISK", recordField: "pct", colorThresholdTarget: "background" },
      thresholds: [{ id: 1, field: "pct", isEnabled: true, rules: [
        { id: 1, color: { Default: "#c62239" }, comparator: "≥", value: 30 },
        { id: 2, color: { Default: "#f5d30f" }, comparator: "≥", value: 15 },
        { id: 3, color: { Default: "#2ab06f" }, comparator: "<", value: 15 }
      ]}],
      unitsOverrides: [{ identifier: "pct", unitCategory: "percentage", baseUnit: "percent", decimals: 1, suffix: "%", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 12, y: y, w: 6, h: 3 };
  
  // Engagement Score
  dashboard.tiles[tileId] = {
    title: "💡 Avg Engagement",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize eng = avg(additionalfields.engagementScore)`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "SCORE", recordField: "eng", colorThresholdTarget: "background" },
      thresholds: [],
      unitsOverrides: [{ identifier: "eng", unitCategory: "unspecified", baseUnit: "count", decimals: 1, delimiter: false }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 18, y: y, w: 6, h: 3 };
  y += 3;
  
  // Customer Segments
  dashboard.tiles[tileId] = {
    title: "💎 Customer Segments",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize count = count(), by: {additionalfields.customerSegmentValue}`,
    visualization: "donutChart",
    visualizationSettings: {
      chartSettings: { circleChartSettings: { valueType: "relative", showTotalValue: true }},
      legend: { ratio: 27 },
      thresholds: [],
      unitsOverrides: []
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 8, h: 4 };
  
  // Market Segments
  dashboard.tiles[tileId] = {
    title: "🏢 Market Segments Revenue",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize revenue = sum(additionalfields.orderTotal), by: {additionalfields.marketSegment}`,
    visualization: "categoricalBarChart",
    visualizationSettings: {
      chartSettings: { categoricalBarChartSettings: { layout: "horizontal" }},
      thresholds: [],
      unitsOverrides: [{ identifier: "revenue", unitCategory: "currency", baseUnit: "usd", decimals: 0, delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 8, y: y, w: 16, h: 4 };
  y += 4;
  
  // ============ SECTION: Device & Channel ============
  dashboard.tiles[tileId] = {
    title: "",
    type: "data",
    query: `data record(a="Device & Channel Analytics")`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { labelMode: "none", isIconVisible: true, prefixIcon: "MobileDeviceIcon", colorThresholdTarget: "background" },
      thresholds: [{ id: 1, field: "a", isEnabled: true, rules: [{ id: 1, color: "#478ACA", comparator: "!=", value: "x" }] }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 1 };
  y += 1;
  
  // Device Distribution
  dashboard.tiles[tileId] = {
    title: "📱 Device Types",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize count = count(), by: {additionalfields.deviceType}`,
    visualization: "donutChart",
    visualizationSettings: {
      chartSettings: { 
        categoryOverrides: {
          "mobile": { color: "#478ACA" },
          "desktop": { color: "#2AB06F" },
          "tablet": { color: "#F5D30F" }
        },
        circleChartSettings: { valueType: "relative", showTotalValue: true }
      },
      legend: { ratio: 27 },
      thresholds: [],
      unitsOverrides: []
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 8, h: 4 };
  
  // Top Locations by Revenue
  dashboard.tiles[tileId] = {
    title: "🌍 Top Locations by Revenue",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize events = count(), revenue = sum(additionalfields.orderTotal), by: {additionalfields.location} | sort revenue desc | limit 10`,
    visualization: "table",
    visualizationSettings: {
      chartSettings: { gapPolicy: "connect" },
      table: { rowDensity: "condensed", enableLineWrap: false, firstVisibleRowIndex: 0, columnWidths: {} },
      thresholds: [],
      unitsOverrides: [{ identifier: "revenue", unitCategory: "currency", baseUnit: "usd", decimals: 0, delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 8, y: y, w: 16, h: 4 };
  y += 4;
  
  // ============ SECTION: Performance Metrics ============
  dashboard.tiles[tileId] = {
    title: "",
    type: "data",
    query: `data record(a="Performance & Operations")`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { labelMode: "none", isIconVisible: true, prefixIcon: "ChartLineIcon", colorThresholdTarget: "background" },
      thresholds: [{ id: 1, field: "a", isEnabled: true, rules: [{ id: 1, color: "#2AB06F", comparator: "!=", value: "x" }] }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 1 };
  y += 1;
  
  // Processing Time P90
  dashboard.tiles[tileId] = {
    title: "⏱️ P90 Processing Time",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize p90 = percentile(additionalfields.processingTime, 90)`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "RESPONSE TIME", recordField: "p90", colorThresholdTarget: "background" },
      thresholds: [{ id: 1, field: "p90", isEnabled: true, rules: [
        { id: 1, color: { Default: "#2ab06f" }, comparator: "≤", value: 50 },
        { id: 2, color: { Default: "#f5d30f" }, comparator: "≤", value: 100 },
        { id: 3, color: { Default: "#c62239" }, comparator: ">", value: 100 }
      ]}],
      unitsOverrides: [{ identifier: "p90", unitCategory: "time", baseUnit: "millisecond", decimals: 0, suffix: " ms", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 6, h: 3 };
  
  // Operational Cost
  dashboard.tiles[tileId] = {
    title: "💵 Avg Operational Cost",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize cost = avg(toDouble(additionalfields.operationalCost))`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "COST PER EVENT", recordField: "cost", colorThresholdTarget: "background" },
      thresholds: [],
      unitsOverrides: [{ identifier: "cost", unitCategory: "currency", baseUnit: "usd", decimals: 2, suffix: "$", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 6, y: y, w: 6, h: 3 };
  
  // Resource Utilization
  dashboard.tiles[tileId] = {
    title: "🔋 Avg Resource Utilization",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize util = avg(additionalfields.resourceUtilization) * 100`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "UTILIZATION", recordField: "util", colorThresholdTarget: "background" },
      thresholds: [],
      unitsOverrides: [{ identifier: "util", unitCategory: "percentage", baseUnit: "percent", decimals: 1, suffix: "%", delimiter: true }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 12, y: y, w: 6, h: 3 };
  
  // Efficiency Rating
  dashboard.tiles[tileId] = {
    title: "⚡ Avg Efficiency Rating",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | summarize eff = avg(toDouble(additionalfields.efficiencyRating))`,
    visualization: "singleValue",
    visualizationSettings: {
      singleValue: { label: "EFFICIENCY", recordField: "eff", colorThresholdTarget: "background" },
      thresholds: [],
      unitsOverrides: [{ identifier: "eff", unitCategory: "unspecified", baseUnit: "count", decimals: 0, delimiter: false }]
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 18, y: y, w: 6, h: 3 };
  y += 3;
  
  // Revenue vs Cost Over Time
  dashboard.tiles[tileId] = {
    title: "💰 Revenue vs Cost Trend",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | makeTimeseries revenue = sum(additionalfields.orderTotal), cost = sum(toDouble(additionalfields.operationalCost)), bins:20`,
    visualization: "areaChart",
    visualizationSettings: {
      chartSettings: { 
        gapPolicy: "connect",
        seriesOverrides: [
          { seriesId: ["revenue"], override: { color: "#2AB06F" }},
          { seriesId: ["cost"], override: { color: "#C62239" }}
        ]
      },
      thresholds: [],
      unitsOverrides: []
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 4 };
  y += 4;
  
  // ============ DETAILED DATA TABLE ============
  dashboard.tiles[tileId] = {
    title: "🔍 Recent Journey Events (Detailed)",
    type: "data",
    query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${companyName}" | filter json.journeyType == $journeyType or $journeyType == "*" | filter in(json.stepName,$Step) | fields timestamp, json.customerId, json.stepName, json.correlationId, additionalfields.orderTotal, additionalfields.deviceType, additionalfields.location, additionalfields.churnRisk, additionalfields.engagementScore, additionalfields.customerLifetimeValue | sort timestamp desc | limit 100`,
    visualization: "table",
    visualizationSettings: {
      chartSettings: { gapPolicy: "connect" },
      table: { 
        rowDensity: "condensed", 
        enableLineWrap: false, 
        firstVisibleRowIndex: 0, 
        columnWidths: {
          "timestamp": 180,
          "json.customerId": 150,
          "json.stepName": 150,
          "json.correlationId": 200,
          "additionalfields.orderTotal": 100,
          "additionalfields.deviceType": 100,
          "additionalfields.location": 120,
          "additionalfields.churnRisk": 100,
          "additionalfields.engagementScore": 120,
          "additionalfields.customerLifetimeValue": 120
        }
      },
      thresholds: [],
      unitsOverrides: []
    },
    querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500 },
    davis: { enabled: false, davisVisualization: { isAvailable: true } }
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 6 };
  y += 6;
  
  // Footer
  dashboard.tiles[tileId] = {
    type: "markdown",
    content: `*Dashboard auto-generated by BizObs Engine* | Monitoring ${companyName} journey performance across all touchpoints`
  };
  dashboard.layouts[tileId++] = { x: 0, y: y, w: 24, h: 1 };
  
  console.log(`✅ Enterprise dashboard generated with ${Object.keys(dashboard.tiles).length} tiles`);
  
  return dashboard;
}

export { deployJourneyDashboard, findExistingDashboard, generateDashboardJson };
