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
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${APP_BASE}${path}`;
  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
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
  targetService?: string,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    flag,
    value,
    reason,
    triggeredBy: 'gremlin-agent',
  };
  if (targetService) {
    body.targetService = targetService;
  }
  return callFeatureFlagAPI('POST', '/api/remediation/feature-flag', body);
}

// ─── Recipes ──────────────────────────────────────────────────

const enableErrorsRecipe: ChaosRecipe = {
  type: 'enable_errors',
  name: 'Enable Error Injection',
  description: 'Enables error injection on a specific service (or all) by setting errors_per_transaction via per-service feature flag overrides. Intensity 1-10 maps to 10%-100% error rate.',
  async inject(params) {
    const id = nextChaosId();
    const intensity = params.intensity ?? 5;
    const errorRate = Math.min(intensity / 10, 1.0);
    const targetService = params.target && params.target !== 'default' ? params.target : undefined;
    log.info(`👹 Enabling error injection (rate=${errorRate})`, { id, targetService: targetService || 'all' });

    // Set errors_per_transaction via the feature flag API (System B) — this is what child services actually read
    if (targetService) {
      await callFeatureFlagAPI('POST', '/api/feature_flag', {
        flags: { errors_per_transaction: errorRate },
        targetService: targetService,
        triggeredBy: 'gremlin-agent'
      });
    } else {
      await callFeatureFlagAPI('POST', '/api/feature_flag', {
        flags: { errors_per_transaction: errorRate },
        triggeredBy: 'gremlin-agent'
      });
    }

    // Also set the legacy remediation flag for DT event tracking
    await callRemediationAPI('errorInjectionEnabled', true, `Gremlin: enabling error injection (rate=${errorRate})${targetService ? ` on ${targetService}` : ''}`, targetService);

    return {
      chaosId: id, type: 'enable_errors', target: targetService || 'all',
      injectedAt: new Date().toISOString(),
      revertInfo: { errorRate, targetService },
      status: 'active',
    };
  },
  async revert(ctx) {
    const targetService = ctx.revertInfo.targetService as string | undefined;
    if (targetService) {
      // Remove per-service override — service falls back to safe defaults (errors_per_transaction=0)
      await callFeatureFlagAPI('DELETE', `/api/feature_flag/service/${encodeURIComponent(targetService)}`);
    } else {
      // Reset global errors_per_transaction to 0
      await callFeatureFlagAPI('POST', '/api/feature_flag', {
        flags: { errors_per_transaction: 0 },
        triggeredBy: 'gremlin-agent'
      });
    }
    await callRemediationAPI('errorInjectionEnabled', false, 'Gremlin revert: error injection', targetService);
    log.info(`Reverted error injection`, { chaosId: ctx.chaosId });
  },
};

const increaseErrorRateRecipe: ChaosRecipe = {
  type: 'increase_error_rate',
  name: 'Increase Error Rate',
  description: 'Raises errors_per_transaction for a SPECIFIC service via per-service targeting. Intensity 1-10 maps to 10%-100% error rate. Only the targeted service is affected.',
  async inject(params) {
    const id = nextChaosId();
    const intensity = params.intensity ?? 5;
    const newRate = Math.min(intensity / 10, 1.0);
    const targetService = params.target || 'all';
    log.info(`👹 Increasing error rate to ${newRate} for service: ${targetService}`, { id, intensity });

    // Set per-service override so only the targeted service gets elevated errors
    await callFeatureFlagAPI('POST', '/api/feature_flag', {
      flags: { errors_per_transaction: newRate },
      targetService: targetService,
      triggeredBy: 'gremlin-agent'
    });
    await callRemediationAPI('errorInjectionEnabled', true, `Gremlin: error rate → ${newRate} on ${targetService}`, targetService);

    return {
      chaosId: id, type: 'increase_error_rate', target: targetService,
      injectedAt: new Date().toISOString(),
      revertInfo: { targetService },
      status: 'active',
    };
  },
  async revert(ctx) {
    const targetService = String(ctx.revertInfo.targetService || ctx.target);
    // Remove per-service override — service falls back to safe defaults
    await callFeatureFlagAPI('DELETE', `/api/feature_flag/service/${encodeURIComponent(targetService)}`);
    log.info(`Reverted error rate for service: ${targetService}`, { chaosId: ctx.chaosId });
  },
};

const slowResponsesRecipe: ChaosRecipe = {
  type: 'slow_responses',
  name: 'Enable Slow Responses',
  description: 'Turns on slowResponsesEnabled to simulate latency in journey steps.',
  async inject(params) {
    const id = nextChaosId();
    const targetService = params.target && params.target !== 'default' ? params.target : undefined;
    log.info(`👹 Enabling slow responses`, { id, targetService: targetService || 'all' });
    const before = await callRemediationAPI('slowResponsesEnabled', true, `Gremlin: enabling slow responses${targetService ? ` on ${targetService}` : ''}`, targetService);
    return {
      chaosId: id, type: 'slow_responses', target: targetService || 'slowResponsesEnabled',
      injectedAt: new Date().toISOString(),
      revertInfo: { previousValue: (before as any).previousValue ?? false, targetService },
      status: 'active',
    };
  },
  async revert(ctx) {
    const targetService = ctx.revertInfo.targetService as string | undefined;
    await callRemediationAPI('slowResponsesEnabled', ctx.revertInfo.previousValue ?? false, 'Gremlin revert: slow responses', targetService);
    log.info(`Reverted slow responses`, { chaosId: ctx.chaosId });
  },
};

const disableCircuitBreakerRecipe: ChaosRecipe = {
  type: 'disable_circuit_breaker',
  name: 'Disable Circuit Breaker',
  description: 'Turns off the circuit breaker so errors cascade without protection.',
  async inject(params) {
    const id = nextChaosId();
    const targetService = params.target && params.target !== 'default' ? params.target : undefined;
    log.info(`👹 Disabling circuit breaker`, { id, targetService: targetService || 'all' });
    const before = await callRemediationAPI('circuitBreakerEnabled', false, `Gremlin: disabling circuit breaker${targetService ? ` on ${targetService}` : ''}`, targetService);
    return {
      chaosId: id, type: 'disable_circuit_breaker', target: targetService || 'circuitBreakerEnabled',
      injectedAt: new Date().toISOString(),
      revertInfo: { previousValue: (before as any).previousValue ?? false, targetService },
      status: 'active',
    };
  },
  async revert(ctx) {
    const targetService = ctx.revertInfo.targetService as string | undefined;
    await callRemediationAPI('circuitBreakerEnabled', ctx.revertInfo.previousValue ?? false, 'Gremlin revert: circuit breaker', targetService);
    log.info(`Reverted circuit breaker`, { chaosId: ctx.chaosId });
  },
};

const disableCacheRecipe: ChaosRecipe = {
  type: 'disable_cache',
  name: 'Disable Cache',
  description: 'Turns off caching to increase load and response times.',
  async inject(params) {
    const id = nextChaosId();
    const targetService = params.target && params.target !== 'default' ? params.target : undefined;
    log.info(`👹 Disabling cache`, { id, targetService: targetService || 'all' });
    const before = await callRemediationAPI('cacheEnabled', false, `Gremlin: disabling cache${targetService ? ` on ${targetService}` : ''}`, targetService);
    return {
      chaosId: id, type: 'disable_cache', target: targetService || 'cacheEnabled',
      injectedAt: new Date().toISOString(),
      revertInfo: { previousValue: (before as any).previousValue ?? true, targetService },
      status: 'active',
    };
  },
  async revert(ctx) {
    const targetService = ctx.revertInfo.targetService as string | undefined;
    await callRemediationAPI('cacheEnabled', ctx.revertInfo.previousValue ?? true, 'Gremlin revert: cache', targetService);
    log.info(`Reverted cache disable`, { chaosId: ctx.chaosId });
  },
};

const targetCompanyRecipe: ChaosRecipe = {
  type: 'target_company',
  name: 'Target Company Error Injection',
  description: 'Enables high error injection for a specific service within a company. Target = service name, intensity = error rate. Only the targeted service is affected.',
  async inject(params) {
    const id = nextChaosId();
    const targetService = params.target;
    const intensity = params.intensity ?? 7;
    const newRate = Math.min(intensity / 10, 1.0);
    const company = (params.details?.companyName as string) || targetService;
    log.info(`👹 Targeting service ${targetService} with error rate ${newRate}`, { id });

    // Set per-service override for the targeted service only
    await callFeatureFlagAPI('POST', '/api/feature_flag', {
      flags: { errors_per_transaction: newRate },
      targetService: targetService,
      companyName: company,
      triggeredBy: 'gremlin-agent'
    });
    await callRemediationAPI('errorInjectionEnabled', true, `Gremlin: targeting ${targetService} at ${newRate}`, targetService);

    return {
      chaosId: id, type: 'target_company', target: targetService,
      injectedAt: new Date().toISOString(),
      revertInfo: { targetService, company },
      status: 'active',
    };
  },
  async revert(ctx) {
    const targetService = String(ctx.revertInfo.targetService || ctx.target);
    // Remove per-service override
    await callFeatureFlagAPI('DELETE', `/api/feature_flag/service/${encodeURIComponent(targetService)}`);
    log.info(`Reverted service targeting: ${targetService}`, { chaosId: ctx.chaosId });
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
    const targetService = params.details?.targetService as string | undefined;
    const before = await callRemediationAPI(flagName, newValue, `Gremlin: ${flagName} → ${newValue}`, targetService);
    if ((before as any).ok) {
      return {
        chaosId: id, type: 'custom_flag', target: flagName,
        injectedAt: new Date().toISOString(),
        revertInfo: { previousValue: (before as any).previousValue, system: 'remediation', targetService },
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
      const targetService = ctx.revertInfo.targetService as string | undefined;
      await callRemediationAPI(ctx.target, ctx.revertInfo.previousValue, `Gremlin revert: ${ctx.target}`, targetService);
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
