/**
 * AI Dashboard Generator - REBUILT
 * Creates bespoke Dynatrace dashboards based on journey data using Ollama LLM
 * 
 * KEY DESIGN PRINCIPLES:
 * 1. Scans the FULL incoming payload (additionalFields, customerProfile, traceMetadata)
 * 2. Dynamically generates tiles based on detected fields (e.g., loyaltyStatus → donut chart)
 * 3. Service tiles use proper DQL: timeseries with $Service/$ServiceID cascading variables
 * 4. LLM prompt includes actual detected fields so it makes smart tile choices
 * 5. No hardcoded references to any specific app — fully generic for any BizObs journey
 */

import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILLS_PATH = path.join(__dirname, '../ai-agent-knowledge-base-main@389e0f6c9c6/knowledge-base/dynatrace/skills');
const PROMPTS_PATH = path.join(__dirname, '../prompts');

const OLLAMA_ENDPOINT = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

let promptTemplates = null;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function createGenAISpan(prompt, completion, model, promptTokens, completionTokens, duration) {
  return {
    'gen_ai.system': 'ollama',
    'gen_ai.request.model': model,
    'gen_ai.response.model': model,
    'gen_ai.prompt.0.content': prompt?.substring(0, 1000) || '',
    'gen_ai.prompt.0.role': 'user',
    'gen_ai.completion.0.content': completion?.substring(0, 1000) || '',
    'gen_ai.completion.0.role': 'assistant',
    'gen_ai.usage.prompt_tokens': promptTokens || 0,
    'gen_ai.usage.completion_tokens': completionTokens || 0,
    'llm.request.type': 'completion',
    'duration_ms': Math.round(duration),
    'endpoint': OLLAMA_ENDPOINT
  };
}

async function logGenAISpan(spanAttributes) {
  try {
    console.log('[GenAI Span]', JSON.stringify(spanAttributes));
  } catch (error) {
    console.error('[GenAI Span] Failed to log:', error.message);
  }
}

async function loadPromptTemplates() {
  if (promptTemplates) return promptTemplates;
  try {
    const [systemContext, dqlExamples, dashboardTemplate, userPromptTemplate] = await Promise.all([
      fs.readFile(path.join(PROMPTS_PATH, 'system-context.txt'), 'utf-8'),
      fs.readFile(path.join(PROMPTS_PATH, 'dql-examples.txt'), 'utf-8'),
      fs.readFile(path.join(PROMPTS_PATH, 'dashboard-template.json'), 'utf-8'),
      fs.readFile(path.join(PROMPTS_PATH, 'user-prompt-template.txt'), 'utf-8')
    ]);
    promptTemplates = { systemContext, dqlExamples, dashboardTemplate, userPromptTemplate };
    return promptTemplates;
  } catch (error) {
    console.error('[AI Dashboard] Failed to load prompt templates:', error.message);
    return {
      systemContext: 'You are a Dynatrace dashboard expert.',
      dqlExamples: 'fetch bizevents | summarize count()',
      dashboardTemplate: '{}',
      userPromptTemplate: 'Create a dashboard for {company}'
    };
  }
}

async function checkOllamaAvailable() {
  try {
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      return data.models?.some(m => m.name.includes(OLLAMA_MODEL.split(':')[0]));
    }
    return false;
  } catch (error) {
    return false;
  }
}

async function loadDynatraceSkills() {
  const skills = { 'dt-app-dashboard': null, 'dt-dql-essentials': null };
  try {
    const [dashboardSkill, dqlSkill] = await Promise.all([
      fs.readFile(path.join(SKILLS_PATH, 'dt-app-dashboard/SKILL.md'), 'utf-8'),
      fs.readFile(path.join(SKILLS_PATH, 'dt-dql-essentials/SKILL.md'), 'utf-8')
    ]);
    skills['dt-app-dashboard'] = dashboardSkill;
    skills['dt-dql-essentials'] = dqlSkill;
    console.log('[AI Dashboard] ✅ Loaded Dynatrace skills');
    return skills;
  } catch (error) {
    console.error('[AI Dashboard] ⚠️  Could not load skills:', error.message);
    return skills;
  }
}

// ============================================================================
// FIELD DETECTION ENGINE
// Scans the full incoming payload and classifies every field for tile generation
// ============================================================================

function detectPayloadFields(journeyData) {
  const detected = {
    additionalFields: {},
    customerProfile: {},
    traceMetadata: {},
    stepFields: {},
    stringFields: [],
    numericFields: [],
    booleanFields: [],
    objectFields: [],
    hasRevenue: false,
    hasLoyalty: false,
    hasDeviceType: false,
    hasLocation: false,
    hasNPS: false,
    hasChurnRisk: false,
    hasLTV: false,
    hasSegments: false,
    hasConversion: false,
    hasChannel: false,
    hasServices: false,
    hasCurrency: false
  };

  // ---- Scan additionalFields ----
  const af = journeyData.additionalFields || {};
  Object.entries(af).forEach(([key, value]) => {
    detected.additionalFields[key] = { value, type: typeof value };
    if (typeof value === 'string') {
      detected.stringFields.push({ key, source: 'additionalfields', dqlField: `additionalfields.${key}` });
    } else if (typeof value === 'number') {
      detected.numericFields.push({ key, source: 'additionalfields', dqlField: `additionalfields.${key}` });
    } else if (typeof value === 'boolean') {
      detected.booleanFields.push({ key, source: 'additionalfields', dqlField: `additionalfields.${key}` });
    } else if (typeof value === 'object' && value !== null) {
      detected.objectFields.push({ key, source: 'additionalfields', dqlField: `additionalfields.${key}`, value });
    }
  });

  // ---- Scan customerProfile ----
  const cp = journeyData.customerProfile || {};
  Object.entries(cp).forEach(([key, value]) => {
    detected.customerProfile[key] = { value, type: typeof value };
    if (typeof value === 'string' && !['userId', 'email', 'sessionId'].includes(key)) {
      detected.stringFields.push({ key, source: 'customerProfile', dqlField: `additionalfields.${key}` });
    } else if (typeof value === 'number') {
      detected.numericFields.push({ key, source: 'customerProfile', dqlField: `additionalfields.${key}` });
    }
  });

  // ---- Scan traceMetadata.businessContext ----
  const bc = journeyData.traceMetadata?.businessContext || {};
  Object.entries(bc).forEach(([key, value]) => {
    detected.traceMetadata[key] = { value, type: typeof value };
    if (typeof value === 'string' && key !== 'correlationId') {
      detected.stringFields.push({ key, source: 'traceMetadata', dqlField: `additionalfields.${key}` });
    } else if (typeof value === 'number') {
      detected.numericFields.push({ key, source: 'traceMetadata', dqlField: `additionalfields.${key}` });
    }
  });

  // ---- Scan step-level fields ----
  const steps = journeyData.steps || [];
  steps.forEach(step => {
    if (step.category) detected.stepFields.category = true;
    if (step.hasError !== undefined) detected.stepFields.hasError = true;
    if (step.estimatedDuration) detected.stepFields.estimatedDuration = true;
    if (step.serviceName) detected.hasServices = true;
  });

  // ---- Set summary flags ----
  const allKeys = Object.keys(af).concat(Object.keys(cp)).concat(Object.keys(bc)).map(k => k.toLowerCase());
  detected.hasRevenue = allKeys.some(k => k.includes('revenue') || k.includes('ordertotal') || k.includes('transactionvalue') || k.includes('transactionamount') || k.includes('businessvalue'));
  detected.hasLoyalty = allKeys.some(k => k.includes('loyalty'));
  detected.hasDeviceType = allKeys.some(k => k.includes('device'));
  detected.hasLocation = allKeys.some(k => k.includes('location') || k.includes('region') || k.includes('country') || k.includes('geo'));
  detected.hasNPS = allKeys.some(k => k.includes('nps') || k.includes('netpromoter') || k.includes('promoter'));
  detected.hasChurnRisk = allKeys.some(k => k.includes('churn'));
  detected.hasLTV = allKeys.some(k => k.includes('lifetime') || k.includes('ltv') || k.includes('clv'));
  detected.hasSegments = allKeys.some(k => k.includes('segment') || k.includes('tier') || k.includes('valuetier'));
  detected.hasConversion = allKeys.some(k => k.includes('conversion') || k.includes('funnel'));
  detected.hasChannel = allKeys.some(k => k.includes('channel') || k.includes('acquisition') || k.includes('entrychannel') || k.includes('campaign'));
  detected.hasCurrency = allKeys.some(k => k.includes('currency'));

  return detected;
}

