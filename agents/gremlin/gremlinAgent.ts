/**
 * Gremlin Agent — controlled chaos via feature flag manipulation.
 * Wraps the EXISTING feature flag system to inject errors, enable slow
 * responses, disable circuit breakers, and target specific companies.
 * Uses LLM reasoning to choose the best chaos recipe for a scenario.
 */

import { v4 as uuidv4 } from 'uuid';
import { chaosRecipes, ChaosResult, ChaosParams, ChaosType, getRecipeList } from '../../tools/chaos/chaosRecipes.js';
import { recordChaosEvent, recordChaosRevert, searchSimilar } from '../librarian/librarianAgent.js';
import { chatJSON } from '../../utils/llmClient.js';
import { config } from '../../utils/config.js';
import { createLogger } from '../../utils/logger.js';
import { sendChaosEvent, sendChaosRevertEvent } from '../../utils/dtEventHelper.js';

const log = createLogger('gremlin');

// ─── State ────────────────────────────────────────────────────

const activeFaults: Map<string, ChaosResult> = new Map();
const revertTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

// ─── Core API ─────────────────────────────────────────────────

/**
 * Inject a chaos fault by manipulating feature flags.
 * If no type is specified and useLlm is true, the LLM picks the best recipe.
 */
export async function injectChaos(params: {
  type?: ChaosType;
  target: string;
  durationMs?: number;
  intensity?: number;
  details?: Record<string, unknown>;
  useLlm?: boolean;
}): Promise<ChaosResult> {
  // Safety check
  if (config.chaos.safetyLockEnabled && activeFaults.size >= config.chaos.maxConcurrentFaults) {
    throw new Error(
      `Safety lock: max ${config.chaos.maxConcurrentFaults} concurrent faults. Revert some first.`
    );
  }

  let chosenType: ChaosType = params.type ?? 'enable_errors';

  // If no type specified, ask LLM to pick
  if (!params.type && params.useLlm !== false) {
    try {
      chosenType = await llmPickRecipe(params.target);
    } catch (err) {
      log.warn('LLM recipe selection failed, defaulting to enable_errors', { error: String(err) });
    }
  }

  const recipe = chaosRecipes[chosenType];
  if (!recipe) throw new Error(`Unknown chaos type: ${chosenType}`);

  const chaosParams: ChaosParams = {
    target: params.target,
    durationMs: params.durationMs ?? config.chaos.defaultDurationMs,
    intensity: params.intensity ?? 5,
    details: params.details,
  };

  log.info(`👹 Injecting chaos: ${recipe.name}`, {
    type: chosenType, target: params.target,
    intensity: chaosParams.intensity, durationMs: chaosParams.durationMs,
  });

  const result = await recipe.inject(chaosParams);
  activeFaults.set(result.chaosId, result);

  // Log to Librarian
  await recordChaosEvent({
    chaosId: result.chaosId, type: chosenType, target: params.target,
    injectedAt: result.injectedAt,
    details: { intensity: chaosParams.intensity, durationMs: chaosParams.durationMs, recipe: recipe.name },
  });

  // Send Dynatrace event (stays OPEN for problem correlation)
  await sendChaosEvent(
    result.chaosId,
    chosenType,
    params.target,
    {
      'chaos.intensity': chaosParams.intensity,
      'chaos.duration.ms': chaosParams.durationMs,
      'chaos.recipe': recipe.name,
      'chaos.autonomous': params.details?.autonomous || false,
      'chaos.reasoning': params.details?.reasoning || '',
    }
  );

  // Schedule auto-revert
  if (chaosParams.durationMs && chaosParams.durationMs > 0) {
    const timer = setTimeout(async () => {
      log.info(`⏰ Auto-reverting chaos: ${result.chaosId}`);
      await revertChaos(result.chaosId);
    }, chaosParams.durationMs);
    revertTimers.set(result.chaosId, timer);
  }

  return result;
}

