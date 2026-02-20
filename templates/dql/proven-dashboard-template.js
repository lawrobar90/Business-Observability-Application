/**
 * PROVEN DASHBOARD TEMPLATE LIBRARY
 * ===================================
 * Extracted from the working Manufacturing dashboard (manufacturing - Working Draft.json)
 * 
 * Every DQL query, visualization config, threshold, and variable definition below
 * has been validated as WORKING in a real Dynatrace environment.
 * 
 * The LLM/AI dashboard agent uses these as the canonical base templates.
 * Industry-specific values (company name, journey type, step names) are injected
 * at generation time via function parameters or dashboard variables.
 * 
 * VARIABLE CHAIN (proven cascade):
 *   $CompanyName → $JourneyType → $Step → $Service → $PGI
 * 
 * TILE CATEGORIES:
 *   1. JOURNEY OVERVIEW    – Step metrics table, KPI cards, volume/funnel charts
 *   2. FILTERED VIEW       – Same KPIs filtered by $Step variable
 *   3. PERFORMANCE & OPS   – Step performance, SLA, error details, hourly patterns
 *   4. GOLDEN SIGNALS      – TRAFFIC, LATENCY, ERRORS, SATURATION (service-level)
 *   5. TRACES & EXCEPTIONS – Spans with exceptions, Davis problems, log errors
 *   6. NAVIGATION          – Deep-link markdown panel, footer
 */

// ============================================================================
// PROVEN VARIABLE DEFINITIONS
// These variables cascade: CompanyName → JourneyType → Step → Service → PGI
// ============================================================================

