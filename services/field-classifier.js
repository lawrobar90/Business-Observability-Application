/**
 * field-classifier.js
 * 
 * Reads a journey config JSON payload and classifies every additionalFields key
 * into a domain (revenue, duration, error, categorical, score, count, customer, meta).
 * 
 * Returns classified fields with their template slot mappings and DQL aggregation hints,
 * which the template resolver uses to fill {{PLACEHOLDER}} tokens and generate dynamic tiles.
 * 
 * Classification order:
 *   1. Exact match in knownFields (field-classifier.json)
 *   2. Regex heuristic match (unknownFieldRules in field-classifier.json)
 *   3. Value-type inference (inspect actual values in the config)
 *   4. Default to "categorical" / "groupBy"
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLASSIFIER_PATH = path.join(__dirname, '..', 'templates', 'dql', 'field-classifier.json');

let _classifierConfig = null;

function loadClassifier() {
  if (_classifierConfig) return _classifierConfig;
  _classifierConfig = JSON.parse(fs.readFileSync(CLASSIFIER_PATH, 'utf8'));
  return _classifierConfig;
}


// ── Extract fields from journey config ───────────────────────────────────────

/**
 * Extract all unique additionalFields keys from a journey config.
 * Journey configs have steps[], each step may have additionalFields as:
 *   - An object with field definitions
 *   - An array of objects with field definitions
 *   - Nested inside substeps
 * 
 * Also checks top-level additionalFields and customerProfile.
 * 
 * @param {Object} journeyConfig - The journey config JSON payload
 * @returns {Map<string, Object>} - Map of fieldName → { sampleValue, sourceStep }
 */
function extractFields(journeyConfig) {
  const fields = new Map();

  // Helper to extract from an object of fields
  function extractFromObject(obj, sourceLabel) {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (!fields.has(key)) {
        fields.set(key, { sampleValue: value, sourceStep: sourceLabel });
      }
    }
  }

  // Check top-level additionalFields
  if (journeyConfig.additionalFields) {
    extractFromObject(journeyConfig.additionalFields, '_top');
  }

  // Check customerProfile / customerProfiles
  const cp = journeyConfig.customerProfile || journeyConfig.customerProfiles;
  if (cp) {
    if (Array.isArray(cp)) {
      cp.forEach((profile, i) => extractFromObject(profile, `_profile_${i}`));
    } else {
      extractFromObject(cp, '_profile');
    }
  }

  // Walk steps
  const steps = journeyConfig.steps || journeyConfig.journeySteps || [];
  for (const step of steps) {
    const stepName = step.stepName || step.name || 'unknown';

    // Direct additionalFields on step
    if (step.additionalFields) {
      if (Array.isArray(step.additionalFields)) {
        step.additionalFields.forEach(af => extractFromObject(af, stepName));
      } else {
        extractFromObject(step.additionalFields, stepName);
      }
    }

    // Check substeps
    const substeps = step.substeps || step.subSteps || [];
    for (const sub of substeps) {
      if (sub.additionalFields) {
        if (Array.isArray(sub.additionalFields)) {
          sub.additionalFields.forEach(af => extractFromObject(af, `${stepName}/${sub.stepName || sub.name || 'sub'}`));
        } else {
          extractFromObject(sub.additionalFields, `${stepName}/${sub.stepName || sub.name || 'sub'}`);
        }
      }
    }
  }

  return fields;
}


// ── Classify a single field ──────────────────────────────────────────────────

/**
 * Classify a single field name into a domain with aggregation hint.
 * @param {string} fieldName
 * @param {*} sampleValue - Optional sample value for type inference
 * @returns {Object} - { domain, type, aggregate, templateSlot, label }
 */
function classifyField(fieldName, sampleValue) {
  const config = loadClassifier();

  // 1. Exact match in knownFields
  if (config.knownFields[fieldName]) {
    const known = config.knownFields[fieldName];
    return {
      name: fieldName,
      domain: known.domain,
      type: known.type,
      aggregate: known.aggregate,
      templateSlot: known.templateSlot,
      label: known.label,
      source: 'known'
    };
  }

  // 2. Regex heuristic match
  const lowerName = fieldName.toLowerCase();
  for (const rule of config.unknownFieldRules.heuristics) {
    if (new RegExp(rule.pattern, 'i').test(lowerName)) {
      return {
        name: fieldName,
        domain: rule.domain,
        type: rule.type,
        aggregate: rule.aggregate,
        templateSlot: null,
        label: humanize(fieldName),
        source: 'heuristic'
      };
    }
  }

  // 3. Value-type inference
  if (sampleValue !== undefined && sampleValue !== null) {
    if (typeof sampleValue === 'boolean') {
      return {
        name: fieldName,
        domain: 'error',
        type: 'boolean',
        aggregate: 'countIf',
        templateSlot: null,
        label: humanize(fieldName),
        source: 'inferred'
      };
    }
    if (typeof sampleValue === 'number') {
      return {
        name: fieldName,
        domain: 'score',
        type: 'number',
        aggregate: 'avg',
        templateSlot: null,
        label: humanize(fieldName),
        source: 'inferred'
      };
    }
    if (typeof sampleValue === 'string') {
      return {
        name: fieldName,
        domain: 'categorical',
        type: 'string',
        aggregate: 'groupBy',
        templateSlot: null,
        label: humanize(fieldName),
        source: 'inferred'
      };
    }
    // Arrays and objects — skip (not suitable for DQL tiles)
    if (Array.isArray(sampleValue) || typeof sampleValue === 'object') {
      return {
        name: fieldName,
        domain: 'meta',
        type: 'object',
        aggregate: null,
        templateSlot: null,
        label: humanize(fieldName),
        source: 'inferred',
        skip: true
      };
    }
  }

  // 4. Default fallback
  return {
    name: fieldName,
    domain: 'categorical',
    type: 'string',
    aggregate: 'groupBy',
    templateSlot: null,
    label: humanize(fieldName),
    source: 'default'
  };
}