function formatFieldsForPrompt(detected) {
  const lines = [];
  if (detected.stringFields.length > 0) {
    lines.push(`CATEGORICAL FIELDS (good for donut/bar charts): ${detected.stringFields.map(f => f.key).join(', ')}`);
  }
  if (detected.numericFields.length > 0) {
    lines.push(`NUMERIC FIELDS (good for singleValue, gauge): ${detected.numericFields.map(f => f.key).join(', ')}`);
  }
  if (detected.booleanFields.length > 0) {
    lines.push(`BOOLEAN FIELDS (good for countIf): ${detected.booleanFields.map(f => f.key).join(', ')}`);
  }
  const flags = [];
  if (detected.hasRevenue) flags.push('💰 Revenue/Transaction data');
  if (detected.hasLoyalty) flags.push('⭐ Loyalty data');
  if (detected.hasDeviceType) flags.push('📱 Device type data');
  if (detected.hasLocation) flags.push('🌍 Geographic data');
  if (detected.hasNPS) flags.push('📊 NPS scores');
  if (detected.hasChurnRisk) flags.push('⚠️ Churn risk');
  if (detected.hasLTV) flags.push('📈 Customer LTV');
  if (detected.hasSegments) flags.push('👥 Segments/Tiers');
  if (detected.hasConversion) flags.push('🎯 Conversion data');
  if (detected.hasChannel) flags.push('📡 Channel/Acquisition');
  if (detected.hasServices) flags.push('🔧 Service names');
  if (flags.length > 0) lines.push(`DATA SIGNALS: ${flags.join(', ')}`);
  return lines.join('\n');
}

// ============================================================================
// DYNAMIC TILE GENERATOR
// Generates tiles based on detected fields
// ============================================================================

function generateDynamicFieldTiles(detected, company, journeyType) {
  const dynamicTiles = {};
  const baseFilter = `filter event.kind == "BIZ_EVENT" | filter json.companyName == "${company}"`;

  // For each STRING field → donut chart
  detected.stringFields.forEach(field => {
    const skipKeys = ['sessionid', 'userid', 'email', 'correlationid', 'businesseventtype'];
    if (skipKeys.includes(field.key.toLowerCase())) return;

    const tileKey = `dynamic_${field.key}`;
    const prettyName = field.key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();

    dynamicTiles[tileKey] = {
      name: `📊 ${prettyName} Distribution`,
      query: `fetch bizevents | ${baseFilter} | filter json.industryType == $JourneyType or $JourneyType == "*" | summarize count = count(), by: {${field.dqlField}} | sort count desc | limit 10`,
      visualization: 'donutChart',
      visualizationSettings: {
        chartSettings: { circleChartSettings: { valueType: 'relative', showTotalValue: true } },
        legend: { ratio: 27 },
        thresholds: [],
        unitsOverrides: []
      }
    };
  });

  // For each NUMERIC field → singleValue or gauge
  detected.numericFields.forEach(field => {
    const skipKeys = ['processingtime', 'estimatedduration'];
    if (skipKeys.includes(field.key.toLowerCase())) return;

    const tileKey = `dynamic_${field.key}`;
    const prettyName = field.key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();

    const isCurrency = /revenue|value|total|amount|price|cost|ltv|lifetime/i.test(field.key);
    const isPercentage = /rate|score|percentage|ratio|likelihood/i.test(field.key);
    const viz = isPercentage ? 'gauge' : 'singleValue';
    const unitCat = isCurrency ? 'currency' : isPercentage ? 'percentage' : 'unspecified';
    const baseUnit = isCurrency ? 'usd' : isPercentage ? 'percent' : 'count';

    dynamicTiles[tileKey] = {
      name: `${isCurrency ? '💰' : isPercentage ? '📊' : '📈'} Avg ${prettyName}`,
      query: `fetch bizevents | ${baseFilter} | filter json.industryType == $JourneyType or $JourneyType == "*" | filter in(json.stepName, $Step) | summarize value = avg(toDouble(${field.dqlField}))`,
      visualization: viz,
      visualizationSettings: {
        singleValue: viz === 'singleValue' ? { label: prettyName.toUpperCase(), recordField: 'value', colorThresholdTarget: 'background' } : undefined,
        thresholds: [],
        unitsOverrides: [{ identifier: 'value', unitCategory: unitCat, baseUnit: baseUnit, decimals: isCurrency ? 0 : 1, suffix: isCurrency ? '$' : isPercentage ? '%' : '', delimiter: true }]
      }
    };
  });

  return dynamicTiles;
}

// ============================================================================
// CORE TILE TEMPLATES
// ============================================================================

