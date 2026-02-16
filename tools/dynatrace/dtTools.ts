/**
 * Dynatrace MCP Tools — pull observability data from Dynatrace.
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

async function dtFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const { environmentUrl, apiToken } = config.dynatrace;
  if (!environmentUrl || !apiToken) {
    throw new Error('Dynatrace env vars DT_ENVIRONMENT_URL and DT_API_TOKEN are required');
  }

  const url = new URL(path, environmentUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Api-Token ${apiToken}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dynatrace API ${res.status} ${path}: ${text.substring(0, 300)}`);
  }

  return (await res.json()) as T;
}

// ─── Tools ────────────────────────────────────────────────────

export async function getProblems(timeframe = '2h'): Promise<DTProblem[]> {
  log.info('Fetching Dynatrace problems', { timeframe });
  try {
    const data = await dtFetch<{ problems: DTProblem[] }>('/api/v2/problems', {
      from: `now-${timeframe}`,
      pageSize: '50',
    });
    log.info(`Found ${data.problems.length} problems`);
    return data.problems;
  } catch (err) {
    log.error('Failed to fetch problems', { error: String(err) });
    return [];
  }
}

export async function getProblemDetails(problemId: string): Promise<DTProblem | null> {
  log.info('Fetching problem details', { problemId });
  try {
    return await dtFetch<DTProblem>(`/api/v2/problems/${problemId}`);
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
  log.info('Fetching Dynatrace logs', { query, timeframe });
  try {
    const data = await dtFetch<{ results: DTLogEntry[] }>('/api/v2/logs/search', {
      query,
      from: `now-${timeframe}`,
      limit: String(limit),
      sort: '-timestamp',
    });
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
  log.info('Fetching Dynatrace metrics', { metricSelector, timeframe });
  try {
    const params: Record<string, string> = {
      metricSelector,
      from: `now-${timeframe}`,
      resolution: '1m',
    };
    if (entitySelector) params.entitySelector = entitySelector;

    const data = await dtFetch<{ result: { data: DTMetricSeries[] }[] }>('/api/v2/metrics/query', params);
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
  log.info('Fetching Dynatrace topology', { entitySelector });
  try {
    const data = await dtFetch<{ entities: DTEntity[] }>('/api/v2/entities', {
      entitySelector,
      fields,
      pageSize: '50',
    });
    log.info(`Found ${data.entities.length} entities`);
    return data.entities;
  } catch (err) {
    log.error('Failed to fetch topology', { error: String(err) });
    return [];
  }
}

export async function getEntityById(entityId: string): Promise<DTEntity | null> {
  log.info('Fetching entity', { entityId });
  try {
    return await dtFetch<DTEntity>(`/api/v2/entities/${entityId}`, {
      fields: 'properties,fromRelationships,toRelationships',
    });
  } catch (err) {
    log.error('Failed to fetch entity', { error: String(err) });
    return null;
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
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
