/**
 * Chaos Recipes — Feature-Flag-Based Failure Injection.
 * Wraps the EXISTING /api/feature_flag and /api/remediation/feature-flag
 * endpoints to inject controlled errors through the real app mechanisms.
 *
 * Each recipe calls the app's own API to toggle feature flags, change
 * error rates, and enable/disable error injection — the same controls
 * that Dynatrace Workflows and the UI use.
 */

import { createLogger } from '../../utils/logger.js';

const log = createLogger('gremlin');

// ─── Types ────────────────────────────────────────────────────

export type ChaosType =
  | 'enable_errors'
  | 'increase_error_rate'
  | 'slow_responses'
  | 'disable_circuit_breaker'
  | 'disable_cache'
  | 'target_company'
  | 'custom_flag';

export interface ChaosRecipe {
  type: ChaosType;
  name: string;
  description: string;
  inject: (params: ChaosParams) => Promise<ChaosResult>;
  revert: (context: ChaosResult) => Promise<void>;
}

export interface ChaosParams {
  target: string;
  durationMs?: number;
  intensity?: number;
  details?: Record<string, unknown>;
}

export interface ChaosResult {
  chaosId: string;
  type: ChaosType;
  target: string;
  injectedAt: string;
  revertInfo: Record<string, unknown>;
  status: 'active' | 'reverted' | 'expired';
}

// ─── Helpers ──────────────────────────────────────────────────

let chaosCounter = 0;
function nextChaosId(): string {
  return `chaos-${Date.now()}-${++chaosCounter}`;
}

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
    log.error(`Feature flag API call failed: ${method} ${path}`, { error: String(err) });
    return { success: false, error: String(err) };
  }
}

async function callRemediationAPI(
  flag: string,
  value: unknown,
  reason: string,
): Promise<Record<string, unknown>> {
  return callFeatureFlagAPI('POST', '/api/remediation/feature-flag', {
    flag,
    value,
    reason,
    triggeredBy: 'gremlin-agent',
  });
}

// ─── Recipes ──────────────────────────────────────────────────

const enableErrorsRecipe: ChaosRecipe = {
  type: 'enable_errors',
  name: 'Enable Error Injection',
  description: 'Turns on errorInjectionEnabled so journey simulations produce errors. Uses the remediation API which sends Dynatrace deployment events.',
  async inject(params) {
    const id = nextChaosId();
    log.info(`👹 Enabling error injection`, { id });
    const before = await callRemediationAPI('errorInjectionEnabled', true, 'Gremlin: enabling error injection');
    return {
      chaosId: id, type: 'enable_errors', target: 'errorInjectionEnabled',
      injectedAt: new Date().toISOString(),
      revertInfo: { previousValue: (before as any).previousValue ?? false },
      status: 'active',
    };
  },
  async revert(ctx) {
    await callRemediationAPI('errorInjectionEnabled', ctx.revertInfo.previousValue ?? false, 'Gremlin revert: error injection');
    log.info(`Reverted error injection`, { chaosId: ctx.chaosId });
  },
};

const increaseErrorRateRecipe: ChaosRecipe = {
  type: 'increase_error_rate',
  name: 'Increase Error Rate',
  description: 'Raises errors_per_transaction via the feature flag API. Intensity 1-10 maps to 10%-100% error rate.',
  async inject(params) {
    const id = nextChaosId();
    const intensity = params.intensity ?? 5;
    const newRate = Math.min(intensity / 10, 1.0);
    log.info(`👹 Increasing error rate to ${newRate}`, { id, intensity });

    const current = await callFeatureFlagAPI('GET', '/api/feature_flag');
    const prevRate = ((current as any).flags || {}).errors_per_transaction ?? 0.1;

    await callFeatureFlagAPI('POST', '/api/feature_flag', { flags: { errors_per_transaction: newRate } });
    await callRemediationAPI('errorInjectionEnabled', true, `Gremlin: error rate → ${newRate}`);

    return {
      chaosId: id, type: 'increase_error_rate', target: 'errors_per_transaction',
      injectedAt: new Date().toISOString(),
      revertInfo: { previousRate: prevRate },
      status: 'active',
    };
  },
  async revert(ctx) {
    await callFeatureFlagAPI('POST', '/api/feature_flag', { flags: { errors_per_transaction: ctx.revertInfo.previousRate } });
    log.info(`Reverted error rate to ${ctx.revertInfo.previousRate}`, { chaosId: ctx.chaosId });
  },
};

const slowResponsesRecipe: ChaosRecipe = {
  type: 'slow_responses',
  name: 'Enable Slow Responses',
  description: 'Turns on slowResponsesEnabled to simulate latency in journey steps.',
  async inject(params) {
    const id = nextChaosId();
    log.info(`👹 Enabling slow responses`, { id });
    const before = await callRemediationAPI('slowResponsesEnabled', true, 'Gremlin: enabling slow responses');
    return {
      chaosId: id, type: 'slow_responses', target: 'slowResponsesEnabled',
      injectedAt: new Date().toISOString(),
      revertInfo: { previousValue: (before as any).previousValue ?? false },
      status: 'active',
    };
  },
  async revert(ctx) {
    await callRemediationAPI('slowResponsesEnabled', ctx.revertInfo.previousValue ?? false, 'Gremlin revert: slow responses');
    log.info(`Reverted slow responses`, { chaosId: ctx.chaosId });
  },
};

