/**
 * Dynatrace Tools — pull observability data from Dynatrace
 * via the server's proxy endpoints (which use UI-configured credentials).
 * Each function maps to a tool the Fix‑It Agent can call via LLM function calling.
 */

import { config } from '../../utils/config.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('fixit');

// ─── Types ────────────────────────────────────────────────────

export interface DTProblem {
  problemId: string;
  displayId: string;
  title: string;
  status: string;
  severityLevel: string;
  impactLevel: string;
  startTime: number;
  endTime: number;
  affectedEntities: { entityId: string; name: string }[];
  rootCauseEntity?: { entityId: string; name: string };
}

export interface DTLogEntry {
  timestamp: string;
  content: string;
  status: string;
  source: string;
}

export interface DTMetricPoint {
  timestamp: number;
  value: number;
}

export interface DTMetricSeries {
  metricId: string;
  dimensions: Record<string, string>;
  dataPoints: DTMetricPoint[];
}

export interface DTEntity {
  entityId: string;
  displayName: string;
  type: string;
  properties: Record<string, unknown>;
  fromRelationships?: Record<string, { id: string; type: string }[]>;
  toRelationships?: Record<string, { id: string; type: string }[]>;
}

// ─── Helpers ──────────────────────────────────────────────────

const APP_BASE = `http://localhost:${process.env.PORT || 8080}`;

/**
 * Call the server's DT proxy endpoint (which uses the UI-configured credentials).
 * Falls back to direct DT API call if proxy returns unconfigured and env vars are set.
 */