export function getProvenVariables(company) {
  return [
    {
      key: 'CompanyName',
      visible: true,
      type: 'query',
      version: 2,
      editable: true,
      multiple: false,
      input: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${company}" | fields json.companyName | dedup json.companyName`
    },
    {
      key: 'JourneyType',
      visible: true,
      type: 'query',
      version: 2,
      editable: true,
      multiple: true,
      input: `fetch bizevents \n| filter json.companyName == $CompanyName\n| fields json.journeyType | dedup json.journeyType`
    },
    {
      key: 'Step',
      visible: true,
      type: 'query',
      version: 2,
      editable: true,
      multiple: true,
      input: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter in(json.journeyType, $JourneyType) | filter json.companyName == "${company}" | fields json.stepName | dedup json.stepName`
    },
    {
      key: 'Service',
      visible: true,
      type: 'query',
      version: 2,
      editable: true,
      multiple: true,
      input: `fetch bizevents\n| fields json.serviceName, json.companyName, json.journeyType\n| summarize count(),by:{json.companyName, json.journeyType, json.serviceName}\n| filter json.companyName == $CompanyName \n| filter in(json.journeyType, $JourneyType)\n| dedup json.serviceName\n| fields json.serviceName = lower(json.serviceName)\n| filter isNotNull(json.serviceName)`
    },
    {
      key: 'PGI',
      visible: true,
      type: 'query',
      version: 2,
      editable: true,
      multiple: true,
      input: `smartscapeNodes PROCESS\n| lookup [smartscapeNodes SERVICE | fields id, name], sourceField:name, lookupField:name, prefix:"svc."\n| lookup [timeseries cpu = avg(dt.process.cpu.usage), by:{dt.smartscape.process}], sourceField:id, lookupField:dt.smartscape.process, fields:{cpu}\n| filter isNotNull(cpu)\n| fieldsAdd LowerService = lower(process.metadata[DYNATRACE_CLUSTER_ID])\n| filter in(LowerService, $Service)\n| fields id\n| dedup id`
    }
  ];
}

// ============================================================================
// SHARED QUERY SETTINGS & DAVIS CONFIG (used on every data tile)
// ============================================================================

const QUERY_SETTINGS = {
  maxResultRecords: 1000,
  defaultScanLimitGbytes: 500,
  maxResultMegaBytes: 1,
  defaultSamplingRatio: 10,
  enableSampling: false
};

const DAVIS_CONFIG = {
  enabled: false,
  davisVisualization: { isAvailable: true }
};

// ============================================================================
// COLOR CONSTANTS (from working dashboard)
// ============================================================================

const COLORS = {
  green: '#2ab06f',
  yellow: '#f5d30f',
  red: '#dc2626',
  crimson: '#c62239',
  blue: '#478ACA',
  purple: '#7C38A1',
  violet: '#7C3AED',
  orange: '#E87A35',
  teal: '#2AB06F',
  dtIdeal: 'var(--dt-colors-charts-status-ideal-default, #2f6862)',
  dtWarning: 'var(--dt-colors-charts-status-warning-default, #eea53c)',
  dtCritical: 'var(--dt-colors-charts-status-critical-default, #c62239)',
  dtBlueSteel: 'var(--dt-colors-charts-categorical-themed-blue-steel-color-01-default, #438fb1)'
};

// ============================================================================
// SECTION 1: JOURNEY OVERVIEW TILES
// Widget types: table, singleValue, areaChart, donutChart
// ============================================================================

export function getJourneyOverviewTiles(company) {
  return {
    step_metrics: {
      _tag: 'journey-metrics-table',
      _widgetType: 'table',
      _purpose: 'Shows all journey steps with volume, success rate, avg time, errors, error rate',
      title: '📊 Journey Step Metrics',
      type: 'data',
      query: `fetch bizevents \n| filter event.kind == "BIZ_EVENT" \n| filter json.companyName == $CompanyName \n| filter json.journeyType == $JourneyType \n| summarize \n    OrdersInStep = count(), \n    SuccessRate = round((toDouble(countIf(isNull(additionalfields.hasError) or additionalfields.hasError == false)) / toDouble(count())) * 100, decimals:2),\n    AvgTimeInStep = avg(additionalfields.processingTime),\n    ErrorsInStep = countIf(additionalfields.hasError == true),\n    ErrorRate = round((toDouble(countIf(additionalfields.hasError == true)) / toDouble(count())) * 100, decimals:2), \n    by: {json.stepName} \n| sort OrdersInStep desc`,
      visualization: 'table',
      visualizationSettings: {
        table: {
          columnWidths: { 'json.stepName': 200, 'OrdersInStep': 120, 'SuccessRate': 120, 'AvgTimeInStep': 120, 'ErrorsInStep': 120, 'ErrorRate': 120 }
        },
        thresholds: [
          { id: 1, field: 'SuccessRate', isEnabled: true, rules: [
            { id: 1, color: { Default: COLORS.green }, comparator: '≥', value: 95 },
            { id: 2, color: { Default: COLORS.yellow }, comparator: '≥', value: 85 },
            { id: 3, color: { Default: COLORS.red }, comparator: '<', value: 85 }
          ]},
          { id: 2, field: 'ErrorRate', isEnabled: true, rules: [
            { id: 1, color: { Default: COLORS.red }, comparator: '>', value: 5 },
            { id: 2, color: { Default: COLORS.yellow }, comparator: '>', value: 2 },
            { id: 3, color: { Default: COLORS.green }, comparator: '≤', value: 2 }
          ]}
        ],
        unitsOverrides: [
          { identifier: 'SuccessRate', unitCategory: 'percentage', baseUnit: 'percent', displayUnit: null, decimals: 3, suffix: '%', delimiter: true },
          { identifier: 'AvgTimeInStep', unitCategory: null, baseUnit: null, displayUnit: null, decimals: 0, suffix: 'ms', delimiter: true },
          { identifier: 'ErrorRate', unitCategory: 'percentage', baseUnit: 'percent', displayUnit: null, decimals: 2, suffix: '%', delimiter: true },
          { identifier: 'OrdersInStep', unitCategory: 'unspecified', baseUnit: 'count', displayUnit: null, decimals: 0, suffix: '', delimiter: true }
        ]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    total_volume: {
      _tag: 'kpi-total-volume',
      _widgetType: 'singleValue',
      _purpose: 'Total bizevents count for the journey',
      title: '📈 Total Journey Volume',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType | summarize TotalEvents = count()`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'TOTAL VOLUME', recordField: 'TotalEvents', prefixIcon: 'ActivityIcon', colorThresholdTarget: 'background' },
        thresholds: [],
        unitsOverrides: [{ identifier: 'TotalEvents', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, suffix: '', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    success_rate: {
      _tag: 'kpi-success-rate',
      _widgetType: 'singleValue',
      _purpose: 'Overall journey success rate percentage with green/yellow/red thresholds',
      title: '✅ Journey Success Rate',
      type: 'data',
      query: `fetch bizevents \n| filter event.kind == "BIZ_EVENT" \n| filter json.companyName == $CompanyName \n| filter json.journeyType == $JourneyType \n| summarize total = count(), successful = countIf(isNull(additionalfields.hasError) or additionalfields.hasError == false) \n| fieldsAdd success_rate = round((toDouble(successful) / toDouble(total)) * 100, decimals:2)`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'SUCCESS RATE', recordField: 'success_rate', prefixIcon: 'CheckmarkIcon' },
        thresholds: [{ id: 1, field: 'success_rate', isEnabled: true, rules: [
          { id: 1, color: { Default: COLORS.green }, comparator: '≥', value: 95 },
          { id: 2, color: { Default: COLORS.yellow }, comparator: '≥', value: 85 },
          { id: 3, color: { Default: COLORS.red }, comparator: '<', value: 85 }
        ]}],
        unitsOverrides: [{ identifier: 'success_rate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 1, suffix: '%', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    total_revenue: {
      _tag: 'kpi-revenue',
      _widgetType: 'singleValue',
      _purpose: 'Sum of orderTotal across all journey events',
      title: '💰 Total Revenue',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType or $JourneyType == "*" | summarize revenue = sum(additionalfields.orderTotal)`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'REVENUE', recordField: 'revenue', prefixIcon: 'MoneyIcon', colorThresholdTarget: 'background' },
        thresholds: [],
        unitsOverrides: [{ identifier: 'revenue', unitCategory: 'currency', baseUnit: 'usd', decimals: 0, suffix: '$', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    total_errors: {
      _tag: 'kpi-errors',
      _widgetType: 'singleValue',
      _purpose: 'Count of error events with color-coded thresholds',
      title: '❌ Total Errors',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType or $JourneyType == "*" | summarize errors = countIf(additionalfields.hasError == true)`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'ERRORS', recordField: 'errors', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'errors', isEnabled: true, rules: [
          { id: 1, color: { Default: COLORS.red }, comparator: '>', value: 10 },
          { id: 2, color: { Default: COLORS.yellow }, comparator: '>', value: 5 },
          { id: 3, color: { Default: COLORS.green }, comparator: '≤', value: 5 }
        ]}],
        unitsOverrides: [{ identifier: 'errors', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, suffix: '', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    volume_over_time: {
      _tag: 'timeseries-volume',
      _widgetType: 'areaChart',
      _purpose: 'Stacked area chart: successful vs failed events over time (bins:30)',
      title: '📈 Volume Over Time',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType | makeTimeseries successful = countIf(isNull(additionalfields.hasError) or additionalfields.hasError == false), failed = countIf(additionalfields.hasError == true), bins:30`,
      visualization: 'areaChart',
      visualizationSettings: {
        chartSettings: {
          fieldMapping: { leftAxisValues: ['successful', 'failed'], timestamp: 'timeframe' },
          seriesOverrides: [
            { seriesId: ['successful'], override: { color: '#2AB06F' } },
            { seriesId: ['failed'], override: { color: '#C62239' } }
          ],
          gapPolicy: 'connect'
        },
        thresholds: [],
        unitsOverrides: []
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    events_by_step: {
      _tag: 'distribution-steps',
      _widgetType: 'donutChart',
      _purpose: 'Donut chart showing event distribution across journey steps',
      title: '📊 Events by Step',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType or $JourneyType == "*" | summarize count = count(), by: {json.stepName} | sort count desc | limit 10`,
      visualization: 'donutChart',
      visualizationSettings: {
        chartSettings: { circleChartSettings: { valueType: 'relative', showTotalValue: true } },
        legend: { ratio: 27 },
        thresholds: [],
        unitsOverrides: []
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    }
  };
}

// ============================================================================
// SECTION 2: FILTERED VIEW TILES (using $Step variable)
// ============================================================================

export function getFilteredViewTiles(company) {
  return {
    filtered_events: {
      _tag: 'filtered-kpi-events',
      _widgetType: 'singleValue',
      _purpose: 'Total events filtered by selected step',
      title: '💼 Journey Events (Filtered)',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType or $JourneyType == "*" | filter in(json.stepName, $Step) | summarize total = count()`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'TOTAL EVENTS', recordField: 'total', prefixIcon: 'ProcessesIcon', colorThresholdTarget: 'background' },
        thresholds: [],
        unitsOverrides: [{ identifier: 'total', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, suffix: '', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    filtered_revenue: {
      _tag: 'filtered-kpi-revenue',
      _widgetType: 'singleValue',
      _purpose: 'Revenue filtered by selected step',
      title: '💰 Revenue (Filtered)',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType or $JourneyType == "*" | filter in(json.stepName, $Step) | summarize revenue = sum(additionalfields.orderTotal)`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'REVENUE', recordField: 'revenue', prefixIcon: 'MoneyIcon', colorThresholdTarget: 'background' },
        thresholds: [],
        unitsOverrides: [{ identifier: 'revenue', unitCategory: 'currency', baseUnit: 'usd', decimals: 0, suffix: '$', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    filtered_aov: {
      _tag: 'filtered-kpi-aov',
      _widgetType: 'singleValue',
      _purpose: 'Average order value filtered by step',
      title: '💵 Avg Order Value',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType or $JourneyType == "*" | filter in(json.stepName, $Step) | summarize avg = avg(additionalfields.orderTotal)`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'AOV', recordField: 'avg', colorThresholdTarget: 'background' },
        thresholds: [],
        unitsOverrides: [{ identifier: 'avg', unitCategory: 'currency', baseUnit: 'usd', decimals: 2, suffix: '$', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    filtered_p90: {
      _tag: 'filtered-kpi-p90',
      _widgetType: 'singleValue',
      _purpose: 'P90 response time filtered by step with green/yellow/red thresholds',
      title: '⏱️ P90 Response Time',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType or $JourneyType == "*" | filter in(json.stepName, $Step) | summarize p90 = percentile(additionalfields.processingTime, 90)`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'P90 RESPONSE TIME', recordField: 'p90', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'p90', isEnabled: true, rules: [
          { id: 1, color: { Default: COLORS.green }, comparator: '≤', value: 50 },
          { id: 2, color: { Default: COLORS.yellow }, comparator: '≤', value: 100 },
          { id: 3, color: { Default: COLORS.crimson }, comparator: '>', value: 100 }
        ]}],
        unitsOverrides: [{ identifier: 'p90', unitCategory: 'time', baseUnit: 'millisecond', decimals: 0, suffix: ' ms', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    filtered_volume_trend: {
      _tag: 'filtered-timeseries',
      _widgetType: 'areaChart',
      _purpose: 'Events over time filtered by step',
      title: '📈 Events Over Time (Filtered)',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType or $JourneyType == "*" | filter in(json.stepName, $Step) | makeTimeseries events = count(), bins:30`,
      visualization: 'areaChart',
      visualizationSettings: {
        chartSettings: { gapPolicy: 'connect', seriesOverrides: [{ seriesId: ['events'], override: { color: '#2AB06F' } }] },
        thresholds: [],
        unitsOverrides: []
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    filtered_events_by_step: {
      _tag: 'filtered-bar-chart',
      _widgetType: 'categoricalBarChart',
      _purpose: 'Bar chart of events per step (filtered view)',
      title: '📊 Events by Step (Filtered)',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType or $JourneyType == "*" | summarize count = count(), by: {json.stepName} | sort count desc | limit 10`,
      visualization: 'categoricalBarChart',
      visualizationSettings: { chartSettings: { categoricalBarChartSettings: {} }, thresholds: [], unitsOverrides: [] },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    }
  };
}

// ============================================================================
// SECTION 3: PERFORMANCE & OPERATIONS TILES
// ============================================================================

export function getPerformanceTiles(company) {
  return {
    step_performance: {
      _tag: 'perf-step-table',
      _widgetType: 'table',
      _purpose: 'Table: events, avg time, error rate per step with color thresholds',
      title: '⚡ Step Performance',
      type: 'data',
      query: `fetch bizevents \n| filter event.kind == "BIZ_EVENT" \n| filter json.companyName == $CompanyName \n| filter json.journeyType == $JourneyType \n| summarize Events = count(), AvgTime = avg(additionalfields.processingTime), ErrorRate = round((toDouble(countIf(additionalfields.hasError == true)) / toDouble(count())) * 100, decimals:2), by: {json.stepName} \n| sort Events desc`,
      visualization: 'table',
      visualizationSettings: {
        table: { columnWidths: { 'json.stepName': 200, 'Events': 100, 'AvgTime': 120, 'ErrorRate': 120 } },
        thresholds: [{ id: 1, field: 'ErrorRate', isEnabled: true, rules: [
          { id: 1, color: { Default: COLORS.red }, comparator: '>', value: 5 },
          { id: 2, color: { Default: COLORS.yellow }, comparator: '>', value: 2 },
          { id: 3, color: { Default: COLORS.green }, comparator: '≤', value: 2 }
        ]}],
        unitsOverrides: [
          { identifier: 'AvgTime', unitCategory: 'time', baseUnit: 'milli_second', decimals: 0, suffix: 'ms', delimiter: true },
          { identifier: 'ErrorRate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 2, suffix: '%', delimiter: true },
          { identifier: 'Events', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, suffix: '', delimiter: true }
        ]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    sla_compliance: {
      _tag: 'perf-sla-table',
      _widgetType: 'table',
      _purpose: 'SLA compliance table (< 5s threshold) per step with green/yellow/red',
      title: '📋 SLA Compliance (< 5s)',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType | summarize TotalEvents = count(), WithinSLA = countIf(additionalfields.processingTime < 5000), by: {json.stepName} | fieldsAdd ComplianceRate = (WithinSLA / TotalEvents) * 100`,
      visualization: 'table',
      visualizationSettings: {
        table: { columnWidths: { 'json.stepName': 200, 'TotalEvents': 100, 'WithinSLA': 100, 'ComplianceRate': 120 } },
        thresholds: [{ id: 1, field: 'ComplianceRate', isEnabled: true, rules: [
          { id: 1, color: { Default: COLORS.green }, comparator: '≥', value: 95 },
          { id: 2, color: { Default: COLORS.yellow }, comparator: '≥', value: 85 },
          { id: 3, color: { Default: COLORS.red }, comparator: '<', value: 85 }
        ]}],
        unitsOverrides: [
          { identifier: 'ComplianceRate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 1, suffix: '%', delimiter: true },
          { identifier: 'TotalEvents', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, suffix: '', delimiter: true },
          { identifier: 'WithinSLA', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, suffix: '', delimiter: true }
        ]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    error_rate_trend: {
      _tag: 'perf-error-trend',
      _widgetType: 'lineChart',
      _purpose: 'Error rate percentage over time with threshold coloring',
      title: '📉 Error Rate Trend',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType | makeTimeseries {errors = countIf(additionalfields.hasError == true), total = count()}, bins:30 | fieldsAdd ErrorRate = (errors[] / total[]) * 100`,
      visualization: 'lineChart',
      visualizationSettings: {
        chartSettings: { seriesOverrides: [{ seriesId: ['ErrorRate'], override: { color: '#C62239' } }], gapPolicy: 'connect' },
        thresholds: [{ id: 1, field: 'ErrorRate', isEnabled: true, rules: [
          { id: 1, color: { Default: COLORS.red }, comparator: '>', value: 5 },
          { id: 2, color: { Default: COLORS.yellow }, comparator: '>', value: 2 }
        ]}],
        unitsOverrides: [{ identifier: 'ErrorRate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 2, suffix: '%', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    errors_by_step: {
      _tag: 'perf-errors-step',
      _widgetType: 'table',
      _purpose: 'Error count per step, sorted by highest errors',
      title: '❌ Errors by Step',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType | filter additionalfields.hasError == true | summarize ErrorCount = count(), by: {json.stepName} | sort ErrorCount desc`,
      visualization: 'table',
      visualizationSettings: {
        autoSelectVisualization: false,
        unitsOverrides: [{ identifier: 'ErrorCount', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, suffix: '', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    error_details: {
      _tag: 'perf-error-details',
      _widgetType: 'table',
      _purpose: 'Error messages grouped by step with occurrence count',
      title: '🐛 Error Details',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType | filter additionalfields.hasError == true | summarize Occurrences = count(), by: {json.stepName, additionalfields.errorMessage} | sort Occurrences desc | limit 20`,
      visualization: 'table',
      visualizationSettings: {
        table: { columnWidths: { 'json.stepName': 150, 'additionalfields.errorMessage': 300, 'Occurrences': 100 } },
        thresholds: [],
        unitsOverrides: [{ identifier: 'Occurrences', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, suffix: '', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    hourly_pattern: {
      _tag: 'perf-hourly',
      _widgetType: 'pieChart',
      _purpose: 'Hourly activity distribution to show peak hours',
      title: '🕐 Hourly Activity Pattern',
      type: 'data',
      query: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == $CompanyName | filter json.journeyType == $JourneyType | fieldsAdd hour = toString(getHour(timestamp)) | summarize Events = count(), by: {hour} | sort hour asc`,
      visualization: 'pieChart',
      visualizationSettings: {
        autoSelectVisualization: false,
        thresholds: [],
        unitsOverrides: [{ identifier: 'Events', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, suffix: '', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    }
  };
}

// ============================================================================
// SECTION 4: GOLDEN SIGNALS – TRAFFIC, LATENCY, ERRORS, SATURATION
// These use timeseries commands with $Service and $PGI variables
// ============================================================================

// Shared visualization settings for service-level timeseries charts
function getServiceChartVizSettings() {
  return {
    chartSettings: { legend: { hidden: true } },
    autoSelectVisualization: false,
    thresholds: [
      { id: 7, field: 'Latency_p50', title: '', isEnabled: true, rules: [
        { id: 0, color: { Default: COLORS.dtIdeal }, comparator: '≥', label: '', value: 0 },
        { id: 1, color: { Default: COLORS.dtWarning }, comparator: '≥', label: '', value: 1000000 },
        { id: 2, color: { Default: COLORS.dtCritical }, comparator: '≥', label: '', value: 2000000 }
      ]},
      { id: 8, field: 'Latency_p90', title: '', isEnabled: true, rules: [
        { id: 0, color: { Default: COLORS.dtIdeal }, comparator: '≥', label: '', value: 0 },
        { id: 1, color: { Default: COLORS.dtWarning }, comparator: '≥', label: '', value: 1000000 },
        { id: 2, color: { Default: COLORS.dtCritical }, comparator: '≥', label: '', value: 2000000 }
      ]},
      { id: 9, field: 'Latency_p99', title: '', isEnabled: true, rules: [
        { id: 0, color: { Default: COLORS.dtIdeal }, comparator: '≥', label: '', value: 0 },
        { id: 1, color: { Default: COLORS.dtWarning }, comparator: '≥', label: '', value: 1000000 },
        { id: 2, color: { Default: COLORS.dtCritical }, comparator: '≥', label: '', value: 2000000 }
      ]}
    ],
    unitsOverrides: [
      { identifier: 'Latency_p50', unitCategory: 'time', baseUnit: 'microsecond', displayUnit: null, decimals: null, suffix: '', delimiter: false },
      { identifier: 'Latency_p90', unitCategory: 'time', baseUnit: 'microsecond', displayUnit: null, decimals: null, suffix: '', delimiter: false },
      { identifier: 'Latency_p99', unitCategory: 'time', baseUnit: 'microsecond', displayUnit: null, decimals: null, suffix: '', delimiter: false }
    ]
  };
}

export function getGoldenSignalTiles() {
  const svcViz = getServiceChartVizSettings();

  return {
    // ---- TRAFFIC ----
    requests: {
      _tag: 'golden-traffic-requests',
      _widgetType: 'lineChart',
      _purpose: 'Service request count timeseries filtered by $Service',
      title: 'Requests',
      type: 'data',
      query: `timeseries requests = sum(dt.service.request.count),\n           by:{dt.entity.service}\n           | fields  timeframe, \n          interval, \n          service = entityName(dt.entity.service),\n          requests\n| sort arraySum(requests) desc\n| filter in(service, $Service)\n| limit 100`,
      visualization: 'lineChart',
      visualizationSettings: svcViz,
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    requests_success_failed: {
      _tag: 'golden-traffic-success-failed',
      _widgetType: 'barChart',
      _purpose: 'Stacked bar of successful vs failed requests',
      title: 'Requests - Success vs Failed',
      type: 'data',
      query: `timeseries total = sum(dt.service.request.count, default:0),\n           failed = sum(dt.service.request.failure_count,default:0),\n           nonempty: true, \n           filter: in(dt.smartscape.service, array($Service)) \n| fieldsAdd success = total[] -failed[]\n| fields timeframe,\n         interval,\n         success,\n         failed`,
      visualization: 'barChart',
      visualizationSettings: svcViz,
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    key_requests: {
      _tag: 'golden-traffic-key-requests',
      _widgetType: 'barChart',
      _purpose: 'Key request endpoints (excluding NON_KEY_REQUESTS)',
      title: 'Requests - Key Requests',
      type: 'data',
      query: `timeseries requests = sum(dt.service.request.count),\n           by:{endpoint.name},\n           filter: endpoint.name != "NON_KEY_REQUESTS" and\n           in(dt.entity.service, array($Service))\n| fields  timeframe, \n          interval, \n          endpoint.name,\n          requests\n| sort arraySum(requests) desc         \n| limit 100 `,
      visualization: 'barChart',
      visualizationSettings: svcViz,
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    // ---- LATENCY ----
    latency_p50: {
      _tag: 'golden-latency-p50',
      _widgetType: 'lineChart',
      _purpose: 'Median response time per service',
      title: 'Latency_p50',
      type: 'data',
      query: `timeseries latency_p50 = median(dt.service.request.response_time),\n           by:{dt.entity.service}\n           | fields  timeframe, \n          interval, \n          service = entityName(dt.entity.service),\n          latency_p50\n| sort arrayAvg(latency_p50) desc\n| filter in(service, $Service)\n| limit 100`,
      visualization: 'lineChart',
      visualizationSettings: svcViz,
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    latency_p90: {
      _tag: 'golden-latency-p90',
      _widgetType: 'barChart',
      _purpose: 'P90 response time per service',
      title: 'Latency_p90',
      type: 'data',
      query: `timeseries latency_p90 = percentile(dt.service.request.response_time, 90),\n           by:{dt.entity.service}\n          | fields  timeframe, \n          interval, \n          service = lower(entityName(dt.entity.service)),\n          latency_p90\n| sort arrayAvg(latency_p90) desc\n| filter in(service, $Service)\n| limit 100`,
      visualization: 'barChart',
      visualizationSettings: svcViz,
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    latency_p99: {
      _tag: 'golden-latency-p99',
      _widgetType: 'barChart',
      _purpose: 'P99 response time per service',
      title: 'Latency_p99',
      type: 'data',
      query: `timeseries latency_p99 = percentile(dt.service.request.response_time, 99), \n           by:{dt.entity.service}\n| fields  timeframe, \n          interval, \n          service = lower(entityName(dt.entity.service)),\n          latency_p99\n| sort arrayAvg(latency_p99) desc\n| filter in(service, array($Service))\n| limit 100`,
      visualization: 'barChart',
      visualizationSettings: svcViz,
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    // ---- ERRORS (service-level) ----
    failed_requests: {
      _tag: 'golden-errors-failed',
      _widgetType: 'lineChart',
      _purpose: 'Failed request count timeseries per service',
      title: 'Failed Requests',
      type: 'data',
      query: `timeseries errors = sum(dt.service.request.failure_count,default:0),\n           nonempty: true,\n           by:{dt.entity.service}\n           | fields  timeframe, \n          interval, \n          service = entityName(dt.entity.service),\n          errors\n| sort arraySum(errors) desc\n| filter in(service, $Service)\n| limit 100`,
      visualization: 'lineChart',
      visualizationSettings: svcViz,
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    errors_5xx: {
      _tag: 'golden-errors-5xx',
      _widgetType: 'barChart',
      _purpose: '5xx HTTP errors per service',
      title: '5xx Errors',
      type: 'data',
      query: `timeseries errors = sum(dt.service.request.count,default:0),\n           nonempty: true,\n           by:{dt.entity.service},\n           filter:\n           http.response.status_code >= 500 and http.response.status_code <= 599 \n| fields  timeframe, \n          interval, \n          service = lower(entityName(dt.entity.service)),\n          errors\n| sort arraySum(errors) desc\n| filter in(service, array($Service))\n| limit 100`,
      visualization: 'barChart',
      visualizationSettings: svcViz,
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    errors_4xx: {
      _tag: 'golden-errors-4xx',
      _widgetType: 'lineChart',
      _purpose: '4xx HTTP errors per service',
      title: '4xx Errors',
      type: 'data',
      query: `timeseries errors = sum(dt.service.request.count,default:0),\n           nonempty: true,\n           by:{dt.entity.service},\n           filter:\n           http.response.status_code >= 400 and http.response.status_code <= 499\n| fields  timeframe, \n          interval, \n          service = lower(entityName(dt.entity.service)),\n          errors\n|filter in(service, array($Service))\n| sort arraySum(errors) desc\n| limit 100`,
      visualization: 'lineChart',
      visualizationSettings: svcViz,
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    // ---- SATURATION ----
    cpu_usage: {
      _tag: 'golden-saturation-cpu',
      _widgetType: 'lineChart',
      _purpose: 'Process CPU usage percentage (uses $PGI variable)',
      title: 'CPU Usage %',
      type: 'data',
      query: `timeseries cpu = avg(dt.process.cpu.usage), by:{dt.smartscape.process}\n| lookup [smartscapeNodes PROCESS | fields id, name], sourceField:dt.smartscape.process, lookupField:id, fields:{name}\n| fields timeframe, interval, process = name, cpu, dt.smartscape.process\n| sort arrayAvg(cpu) desc\n| filter in(dt.smartscape.process, $PGI)\n| limit 100`,
      visualization: 'lineChart',
      visualizationSettings: svcViz,
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    memory_used: {
      _tag: 'golden-saturation-memory',
      _widgetType: 'barChart',
      _purpose: 'Process memory usage (uses $PGI variable)',
      title: 'Memory Used',
      type: 'data',
      query: `timeseries cpu = avg(dt.process.memory.usage), by:{dt.smartscape.process}\n| lookup [smartscapeNodes PROCESS | fields id, name], sourceField:dt.smartscape.process, lookupField:id, fields:{name}\n| fields timeframe, interval, process = name, cpu, dt.smartscape.process\n| sort arrayAvg(cpu) desc\n| filter in(dt.smartscape.process, $PGI)\n| limit 100`,
      visualization: 'barChart',
      visualizationSettings: svcViz,
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    gc_suspension: {
      _tag: 'golden-saturation-gc',
      _widgetType: 'lineChart',
      _purpose: 'GC suspension time across all runtimes (JVM, CLR, Go, Node.js)',
      title: 'GC Suspension Time',
      type: 'data',
      query: `timeseries gc_time = avg(dt.runtime.jvm.gc.suspension_time),\n           by:{dt.smartscape.process},\n           filter: in(dt.smartscape.process, array($PGI))       \n| append [timeseries gc_time = avg(dt.runtime.clr.gc.suspension_time),\n           by:{dt.smartscape.process},\n           filter: in(dt.smartscape.process, array($PGI))\n         ]\n| append [timeseries gc_time = avg(dt.runtime.go.gc.suspension_time),\n           by:{dt.smartscape.process},\n           filter: in(dt.smartscape.process, array($PGI)) \n         ]\n| append [timeseries gc_time = avg(dt.runtime.nodejs.gc.suspension_time),\n           by:{dt.smartscape.process},\n           filter: in(dt.smartscape.process, array($PGI))\n         ]\n| lookup [smartscapeNodes PROCESS | fields id, name], sourceField:dt.smartscape.process, lookupField:id, fields:{name}\n| fields timeframe, interval, process = name, gc_time\n| sort arrayAvg(gc_time) desc\n| limit 100`,
      visualization: 'lineChart',
      visualizationSettings: svcViz,
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    }
  };
}

// ============================================================================
// SECTION 5: TRACES, EXCEPTIONS, DAVIS PROBLEMS, LOGS
// ============================================================================

export function getObservabilityTiles() {
  return {
    traces_with_exceptions: {
      _tag: 'traces-exceptions',
      _widgetType: 'table',
      _purpose: 'Spans with exceptions, deep-linked to trace explorer. Includes Davis CoPilot prompt.',
      title: '💥 TRACES WITH EXCEPTIONS: Click on Endpoint to open Trace. Or use Open-With Davis CoPilot to explain Exception',
      type: 'data',
      query: `fetch spans\n| filter in(dt.entity.service, array($Service))\n\n| fieldsAdd Service = rpc.service\n| fieldsAdd exception.stacktrace = span.events[][exception.stack_trace]\n| fieldsAdd exception.class = span.events[0][exception.type]\n| fieldsAdd eventname = span.events[0][span_event.name]\n| fieldsAdd exception.message = toString(span.events[][exception.message])\n| fieldsAdd trace_id = toString(trace.id), span_id = toString(span.id)\n\n| filter eventname == "exception"\n| filter isNotNull(span.exit_by_exception_id)\n\n| fields Time = start_time,\n         start_time,\n         end_time,\n         Service,\n         Endpoint = concat("[", if(isnull(endpoint.name), span.name, else: endpoint.name), "](/ui/apps/dynatrace.distributedtracing/explorer?cv=a%2Cfalse\\u0026sidebar=a%2Cfalse\\u0026filter=dt.entity.service+%3D+",dt.entity.service,"+AND+endpoint.name+%3D+",endpoint.name,"+AND+trace.id+%3D+",\n                         trace_id,"\\u0026traceId=",trace_id,"\\u0026spanId=",span_id,"\\u0026tf=",$dt_timeframe_from,";",$dt_timeframe_to,"\\u0026pb=true","\\u0026tt=",encodeUrl(toString(start_time)),")"),\n         ExceptionClass = if(isNotNull(exception.class),exception.class, else:"N/A"),\n         ExceptionMesssage = concat("🤖 ", if(isNotNull(exception.message),exception.message, else:"N/A")),\n         Exception = if(isNotNull(exception.stacktrace),exception.stacktrace, else:"N/A"),\n         Duration = duration,\n         dt.entity.service, \n         trace.id,\n         span.id     \n| sort start_time desc\n| limit 200\n| fieldsAdd prompt=concat("Analyze the Exception, Service and Endpoint and tell me how to fix the exception ", \`ExceptionClass\`, ":", ExceptionMesssage), execute=true, contexts=array(record(type="supplementary", value=substring(concat(\`Exception\`, " Service", \`Endpoint\`), to:20000)))`,
      visualization: 'table',
      visualizationSettings: {
        table: { columnWidths: { 'event.name': 350, 'serviceName': 200, 'occurrences': 100, 'lastSeen': 160 } },
        thresholds: [{ id: 1, field: 'occurrences', isEnabled: true, rules: [
          { id: 1, color: { Default: COLORS.red }, comparator: '≥', value: 50 },
          { id: 2, color: { Default: COLORS.yellow }, comparator: '≥', value: 10 },
          { id: 3, color: { Default: COLORS.green }, comparator: '<', value: 10 }
        ]}],
        unitsOverrides: [{ identifier: 'occurrences', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, suffix: '', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    top_exceptions: {
      _tag: 'exceptions-table',
      _widgetType: 'table',
      _purpose: 'Top 15 Davis error events with service name and frequency',
      title: '💥 Top Exceptions',
      type: 'data',
      query: `fetch dt.davis.events, from:now()-24h\n| filter event.kind == "ERROR_EVENT"\n| summarize occurrences = count(), lastSeen = takeLast(timestamp), by: {event.name, dt.entity.service}\n| fieldsAdd serviceName = entityName(dt.entity.service)\n| sort occurrences desc\n| limit 15`,
      visualization: 'table',
      visualizationSettings: {
        table: { columnWidths: { 'event.name': 350, 'serviceName': 200, 'occurrences': 100, 'lastSeen': 160 } },
        thresholds: [{ id: 1, field: 'occurrences', isEnabled: true, rules: [
          { id: 1, color: { Default: COLORS.red }, comparator: '≥', value: 50 },
          { id: 2, color: { Default: COLORS.yellow }, comparator: '≥', value: 10 },
          { id: 3, color: { Default: COLORS.green }, comparator: '<', value: 10 }
        ]}],
        unitsOverrides: [{ identifier: 'occurrences', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, suffix: '', delimiter: true }]
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    davis_problems: {
      _tag: 'davis-problems',
      _widgetType: 'table',
      _purpose: 'Active Davis AI problems with affected entities',
      title: '🚨 Active Davis Problems',
      type: 'data',
      query: `fetch dt.davis.problems\n| filter event.status == "ACTIVE"\n| fields display_id, title, affected_entity_ids, event.start, event.status, management_zone\n| sort event.start desc\n| limit 10`,
      visualization: 'table',
      visualizationSettings: {
        table: { columnWidths: { 'display_id': 80, 'title': 300, 'affected_entity_ids': 200, 'event.start': 160 } },
        thresholds: [],
        unitsOverrides: []
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    },

    log_errors: {
      _tag: 'logs-errors',
      _widgetType: 'table',
      _purpose: 'Recent ERROR/WARN log entries with service name',
      title: '📋 Recent Log Errors',
      type: 'data',
      query: `fetch logs, from:now()-1h\n| filter loglevel == "ERROR" or loglevel == "WARN"\n| fields timestamp, loglevel, content, dt.entity.service\n| fieldsAdd serviceName = entityName(dt.entity.service)\n| sort timestamp desc\n| limit 20`,
      visualization: 'table',
      visualizationSettings: {
        table: {
          columnWidths: { 'timestamp': 160, 'loglevel': 80, 'content': 400, 'serviceName': 200 },
          columnTypeOverrides: [{ fields: ['content'], id: 1771197666892, value: 'log-content', disableRemoval: true }]
        },
        thresholds: [{ id: 1, field: 'loglevel', isEnabled: true, rules: [
          { id: 1, color: { Default: COLORS.red }, comparator: '==', value: 'ERROR' },
          { id: 2, color: { Default: COLORS.yellow }, comparator: '==', value: 'WARN' }
        ]}],
        unitsOverrides: []
      },
      querySettings: QUERY_SETTINGS,
      davis: DAVIS_CONFIG
    }
  };
}

// ============================================================================
// SECTION HEADER TILES (colored banner singles)
// ============================================================================

export function getSectionHeaders() {
  return {
    overall: {
      type: 'data', title: '',
      query: 'data record(a="Overall Journey Performance - All Steps")',
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { labelMode: 'none', isIconVisible: true, prefixIcon: 'RocketIcon', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'a', isEnabled: true, rules: [{ id: 1, color: COLORS.blue, comparator: '!=', value: 'x' }] }]
      },
      querySettings: QUERY_SETTINGS,
      davis: { davisVisualization: { isAvailable: true } }
    },
    filtered: {
      type: 'data', title: '',
      query: 'data record(a="Filtered View - By Selected Step")',
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { labelMode: 'none', isIconVisible: true, prefixIcon: 'FilterIcon', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'a', isEnabled: true, rules: [{ id: 1, color: COLORS.purple, comparator: '!=', value: 'x' }] }]
      },
      querySettings: QUERY_SETTINGS,
      davis: { davisVisualization: { isAvailable: true } }
    },
    performance: {
      type: 'data', title: '',
      query: 'data record(a="Performance & Operations")',
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { labelMode: 'none', isIconVisible: true, prefixIcon: 'ChartLineIcon', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'a', isEnabled: true, rules: [{ id: 1, color: COLORS.teal, comparator: '!=', value: 'x' }] }]
      },
      querySettings: QUERY_SETTINGS,
      davis: { davisVisualization: { isAvailable: true } }
    },
    traffic: {
      type: 'data', title: '',
      query: 'data record(a="TRAFFIC")',
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { labelMode: 'none', isIconVisible: true, prefixIcon: 'BarChartIcon', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'a', isEnabled: true, rules: [{ id: 1, color: COLORS.violet, comparator: '!=', value: 'x' }] }]
      },
      querySettings: QUERY_SETTINGS,
      davis: { davisVisualization: { isAvailable: true } }
    },
    latency: {
      type: 'data', title: '',
      query: 'data record(a="LATENCY" )',
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { labelMode: 'none', isIconVisible: true, prefixIcon: 'LineChartIcon', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'a', isEnabled: true, rules: [{ id: 1, color: COLORS.violet, comparator: '!=', value: 'x' }] }]
      },
      querySettings: QUERY_SETTINGS,
      davis: { davisVisualization: { isAvailable: true } }
    },
    errors: {
      type: 'data', title: '',
      query: 'data record(a="ERRORS")',
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { labelMode: 'none', isIconVisible: true, prefixIcon: 'WarningIcon', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'a', isEnabled: true, rules: [{ id: 1, color: COLORS.violet, comparator: '!=', value: 'x' }] }]
      },
      querySettings: QUERY_SETTINGS,
      davis: { davisVisualization: { isAvailable: true } }
    },
    saturation: {
      type: 'data', title: '',
      query: 'data record(a="SATURATION")',
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { labelMode: 'none', isIconVisible: true, prefixIcon: 'ContainerIcon', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'a', isEnabled: true, rules: [{ id: 1, color: COLORS.violet, comparator: '!=', value: 'x' }] }]
      },
      querySettings: QUERY_SETTINGS,
      davis: { davisVisualization: { isAvailable: true } }
    }
  };
}

// ============================================================================
// MARKDOWN GENERATORS
// ============================================================================

export function getHeaderMarkdown(company, journeyType, dataSignals) {
  return {
    type: 'markdown',
    content: `# ${company}\n## ${journeyType} - Business Observability Dashboard\n\n**Journey Type:** ${journeyType} | **Dashboard Type:** AI-Generated Bespoke Analytics\n**Data Signals Detected:** ${dataSignals}`
  };
}

export function getJourneyFlowMarkdown(steps) {
  const stepFlow = (steps || []).map((s, i) => {
    const label = s.name || s.stepName || `Step ${i + 1}`;
    const cat = s.category ? ` (${s.category})` : '';
    return `**${i + 1}. ${label}**${cat}`;
  }).join(' **→** ');
  return {
    type: 'markdown',
    content: `## 🔄 Customer Journey Flow\n\n${stepFlow}\n\n---\n*End-to-end journey visualization with step-by-step metrics*`
  };
}

export function getDeepLinksMarkdown(dynatraceUrl) {
  return {
    type: 'markdown',
    title: '🔗 Quick Navigation',
    content: `## 🔗 Deep-Link Navigation\n\n| Resource | Link |\n|----------|------|\n| 🔍 **Distributed Traces** | [Open Trace Explorer →](${dynatraceUrl}/ui/diagnostictools/purepaths?gtf=-24h+to+now&gf=all) |\n| 📊 **Service Overview** | [Open Services →](${dynatraceUrl}/ui/services?gtf=-24h+to+now&gf=all) |\n| ❌ **Failure Analysis** | [Open Failure Analysis →](${dynatraceUrl}/ui/diagnostictools/mda?gtf=-24h+to+now&gf=all&mdaId=failureAnalysis) |\n| 🐛 **Exception Analysis** | [Open Exception Analysis →](${dynatraceUrl}/ui/diagnostictools/mda?gtf=-24h+to+now&gf=all&mdaId=exceptionAnalysis) |\n| 📈 **Davis Problems** | [Open Problems →](${dynatraceUrl}/ui/problems?gtf=-24h+to+now) |\n| 📊 **Business Events** | [Open BizEvents →](${dynatraceUrl}/ui/bizevents?gtf=-24h+to+now) |\n\n*Links open in your Dynatrace environment*`
  };
}

export function getFooterMarkdown(company) {
  return {
    type: 'markdown',
    content: `*Dashboard auto-generated by BizObs Engine* | Monitoring ${company} journey performance across all touchpoints`
  };
}

// ============================================================================
// PROVEN LAYOUT DEFINITION (from working dashboard)
// Maps each tile to its grid position: { x, y, w, h }
// ============================================================================

export const PROVEN_LAYOUT = {
  // Row 0-2: Header markdown
  header: { x: 0, y: 0, w: 24, h: 3 },
  journey_flow: { x: 0, y: 3, w: 24, h: 3 },
  // Row 6-11: Step Metrics table
  step_metrics: { x: 0, y: 6, w: 24, h: 6 },
  // Row 12: Overall section header
  section_overall: { x: 0, y: 12, w: 24, h: 1 },
  // Row 13-15: KPI cards
  total_volume: { x: 0, y: 13, w: 6, h: 3 },
  success_rate: { x: 6, y: 13, w: 6, h: 3 },
  total_revenue: { x: 12, y: 13, w: 6, h: 3 },
  total_errors: { x: 18, y: 13, w: 6, h: 3 },
  // Row 16-19: Charts
  volume_over_time: { x: 0, y: 16, w: 12, h: 4 },
  events_by_step: { x: 12, y: 16, w: 12, h: 4 },
  // Row 20: Filtered section header
  section_filtered: { x: 0, y: 20, w: 24, h: 1 },
  // Row 21-23: Filtered KPIs
  filtered_events: { x: 0, y: 21, w: 6, h: 3 },
  filtered_revenue: { x: 6, y: 21, w: 6, h: 3 },
  filtered_aov: { x: 12, y: 21, w: 6, h: 3 },
  filtered_p90: { x: 18, y: 21, w: 6, h: 3 },
  // Row 24-27: Filtered charts
  filtered_volume_trend: { x: 0, y: 24, w: 12, h: 4 },
  filtered_events_by_step: { x: 12, y: 24, w: 12, h: 4 },
  // Row 28: Performance section header
  section_performance: { x: 0, y: 28, w: 24, h: 1 },
  // Row 29-33: Performance tables
  step_performance: { x: 0, y: 29, w: 12, h: 5 },
  sla_compliance: { x: 12, y: 29, w: 12, h: 5 },
  // Row 34-37: Error analytics
  error_rate_trend: { x: 0, y: 34, w: 12, h: 4 },
  errors_by_step: { x: 12, y: 34, w: 12, h: 4 },
  // Row 38-41: Error details & hourly
  error_details: { x: 0, y: 38, w: 12, h: 4 },
  hourly_pattern: { x: 12, y: 38, w: 12, h: 4 },
  // Row 42: Golden Signals section headers (TRAFFIC, LATENCY, ERRORS, SATURATION)
  section_traffic: { x: 0, y: 42, w: 6, h: 1 },
  section_latency: { x: 6, y: 42, w: 6, h: 1 },
  section_errors: { x: 12, y: 42, w: 6, h: 1 },
  section_saturation: { x: 18, y: 42, w: 6, h: 1 },
  // Row 43-47: Top golden signal row
  requests: { x: 0, y: 43, w: 6, h: 5 },
  latency_p50: { x: 6, y: 43, w: 6, h: 5 },
  failed_requests: { x: 12, y: 43, w: 6, h: 5 },
  cpu_usage: { x: 18, y: 43, w: 6, h: 5 },
  // Row 48-52: Second golden signal row
  requests_success_failed: { x: 0, y: 48, w: 6, h: 5 },
  latency_p90: { x: 6, y: 48, w: 6, h: 5 },
  errors_5xx: { x: 12, y: 48, w: 6, h: 5 },
  memory_used: { x: 18, y: 48, w: 6, h: 5 },
  // Row 53-57: Third golden signal row
  key_requests: { x: 0, y: 53, w: 6, h: 5 },
  latency_p99: { x: 6, y: 53, w: 6, h: 5 },
  errors_4xx: { x: 12, y: 53, w: 6, h: 5 },
  gc_suspension: { x: 18, y: 53, w: 6, h: 5 },
  // Row 58-62: Top Exceptions
  top_exceptions: { x: 0, y: 58, w: 24, h: 5 },
  // Row 63-67: Traces with exceptions
  traces_with_exceptions: { x: 0, y: 63, w: 24, h: 5 },
  // Row 68-72: Davis & Logs
  davis_problems: { x: 0, y: 68, w: 12, h: 5 },
  log_errors: { x: 12, y: 68, w: 12, h: 5 },
  // Row 73-79: Deep links
  deep_links: { x: 0, y: 73, w: 24, h: 7 },
  // Row 80: Footer
  footer: { x: 0, y: 80, w: 24, h: 1 }
};

// ============================================================================
// MASTER BUILD FUNCTION
// Assembles a complete v21 dashboard from template library
// ============================================================================

export function buildProvenDashboard(company, journeyType, steps, detected) {
  const dynatraceUrl = process.env.DT_ENVIRONMENT_URL || process.env.DYNATRACE_URL || 'https://your-environment.apps.dynatrace.com';

  // Build data signal summary
  const signals = [];
  if (detected?.hasRevenue) signals.push('💰 Revenue');
  if (detected?.hasLoyalty) signals.push('⭐ Loyalty');
  if (detected?.hasLTV) signals.push('📈 LTV');
  if (detected?.hasSegments) signals.push('👥 Segments');
  if (detected?.hasChannel) signals.push('📡 Channels');
  if (detected?.hasDeviceType) signals.push('📱 Devices');
  if (detected?.hasNPS) signals.push('📊 NPS');
  if (detected?.hasChurnRisk) signals.push('⚠️ Churn');
  if (detected?.hasSatisfaction) signals.push('😊 Satisfaction');
  if (detected?.hasEngagement) signals.push('📊 Engagement');
  if (detected?.hasRisk) signals.push('🛡️ Risk');
  if (detected?.hasFraud) signals.push('🚨 Fraud');
  if (detected?.hasCompliance) signals.push('📋 Compliance');
  if (detected?.hasRetention) signals.push('🔄 Retention');
  if (detected?.hasPricing) signals.push('💳 Pricing');
  if (detected?.hasProduct) signals.push('📦 Products');
  if (detected?.hasOperational) signals.push('⚙️ Operations');
  if (detected?.hasForecast) signals.push('🔮 Forecast');
  if (detected?.hasConversion) signals.push('🎯 Conversion');
  if (detected?.hasAcquisition) signals.push('🎯 Acquisition');
  if (detected?.hasUpsell) signals.push('📈 Upsell');
  if (detected?.hasSubscription) signals.push('📰 Subscription');
  if (detected?.hasMembership) signals.push('🏅 Membership');
  if (detected?.hasServices) signals.push('🔧 Services');
  const dataSignals = signals.length > 0 ? signals.join(' | ') : '🔧 Services';

  // Collect all tiles from sections
  const journeyTiles = getJourneyOverviewTiles(company);
  const filteredTiles = getFilteredViewTiles(company);
  const perfTiles = getPerformanceTiles(company);
  const goldenTiles = getGoldenSignalTiles();
  const obsTiles = getObservabilityTiles();
  const sectionHeaders = getSectionHeaders();

  // Markdown tiles
  const headerMd = getHeaderMarkdown(company, journeyType, dataSignals);
  const flowMd = getJourneyFlowMarkdown(steps);
  const linksMd = getDeepLinksMarkdown(dynatraceUrl);
  const footerMd = getFooterMarkdown(company);

  // Build tile and layout objects
  const dashboard = {
    version: 21,
    variables: getProvenVariables(company),
    tiles: {},
    layouts: {},
    importedWithCode: false,
    settings: { defaultTimeframe: { value: { from: 'now()-24h', to: 'now()' }, enabled: true } },
    annotations: []
  };

  let idx = 0;

  // Helper: add tile + layout
  const addTile = (tileObj, layoutKey) => {
    const layout = PROVEN_LAYOUT[layoutKey];
    if (!layout) { console.warn(`[Template] No layout found for: ${layoutKey}`); return; }

    // Strip internal tags before writing to dashboard
    const tile = { ...tileObj };
    delete tile._tag;
    delete tile._widgetType;
    delete tile._purpose;

    dashboard.tiles[idx] = tile;
    dashboard.layouts[idx] = layout;
    idx++;
  };

  const addMarkdownTile = (mdObj, layoutKey) => {
    const layout = PROVEN_LAYOUT[layoutKey];
    if (!layout) return;
    dashboard.tiles[idx] = mdObj;
    dashboard.layouts[idx] = layout;
    idx++;
  };

  // ---- ASSEMBLE IN PROVEN ORDER ----

  // Header
  addMarkdownTile(headerMd, 'header');
  addMarkdownTile(flowMd, 'journey_flow');

  // Journey Overview
  addTile(journeyTiles.step_metrics, 'step_metrics');
  addTile(sectionHeaders.overall, 'section_overall');
  addTile(journeyTiles.total_volume, 'total_volume');
  addTile(journeyTiles.success_rate, 'success_rate');
  addTile(journeyTiles.total_revenue, 'total_revenue');
  addTile(journeyTiles.total_errors, 'total_errors');
  addTile(journeyTiles.volume_over_time, 'volume_over_time');
  addTile(journeyTiles.events_by_step, 'events_by_step');

  // Filtered View
  addTile(sectionHeaders.filtered, 'section_filtered');
  addTile(filteredTiles.filtered_events, 'filtered_events');
  addTile(filteredTiles.filtered_revenue, 'filtered_revenue');
  addTile(filteredTiles.filtered_aov, 'filtered_aov');
  addTile(filteredTiles.filtered_p90, 'filtered_p90');
  addTile(filteredTiles.filtered_volume_trend, 'filtered_volume_trend');
  addTile(filteredTiles.filtered_events_by_step, 'filtered_events_by_step');

  // Performance & Operations
  addTile(sectionHeaders.performance, 'section_performance');
  addTile(perfTiles.step_performance, 'step_performance');
  addTile(perfTiles.sla_compliance, 'sla_compliance');
  addTile(perfTiles.error_rate_trend, 'error_rate_trend');
  addTile(perfTiles.errors_by_step, 'errors_by_step');
  addTile(perfTiles.error_details, 'error_details');
  addTile(perfTiles.hourly_pattern, 'hourly_pattern');

  // Golden Signals section headers
  addTile(sectionHeaders.traffic, 'section_traffic');
  addTile(sectionHeaders.latency, 'section_latency');
  addTile(sectionHeaders.errors, 'section_errors');
  addTile(sectionHeaders.saturation, 'section_saturation');

  // Golden Signals - Row 1  
  addTile(goldenTiles.requests, 'requests');
  addTile(goldenTiles.latency_p50, 'latency_p50');
  addTile(goldenTiles.failed_requests, 'failed_requests');
  addTile(goldenTiles.cpu_usage, 'cpu_usage');

  // Golden Signals - Row 2
  addTile(goldenTiles.requests_success_failed, 'requests_success_failed');
  addTile(goldenTiles.latency_p90, 'latency_p90');
  addTile(goldenTiles.errors_5xx, 'errors_5xx');
  addTile(goldenTiles.memory_used, 'memory_used');

  // Golden Signals - Row 3
  addTile(goldenTiles.key_requests, 'key_requests');
  addTile(goldenTiles.latency_p99, 'latency_p99');
  addTile(goldenTiles.errors_4xx, 'errors_4xx');
  addTile(goldenTiles.gc_suspension, 'gc_suspension');

  // Observability
  addTile(obsTiles.top_exceptions, 'top_exceptions');
  addTile(obsTiles.traces_with_exceptions, 'traces_with_exceptions');
  addTile(obsTiles.davis_problems, 'davis_problems');
  addTile(obsTiles.log_errors, 'log_errors');

  // Navigation & Footer
  addMarkdownTile(linksMd, 'deep_links');
  addMarkdownTile(footerMd, 'footer');

  console.log(`[Template Library] ✅ Built proven dashboard: ${idx} tiles for ${company} - ${journeyType}`);
  return dashboard;
}