const disableCircuitBreakerRecipe: ChaosRecipe = {
  type: 'disable_circuit_breaker',
  name: 'Disable Circuit Breaker',
  description: 'Turns off the circuit breaker so errors cascade without protection.',
  async inject(params) {
    const id = nextChaosId();
    log.info(`👹 Disabling circuit breaker`, { id });
    const before = await callRemediationAPI('circuitBreakerEnabled', false, 'Gremlin: disabling circuit breaker');
    return {
      chaosId: id, type: 'disable_circuit_breaker', target: 'circuitBreakerEnabled',
      injectedAt: new Date().toISOString(),
      revertInfo: { previousValue: (before as any).previousValue ?? false },
      status: 'active',
    };
  },
  async revert(ctx) {
    await callRemediationAPI('circuitBreakerEnabled', ctx.revertInfo.previousValue ?? false, 'Gremlin revert: circuit breaker');
    log.info(`Reverted circuit breaker`, { chaosId: ctx.chaosId });
  },
};

const disableCacheRecipe: ChaosRecipe = {
  type: 'disable_cache',
  name: 'Disable Cache',
  description: 'Turns off caching to increase load and response times.',
  async inject(params) {
    const id = nextChaosId();
    log.info(`👹 Disabling cache`, { id });
    const before = await callRemediationAPI('cacheEnabled', false, 'Gremlin: disabling cache');
    return {
      chaosId: id, type: 'disable_cache', target: 'cacheEnabled',
      injectedAt: new Date().toISOString(),
      revertInfo: { previousValue: (before as any).previousValue ?? true },
      status: 'active',
    };
  },
  async revert(ctx) {
    await callRemediationAPI('cacheEnabled', ctx.revertInfo.previousValue ?? true, 'Gremlin revert: cache');
    log.info(`Reverted cache disable`, { chaosId: ctx.chaosId });
  },
};

const targetCompanyRecipe: ChaosRecipe = {
  type: 'target_company',
  name: 'Target Company Error Injection',
  description: 'Enables high error injection for a specific company. Target = company name, intensity = error rate.',
  async inject(params) {
    const id = nextChaosId();
    const company = params.target;
    const intensity = params.intensity ?? 7;
    const newRate = Math.min(intensity / 10, 1.0);
    log.info(`👹 Targeting ${company} with error rate ${newRate}`, { id });

    const current = await callFeatureFlagAPI('GET', '/api/feature_flag');
    const prevRate = ((current as any).flags || {}).errors_per_transaction ?? 0.1;

    await callFeatureFlagAPI('POST', '/api/feature_flag', {
      action: 'enable', companyName: company,
    });
    await callFeatureFlagAPI('POST', '/api/feature_flag', { flags: { errors_per_transaction: newRate } });
    await callRemediationAPI('errorInjectionEnabled', true, `Gremlin: targeting ${company} at ${newRate}`);

    return {
      chaosId: id, type: 'target_company', target: company,
      injectedAt: new Date().toISOString(),
      revertInfo: { previousRate: prevRate, company },
      status: 'active',
    };
  },
  async revert(ctx) {
    const company = ctx.revertInfo.company as string;
    await callFeatureFlagAPI('POST', '/api/feature_flag', { action: 'disable', companyName: company });
    await callFeatureFlagAPI('POST', '/api/feature_flag', { flags: { errors_per_transaction: ctx.revertInfo.previousRate } });
    log.info(`Reverted company targeting: ${company}`, { chaosId: ctx.chaosId });
  },
};

const customFlagRecipe: ChaosRecipe = {
  type: 'custom_flag',
  name: 'Custom Feature Flag',
  description: 'Set any feature flag to a custom value. Target = flag name, details.value = new value.',
  async inject(params) {
    const id = nextChaosId();
    const flagName = params.target;
    const newValue = params.details?.value;
    log.info(`👹 Custom flag: ${flagName} → ${newValue}`, { id });

    // Try remediation API first (System A — sends DT events)
    const before = await callRemediationAPI(flagName, newValue, `Gremlin: ${flagName} → ${newValue}`);
    if ((before as any).ok) {
      return {
        chaosId: id, type: 'custom_flag', target: flagName,
        injectedAt: new Date().toISOString(),
        revertInfo: { previousValue: (before as any).previousValue, system: 'remediation' },
        status: 'active',
      };
    }

    // Fall back to feature flag API (System B)
    const current = await callFeatureFlagAPI('GET', '/api/feature_flag');
    const prevValue = ((current as any).flags || {})[flagName];
    await callFeatureFlagAPI('POST', '/api/feature_flag', { flags: { [flagName]: newValue } });
    return {
      chaosId: id, type: 'custom_flag', target: flagName,
      injectedAt: new Date().toISOString(),
      revertInfo: { previousValue: prevValue, system: 'feature_flag' },
      status: 'active',
    };
  },
  async revert(ctx) {
    if (ctx.revertInfo.system === 'remediation') {
      await callRemediationAPI(ctx.target, ctx.revertInfo.previousValue, `Gremlin revert: ${ctx.target}`);
    } else {
      await callFeatureFlagAPI('POST', '/api/feature_flag', { flags: { [ctx.target]: ctx.revertInfo.previousValue } });
    }
    log.info(`Reverted custom flag: ${ctx.target}`, { chaosId: ctx.chaosId });
  },
};

// ─── Registry ─────────────────────────────────────────────────

export const chaosRecipes: Record<ChaosType, ChaosRecipe> = {
  enable_errors: enableErrorsRecipe,
  increase_error_rate: increaseErrorRateRecipe,
  slow_responses: slowResponsesRecipe,
  disable_circuit_breaker: disableCircuitBreakerRecipe,
  disable_cache: disableCacheRecipe,
  target_company: targetCompanyRecipe,
  custom_flag: customFlagRecipe,
};

export function getRecipeList(): { type: ChaosType; name: string; description: string }[] {
  return Object.values(chaosRecipes).map(r => ({
    type: r.type, name: r.name, description: r.description,
  }));
}

export default chaosRecipes;