/** Revert a specific chaos fault (restore feature flags). */
export async function revertChaos(chaosId: string): Promise<boolean> {
  const fault = activeFaults.get(chaosId);
  if (!fault) {
    log.warn(`No active fault found: ${chaosId}`);
    return false;
  }

  const recipe = chaosRecipes[fault.type];
  await recipe.revert(fault);

  fault.status = 'reverted';
  activeFaults.delete(chaosId);

  const timer = revertTimers.get(chaosId);
  if (timer) { clearTimeout(timer); revertTimers.delete(chaosId); }

  await recordChaosRevert(chaosId);

  // Send Dynatrace revert event (closes the chaos)
  await sendChaosRevertEvent(chaosId, fault.type, fault.target);

  log.info(`✅ Chaos reverted: ${chaosId}`);
  return true;
}

/** Revert ALL active chaos faults (panic button). */
export async function revertAll(): Promise<{ reverted: number; failed: number }> {
  let reverted = 0, failed = 0;
  const ids = [...activeFaults.keys()];
  log.info(`🛑 Reverting ALL ${ids.length} active faults`);

  for (const id of ids) {
    try { await revertChaos(id); reverted++; }
    catch (err) { log.error(`Failed to revert ${id}`, { error: String(err) }); failed++; }
  }
  return { reverted, failed };
}

/** Get status of all active faults. */
export function getActiveFaults(): ChaosResult[] {
  return [...activeFaults.values()];
}

/** Get available chaos recipes. */
export function getAvailableRecipes() {
  return getRecipeList();
}

// ─── LLM-Driven Recipe Selection ─────────────────────────────

async function llmPickRecipe(target: string): Promise<ChaosType> {
  const recipes = getRecipeList();
  const recipeList = recipes.map(r => `- ${r.type}: ${r.description}`).join('\n');

  const history = await searchSimilar(`chaos on ${target}`, 3);
  const historyContext = history.results.length > 0
    ? `\nPast chaos on similar targets:\n${history.results.map(r => `- ${r.text}`).join('\n')}`
    : '';

  const result = await chatJSON<{ type: ChaosType; reasoning: string }>([
    {
      role: 'system',
      content: `You are a chaos engineering advisor for the BizObs app. The app uses feature flags to control error injection, slow responses, caching, and circuit breakers.
Available chaos recipes:
${recipeList}
${historyContext}
Pick the best recipe to test resilience of the target. Respond with JSON: {"type":"<recipe_type>","reasoning":"<why>"}`,
    },
    { role: 'user', content: `Target: ${target}\nPick the best chaos recipe.` },
  ]);

  log.info(`LLM picked: ${result.type}`, { reasoning: result.reasoning });
  return result.type;
}

/**
 * LLM-driven chaos: describe what you want to break and the agent figures it out.
 * E.g., "cause high errors for Acme Corp" → target_company recipe
 */
export async function smartChaos(description: string): Promise<ChaosResult> {
  const recipes = getRecipeList();
  const result = await chatJSON<{
    type: ChaosType;
    target: string;
    intensity: number;
    durationMs: number;
    reasoning: string;
    details?: Record<string, unknown>;
  }>([
    {
      role: 'system',
      content: `You are the Gremlin Agent for the BizObs app. Given a natural language description, produce a chaos plan using the app's feature flags.
Available types: ${recipes.map(r => r.type).join(', ')}
- enable_errors: turn on error injection globally
- increase_error_rate: raise errors_per_transaction (intensity 1=10%, 10=100%)
- slow_responses: enable latency simulation
- disable_circuit_breaker: remove error cascade protection
- disable_cache: increase load
- target_company: focus errors on a specific company (target = company name)
- custom_flag: set any flag (target = flag name, details.value = value)
Respond with JSON: {"type":"...","target":"...","intensity":1-10,"durationMs":number,"reasoning":"...","details":{}}`,
    },
    { role: 'user', content: description },
  ]);

  log.info('Smart chaos plan', result);

  return injectChaos({
    type: result.type, target: result.target,
    intensity: result.intensity, durationMs: result.durationMs,
    details: result.details, useLlm: false,
  });
}

export default {
  injectChaos, revertChaos, revertAll,
  getActiveFaults, getAvailableRecipes, smartChaos,
};