function generateCoreTileTemplates(company, journeyType, steps, dynatraceUrl) {
  const baseFilter = `filter event.kind == "BIZ_EVENT" | filter json.companyName == "${company}"`;
  const journeyFilter = `${baseFilter} | filter json.industryType == "${journeyType}"`;
  const varFilter = `${baseFilter} | filter json.industryType == $JourneyType or $JourneyType == "*"`;
  const stepFilter = `${varFilter} | filter in(json.stepName, $Step)`;

  return {
    // ===== OVERALL JOURNEY =====
    step_metrics: {
      name: '📊 Journey Step Metrics',
      query: `fetch bizevents | ${varFilter} | summarize OrdersInStep = count(), SuccessRate = (countIf(isNull(additionalfields.hasError) or additionalfields.hasError == false) / count()) * 100, AvgTimeInStep = avg(additionalfields.processingTime), ErrorsInStep = countIf(additionalfields.hasError == true), ErrorRate = (countIf(additionalfields.hasError == true) / count()) * 100, by: {json.stepName} | sort OrdersInStep desc`,
      visualization: 'table',
      visualizationSettings: {
        table: { columnWidths: { 'json.stepName': 200, 'OrdersInStep': 120, 'SuccessRate': 120, 'AvgTimeInStep': 120, 'ErrorsInStep': 120, 'ErrorRate': 120 } },
        thresholds: [
          { id: 1, field: 'SuccessRate', isEnabled: true, rules: [
            { id: 1, color: { Default: '#2ab06f' }, comparator: '≥', value: 95 },
            { id: 2, color: { Default: '#f5d30f' }, comparator: '≥', value: 85 },
            { id: 3, color: { Default: '#dc2626' }, comparator: '<', value: 85 }
          ]},
          { id: 2, field: 'ErrorRate', isEnabled: true, rules: [
            { id: 1, color: { Default: '#dc2626' }, comparator: '>', value: 5 },
            { id: 2, color: { Default: '#f5d30f' }, comparator: '>', value: 2 },
            { id: 3, color: { Default: '#2ab06f' }, comparator: '≤', value: 2 }
          ]}
        ],
        unitsOverrides: [
          { identifier: 'SuccessRate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 2, suffix: '%', delimiter: true },
          { identifier: 'AvgTimeInStep', unitCategory: 'time', baseUnit: 'milli_second', decimals: 0, suffix: 'ms', delimiter: true },
          { identifier: 'ErrorRate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 2, suffix: '%', delimiter: true },
          { identifier: 'OrdersInStep', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }
        ]
      }
    },
    success_rate: {
      name: '✅ Journey Success Rate',
      query: `fetch bizevents | ${journeyFilter} | summarize total = count(), successful = countIf(isNull(additionalfields.hasError) or additionalfields.hasError == false) | fieldsAdd success_rate = (successful / total) * 100`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'SUCCESS RATE', recordField: 'success_rate', colorThresholdTarget: 'value', prefixIcon: 'CheckmarkIcon' },
        thresholds: [{ id: 1, field: 'success_rate', isEnabled: true, rules: [
          { id: 1, color: { Default: '#2ab06f' }, comparator: '≥', value: 95 },
          { id: 2, color: { Default: '#f5d30f' }, comparator: '≥', value: 85 },
          { id: 3, color: { Default: '#dc2626' }, comparator: '<', value: 85 }
        ]}],
        unitsOverrides: [{ identifier: 'success_rate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 1, suffix: '%', delimiter: true }]
      }
    },
    total_volume: {
      name: '📈 Total Journey Volume',
      query: `fetch bizevents | ${journeyFilter} | summarize TotalEvents = count()`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'TOTAL VOLUME', recordField: 'TotalEvents', colorThresholdTarget: 'background', prefixIcon: 'ActivityIcon' },
        thresholds: [],
        unitsOverrides: [{ identifier: 'TotalEvents', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }]
      }
    },
    error_count: {
      name: '❌ Total Errors',
      query: `fetch bizevents | ${varFilter} | summarize errors = countIf(additionalfields.hasError == true)`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'ERRORS', recordField: 'errors', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'errors', isEnabled: true, rules: [
          { id: 1, color: { Default: '#dc2626' }, comparator: '>', value: 10 },
          { id: 2, color: { Default: '#f5d30f' }, comparator: '>', value: 5 },
          { id: 3, color: { Default: '#2ab06f' }, comparator: '≤', value: 5 }
        ]}],
        unitsOverrides: [{ identifier: 'errors', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }]
      }
    },
    business_value: {
      name: '💰 Total Revenue',
      query: `fetch bizevents | ${varFilter} | summarize revenue = sum(additionalfields.orderTotal)`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'REVENUE', recordField: 'revenue', prefixIcon: 'MoneyIcon', colorThresholdTarget: 'background' },
        thresholds: [],
        unitsOverrides: [{ identifier: 'revenue', unitCategory: 'currency', baseUnit: 'usd', decimals: 0, suffix: '$', delimiter: true }]
      }
    },
    volume_trend: {
      name: '📈 Volume Over Time',
      query: `fetch bizevents | ${journeyFilter} | makeTimeseries successful = countIf(isNull(additionalfields.hasError) or additionalfields.hasError == false), failed = countIf(additionalfields.hasError == true), bins:30`,
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
        thresholds: [], unitsOverrides: []
      }
    },
    conversion_funnel: {
      name: '📊 Events by Step',
      query: `fetch bizevents | ${varFilter} | summarize count = count(), by: {json.stepName} | sort count desc | limit 10`,
      visualization: 'donutChart',
      visualizationSettings: {
        chartSettings: { circleChartSettings: { valueType: 'relative', showTotalValue: true } },
        legend: { ratio: 27 }, thresholds: [], unitsOverrides: []
      }
    },
    error_analysis: {
      name: '❌ Errors by Step',
      query: `fetch bizevents | ${journeyFilter} | filter additionalfields.hasError == true | summarize ErrorCount = count(), by: {json.stepName} | sort ErrorCount desc`,
      visualization: 'barChart',
      visualizationSettings: {
        chartSettings: { colorPalette: 'negativeComparison', gapPolicy: 'connect' },
        unitsOverrides: [{ identifier: 'ErrorCount', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }]
      }
    },
    error_types: {
      name: '🐛 Error Details',
      query: `fetch bizevents | ${journeyFilter} | filter additionalfields.hasError == true | summarize Occurrences = count(), by: {json.stepName, additionalfields.errorMessage} | sort Occurrences desc | limit 20`,
      visualization: 'table',
      visualizationSettings: {
        table: { rowDensity: 'condensed', enableLineWrap: true, columnWidths: { 'json.stepName': 150, 'additionalfields.errorMessage': 300, 'Occurrences': 100 } },
        thresholds: [],
        unitsOverrides: [{ identifier: 'Occurrences', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }]
      }
    },
    top_errors: {
      name: '🔥 Top Error Messages',
      query: `fetch bizevents | ${journeyFilter} | filter additionalfields.hasError == true | summarize Count = count(), by: {additionalfields.errorMessage} | sort Count desc | limit 10`,
      visualization: 'categoricalBarChart',
      visualizationSettings: { thresholds: [], unitsOverrides: [{ identifier: 'Count', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }] }
    },
    error_rate_trend: {
      name: '📉 Error Rate Trend',
      query: `fetch bizevents | ${journeyFilter} | makeTimeseries {errors = countIf(additionalfields.hasError == true), total = count()}, bins:30 | fieldsAdd ErrorRate = (errors[] / total[]) * 100`,
      visualization: 'lineChart',
      visualizationSettings: {
        chartSettings: { gapPolicy: 'connect', seriesOverrides: [{ seriesId: ['ErrorRate'], override: { color: '#C62239' } }] },
        thresholds: [{ id: 1, field: 'ErrorRate', isEnabled: true, rules: [
          { id: 1, color: { Default: '#dc2626' }, comparator: '>', value: 5 },
          { id: 2, color: { Default: '#f5d30f' }, comparator: '>', value: 2 }
        ]}],
        unitsOverrides: [{ identifier: 'ErrorRate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 2, suffix: '%', delimiter: true }]
      }
    },
    step_performance: {
      name: '⚡ Step Performance',
      query: `fetch bizevents | ${journeyFilter} | summarize Events = count(), AvgTime = avg(additionalfields.processingTime), ErrorRate = (countIf(additionalfields.hasError == true) / count()) * 100, by: {json.stepName} | sort Events desc`,
      visualization: 'table',
      visualizationSettings: {
        table: { rowDensity: 'condensed', enableLineWrap: false, columnWidths: { 'json.stepName': 200, 'Events': 100, 'AvgTime': 120, 'ErrorRate': 120 } },
        thresholds: [{ id: 1, field: 'ErrorRate', isEnabled: true, rules: [
          { id: 1, color: { Default: '#dc2626' }, comparator: '>', value: 5 },
          { id: 2, color: { Default: '#f5d30f' }, comparator: '>', value: 2 },
          { id: 3, color: { Default: '#2ab06f' }, comparator: '≤', value: 2 }
        ]}],
        unitsOverrides: [
          { identifier: 'AvgTime', unitCategory: 'time', baseUnit: 'milli_second', decimals: 0, suffix: 'ms', delimiter: true },
          { identifier: 'ErrorRate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 2, suffix: '%', delimiter: true },
          { identifier: 'Events', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }
        ]
      }
    },
    response_time: {
      name: '⏱️ Response Time by Step',
      query: `fetch bizevents | ${journeyFilter} | summarize AvgResponseTime = avg(additionalfields.processingTime), by: {json.stepName} | sort AvgResponseTime desc`,
      visualization: 'barChart',
      visualizationSettings: {
        chartSettings: { colorPalette: 'sequential', gapPolicy: 'connect' },
        unitsOverrides: [{ identifier: 'AvgResponseTime', unitCategory: 'time', baseUnit: 'milli_second', decimals: 0, suffix: 'ms', delimiter: true }]
      }
    },
    hourly_pattern: {
      name: '🕐 Hourly Activity Pattern',
      query: `fetch bizevents | ${journeyFilter} | fieldsAdd hour = toString(getHour(timestamp)) | summarize Events = count(), by: {hour} | sort hour asc`,
      visualization: 'lineChart',
      visualizationSettings: {
        chartSettings: { gapPolicy: 'connect' }, thresholds: [],
        unitsOverrides: [{ identifier: 'Events', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }]
      }
    },
    completion_time: {
      name: '⏱️ Avg Completion Time',
      query: `fetch bizevents | ${journeyFilter} | filter isNull(additionalfields.hasError) or additionalfields.hasError == false | summarize AvgCompletionTime = avg(additionalfields.processingTime)`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'AVG COMPLETION TIME', recordField: 'AvgCompletionTime', colorThresholdTarget: 'background', prefixIcon: 'ClockIcon' },
        thresholds: [{ id: 1, field: 'AvgCompletionTime', isEnabled: true, rules: [
          { id: 1, color: { Default: '#2ab06f' }, comparator: '≤', value: 2000 },
          { id: 2, color: { Default: '#f5d30f' }, comparator: '≤', value: 5000 },
          { id: 3, color: { Default: '#dc2626' }, comparator: '>', value: 5000 }
        ]}],
        unitsOverrides: [{ identifier: 'AvgCompletionTime', unitCategory: 'time', baseUnit: 'milli_second', decimals: 0, suffix: 'ms', delimiter: true }]
      }
    },
    sla_compliance: {
      name: '📋 SLA Compliance (< 5s)',
      query: `fetch bizevents | ${journeyFilter} | summarize TotalEvents = count(), WithinSLA = countIf(additionalfields.processingTime < 5000), by: {json.stepName} | fieldsAdd ComplianceRate = (WithinSLA / TotalEvents) * 100`,
      visualization: 'table',
      visualizationSettings: {
        table: { rowDensity: 'condensed', enableLineWrap: false, columnWidths: { 'json.stepName': 200, 'TotalEvents': 100, 'WithinSLA': 100, 'ComplianceRate': 120 } },
        thresholds: [{ id: 1, field: 'ComplianceRate', isEnabled: true, rules: [
          { id: 1, color: { Default: '#2ab06f' }, comparator: '≥', value: 95 },
          { id: 2, color: { Default: '#f5d30f' }, comparator: '≥', value: 85 },
          { id: 3, color: { Default: '#dc2626' }, comparator: '<', value: 85 }
        ]}],
        unitsOverrides: [
          { identifier: 'ComplianceRate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 1, suffix: '%', delimiter: true },
          { identifier: 'TotalEvents', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true },
          { identifier: 'WithinSLA', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }
        ]
      }
    },
    daily_comparison: {
      name: '📅 Today vs Yesterday',
      query: `fetch bizevents | ${journeyFilter} | fieldsAdd day = if(timestamp >= now() - 1d, else:"Yesterday", "Today") | filter timestamp >= now() - 2d | summarize Events = count(), SuccessRate = (countIf(isNull(additionalfields.hasError) or additionalfields.hasError == false) / count()) * 100, by: {day}`,
      visualization: 'categoricalBarChart',
      visualizationSettings: { chartSettings: { colorPalette: 'categorical' }, thresholds: [], unitsOverrides: [{ identifier: 'Events', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }] }
    },
    step_duration_percentiles: {
      name: '⏱️ P90 Response Time',
      query: `fetch bizevents | ${stepFilter} | summarize p90 = percentile(additionalfields.processingTime, 90)`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'P90 RESPONSE TIME', recordField: 'p90', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'p90', isEnabled: true, rules: [
          { id: 1, color: { Default: '#2ab06f' }, comparator: '≤', value: 50 },
          { id: 2, color: { Default: '#f5d30f' }, comparator: '≤', value: 100 },
          { id: 3, color: { Default: '#c62239' }, comparator: '>', value: 100 }
        ]}],
        unitsOverrides: [{ identifier: 'p90', unitCategory: 'time', baseUnit: 'millisecond', decimals: 0, suffix: ' ms', delimiter: true }]
      }
    },
    abandonment_analysis: {
      name: '🚪 Last Steps Before Drop-off',
      query: `fetch bizevents | ${journeyFilter} | filter additionalfields.hasError == true or isNull(additionalfields.completedJourney) | summarize Abandonments = count(), by: {json.stepName} | sort Abandonments desc`,
      visualization: 'categoricalBarChart',
      visualizationSettings: { chartSettings: { colorPalette: 'negativeComparison' }, thresholds: [], unitsOverrides: [{ identifier: 'Abandonments', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }] }
    },
    step_funnel_dropoff: {
      name: '🔻 Step-by-Step Conversion',
      query: `fetch bizevents | ${journeyFilter} | summarize TotalAtStep = count(), CompletedFromStep = countIf(isNull(additionalfields.hasError) or additionalfields.hasError == false), by: {json.stepName} | fieldsAdd ConversionRate = (CompletedFromStep / TotalAtStep) * 100 | sort TotalAtStep desc`,
      visualization: 'table',
      visualizationSettings: {
        table: { rowDensity: 'condensed', enableLineWrap: false, columnWidths: { 'json.stepName': 200, 'TotalAtStep': 120, 'CompletedFromStep': 140, 'ConversionRate': 140 } },
        thresholds: [{ id: 1, field: 'ConversionRate', isEnabled: true, rules: [
          { id: 1, color: { Default: '#2ab06f' }, comparator: '≥', value: 90 },
          { id: 2, color: { Default: '#f5d30f' }, comparator: '≥', value: 75 },
          { id: 3, color: { Default: '#dc2626' }, comparator: '<', value: 75 }
        ]}],
        unitsOverrides: [
          { identifier: 'TotalAtStep', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true },
          { identifier: 'CompletedFromStep', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true },
          { identifier: 'ConversionRate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 1, suffix: '%', delimiter: true }
        ]
      }
    },
    peak_hours: {
      name: '🔝 Peak Activity Hours',
      query: `fetch bizevents | ${journeyFilter} | fieldsAdd hour = toString(getHour(timestamp)) | summarize Events = count(), Errors = countIf(additionalfields.hasError == true), by: {hour} | fieldsAdd ErrorRate = (toDouble(Errors) / toDouble(Events)) * 100 | sort Events desc | limit 10`,
      visualization: 'categoricalBarChart',
      visualizationSettings: { chartSettings: { colorPalette: 'sequential' }, thresholds: [], unitsOverrides: [{ identifier: 'Events', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }] }
    },

    // ===== FILTERED VIEW (with $Step variable) =====
    total_volume_filtered: {
      name: '💼 Journey Events (Filtered)',
      query: `fetch bizevents | ${stepFilter} | summarize total = count()`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'TOTAL EVENTS', recordField: 'total', prefixIcon: 'ProcessesIcon', colorThresholdTarget: 'background' },
        thresholds: [],
        unitsOverrides: [{ identifier: 'total', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }]
      }
    },
    business_value_filtered: {
      name: '💰 Revenue (Filtered)',
      query: `fetch bizevents | ${stepFilter} | summarize revenue = sum(additionalfields.orderTotal)`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'REVENUE', recordField: 'revenue', prefixIcon: 'MoneyIcon', colorThresholdTarget: 'background' },
        thresholds: [],
        unitsOverrides: [{ identifier: 'revenue', unitCategory: 'currency', baseUnit: 'usd', decimals: 0, suffix: '$', delimiter: true }]
      }
    },
    avg_order_value_filtered: {
      name: '💵 Avg Order Value',
      query: `fetch bizevents | ${stepFilter} | summarize avg = avg(additionalfields.orderTotal)`,
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { label: 'AOV', recordField: 'avg', colorThresholdTarget: 'background' },
        thresholds: [],
        unitsOverrides: [{ identifier: 'avg', unitCategory: 'currency', baseUnit: 'usd', decimals: 2, suffix: '$', delimiter: true }]
      }
    },
    volume_trend_filtered: {
      name: '📈 Events Over Time (Filtered)',
      query: `fetch bizevents | ${stepFilter} | makeTimeseries events = count(), bins:30`,
      visualization: 'areaChart',
      visualizationSettings: {
        chartSettings: { gapPolicy: 'connect', seriesOverrides: [{ seriesId: ['events'], override: { color: '#2AB06F' } }] },
        thresholds: [], unitsOverrides: []
      }
    },
    conversion_funnel_filtered: {
      name: '📊 Events by Step (Filtered)',
      query: `fetch bizevents | ${varFilter} | summarize count = count(), by: {json.stepName} | sort count desc | limit 10`,
      visualization: 'categoricalBarChart',
      visualizationSettings: { chartSettings: { categoricalBarChartSettings: {} }, thresholds: [], unitsOverrides: [] }
    },

    // ===== SERVICE & INFRASTRUCTURE OBSERVABILITY =====
    service_health_table: {
      name: '🏥 Service Health Overview',
      query: `timeseries { reqCount = avg(dt.service.request.count) }, by: { dt.entity.service }, filter: { in(dt.entity.service, classicEntitySelector("type(SERVICE),entityName.exists()")) }
| lookup [
    timeseries { errCount = avg(dt.service.request.failure_count) }, by: { dt.entity.service }, filter: { in(dt.entity.service, classicEntitySelector("type(SERVICE),entityName.exists()")) }
  ], sourceField:dt.entity.service, lookupField:dt.entity.service, prefix:"err."
| fieldsAdd serviceName = entityName(dt.entity.service), failureRate = (arrayAvg(err.errCount[]) / arrayAvg(reqCount[])) * 100
| sort failureRate desc`,
      visualization: 'table',
      visualizationSettings: {
        table: { rowDensity: 'condensed', enableLineWrap: false, columnWidths: { 'serviceName': 250, 'failureRate': 120 } },
        thresholds: [
          { id: 1, field: 'failureRate', isEnabled: true, rules: [
            { id: 1, color: { Default: '#2ab06f' }, comparator: '≤', value: 1 },
            { id: 2, color: { Default: '#f5d30f' }, comparator: '≤', value: 5 },
            { id: 3, color: { Default: '#dc2626' }, comparator: '>', value: 5 }
          ]}
        ],
        unitsOverrides: [{ identifier: 'failureRate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 2, suffix: '%', delimiter: true }]
      }
    },
    service_response_time: {
      name: '⏱️ Service Response Time (P50/P90/P99)',
      query: `timeseries {
  p50 = avg(dt.service.request.response_time, default:0),
  p90 = percentile(dt.service.request.response_time, 90),
  p99 = percentile(dt.service.request.response_time, 99)
}, filter: { dt.entity.service == $ServiceID }`,
      visualization: 'lineChart',
      visualizationSettings: {
        chartSettings: {
          gapPolicy: 'connect',
          fieldMapping: { leftAxisValues: ['p50', 'p90', 'p99'], timestamp: 'timeframe' },
          seriesOverrides: [
            { seriesId: ['p50'], override: { color: '#2AB06F', lineWidth: 2 } },
            { seriesId: ['p90'], override: { color: '#F5D30F', lineWidth: 2 } },
            { seriesId: ['p99'], override: { color: '#C62239', lineWidth: 2, lineStyle: 'dashed' } }
          ]
        },
        thresholds: [],
        unitsOverrides: [
          { identifier: 'p50', unitCategory: 'time', baseUnit: 'micro_second', decimals: 0, suffix: 'µs', delimiter: true },
          { identifier: 'p90', unitCategory: 'time', baseUnit: 'micro_second', decimals: 0, suffix: 'µs', delimiter: true },
          { identifier: 'p99', unitCategory: 'time', baseUnit: 'micro_second', decimals: 0, suffix: 'µs', delimiter: true }
        ]
      }
    },
    http_error_breakdown: {
      name: '🔴 HTTP Error Breakdown',
      query: `timeseries {
  http4xx = avg(dt.service.request.client_side_failure_count),
  http5xx = avg(dt.service.request.failure_count)
}, by: { dt.entity.service }, filter: { in(dt.entity.service, classicEntitySelector("type(SERVICE),entityName.exists()")) }
| fieldsAdd serviceName = entityName(dt.entity.service), total4xx = arraySum(http4xx[]), total5xx = arraySum(http5xx[])
| sort total5xx desc`,
      visualization: 'table',
      visualizationSettings: {
        table: { rowDensity: 'condensed', enableLineWrap: false, columnWidths: { 'serviceName': 250, 'total4xx': 120, 'total5xx': 120 } },
        thresholds: [
          { id: 1, field: 'total5xx', isEnabled: true, rules: [
            { id: 1, color: { Default: '#dc2626' }, comparator: '>', value: 10 },
            { id: 2, color: { Default: '#f5d30f' }, comparator: '>', value: 0 },
            { id: 3, color: { Default: '#2ab06f' }, comparator: '≤', value: 0 }
          ]},
          { id: 2, field: 'total4xx', isEnabled: true, rules: [
            { id: 1, color: { Default: '#f5d30f' }, comparator: '>', value: 10 },
            { id: 2, color: { Default: '#2ab06f' }, comparator: '≤', value: 10 }
          ]}
        ],
        unitsOverrides: [
          { identifier: 'total4xx', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true },
          { identifier: 'total5xx', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }
        ]
      }
    },
    exception_analysis_table: {
      name: '💥 Top Exceptions',
      query: `fetch dt.davis.events, from:now()-24h
| filter event.kind == "ERROR_EVENT"
| summarize occurrences = count(), lastSeen = takeLast(timestamp), by: {event.name, dt.entity.service}
| fieldsAdd serviceName = entityName(dt.entity.service)
| sort occurrences desc
| limit 15`,
      visualization: 'table',
      visualizationSettings: {
        table: { rowDensity: 'condensed', enableLineWrap: true, columnWidths: { 'event.name': 350, 'serviceName': 200, 'occurrences': 100, 'lastSeen': 160 } },
        thresholds: [{ id: 1, field: 'occurrences', isEnabled: true, rules: [
          { id: 1, color: { Default: '#dc2626' }, comparator: '≥', value: 50 },
          { id: 2, color: { Default: '#f5d30f' }, comparator: '≥', value: 10 },
          { id: 3, color: { Default: '#2ab06f' }, comparator: '<', value: 10 }
        ]}],
        unitsOverrides: [{ identifier: 'occurrences', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, delimiter: true }]
      }
    },
    service_throughput: {
      name: '📊 Service Request Throughput',
      query: `timeseries avg(dt.service.request.count), by: { dt.entity.service }, filter: { in(dt.entity.service, classicEntitySelector("type(SERVICE),entityName.exists()")) }
| fieldsAdd serviceName = entityName(dt.entity.service)`,
      visualization: 'areaChart',
      visualizationSettings: {
        chartSettings: { gapPolicy: 'connect', legend: { position: 'bottom' } },
        thresholds: [],
        unitsOverrides: [{ identifier: 'avg(dt.service.request.count)', unitCategory: 'unspecified', baseUnit: 'count', decimals: 0, suffix: ' req', delimiter: true }]
      }
    },
    failure_rate_timeseries: {
      name: '📉 Service Failure Rate Over Time',
      query: `timeseries {
  requests = avg(dt.service.request.count),
  failures = avg(dt.service.request.failure_count)
}, filter: { dt.entity.service == $ServiceID }
| fieldsAdd failureRate = (arrayAvg(failures[]) / arrayAvg(requests[])) * 100`,
      visualization: 'lineChart',
      visualizationSettings: {
        chartSettings: { gapPolicy: 'connect', seriesOverrides: [{ seriesId: ['failureRate'], override: { color: '#C62239', lineWidth: 2 } }] },
        thresholds: [{ id: 1, field: 'failureRate', isEnabled: true, rules: [
          { id: 1, color: { Default: '#dc2626' }, comparator: '>', value: 5 },
          { id: 2, color: { Default: '#f5d30f' }, comparator: '>', value: 1 }
        ]}],
        unitsOverrides: [{ identifier: 'failureRate', unitCategory: 'percentage', baseUnit: 'percent', decimals: 2, suffix: '%', delimiter: true }]
      }
    },
    process_cpu_usage: {
      name: '🖥️ Process CPU Usage',
      query: `timeseries avg(dt.process.cpu.usage), by: { dt.entity.process_group_instance }, filter: { in(dt.entity.process_group_instance, classicEntitySelector("type(PROCESS_GROUP_INSTANCE),fromRelationships.isInstanceOf(type(PROCESS_GROUP),fromRelationships.runsOn($ServiceID))")) }
| fieldsAdd processName = entityName(dt.entity.process_group_instance)`,
      visualization: 'lineChart',
      visualizationSettings: {
        chartSettings: { gapPolicy: 'connect', legend: { position: 'bottom' } },
        thresholds: [{ id: 1, field: 'avg(dt.process.cpu.usage)', isEnabled: true, rules: [
          { id: 1, color: { Default: '#dc2626' }, comparator: '>', value: 80 },
          { id: 2, color: { Default: '#f5d30f' }, comparator: '>', value: 60 }
        ]}],
        unitsOverrides: [{ identifier: 'avg(dt.process.cpu.usage)', unitCategory: 'percentage', baseUnit: 'percent', decimals: 1, suffix: '%', delimiter: true }]
      }
    },
    process_memory_usage: {
      name: '🧠 Process Memory Usage',
      query: `timeseries avg(dt.process.memory.working_set_size), by: { dt.entity.process_group_instance }, filter: { in(dt.entity.process_group_instance, classicEntitySelector("type(PROCESS_GROUP_INSTANCE),fromRelationships.isInstanceOf(type(PROCESS_GROUP),fromRelationships.runsOn($ServiceID))")) }
| fieldsAdd processName = entityName(dt.entity.process_group_instance)`,
      visualization: 'areaChart',
      visualizationSettings: {
        chartSettings: { gapPolicy: 'connect', legend: { position: 'bottom' } },
        thresholds: [],
        unitsOverrides: [{ identifier: 'avg(dt.process.memory.working_set_size)', unitCategory: 'data', baseUnit: 'byte', decimals: 1, delimiter: true }]
      }
    },
    davis_problems: {
      name: '🚨 Active Davis Problems',
      query: `fetch dt.davis.problems
| filter event.status == "ACTIVE"
| fields display_id, title, affected_entity_ids, event.start, event.status, management_zone
| sort event.start desc
| limit 10`,
      visualization: 'table',
      visualizationSettings: {
        table: { rowDensity: 'condensed', enableLineWrap: true, columnWidths: { 'display_id': 80, 'title': 300, 'affected_entity_ids': 200, 'event.start': 160 } },
        thresholds: [], unitsOverrides: []
      }
    },
    log_errors: {
      name: '📋 Recent Log Errors',
      query: `fetch logs, from:now()-1h
| filter loglevel == "ERROR" or loglevel == "WARN"
| fields timestamp, loglevel, content, dt.entity.service
| fieldsAdd serviceName = entityName(dt.entity.service)
| sort timestamp desc
| limit 20`,
      visualization: 'table',
      visualizationSettings: {
        table: { rowDensity: 'condensed', enableLineWrap: true, columnWidths: { 'timestamp': 160, 'loglevel': 80, 'content': 400, 'serviceName': 200 } },
        thresholds: [{ id: 1, field: 'loglevel', isEnabled: true, rules: [
          { id: 1, color: { Default: '#dc2626' }, comparator: '==', value: 'ERROR' },
          { id: 2, color: { Default: '#f5d30f' }, comparator: '==', value: 'WARN' }
        ]}],
        unitsOverrides: []
      }
    },
    trace_links_panel: {
      name: '🔗 Quick Navigation',
      type: 'markdown',
      content: `## 🔗 Deep-Link Navigation

| Resource | Link |
|----------|------|
| 🔍 **Distributed Traces** | [Open Trace Explorer →](${dynatraceUrl}/ui/diagnostictools/purepaths?gtf=-24h+to+now&gf=all) |
| 📊 **Service Overview** | [Open Services →](${dynatraceUrl}/ui/services?gtf=-24h+to+now&gf=all) |
| ❌ **Failure Analysis** | [Open Failure Analysis →](${dynatraceUrl}/ui/diagnostictools/mda?gtf=-24h+to+now&gf=all&mdaId=failureAnalysis) |
| 🐛 **Exception Analysis** | [Open Exception Analysis →](${dynatraceUrl}/ui/diagnostictools/mda?gtf=-24h+to+now&gf=all&mdaId=exceptionAnalysis) |
| 📈 **Davis Problems** | [Open Problems →](${dynatraceUrl}/ui/problems?gtf=-24h+to+now) |
| 📊 **Business Events** | [Open BizEvents →](${dynatraceUrl}/ui/bizevents?gtf=-24h+to+now) |

*Links open in your Dynatrace environment*`
    }
  };
}

