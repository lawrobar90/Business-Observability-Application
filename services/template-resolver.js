/**
 * template-resolver.js
 * 
 * Loads the DQL template library and resolves {{PLACEHOLDER}} tokens
 * to produce complete, ready-to-import Dynatrace dashboard tile objects.
 * 
 * Every DQL query comes from the verified working Manufacturing dashboard.
 * The LLM never writes DQL — it only selects and arranges tiles.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_DIR = path.join(__dirname, '..', 'templates', 'dql');

// ── Load all template files ──────────────────────────────────────────────────

let _cache = null;

function loadTemplates() {
  if (_cache) return _cache;

  const load = (file) => JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, file), 'utf8'));

  _cache = {
    variables:    load('variables.json'),
    bizevent:     load('tiles-bizevent.json'),
    timeseries:   load('tiles-timeseries.json'),
    observability:load('tiles-observability.json'),
    headers:      load('tiles-headers.json'),
    dynamic:      load('tiles-dynamic.json'),
    vizConfigs:   load('tiles-visualization-configs.json'),
    classifier:   load('field-classifier.json'),
    index:        load('template-index.json')
  };

  return _cache;
}


// ── Token resolution ─────────────────────────────────────────────────────────

/**
 * Replace all {{TOKEN}} placeholders in a string with actual values.
 * @param {string} str - The template string
 * @param {Object} tokens - Key/value pairs e.g. { COMPANY: "Manufacturing", REVENUE_FIELD: "additionalfields.orderTotal" }
 * @returns {string}
 */
function resolveTokens(str, tokens) {
  if (!str || typeof str !== 'string') return str;
  return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return tokens[key] !== undefined ? tokens[key] : match;
  });
}

/**
 * Deep-clone an object and resolve all string values containing {{TOKEN}}.
 */
function resolveObjectTokens(obj, tokens) {
  if (typeof obj === 'string') return resolveTokens(obj, tokens);
  if (Array.isArray(obj)) return obj.map(item => resolveObjectTokens(item, tokens));
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('_comment')) continue; // strip comments
      result[k] = resolveObjectTokens(v, tokens);
    }
    return result;
  }
  return obj;
}


// ── Build variables ──────────────────────────────────────────────────────────

/**
 * Build the 5 cascading dashboard variables with company name resolved.
 * @param {string} companyName
 * @returns {Array} - Ready-to-use variables array
 */
function buildVariables(companyName) {
  const templates = loadTemplates();
  const tokens = { COMPANY: companyName };
  return templates.variables.variables.map(v => resolveObjectTokens(v, tokens));
}


// ── Build section headers ────────────────────────────────────────────────────

/**
 * Build a section header tile (colored banner with icon).
 * @param {string} headerKey - e.g. "overall", "filtered", "traffic"
 * @param {string} labelText - The text to display
 * @returns {Object} - Complete tile object
 */
function buildSectionHeader(headerKey, labelText) {
  const templates = loadTemplates();
  const cfg = templates.vizConfigs.sectionHeaders;
  const icon = cfg.icons[headerKey] || 'RocketIcon';
  const color = cfg.colors[headerKey] || '#478ACA';

  return {
    title: '',
    type: 'data',
    query: `data record(a="${labelText}")`,
    visualization: 'singleValue',
    visualizationSettings: {
      singleValue: {
        labelMode: 'none',
        isIconVisible: true,
        prefixIcon: icon,
        colorThresholdTarget: 'background'
      },
      thresholds: [{
        id: 1, field: 'a', isEnabled: true,
        rules: [{ id: 1, color: color, comparator: '!=', value: 'x' }]
      }]
    },
    querySettings: { ...templates.vizConfigs.querySettings },
    davis: { ...templates.vizConfigs.davis.headerTile }
  };
}


// ── Build KPI single-value tiles ─────────────────────────────────────────────

/**
 * Build a KPI single-value tile (revenue, success rate, errors, etc.)
 * @param {string} templateKey - Key from tiles-bizevent.json (e.g. "total_revenue")
 * @param {Object} tokens - Placeholder values
 * @returns {Object} - Complete tile object
 */
function buildKpiTile(templateKey, tokens) {
  const templates = loadTemplates();
  const tileDef = templates.bizevent.tiles[templateKey];
  if (!tileDef) throw new Error(`Unknown bizevent tile template: ${templateKey}`);

  const vizConfig = templates.vizConfigs.kpiSingleValues[templateKey];
  if (!vizConfig) throw new Error(`No visualization config for KPI tile: ${templateKey}`);

  const query = resolveTokens(tileDef.query, tokens);

  return {
    title: tileDef.title,
    type: 'data',
    query,
    visualization: 'singleValue',
    visualizationSettings: {
      singleValue: { ...vizConfig.singleValue },
      thresholds: JSON.parse(JSON.stringify(vizConfig.thresholds)),
      unitsOverrides: JSON.parse(JSON.stringify(vizConfig.unitsOverrides))
    },
    querySettings: { ...templates.vizConfigs.querySettings },
    davis: { ...templates.vizConfigs.davis.dataTile }
  };
}