// ── Classify all fields from a journey config ────────────────────────────────

/**
 * Classify all additionalFields from a journey config.
 * Returns both the slot assignments (for core template tokens) and
 * the full classified field list (for dynamic tile generation).
 * 
 * @param {Object} journeyConfig - The journey config JSON payload
 * @returns {Object} - { slots, fields, dynamicFields, stats }
 */
function classifyJourneyFields(journeyConfig) {
  const config = loadClassifier();
  const extractedFields = extractFields(journeyConfig);
  const classified = [];

  for (const [fieldName, info] of extractedFields) {
    const result = classifyField(fieldName, info.sampleValue);
    result.sourceStep = info.sourceStep;
    classified.push(result);
  }

  // Sort by domain priority
  const domainOrder = config.domainPriority || [];
  classified.sort((a, b) => {
    const ai = domainOrder.indexOf(a.domain);
    const bi = domainOrder.indexOf(b.domain);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  // Resolve template slots — pick the FIRST field that matches each slot
  const slots = {};
  const slotFallbacks = config.templateSlotFallbacks;

  for (const field of classified) {
    if (field.templateSlot && !slots[field.templateSlot]) {
      slots[field.templateSlot] = `additionalfields.${field.name}`;
    }
  }

  // Apply fallbacks for any unresolved slots
  for (const [slot, fallback] of Object.entries(slotFallbacks)) {
    if (!slots[slot]) {
      slots[slot] = fallback;
    }
  }

  // Split into core (has templateSlot) vs dynamic (no templateSlot, not skip)
  const coreFields = classified.filter(f => f.templateSlot);
  const dynamicFields = classified.filter(f => !f.templateSlot && !f.skip);
  const skippedFields = classified.filter(f => f.skip);

  // Stats
  const domainCounts = {};
  for (const f of classified) {
    domainCounts[f.domain] = (domainCounts[f.domain] || 0) + 1;
  }

  return {
    slots,
    fields: classified,
    coreFields,
    dynamicFields,
    skippedFields,
    stats: {
      totalFields: classified.length,
      coreFieldsCount: coreFields.length,
      dynamicFieldsCount: dynamicFields.length,
      skippedFieldsCount: skippedFields.length,
      domainCounts,
      sources: {
        known: classified.filter(f => f.source === 'known').length,
        heuristic: classified.filter(f => f.source === 'heuristic').length,
        inferred: classified.filter(f => f.source === 'inferred').length,
        default: classified.filter(f => f.source === 'default').length
      }
    }
  };
}


// ── Select dynamic tile templates for classified fields ──────────────────────

/**
 * For each dynamic field, select the best tile template(s) from tiles-dynamic.json.
 * Returns an array of { field, templateKey } pairs ready for buildDynamicTile().
 * 
 * @param {Object[]} dynamicFields - Array of classified field objects
 * @param {Object} options - { maxTilesPerField: 2, maxTotalDynamic: 12 }
 * @returns {Object[]} - Array of { field, templateKey }
 */
function selectDynamicTemplates(dynamicFields, options = {}) {
  const maxPerField = options.maxTilesPerField || 2;
  const maxTotal = options.maxTotalDynamic || 12;
  const result = [];

  for (const field of dynamicFields) {
    if (result.length >= maxTotal) break;

    const templates = getDynamicTemplatesForField(field);
    const selected = templates.slice(0, maxPerField);

    for (const templateKey of selected) {
      if (result.length >= maxTotal) break;
      result.push({ field, templateKey });
    }
  }

  return result;
}

/**
 * Get matching dynamic template keys for a classified field.
 */
function getDynamicTemplatesForField(field) {
  switch (field.type) {
    case 'number':
      if (field.aggregate === 'sum') {
        return ['numeric_single_value', 'numeric_by_step', 'numeric_over_time'];
      }
      return ['numeric_single_value', 'numeric_over_time'];

    case 'boolean':
      return ['boolean_rate', 'boolean_trend'];

    case 'string':
      if (field.aggregate === 'countDistinct') {
        return ['count_distinct', 'categorical_distribution'];
      }
      return ['categorical_distribution', 'categorical_by_step'];

    default:
      return ['numeric_single_value'];
  }
}


// ── Utility ──────────────────────────────────────────────────────────────────

/**
 * Convert camelCase field name to human-readable label.
 * e.g. "customerLifetimeValue" → "Customer Lifetime Value"
 */
function humanize(fieldName) {
  return fieldName
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}


// ── Extract journey metadata ─────────────────────────────────────────────────

/**
 * Extract companyName, industryType/journeyType, and step names from a journey config.
 * Handles the various config formats used by the BizObs Generator.
 * 
 * @param {Object} journeyConfig
 * @returns {Object} - { companyName, journeyType, stepNames }
 */
function extractJourneyMeta(journeyConfig) {
  const companyName = journeyConfig.companyName || journeyConfig.company || 'Unknown';
  const journeyType = journeyConfig.industryType || journeyConfig.journeyType || journeyConfig.industry || 'Unknown';

  const steps = journeyConfig.steps || journeyConfig.journeySteps || [];
  const stepNames = steps.map(s => s.stepName || s.name || 'Unknown');

  return { companyName, journeyType, stepNames };
}


// ── Exports ──────────────────────────────────────────────────────────────────

export {
  loadClassifier,
  extractFields,
  classifyField,
  classifyJourneyFields,
  selectDynamicTemplates,
  getDynamicTemplatesForField,
  extractJourneyMeta,
  humanize
};