async function dtProxyFetch<T>(proxyPath: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(proxyPath, APP_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DT Proxy ${res.status} ${proxyPath}: ${text.substring(0, 300)}`);
  }

  return (await res.json()) as T;
}

// ─── Tools ────────────────────────────────────────────────────

export async function getProblems(timeframe = '2h'): Promise<DTProblem[]> {
  log.info('Fetching Dynatrace problems via proxy', { timeframe });
  try {
    const data = await dtProxyFetch<{ ok: boolean; problems: DTProblem[]; error?: string }>(
      '/api/dt-proxy/problems', { from: `now-${timeframe}` }
    );
    if (!data.ok) {
      log.warn('DT proxy problems returned not-ok', { error: data.error });
      return [];
    }
    log.info(`Found ${data.problems.length} problems`);
    return data.problems;
  } catch (err) {
    log.error('Failed to fetch problems', { error: String(err) });
    return [];
  }
}

export async function getProblemDetails(problemId: string): Promise<DTProblem | null> {
  log.info('Fetching problem details via proxy', { problemId });
  try {
    const data = await dtProxyFetch<{ ok: boolean; problem: DTProblem; error?: string }>(
      `/api/dt-proxy/problems/${problemId}`
    );
    if (!data.ok) return null;
    return data.problem;
  } catch (err) {
    log.error('Failed to fetch problem details', { error: String(err) });
    return null;
  }
}

export async function getLogs(
  query = 'status="ERROR"',
  timeframe = '1h',
  limit = 50
): Promise<DTLogEntry[]> {
  log.info('Fetching Dynatrace logs via proxy', { query, timeframe });
  try {
    const data = await dtProxyFetch<{ ok: boolean; results: DTLogEntry[]; error?: string }>(
      '/api/dt-proxy/logs', { query, from: `now-${timeframe}`, limit: String(limit) }
    );
    if (!data.ok) return [];
    log.info(`Found ${data.results.length} log entries`);
    return data.results;
  } catch (err) {
    log.error('Failed to fetch logs', { error: String(err) });
    return [];
  }
}

export async function getMetrics(
  metricSelector: string,
  entitySelector?: string,
  timeframe = '30m'
): Promise<DTMetricSeries[]> {
  log.info('Fetching Dynatrace metrics via proxy', { metricSelector, timeframe });
  try {
    const params: Record<string, string> = {
      metricSelector,
      from: `now-${timeframe}`,
    };
    if (entitySelector) params.entitySelector = entitySelector;

    const data = await dtProxyFetch<{ ok: boolean; result: { data: DTMetricSeries[] }[]; error?: string }>(
      '/api/dt-proxy/metrics', params
    );
    if (!data.ok) return [];
    const series = data.result?.flatMap(r => r.data) ?? [];
    log.info(`Got ${series.length} metric series`);
    return series;
  } catch (err) {
    log.error('Failed to fetch metrics', { error: String(err) });
    return [];
  }
}

export async function getTopology(
  entitySelector: string,
  fields = 'properties,fromRelationships,toRelationships'
): Promise<DTEntity[]> {
  log.info('Fetching Dynatrace topology via proxy', { entitySelector });
  try {
    const data = await dtProxyFetch<{ ok: boolean; entities: DTEntity[]; error?: string }>(
      '/api/dt-proxy/entities', { entitySelector, fields }
    );
    if (!data.ok) return [];
    log.info(`Found ${data.entities.length} entities`);
    return data.entities;
  } catch (err) {
    log.error('Failed to fetch topology', { error: String(err) });
    return [];
  }
}

export async function getEntityById(entityId: string): Promise<DTEntity | null> {
  log.info('Fetching entity via proxy', { entityId });
  try {
    const data = await dtProxyFetch<{ ok: boolean; entities: DTEntity[]; error?: string }>(
      '/api/dt-proxy/entities', { entitySelector: `entityId("${entityId}")`, fields: 'properties,fromRelationships,toRelationships' }
    );
    if (!data.ok || !data.entities?.length) return null;
    return data.entities[0];
  } catch (err) {
    log.error('Failed to fetch entity', { error: String(err) });
    return null;
  }
}

export async function getEvents(timeframe = '2h', eventType?: string): Promise<unknown[]> {
  log.info('Fetching Dynatrace events via proxy', { timeframe, eventType });
  try {
    const params: Record<string, string> = { from: `now-${timeframe}` };
    if (eventType) params.eventType = eventType;

    const data = await dtProxyFetch<{ ok: boolean; events: unknown[]; error?: string }>(
      '/api/dt-proxy/events', params
    );
    if (!data.ok) return [];
    return data.events;
  } catch (err) {
    log.error('Failed to fetch events', { error: String(err) });
    return [];
  }
}

// ─── Tool Definitions for LLM Function Calling ───────────────

export const dynatraceToolDefs = [
  {
    type: 'function' as const,
    function: {
      name: 'getProblems',
      description: 'Get active Dynatrace problems. Returns array of problems with severity, impact, and affected entities.',
      parameters: {
        type: 'object',
        properties: {
          timeframe: { type: 'string', description: 'Lookback window, e.g. "2h", "30m", "1d"', default: '2h' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getProblemDetails',
      description: 'Get detailed information about a specific Dynatrace problem by its ID.',
      parameters: {
        type: 'object',
        properties: {
          problemId: { type: 'string', description: 'The Dynatrace problem ID (e.g. P-12345)' },
        },
        required: ['problemId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getLogs',
      description: 'Search Dynatrace logs. Default shows ERROR logs from the last hour.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'DQL log query filter', default: 'status="ERROR"' },
          timeframe: { type: 'string', description: 'Lookback window', default: '1h' },
          limit: { type: 'number', description: 'Max entries', default: 50 },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getMetrics',
      description: 'Query Dynatrace metrics (CPU, memory, request rate, error rate, response time, etc).',
      parameters: {
        type: 'object',
        properties: {
          metricSelector: { type: 'string', description: 'Metric selector, e.g. "builtin:service.response.time"' },
          entitySelector: { type: 'string', description: 'Optional entity filter, e.g. "type(SERVICE)"' },
          timeframe: { type: 'string', description: 'Lookback window', default: '30m' },
        },
        required: ['metricSelector'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getTopology',
      description: 'Get Dynatrace Smartscape topology — entities, properties, and relationships.',
      parameters: {
        type: 'object',
        properties: {
          entitySelector: { type: 'string', description: 'Entity selector, e.g. "type(SERVICE),tag(bizobs)"' },
        },
        required: ['entitySelector'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'getEvents',
      description: 'Get recent Dynatrace events (custom configuration, deployment, info events). Useful for seeing what the Gremlin agent injected.',
      parameters: {
        type: 'object',
        properties: {
          timeframe: { type: 'string', description: 'Lookback window, e.g. "2h", "30m"', default: '2h' },
          eventType: { type: 'string', description: 'Filter by event type, e.g. "CUSTOM_CONFIGURATION"' },
        },
      },
    },
  },
];

/** Execute a Dynatrace tool by name (used in agent loops) */
export async function executeDynatraceTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case 'getProblems':
      return JSON.stringify(await getProblems(args.timeframe as string));
    case 'getProblemDetails':
      return JSON.stringify(await getProblemDetails(args.problemId as string));
    case 'getLogs':
      return JSON.stringify(await getLogs(args.query as string, args.timeframe as string, args.limit as number));
    case 'getMetrics':
      return JSON.stringify(await getMetrics(args.metricSelector as string, args.entitySelector as string, args.timeframe as string));
    case 'getTopology':
      return JSON.stringify(await getTopology(args.entitySelector as string));
    case 'getEvents':
      return JSON.stringify(await getEvents(args.timeframe as string, args.eventType as string));
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