// ── Build bizevent chart/table tiles ─────────────────────────────────────────

/**
 * Build a bizevent-based chart or table tile.
 * @param {string} templateKey - Key from tiles-bizevent.json
 * @param {Object} tokens - Placeholder values
 * @returns {Object} - Complete tile object
 */
function buildBizeventTile(templateKey, tokens) {
  const templates = loadTemplates();
  const tileDef = templates.bizevent.tiles[templateKey];
  if (!tileDef) throw new Error(`Unknown bizevent tile template: ${templateKey}`);

  const query = resolveTokens(tileDef.query, tokens);
  const viz = tileDef.visualization;

  // Get viz settings from the appropriate config section
  let vizSettings = {};
  if (viz === 'table' && templates.vizConfigs.tables[templateKey]) {
    const tblCfg = templates.vizConfigs.tables[templateKey];
    vizSettings = {
      table: tblCfg.columnWidths && Object.keys(tblCfg.columnWidths).length > 0
        ? { columnWidths: { ...tblCfg.columnWidths } } : undefined,
      thresholds: JSON.parse(JSON.stringify(tblCfg.thresholds || [])),
      unitsOverrides: JSON.parse(JSON.stringify(tblCfg.unitsOverrides || []))
    };
    if (tblCfg.autoSelectVisualization !== undefined) {
      vizSettings.autoSelectVisualization = tblCfg.autoSelectVisualization;
    }
    if (tblCfg.columnTypeOverrides) {
      vizSettings.columnTypeOverrides = JSON.parse(JSON.stringify(tblCfg.columnTypeOverrides));
    }
  } else if (templates.vizConfigs.charts[templateKey]) {
    vizSettings = JSON.parse(JSON.stringify(templates.vizConfigs.charts[templateKey]));
  } else {
    vizSettings = { thresholds: [], unitsOverrides: [] };
  }

  // Clean up undefined values
  if (vizSettings.table === undefined) delete vizSettings.table;

  return {
    title: tileDef.title,
    type: 'data',
    query,
    visualization: viz,
    visualizationSettings: vizSettings,
    querySettings: { ...templates.vizConfigs.querySettings },
    davis: { ...templates.vizConfigs.davis.dataTile }
  };
}


// ── Build timeseries tiles ───────────────────────────────────────────────────

/**
 * Build a service-metric timeseries tile (requests, latency, CPU, etc.)
 * @param {string} templateKey - Key from tiles-timeseries.json
 * @returns {Object} - Complete tile object
 */
function buildTimeseriesTile(templateKey) {
  const templates = loadTemplates();
  const tileDef = templates.timeseries.tiles[templateKey];
  if (!tileDef) throw new Error(`Unknown timeseries tile template: ${templateKey}`);

  // All service-metric tiles share the same massive visualizationSettings block
  const vizSettings = JSON.parse(JSON.stringify(templates.vizConfigs.charts.serviceMetric));

  return {
    title: tileDef.title,
    type: 'data',
    query: tileDef.query,
    visualization: tileDef.visualization,
    visualizationSettings: vizSettings,
    querySettings: { ...templates.vizConfigs.querySettings },
    davis: { ...templates.vizConfigs.davis.dataTile }
  };
}


// ── Build observability tiles ────────────────────────────────────────────────

/**
 * Build an observability tile (Davis problems, logs, spans, exceptions).
 * @param {string} templateKey - Key from tiles-observability.json
 * @returns {Object} - Complete tile object
 */
function buildObservabilityTile(templateKey) {
  const templates = loadTemplates();
  const tileDef = templates.observability.tiles[templateKey];
  if (!tileDef) throw new Error(`Unknown observability tile template: ${templateKey}`);

  let vizSettings = {};
  if (templates.vizConfigs.tables[templateKey]) {
    const tblCfg = templates.vizConfigs.tables[templateKey];
    vizSettings = {
      table: tblCfg.columnWidths && Object.keys(tblCfg.columnWidths).length > 0
        ? { columnWidths: { ...tblCfg.columnWidths } } : undefined,
      thresholds: JSON.parse(JSON.stringify(tblCfg.thresholds || [])),
      unitsOverrides: JSON.parse(JSON.stringify(tblCfg.unitsOverrides || []))
    };
    if (tblCfg.columnTypeOverrides) {
      vizSettings.columnTypeOverrides = JSON.parse(JSON.stringify(tblCfg.columnTypeOverrides));
    }
    if (vizSettings.table === undefined) delete vizSettings.table;
  }

  return {
    title: tileDef.title,
    type: 'data',
    query: tileDef.query,
    visualization: tileDef.visualization,
    visualizationSettings: vizSettings,
    querySettings: { ...templates.vizConfigs.querySettings },
    davis: { ...templates.vizConfigs.davis.dataTile }
  };
}