// ============================================================================
// VARIABLE GENERATOR
// ============================================================================

function generateVariables(company) {
  return [
    {
      key: 'CompanyName', visible: true, type: 'query', version: 2, editable: true, multiple: false,
      input: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${company}" | fields json.companyName | dedup json.companyName`
    },
    {
      key: 'JourneyType', visible: true, type: 'query', version: 2, editable: true, multiple: true,
      input: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter json.companyName == "${company}" | fields json.industryType | dedup json.industryType`
    },
    {
      key: 'Step', visible: true, type: 'query', version: 2, editable: true, multiple: true,
      input: `fetch bizevents | filter event.kind == "BIZ_EVENT" | filter in(json.industryType, $JourneyType) | filter json.companyName == "${company}" | fields json.stepName | dedup json.stepName`
    },
    {
      key: 'Service', visible: true, type: 'query', version: 2, editable: true, multiple: false,
      input: 'fetch dt.entity.service | fields id, entity.name | sort entity.name asc'
    },
    {
      key: 'ServiceID', visible: true, type: 'query', version: 2, editable: true, multiple: false,
      input: 'fetch dt.entity.service | filter entity.name == $Service | fields id'
    }
  ];
}

// ============================================================================
// MARKDOWN SECTION HEADERS
// ============================================================================

function generateMarkdownTiles(company, journeyType, steps, detected) {
  const stepFlow = (steps || []).map((s, i) => {
    const label = s.name || s.stepName || `Step ${i + 1}`;
    const cat = s.category ? ` (${s.category})` : '';
    return `**${i + 1}. ${label}**${cat}`;
  }).join(' **→** ');

  const detectedSummary = [];
  if (detected.hasRevenue) detectedSummary.push('💰 Revenue');
  if (detected.hasLoyalty) detectedSummary.push('⭐ Loyalty');
  if (detected.hasLTV) detectedSummary.push('📈 LTV');
  if (detected.hasSegments) detectedSummary.push('👥 Segments');
  if (detected.hasChannel) detectedSummary.push('📡 Channels');
  if (detected.hasDeviceType) detectedSummary.push('📱 Devices');
  if (detected.hasServices) detectedSummary.push('🔧 Services');
  const dataSignals = detectedSummary.length > 0 ? `\n**Data Signals Detected:** ${detectedSummary.join(' | ')}` : '';

  return {
    header: { type: 'markdown', content: `# ${company}\n## ${journeyType} - Business Observability Dashboard\n\n**Industry:** ${journeyType} | **Dashboard Type:** AI-Generated Bespoke Analytics${dataSignals}` },
    journey_flow: { type: 'markdown', content: `## 🔄 Customer Journey Flow\n\n${stepFlow}\n\n---\n*End-to-end journey visualization with step-by-step metrics*` },
    section_overall: {
      type: 'data', title: '',
      query: 'data record(a="Overall Journey Performance - All Steps")',
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { labelMode: 'none', isIconVisible: true, prefixIcon: 'RocketIcon', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'a', isEnabled: true, rules: [{ id: 1, color: '#478ACA', comparator: '!=', value: 'x' }] }]
      }
    },
    section_filtered: {
      type: 'data', title: '',
      query: 'data record(a="Filtered View - By Selected Step")',
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { labelMode: 'none', isIconVisible: true, prefixIcon: 'FilterIcon', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'a', isEnabled: true, rules: [{ id: 1, color: '#7C38A1', comparator: '!=', value: 'x' }] }]
      }
    },
    section_dynamic: {
      type: 'data', title: '',
      query: 'data record(a="Business Intelligence - Detected Data Fields")',
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { labelMode: 'none', isIconVisible: true, prefixIcon: 'LightbulbIcon', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'a', isEnabled: true, rules: [{ id: 1, color: '#E87A35', comparator: '!=', value: 'x' }] }]
      }
    },
    section_performance: {
      type: 'data', title: '',
      query: 'data record(a="Performance & Operations")',
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { labelMode: 'none', isIconVisible: true, prefixIcon: 'ChartLineIcon', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'a', isEnabled: true, rules: [{ id: 1, color: '#2AB06F', comparator: '!=', value: 'x' }] }]
      }
    },
    section_service_infra: {
      type: 'data', title: '',
      query: 'data record(a="Service & Infrastructure Observability")',
      visualization: 'singleValue',
      visualizationSettings: {
        singleValue: { labelMode: 'none', isIconVisible: true, prefixIcon: 'ServerIcon', colorThresholdTarget: 'background' },
        thresholds: [{ id: 1, field: 'a', isEnabled: true, rules: [{ id: 1, color: '#7C3AED', comparator: '!=', value: 'x' }] }]
      }
    },
    footer: { type: 'markdown', content: `*Dashboard auto-generated by BizObs Engine* | Monitoring ${company} journey performance across all touchpoints` }
  };
}

