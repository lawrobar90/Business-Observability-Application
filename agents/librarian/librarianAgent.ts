/**
 * Librarian Agent — operational memory for the AI agent system.
 * Records feature flag changes, error injections, Dynatrace problems,
 * diagnoses, fixes, and outcomes. Provides similarity search so the
 * agents can learn from past incidents.
 */

import { v4 as uuidv4 } from 'uuid';
import { VectorStore } from '../../memory/vector/vectorStore.js';
import { HistoryStore, HistoryEvent, EventKind } from '../../memory/history/historyStore.js';
import { createLogger } from '../../utils/logger.js';
import { chatJSON } from '../../utils/llmClient.js';
import type { AgentName } from '../../utils/logger.js';

const log = createLogger('librarian');

// ─── Stores ───────────────────────────────────────────────────

const vectorStore = new VectorStore('incidents');
const historyStore = new HistoryStore('events');

// ─── Public API ───────────────────────────────────────────────

/** Record a chaos/feature-flag injection event */
export async function recordChaosEvent(data: {
  chaosId: string;
  type: string;
  target: string;
  injectedAt: string;
  details?: Record<string, unknown>;
}): Promise<string> {
  const id = data.chaosId;
  const summary = `Feature flag chaos: ${data.type} on ${data.target}`;

  const event: HistoryEvent = {
    id,
    timestamp: data.injectedAt,
    agent: 'gremlin',
    kind: 'chaos_injected',
    summary,
    details: { ...data.details, type: data.type, target: data.target },
  };

  historyStore.append(event);
  await vectorStore.add(id, summary, {
    kind: 'chaos_injected', type: data.type, target: data.target,
  });

  log.info('📚 Recorded chaos event', { id, type: data.type });
  return id;
}

/** Record a chaos revert (feature flag restored) */
export async function recordChaosRevert(chaosId: string): Promise<void> {
  const event: HistoryEvent = {
    id: `revert-${chaosId}`,
    timestamp: new Date().toISOString(),
    agent: 'gremlin',
    kind: 'chaos_reverted',
    summary: `Feature flag chaos ${chaosId} reverted`,
    details: {},
    relatedIds: [chaosId],
  };

  historyStore.append(event);
  log.info('📚 Recorded chaos revert', { chaosId });
}

/** Record a Dynatrace problem detection */
export async function recordProblem(data: {
  problemId: string;
  title: string;
  severity: string;
  affectedEntities: string[];
  details?: Record<string, unknown>;
}): Promise<string> {
  const id = data.problemId;
  const summary = `Problem: ${data.title} (${data.severity}) affecting ${data.affectedEntities.join(', ')}`;

  const event: HistoryEvent = {
    id,
    timestamp: new Date().toISOString(),
    agent: 'fixit',
    kind: 'problem_detected',
    summary,
    details: { ...data.details, severity: data.severity, entities: data.affectedEntities },
  };

  historyStore.append(event);
  await vectorStore.add(id, summary, {
    kind: 'problem_detected', severity: data.severity, entities: data.affectedEntities,
  });

  log.info('📚 Recorded problem', { id, title: data.title });
  return id;
}

/** Record a diagnosis */
export async function recordDiagnosis(data: {
  problemId: string;
  diagnosis: string;
  confidence: number;
  proposedFix: string;
}): Promise<string> {
  const id = `diag-${data.problemId}-${Date.now()}`;
  const summary = `Diagnosis for ${data.problemId}: ${data.diagnosis}. Proposed: ${data.proposedFix}`;

  const event: HistoryEvent = {
    id,
    timestamp: new Date().toISOString(),
    agent: 'fixit',
    kind: 'diagnosis_complete',
    summary,
    details: { diagnosis: data.diagnosis, confidence: data.confidence, proposedFix: data.proposedFix },
    relatedIds: [data.problemId],
  };

  historyStore.append(event);
  await vectorStore.add(id, summary, {
    kind: 'diagnosis', problemId: data.problemId, confidence: data.confidence,
  });

  log.info('📚 Recorded diagnosis', { id, problemId: data.problemId });
  return id;
}

/** Record a fix execution result (feature flag change, DT event, etc.) */
export async function recordFix(data: {
  fixId: string;
  problemId: string;
  fixType: string;
  target: string;
  success: boolean;
  message: string;
}): Promise<string> {
  const id = data.fixId;
  const kind: EventKind = data.success ? 'fix_executed' : 'fix_failed';
  const summary = `Fix ${data.fixType} on ${data.target}: ${data.success ? 'SUCCESS' : 'FAILED'} — ${data.message}`;

  const event: HistoryEvent = {
    id,
    timestamp: new Date().toISOString(),
    agent: 'fixit',
    kind,
    summary,
    details: { fixType: data.fixType, target: data.target, success: data.success, message: data.message },
    relatedIds: [data.problemId],
  };

  historyStore.append(event);
  await vectorStore.add(id, summary, { kind, fixType: data.fixType, success: data.success });

  log.info('📚 Recorded fix', { id, success: data.success });
  return id;
}