// ── Build dynamic tiles (for extra fields) ───────────────────────────────────

/**
 * Build a dynamic tile for a field that doesn't map to a core template slot.
 * @param {string} dynamicTemplateKey - Key from tiles-dynamic.json (e.g. "numeric_single_value")
 * @param {Object} fieldInfo - { name, domain, type, aggregate, label }
 * @returns {Object} - Complete tile object
 */
function buildDynamicTile(dynamicTemplateKey, fieldInfo) {
  const templates = loadTemplates();
  const tileDef = templates.dynamic.tiles[dynamicTemplateKey];
  if (!tileDef) throw new Error(`Unknown dynamic tile template: ${dynamicTemplateKey}`);

  const tokens = {
    FIELD_NAME: fieldInfo.name,
    FIELD_LABEL: fieldInfo.label,
    FIELD_PATH: `additionalfields.${fieldInfo.name}`,
    AGGREGATE: fieldInfo.aggregate || 'avg'
  };

  const query = resolveTokens(tileDef.query, tokens);
  const title = resolveTokens(tileDef.title, tokens);
  const id = resolveTokens(tileDef.id, tokens);

  return {
    title,
    type: 'data',
    query,
    visualization: tileDef.visualization,
    visualizationSettings: { thresholds: [], unitsOverrides: [] },
    querySettings: { ...templates.vizConfigs.querySettings },
    davis: { ...templates.vizConfigs.davis.dataTile },
    _meta: { id, fieldName: fieldInfo.name, domain: fieldInfo.domain }
  };
}


// ── Build markdown tiles ─────────────────────────────────────────────────────

/**
 * Build the header markdown tile.
 * @param {string} companyName
 * @param {string} journeyType
 * @param {string[]} stepNames
 * @returns {Object} - Complete markdown tile object
 */
function buildHeaderMarkdown(companyName, journeyType, stepNames) {
  const content = `# 🏢 ${companyName} — ${journeyType} Dashboard\n## Business Observability KPI Dashboard\nGenerated by BizObs AI Dashboard Agent`;
  return { type: 'markdown', title: '', content };
}

/**
 * Build the journey flow markdown tile.
 * @param {string[]} stepNames
 * @returns {Object}
 */
function buildJourneyFlowMarkdown(stepNames) {
  const flow = stepNames.map((s, i) => `**Step ${i + 1}:** ${s}`).join(' → ');
  const content = `## 🗺️ Journey Flow\n${flow}`;
  return { type: 'markdown', title: '', content };
}

/**
 * Build the footer markdown tile.
 * @returns {Object}
 */
function buildFooterMarkdown() {
  return { type: 'markdown', title: '', content: '---\n*Generated by BizObs AI Dashboard Agent*' };
}


// ── Get the static layout grid ───────────────────────────────────────────────

/**
 * Returns the complete layout grid from the working dashboard.
 * @returns {Object} - Map of tile key → { x, y, w, h }
 */
function getStaticLayouts() {
  const templates = loadTemplates();
  return JSON.parse(JSON.stringify(templates.vizConfigs.layouts.static));
}


// ── Full dashboard assembly convenience function ─────────────────────────────

/**
 * Build a complete core dashboard (all standard tiles, no dynamic extras).
 * @param {string} companyName
 * @param {string} journeyType
 * @param {string[]} stepNames
 * @param {Object} fieldSlots - { REVENUE_FIELD, DURATION_FIELD, ERROR_BOOL_FIELD, ERROR_MSG_FIELD }
 * @returns {Object} - Complete Dynatrace dashboard JSON
 */
