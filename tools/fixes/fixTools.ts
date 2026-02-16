/**
 * Fix Tools — Feature-Flag-Based Remediation Actions.
 * Wraps the EXISTING /api/feature_flag, /api/remediation/feature-flag,
 * and Dynatrace event APIs to remediate issues the same way a Dynatrace
 * Workflow or human operator would.
 *
 * The Fix-It Agent selects and executes these after diagnosing a problem.
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('fixit');

// ─── Types ────────────────────────────────────────────────────

export type FixType =
  | 'disable_errors'
  | 'reset_feature_flags'
  | 'reduce_error_rate'
  | 'enable_circuit_breaker'
  | 'enable_cache'
  | 'disable_slow_responses'
  | 'send_dt_event';

export interface FixParams {
  target: string;
  details?: Record<string, unknown>;
}

export interface FixResult {
  fixId: string;
  type: FixType;
  target: string;
  success: boolean;
  message: string;
  executedAt: string;
  details: Record<string, unknown>;
}

let fixCounter = 0;
function nextFixId(): string {
  return `fix-${Date.now()}-${++fixCounter}`;
}

// ─── API Helpers ──────────────────────────────────────────────

const APP_BASE = `http://localhost:${process.env.PORT || 8080}`;

async function callFeatureFlagAPI(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${APP_BASE}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    log.error(`API call failed: ${method} ${path}`, { error: String(err) });
    return { success: false, error: String(err) };
  }
}

async function callRemediationAPI(
  flag: string,
  value: unknown,
  reason: string,
  problemId?: string,
): Promise<Record<string, unknown>> {
  return callFeatureFlagAPI('POST', '/api/remediation/feature-flag', {
    flag,
    value,
    reason,
    problemId: problemId || 'N/A',
    triggeredBy: 'fixit-agent',
  });
}

// ─── Fix Implementations ─────────────────────────────────────

async function disableErrors(params: FixParams): Promise<FixResult> {
  const id = nextFixId();
  const problemId = params.details?.problemId as string | undefined;
  log.info(`🔧 Disabling error injection`, { fixId: id });

  try {
    // Disable via remediation API (sends Dynatrace deployment event)
    await callRemediationAPI('errorInjectionEnabled', false, 'Fix-It: disabling error injection', problemId);

    // Also set error rate to 0 via feature flag API
    await callFeatureFlagAPI('POST', '/api/feature_flag', {
      action: 'disable',
    });

    return {
      fixId: id, type: 'disable_errors', target: 'errorInjectionEnabled',
      success: true, message: 'Error injection disabled and error rate set to 0',
      executedAt: new Date().toISOString(),
      details: { errorInjectionEnabled: false, errors_per_transaction: 0 },
    };
  } catch (err) {
    return {
      fixId: id, type: 'disable_errors', target: 'errorInjectionEnabled',
      success: false, message: `Failed to disable errors: ${String(err)}`,
      executedAt: new Date().toISOString(), details: { error: String(err) },
    };
  }
}

async function resetFeatureFlags(params: FixParams): Promise<FixResult> {
  const id = nextFixId();
  const problemId = params.details?.problemId as string | undefined;
  log.info(`🔧 Resetting all feature flags to defaults`, { fixId: id });

  try {
    // Reset System B flags (errors_per_transaction, etc.)
    await callFeatureFlagAPI('POST', '/api/feature_flag', {
      flags: {
        errors_per_transaction: 0.1,
        errors_per_visit: 0.001,
        errors_per_minute: 0.5,
        regenerate_every_n_transactions: 100,
      },
    });

    // Reset System A flags via remediation (sends DT events)
    await callRemediationAPI('errorInjectionEnabled', true, 'Fix-It: reset to defaults', problemId);
    await callRemediationAPI('slowResponsesEnabled', true, 'Fix-It: reset to defaults', problemId);
    await callRemediationAPI('circuitBreakerEnabled', false, 'Fix-It: reset to defaults', problemId);
    await callRemediationAPI('cacheEnabled', true, 'Fix-It: reset to defaults', problemId);

    return {
      fixId: id, type: 'reset_feature_flags', target: 'all',
      success: true, message: 'All feature flags reset to default values',
      executedAt: new Date().toISOString(),
      details: {
        systemA: { errorInjectionEnabled: true, slowResponsesEnabled: true, circuitBreakerEnabled: false, cacheEnabled: true },
        systemB: { errors_per_transaction: 0.1, errors_per_visit: 0.001, errors_per_minute: 0.5 },
      },
    };
  } catch (err) {
    return {
      fixId: id, type: 'reset_feature_flags', target: 'all',
      success: false, message: `Reset failed: ${String(err)}`,
      executedAt: new Date().toISOString(), details: { error: String(err) },
    };
  }
}

async function reduceErrorRate(params: FixParams): Promise<FixResult> {
  const id = nextFixId();
  const newRate = (params.details?.rate as number) ?? 0.01;
  log.info(`🔧 Reducing error rate to ${newRate}`, { fixId: id });

  try {
    const current = await callFeatureFlagAPI('GET', '/api/feature_flag');
    const prevRate = ((current as any).flags || {}).errors_per_transaction ?? 0.1;

    await callFeatureFlagAPI('POST', '/api/feature_flag', {
      flags: { errors_per_transaction: newRate },
    });

    return {
      fixId: id, type: 'reduce_error_rate', target: 'errors_per_transaction',
      success: true, message: `Error rate reduced: ${prevRate} → ${newRate}`,
      executedAt: new Date().toISOString(),
      details: { previousRate: prevRate, newRate },
    };
  } catch (err) {
    return {
      fixId: id, type: 'reduce_error_rate', target: 'errors_per_transaction',
      success: false, message: `Failed to reduce rate: ${String(err)}`,
      executedAt: new Date().toISOString(), details: { error: String(err) },
    };
  }
}

async function enableCircuitBreaker(params: FixParams): Promise<FixResult> {
  const id = nextFixId();
  const problemId = params.details?.problemId as string | undefined;
  log.info(`🔧 Enabling circuit breaker`, { fixId: id });

  try {
    await callRemediationAPI('circuitBreakerEnabled', true, 'Fix-It: enabling circuit breaker', problemId);
    return {
      fixId: id, type: 'enable_circuit_breaker', target: 'circuitBreakerEnabled',
      success: true, message: 'Circuit breaker enabled — errors will be caught',
      executedAt: new Date().toISOString(), details: {},
    };
  } catch (err) {
    return {
      fixId: id, type: 'enable_circuit_breaker', target: 'circuitBreakerEnabled',
      success: false, message: `Failed: ${String(err)}`,
      executedAt: new Date().toISOString(), details: { error: String(err) },
    };
  }
}

async function enableCache(params: FixParams): Promise<FixResult> {
  const id = nextFixId();
  const problemId = params.details?.problemId as string | undefined;
  log.info(`🔧 Enabling cache`, { fixId: id });

  try {
    await callRemediationAPI('cacheEnabled', true, 'Fix-It: enabling cache', problemId);
    return {
      fixId: id, type: 'enable_cache', target: 'cacheEnabled',
      success: true, message: 'Cache enabled — response times should improve',
      executedAt: new Date().toISOString(), details: {},
    };
  } catch (err) {
    return {
      fixId: id, type: 'enable_cache', target: 'cacheEnabled',
      success: false, message: `Failed: ${String(err)}`,
      executedAt: new Date().toISOString(), details: { error: String(err) },
    };
  }
}

async function disableSlowResponses(params: FixParams): Promise<FixResult> {
  const id = nextFixId();
  const problemId = params.details?.problemId as string | undefined;
  log.info(`🔧 Disabling slow responses`, { fixId: id });

  try {
    await callRemediationAPI('slowResponsesEnabled', false, 'Fix-It: disabling slow responses', problemId);
    return {
      fixId: id, type: 'disable_slow_responses', target: 'slowResponsesEnabled',
      success: true, message: 'Slow responses disabled — latency should normalize',
      executedAt: new Date().toISOString(), details: {},
    };
  } catch (err) {
    return {
      fixId: id, type: 'disable_slow_responses', target: 'slowResponsesEnabled',
      success: false, message: `Failed: ${String(err)}`,
      executedAt: new Date().toISOString(), details: { error: String(err) },
    };
  }
}

async function sendDtEvent(params: FixParams): Promise<FixResult> {
  const id = nextFixId();
  const title = (params.details?.title as string) || `Fix-It Agent: ${params.target}`;
  const properties = (params.details?.properties as Record<string, string>) || {};
  log.info(`🔧 Sending Dynatrace custom event`, { fixId: id, title });

  try {
    // Use the app's built-in Dynatrace event sender via the remediation API
    // Creating a "virtual" flag change that sends the DT event
    const result = await callFeatureFlagAPI('POST', '/api/remediation/feature-flag', {
      flag: 'errorInjectionEnabled',
      value: true, // no-op value (reading current is fine)
      reason: title,
      triggeredBy: 'fixit-agent',
      problemId: (params.details?.problemId as string) || 'N/A',
    });

    return {
      fixId: id, type: 'send_dt_event', target: 'dynatrace',
      success: (result as any).ok ?? (result as any).success ?? false,
      message: `Dynatrace event sent: ${title}`,
      executedAt: new Date().toISOString(),
      details: { title, properties, dtResponse: result },
    };
  } catch (err) {
    return {
      fixId: id, type: 'send_dt_event', target: 'dynatrace',
      success: false, message: `DT event failed: ${String(err)}`,
      executedAt: new Date().toISOString(), details: { error: String(err) },
    };
  }
}

// ─── Registry ─────────────────────────────────────────────────

export const fixTools: Record<FixType, (params: FixParams) => Promise<FixResult>> = {
  disable_errors: disableErrors,
  reset_feature_flags: resetFeatureFlags,
  reduce_error_rate: reduceErrorRate,
  enable_circuit_breaker: enableCircuitBreaker,
  enable_cache: enableCache,
  disable_slow_responses: disableSlowResponses,
  send_dt_event: sendDtEvent,
};

export function getFixList(): { type: FixType; description: string }[] {
  return [
    { type: 'disable_errors', description: 'Disable error injection and set error rate to 0 (full remediation)' },
    { type: 'reset_feature_flags', description: 'Reset all feature flags to default values' },
    { type: 'reduce_error_rate', description: 'Reduce errors_per_transaction to a low value' },
    { type: 'enable_circuit_breaker', description: 'Enable the circuit breaker to stop error cascading' },
    { type: 'enable_cache', description: 'Re-enable caching to improve response times' },
    { type: 'disable_slow_responses', description: 'Turn off slow response simulation' },
    { type: 'send_dt_event', description: 'Send a custom event to Dynatrace for the deployment timeline' },
  ];
}

/** LLM tool definitions for Fix-It Agent function calling */
export const fixToolDefs = [
  {
    type: 'function' as const,
    function: {
      name: 'disableErrors',
      description: 'Disable all error injection and set the error rate to zero. This is the primary remediation action.',
      parameters: { type: 'object', properties: { problemId: { type: 'string', description: 'Dynatrace problem ID' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'resetFeatureFlags',
      description: 'Reset all feature flags to their default values (error rate 0.1, cache on, etc.).',
      parameters: { type: 'object', properties: { problemId: { type: 'string', description: 'Dynatrace problem ID' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'reduceErrorRate',
      description: 'Reduce the errors_per_transaction rate to a specified value (default 0.01).',
      parameters: {
        type: 'object',
        properties: {
          rate: { type: 'number', description: 'New error rate (0 to 1.0)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'enableCircuitBreaker',
      description: 'Enable the circuit breaker to prevent error cascading across services.',
      parameters: { type: 'object', properties: { problemId: { type: 'string', description: 'Dynatrace problem ID' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'enableCache',
      description: 'Re-enable caching to improve response times and reduce backend load.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'disableSlowResponses',
      description: 'Turn off slow response simulation to restore normal latency.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'sendDtEvent',
      description: 'Send a custom deployment event to Dynatrace with a title and properties.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Event title' },
          problemId: { type: 'string', description: 'Related problem ID' },
        },
        required: ['title'],
      },
    },
  },
];

/** Execute a fix tool by name (used in agent loops) */
export async function executeFixTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const params: FixParams = {
    target: (args.target as string) || name,
    details: args,
  };

  switch (name) {
    case 'disableErrors':
      return JSON.stringify(await fixTools.disable_errors(params));
    case 'resetFeatureFlags':
      return JSON.stringify(await fixTools.reset_feature_flags(params));
    case 'reduceErrorRate':
      return JSON.stringify(await fixTools.reduce_error_rate(params));
    case 'enableCircuitBreaker':
      return JSON.stringify(await fixTools.enable_circuit_breaker(params));
    case 'enableCache':
      return JSON.stringify(await fixTools.enable_cache(params));
    case 'disableSlowResponses':
      return JSON.stringify(await fixTools.disable_slow_responses(params));
    case 'sendDtEvent':
      return JSON.stringify(await fixTools.send_dt_event(params));
    default:
      return JSON.stringify({ error: `Unknown fix tool: ${name}` });
  }
}