/** Record a feature flag state change (for auditing) */
export async function recordFlagChange(data: {
  flag: string;
  previousValue: unknown;
  newValue: unknown;
  changedBy: string;
  reason: string;
}): Promise<string> {
  const id = `flag-${Date.now()}-${data.flag}`;
  const summary = `Flag ${data.flag}: ${data.previousValue} → ${data.newValue} by ${data.changedBy}. Reason: ${data.reason}`;

  const event: HistoryEvent = {
    id,
    timestamp: new Date().toISOString(),
    agent: data.changedBy === 'gremlin-agent' ? 'gremlin' : data.changedBy === 'fixit-agent' ? 'fixit' : 'librarian',
    kind: data.changedBy.includes('fixit') ? 'fix_executed' : 'chaos_injected',
    summary,
    details: { flag: data.flag, previousValue: data.previousValue, newValue: data.newValue, reason: data.reason },
  };

  historyStore.append(event);
  await vectorStore.add(id, summary, { kind: 'flag_change', flag: data.flag });

  log.info('📚 Recorded flag change', { flag: data.flag, changedBy: data.changedBy });
  return id;
}

/** Search past incidents for similar situations */
export async function searchSimilar(query: string, topK = 5): Promise<{
  results: { text: string; score: number; metadata: Record<string, unknown> }[];
}> {
  const results = await vectorStore.search(query, topK);
  log.info('📚 Similarity search', { query: query.substring(0, 80), results: results.length });
  return {
    results: results.map(r => ({
      text: r.entry.text, score: r.score, metadata: r.entry.metadata,
    })),
  };
}

/** Get full incident timeline for a given ID chain */
export function getIncidentTimeline(id: string): HistoryEvent[] {
  return historyStore.findRelated(id);
}

/** Get recent history */
export function getRecentHistory(count = 20): HistoryEvent[] {
  return historyStore.readRecent(count);
}

/** Get stats */
export function getStats(): {
  totalEvents: number;
  vectorEntries: number;
  byKind: Record<string, number>;
} {
  const all = historyStore.readAll();
  const byKind: Record<string, number> = {};
  for (const e of all) {
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  }
  return { totalEvents: all.length, vectorEntries: vectorStore.size, byKind };
}

/** Use LLM to generate a learning summary from an incident chain */
export async function generateLearning(incidentId: string): Promise<string> {
  const timeline = getIncidentTimeline(incidentId);
  if (timeline.length === 0) return 'No events found for this incident.';

  const timelineText = timeline.map(e =>
    `[${e.timestamp}] ${e.kind}: ${e.summary}`
  ).join('\n');

  try {
    const result = await chatJSON<{ learning: string; tags: string[] }>([
      {
        role: 'system',
        content: `You are an SRE analyst reviewing a BizObs incident. The app uses feature flags (errorInjectionEnabled, slowResponsesEnabled, errors_per_transaction, etc.) to control error injection. 
Given the timeline, extract: what feature flags were changed, what errors occurred, what fixed it, and how to prevent recurrence.
Respond with JSON: {"learning":"...","tags":["..."]}`,
      },
      { role: 'user', content: timelineText },
    ]);

    const learningEvent: HistoryEvent = {
      id: `learning-${incidentId}`,
      timestamp: new Date().toISOString(),
      agent: 'librarian',
      kind: 'learning_stored',
      summary: result.learning,
      details: { tags: result.tags, incidentId },
      relatedIds: [incidentId],
    };
    historyStore.append(learningEvent);
    await vectorStore.add(learningEvent.id, result.learning, {
      kind: 'learning', tags: result.tags, incidentId,
    });

    log.info('📚 Learning generated', { incidentId, tags: result.tags });
    return result.learning;
  } catch (err) {
    log.warn('Learning generation failed (LLM unavailable), using summary', { error: String(err) });
    const summary = `Incident ${incidentId}: ${timeline.length} events. ${timeline.map(e => e.kind).join(' → ')}`;
    return summary;
  }
}

export default {
  recordChaosEvent, recordChaosRevert, recordProblem,
  recordDiagnosis, recordFix, recordFlagChange,
  searchSimilar, getIncidentTimeline, getRecentHistory,
  getStats, generateLearning,
};