function buildCoreDashboard(companyName, journeyType, stepNames, fieldSlots) {
  const tokens = {
    COMPANY: companyName,
    ...fieldSlots
  };

  const tiles = {};
  const layouts = getStaticLayouts();

  // Tile 0: Header markdown
  tiles['0'] = buildHeaderMarkdown(companyName, journeyType, stepNames);

  // Tile 1: Journey flow markdown
  tiles['1'] = buildJourneyFlowMarkdown(stepNames);

  // Tile 2: Journey step metrics table
  tiles['2'] = buildBizeventTile('journey_step_metrics', tokens);

  // Tile 3: Section header — Overall
  tiles['3'] = buildSectionHeader('overall', 'Overall Journey Performance - All Steps');

  // Tiles 4-7: KPI row
  tiles['4'] = buildKpiTile('total_journey_volume', tokens);
  tiles['5'] = buildKpiTile('journey_success_rate', tokens);
  tiles['6'] = buildKpiTile('total_revenue', tokens);
  tiles['7'] = buildKpiTile('total_errors', tokens);

  // Tiles 8-9: Charts
  tiles['8'] = buildBizeventTile('volume_over_time', tokens);
  tiles['9'] = buildBizeventTile('events_by_step', tokens);

  // Tile 10: Section header — Filtered
  tiles['10'] = buildSectionHeader('filtered', 'Filtered View - By Selected Step');

  // Tiles 11-14: Filtered KPIs
  tiles['11'] = buildKpiTile('filtered_journey_events', tokens);
  tiles['12'] = buildKpiTile('filtered_revenue', tokens);
  tiles['13'] = buildKpiTile('avg_order_value', tokens);
  tiles['14'] = buildKpiTile('p90_response_time', tokens);

  // Tiles 15-16: Filtered charts
  tiles['15'] = buildBizeventTile('events_over_time_filtered', tokens);
  tiles['16'] = buildBizeventTile('events_by_step_filtered', tokens);

  // Tile 17: Section header — Performance
  tiles['17'] = buildSectionHeader('performance', 'Performance & Operations');

  // Tiles 18-23: Performance & operations
  tiles['18'] = buildBizeventTile('step_performance', tokens);
  tiles['19'] = buildBizeventTile('sla_compliance', tokens);
  tiles['20'] = buildBizeventTile('error_rate_trend', tokens);
  tiles['21'] = buildBizeventTile('errors_by_step', tokens);
  tiles['22'] = buildBizeventTile('error_details', tokens);
  tiles['23'] = buildBizeventTile('hourly_activity', tokens);

  // Tiles 24, 42, 40, 41: USE method section headers
  tiles['24'] = buildSectionHeader('traffic', 'TRAFFIC');
  tiles['42'] = buildSectionHeader('latency', 'LATENCY');
  tiles['40'] = buildSectionHeader('errors', 'ERRORS');
  tiles['41'] = buildSectionHeader('saturation', 'SATURATION');

  // Tiles 25, 43-45: Top row timeseries (Traffic, Latency, Errors, Saturation)
  tiles['25'] = buildTimeseriesTile('requests_total');
  tiles['43'] = buildTimeseriesTile('latency_p50');
  tiles['44'] = buildTimeseriesTile('requests_failed');
  tiles['45'] = buildTimeseriesTile('cpu_usage');

  // Tiles 47-50: Middle row timeseries
  tiles['47'] = buildTimeseriesTile('requests_success_vs_failed');
  tiles['48'] = buildTimeseriesTile('latency_p90');
  tiles['49'] = buildTimeseriesTile('errors_5xx');
  tiles['50'] = buildTimeseriesTile('memory_usage');

  // Tiles 51-54: Bottom row timeseries
  tiles['51'] = buildTimeseriesTile('requests_key_requests');
  tiles['52'] = buildTimeseriesTile('latency_p99');
  tiles['53'] = buildTimeseriesTile('errors_4xx');
  tiles['54'] = buildTimeseriesTile('gc_suspension_time');

  // Tiles 28, 39, 33, 34: Observability
  tiles['28'] = buildObservabilityTile('top_exceptions');
  tiles['39'] = buildObservabilityTile('traces_with_exceptions');
  tiles['33'] = buildObservabilityTile('active_davis_problems');
  tiles['34'] = buildObservabilityTile('recent_log_errors');

  // Tiles 35, 36: Footer markdown
  tiles['35'] = buildFooterMarkdown();
  tiles['36'] = { type: 'markdown', title: '', content: '' };

  // Build final dashboard
  return {
    version: 21,
    variables: buildVariables(companyName),
    tiles,
    layouts,
    importedWithCode: false,
    settings: {
      defaultTimeframe: {
        value: { from: 'now()-24h', to: 'now()' },
        enabled: true
      }
    },
    annotations: []
  };
}


// ── Exports ──────────────────────────────────────────────────────────────────

export {
  loadTemplates,
  resolveTokens,
  resolveObjectTokens,
  buildVariables,
  buildSectionHeader,
  buildKpiTile,
  buildBizeventTile,
  buildTimeseriesTile,
  buildObservabilityTile,
  buildDynamicTile,
  buildHeaderMarkdown,
  buildJourneyFlowMarkdown,
  buildFooterMarkdown,
  getStaticLayouts,
  buildCoreDashboard
};