// ============================================================================
// DASHBOARD LAYOUT BUILDER
// ============================================================================

function buildDashboardLayout(coreTiles, dynamicTiles, markdownTiles, variables, company, journeyType, industry, aiSelectedTiles, detected) {
  const dashboardJson = {
    version: 21,
    variables: variables,
    tiles: {},
    layouts: {},
    settings: { defaultTimeframe: { value: { from: 'now()-24h', to: 'now()' }, enabled: true } }
  };

  let y = 0;
  let tileIndex = 0;

  const addDataTile = (template, x, width, height) => {
    if (!template) return;
    if (template.type === 'markdown') {
      dashboardJson.tiles[tileIndex] = { title: template.name, type: 'markdown', content: template.content };
    } else {
      dashboardJson.tiles[tileIndex] = {
        title: template.name, type: 'data', query: template.query,
        visualization: template.visualization, visualizationSettings: template.visualizationSettings,
        querySettings: { maxResultRecords: 1000, defaultScanLimitGbytes: 500, maxResultMegaBytes: 1, defaultSamplingRatio: 10, enableSampling: false },
        davis: { enabled: false, davisVisualization: { isAvailable: true } }
      };
    }
    dashboardJson.layouts[tileIndex] = { x, y, w: width, h: height };
    tileIndex++;
  };

  const addSectionTile = (tile, height = 1) => {
    dashboardJson.tiles[tileIndex] = tile;
    dashboardJson.layouts[tileIndex] = { x: 0, y, w: 24, h: height };
    y += height;
    tileIndex++;
  };

  // ---- HEADER ----
  addSectionTile(markdownTiles.header, 3);
  addSectionTile(markdownTiles.journey_flow, 3);

  // ---- STEP METRICS TABLE ----
  addDataTile(coreTiles['step_metrics'], 0, 24, 6);
  y += 6;

  // ---- OVERALL JOURNEY PERFORMANCE ----
  addSectionTile(markdownTiles.section_overall);
  ['total_volume', 'success_rate', 'business_value', 'error_count'].forEach((key, i) => {
    addDataTile(coreTiles[key], i * 6, 6, 3);
  });
  y += 3;
  addDataTile(coreTiles['volume_trend'], 0, 12, 4);
  addDataTile(coreTiles['conversion_funnel'], 12, 12, 4);
  y += 4;

  // ---- FILTERED VIEW ----
  addSectionTile(markdownTiles.section_filtered);
  ['total_volume_filtered', 'business_value_filtered', 'avg_order_value_filtered', 'step_duration_percentiles'].forEach((key, i) => {
    addDataTile(coreTiles[key], i * 6, 6, 3);
  });
  y += 3;
  addDataTile(coreTiles['volume_trend_filtered'], 0, 12, 4);
  addDataTile(coreTiles['conversion_funnel_filtered'], 12, 12, 4);
  y += 4;

  // ---- DYNAMIC FIELD TILES ----
  const dynamicKeys = Object.keys(dynamicTiles);
  if (dynamicKeys.length > 0) {
    addSectionTile(markdownTiles.section_dynamic);
    let colIndex = 0;
    dynamicKeys.forEach((key) => {
      addDataTile(dynamicTiles[key], colIndex * 8, 8, 4);
      colIndex++;
      if (colIndex >= 3) { colIndex = 0; y += 4; }
    });
    if (colIndex > 0) y += 4;
  }

  // ---- PERFORMANCE & OPERATIONS ----
  addSectionTile(markdownTiles.section_performance);
  addDataTile(coreTiles['step_performance'], 0, 12, 5);
  addDataTile(coreTiles['sla_compliance'], 12, 12, 5);
  y += 5;
  addDataTile(coreTiles['error_rate_trend'], 0, 12, 4);
  addDataTile(coreTiles['error_analysis'], 12, 12, 4);
  y += 4;
  addDataTile(coreTiles['error_types'], 0, 12, 4);
  addDataTile(coreTiles['hourly_pattern'], 12, 12, 4);
  y += 4;

  // Extra performance tiles from AI
  const extraPerfTiles = (aiSelectedTiles || []).filter(k =>
    ['abandonment_analysis', 'step_funnel_dropoff', 'daily_comparison', 'peak_hours', 'top_errors'].includes(k) && coreTiles[k]
  );
  for (let i = 0; i < extraPerfTiles.length; i += 2) {
    const w = extraPerfTiles[i + 1] ? 12 : 24;
    addDataTile(coreTiles[extraPerfTiles[i]], 0, w, 4);
    if (extraPerfTiles[i + 1]) addDataTile(coreTiles[extraPerfTiles[i + 1]], 12, 12, 4);
    y += 4;
  }

  // ---- SERVICE & INFRASTRUCTURE ----
  addSectionTile(markdownTiles.section_service_infra);
  addDataTile(coreTiles['service_health_table'], 0, 24, 5);
  y += 5;
  addDataTile(coreTiles['service_response_time'], 0, 12, 5);
  addDataTile(coreTiles['http_error_breakdown'], 12, 12, 5);
  y += 5;
  addDataTile(coreTiles['exception_analysis_table'], 0, 24, 5);
  y += 5;
  addDataTile(coreTiles['service_throughput'], 0, 12, 4);
  addDataTile(coreTiles['failure_rate_timeseries'], 12, 12, 4);
  y += 4;
  addDataTile(coreTiles['process_cpu_usage'], 0, 12, 4);
  addDataTile(coreTiles['process_memory_usage'], 12, 12, 4);
  y += 4;
  addDataTile(coreTiles['davis_problems'], 0, 12, 5);
  addDataTile(coreTiles['log_errors'], 12, 12, 5);
  y += 5;
  addDataTile(coreTiles['trace_links_panel'], 0, 24, 4);
  y += 4;

  // Footer
  addSectionTile(markdownTiles.footer, 1);

  console.log(`[AI Dashboard] ✅ Layout complete: ${tileIndex} tiles, dynamic: ${dynamicKeys.length}, height: ${y}`);
  return dashboardJson;
}

// ============================================================================
// FALLBACK DASHBOARD (no Ollama)
// ============================================================================

function generateDashboardStructure(journeyData) {
  const { company, industry, journeyType, steps } = journeyData;
  const dynatraceUrl = process.env.DT_ENVIRONMENT_URL || process.env.DYNATRACE_URL || 'https://your-environment.apps.dynatrace.com';
  const detected = detectPayloadFields(journeyData);
  const coreTiles = generateCoreTileTemplates(company, journeyType, steps, dynatraceUrl);
  const dynamicTiles = generateDynamicFieldTiles(detected, company, journeyType);
  const markdownTiles = generateMarkdownTiles(company, journeyType, steps, detected);
  const variables = generateVariables(company);
  return buildDashboardLayout(coreTiles, dynamicTiles, markdownTiles, variables, company, journeyType, industry, [], detected);
}

// ============================================================================
// AI-POWERED DASHBOARD GENERATION
// ============================================================================

async function generateDashboardWithAI(journeyData, skills) {
  const ollamaAvailable = await checkOllamaAvailable();
  if (!ollamaAvailable) {
    throw new Error(`Ollama not available at ${OLLAMA_ENDPOINT} or model ${OLLAMA_MODEL} not installed`);
  }

  const { company, industry, journeyType, steps } = journeyData;
  const dynatraceUrl = process.env.DT_ENVIRONMENT_URL || process.env.DYNATRACE_URL || 'https://your-environment.apps.dynatrace.com';

  // STEP 1: Detect all fields
  const detected = detectPayloadFields(journeyData);
  const fieldPromptText = formatFieldsForPrompt(detected);
  const serviceNames = [...new Set((steps || []).filter(s => s.serviceName).map(s => s.serviceName))];

  console.log('[AI Dashboard] 🔍 Field detection:');
  console.log(`  Strings: ${detected.stringFields.map(f => f.key).join(', ') || 'none'}`);
  console.log(`  Numbers: ${detected.numericFields.map(f => f.key).join(', ') || 'none'}`);
  console.log(`  Booleans: ${detected.booleanFields.map(f => f.key).join(', ') || 'none'}`);
  console.log(`  Services: ${serviceNames.join(', ') || 'none'}`);

  // STEP 2: Generate tile templates
  const coreTiles = generateCoreTileTemplates(company, journeyType, steps, dynatraceUrl);
  const dynamicTiles = generateDynamicFieldTiles(detected, company, journeyType);
  const dynamicKeys = Object.keys(dynamicTiles);

  // STEP 3: Build LLM prompt
  const stepsText = (steps || []).map(s => `${s.name || s.stepName}${s.category ? ` [${s.category}]` : ''}`).join(', ');

  // Keep prompt concise for fast LLM response
  const dataSignals = [];
  if (detected.hasRevenue) dataSignals.push('revenue');
  if (detected.hasLoyalty) dataSignals.push('loyalty');
  if (detected.hasLTV) dataSignals.push('LTV');
  if (detected.hasConversion) dataSignals.push('conversion');
  if (detected.hasChannel) dataSignals.push('channels');

  const prompt = `Select 6-8 tiles for a ${industry} ${journeyType} dashboard. Steps: ${stepsText}. Data: ${dataSignals.join(', ') || 'standard'}.
Tiles: step_performance, response_time, error_analysis, error_types, top_errors, hourly_pattern, step_funnel_dropoff, abandonment_analysis, daily_comparison, sla_compliance, peak_hours, error_rate_trend, completion_time
Respond with ONLY this JSON, no other text: {"tiles":["name1","name2"]}`;  

  try {
    console.log('[AI Dashboard] 🤖 Calling Ollama API...');
    console.log(`[AI Dashboard] Model: ${OLLAMA_MODEL}, Prompt: ${prompt.length} chars`);

    const startTime = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); console.error('[AI Dashboard] ⏱️ Timeout after 90s'); }, 90000);

    try {
      const response = await fetch(`${OLLAMA_ENDPOINT}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: prompt,
          stream: false,
          options: { temperature: 0.3, num_predict: 256, num_ctx: 2048 }
        })
      });

      clearTimeout(timeout);
      if (!response.ok) throw new Error(`Ollama API returned ${response.status}`);

      const result = await response.json();
      const responseText = result.response;
      const duration = performance.now() - startTime;

      console.log(`[AI Dashboard] ✅ Response in ${Math.round(duration)}ms, ${responseText.length} chars`);
      console.log(`[AI Dashboard] Tokens - Prompt: ${result.prompt_eval_count || 0}, Completion: ${result.eval_count || 0}`);
      console.log(`[AI Dashboard] Raw: ${responseText.substring(0, 300)}`);

      let aiData;
      try {
        // Try direct parse first, then extract JSON from surrounding text
        try { aiData = JSON.parse(responseText); } catch (e) {
          const jsonMatch = responseText.match(/\{[\s\S]*"tiles"[\s\S]*\}/);
          if (jsonMatch) { aiData = JSON.parse(jsonMatch[0]); }
          else { throw e; }
        }
      } catch (e) {
        console.error('[AI Dashboard] JSON parse error:', responseText.substring(0, 500));
        throw new Error('AI returned invalid JSON');
      }

      const aiSelectedTiles = Array.isArray(aiData.tiles) ? aiData.tiles.filter(key => coreTiles[key]) : [];
      console.log(`[AI Dashboard] 🤖 AI selected: ${aiSelectedTiles.join(', ')}`);
      if (aiData.reasoning) console.log(`[AI Dashboard] 💡 Reasoning: ${aiData.reasoning}`);

      // STEP 4: Build dashboard
      const markdownTiles = generateMarkdownTiles(company, journeyType, steps, detected);
      const variables = generateVariables(company);
      const dashboardJson = buildDashboardLayout(coreTiles, dynamicTiles, markdownTiles, variables, company, journeyType, industry, aiSelectedTiles, detected);

      // Log GenAI span
      await logGenAISpan(createGenAISpan(prompt, responseText, OLLAMA_MODEL, result.prompt_eval_count || 0, result.eval_count || 0, duration));
      console.log('[AI Dashboard] 📊 GenAI span logged');

      return dashboardJson;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('AI generation timed out - falling back to rule-based');
    console.error('[AI Dashboard] AI error:', error.message);
    throw error;
  }
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

router.post('/generate', async (req, res) => {
  try {
    const { journeyData, useAI = true } = req.body;
    if (!journeyData) return res.status(400).json({ error: 'Journey data required' });

    console.log('[AI Dashboard] Generating dashboard for:', journeyData.company, journeyData.journeyType);

    const afKeys = Object.keys(journeyData.additionalFields || {});
    const cpKeys = Object.keys(journeyData.customerProfile || {});
    const tmKeys = Object.keys(journeyData.traceMetadata || {});
    console.log(`[AI Dashboard] 📦 Payload: ${afKeys.length} additionalFields, ${cpKeys.length} customerProfile, ${tmKeys.length} traceMetadata`);
    if (afKeys.length > 0) console.log(`[AI Dashboard] 📦 additionalFields: ${afKeys.join(', ')}`);
    if (cpKeys.length > 0) console.log(`[AI Dashboard] 📦 customerProfile: ${cpKeys.join(', ')}`);

    const skills = await loadDynatraceSkills();
    let dashboard;
    let generationMethod = 'rule-based';

    if (useAI) {
      const ollamaAvailable = await checkOllamaAvailable();
      if (ollamaAvailable) {
        try {
          console.log(`[AI Dashboard] 🤖 Using Ollama AI (${OLLAMA_MODEL})...`);
          dashboard = await generateDashboardWithAI(journeyData, skills);
          generationMethod = 'ollama-ai';
        } catch (aiError) {
          console.warn('[AI Dashboard] ⚠️  AI failed, falling back:', aiError.message);
          dashboard = generateDashboardStructure(journeyData);
        }
      } else {
        console.log(`[AI Dashboard] ℹ️  Ollama not available, using rule-based`);
        dashboard = generateDashboardStructure(journeyData);
      }
    } else {
      dashboard = generateDashboardStructure(journeyData);
    }

    const tileCount = Object.keys(dashboard.tiles).length;
    const detected = detectPayloadFields(journeyData);
    const dynamicCount = Object.keys(generateDynamicFieldTiles(detected, journeyData.company, journeyData.journeyType)).length;

    const dashboardDocument = {
      name: `${journeyData.company} - ${journeyData.journeyType} Journey Dashboard`,
      type: 'dashboard',
      version: 1,
      content: dashboard,
      metadata: {
        generatedBy: 'ai-dashboard-generator',
        generationMethod,
        model: OLLAMA_MODEL,
        company: journeyData.company,
        industry: journeyData.industry,
        journeyType: journeyData.journeyType,
        totalTiles: tileCount,
        dynamicFieldTiles: dynamicCount,
        detectedFields: {
          additionalFields: afKeys,
          customerProfile: cpKeys,
          flags: {
            revenue: detected.hasRevenue, loyalty: detected.hasLoyalty, ltv: detected.hasLTV,
            segments: detected.hasSegments, devices: detected.hasDeviceType, channel: detected.hasChannel
          }
        },
        generatedAt: new Date().toISOString()
      }
    };

    console.log(`[AI Dashboard] ✅ Done: ${tileCount} tiles (${dynamicCount} dynamic) via ${generationMethod}`);

    res.json({
      success: true,
      dashboard: dashboardDocument,
      generationMethod,
      message: `Dashboard generated for ${journeyData.company} - ${journeyData.journeyType} (${tileCount} tiles, ${dynamicCount} from detected fields)`
    });
  } catch (error) {
    console.error('[AI Dashboard] Generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/health', async (req, res) => {
  try {
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/tags`);
    if (response.ok) {
      const data = await response.json();
      const hasModel = data.models?.some(m => m.name.includes(OLLAMA_MODEL.split(':')[0]));
      res.json({
        success: true, ollamaAvailable: true, endpoint: OLLAMA_ENDPOINT,
        configuredModel: OLLAMA_MODEL, modelInstalled: hasModel,
        installedModels: data.models?.map(m => m.name) || [],
        ready: hasModel,
        message: hasModel ? `Ollama ready with ${OLLAMA_MODEL}` : `Model ${OLLAMA_MODEL} not installed. Run: ollama pull ${OLLAMA_MODEL}`
      });
    } else {
      res.json({ success: false, ollamaAvailable: false, endpoint: OLLAMA_ENDPOINT, message: 'Ollama not responding' });
    }
  } catch (error) {
    res.json({ success: false, ollamaAvailable: false, endpoint: OLLAMA_ENDPOINT, error: error.message, message: `Cannot reach Ollama at ${OLLAMA_ENDPOINT}` });
  }
});

router.get('/skills', async (req, res) => {
  try {
    const skills = await loadDynatraceSkills();
    res.json({ success: true, skills: Object.keys(skills), loaded: Object.values(skills).filter(s => s !== null).length });
  } catch (error) {
    console.error('[AI Dashboard] Skills error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/preview', async (req, res) => {
  try {
    const { journeyData } = req.body;
    if (!journeyData) return res.status(400).json({ error: 'Journey data required' });

    const detected = detectPayloadFields(journeyData);
    const dynamicTiles = generateDynamicFieldTiles(detected, journeyData.company, journeyData.journeyType);

    res.json({
      success: true,
      preview: {
        name: `${journeyData.company} - ${journeyData.journeyType} Dashboard`,
        company: journeyData.company, industry: journeyData.industry, journeyType: journeyData.journeyType,
        detectedFields: {
          stringFields: detected.stringFields.map(f => f.key),
          numericFields: detected.numericFields.map(f => f.key),
          booleanFields: detected.booleanFields.map(f => f.key),
          flags: { revenue: detected.hasRevenue, loyalty: detected.hasLoyalty, ltv: detected.hasLTV, segments: detected.hasSegments, devices: detected.hasDeviceType, channel: detected.hasChannel, services: detected.hasServices }
        },
        dynamicTilesGenerated: Object.keys(dynamicTiles),
        dynamicTileCount: Object.keys(dynamicTiles).length
      }
    });
  } catch (error) {
    console.error('[AI Dashboard] Preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
