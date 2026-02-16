/**
 * LLM Client — wraps Ollama HTTP API for chat + function‑calling.
 * All agent LLM interactions go through this module.
 */

import { config } from './config.js';
import { createLogger } from './logger.js';
import { initTracing, withGenAISpan, GenAISpanResult } from './otelTracing.js';

const log = createLogger('system');

// Initialize OTel tracing for GenAI spans → Dynatrace
initTracing();

// ─── Types ────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;   // JSON string
  };
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  model: string;
  totalDurationMs: number;
}

// ─── Core Chat ────────────────────────────────────────────────

export async function chat(
  messages: ChatMessage[],
  options: {
    tools?: ToolDefinition[];
    temperature?: number;
    format?: 'json' | undefined;
    stream?: boolean;
  } = {},
): Promise<LLMResponse> {
  const { endpoint, model, timeoutMs, maxRetries } = config.ollama;
  const url = `${endpoint}/api/chat`;

  // Wrap entire call in a GenAI span for Dynatrace AI Observability
  return withGenAISpan<LLMResponse>(
    {
      operation: options.format === 'json' ? 'chatJSON' : 'chat',
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature,
      tools: options.tools as { function: { name: string } }[],
    },
    () => _chatInternal(url, model, messages, options, timeoutMs, maxRetries),
    (result) => ({
      content: result.content,
      toolCalls: result.toolCalls?.length,
      totalDurationMs: result.totalDurationMs,
    }),
  );
}

async function _chatInternal(
  url: string,
  model: string,
  messages: ChatMessage[],
  options: {
    tools?: ToolDefinition[];
    temperature?: number;
    format?: 'json' | undefined;
    stream?: boolean;
  },
  timeoutMs: number,
  maxRetries: number,
): Promise<LLMResponse> {

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: options.stream ?? false,
    options: {
      temperature: options.temperature ?? 0.3,
    },
  };

  if (options.tools?.length) {
    body.tools = options.tools;
  }
  if (options.format) {
    body.format = options.format;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        log.warn(`LLM retry attempt ${attempt}/${maxRetries}`);
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama ${res.status}: ${text}`);
      }

      const data = await res.json() as Record<string, unknown>;
      const msg = data.message as Record<string, unknown> | undefined;
      const content = (msg?.content as string) ?? '';
      const toolCalls = (msg?.tool_calls as ToolCall[]) ?? undefined;
      const totalDuration = (data.total_duration as number) ?? 0;

      log.debug('LLM response received', {
        model,
        durationMs: Math.round(totalDuration / 1_000_000),
        contentLen: content.length,
        toolCalls: toolCalls?.length ?? 0,
      });

      return {
        content,
        toolCalls: toolCalls?.length ? toolCalls : undefined,
        model,
        totalDurationMs: Math.round(totalDuration / 1_000_000),
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.name === 'AbortError') {
        log.warn('LLM request timed out', { timeoutMs });
      } else {
        log.error('LLM request failed', { error: lastError.message, attempt });
      }
    }
  }

  throw lastError ?? new Error('LLM request failed after retries');
}

// ─── Convenience: structured JSON response ────────────────────

export async function chatJSON<T = unknown>(
  messages: ChatMessage[],
  options: { temperature?: number } = {},
): Promise<T> {
  const res = await chat(messages, { ...options, format: 'json' });
  try {
    return JSON.parse(res.content) as T;
  } catch {
    // Try to extract JSON from the response
    const match = res.content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error(`LLM returned non-JSON: ${res.content.substring(0, 200)}`);
  }
}

// ─── Convenience: simple prompt → string ──────────────────────

export async function ask(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);
  return res.content;
}

// ─── Health Check ─────────────────────────────────────────────

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${config.ollama.endpoint}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const data = await res.json() as { models?: { name: string }[] };
    const modelBase = config.ollama.model.split(':')[0];
    return data.models?.some(m => m.name.includes(modelBase)) ?? false;
  } catch {
    return false;
  }
}

// ─── Agentic loop: chat with tool execution ───────────────────

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<string>;

export async function agentLoop(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  executeTool: ToolExecutor,
  maxIterations = 10,
): Promise<string> {
  // Each individual chat() call inside the loop already creates its own GenAI span.
  // This parent span groups the entire agent loop as one logical operation.
  const conversation = [...messages];

  for (let i = 0; i < maxIterations; i++) {
    const res = await chat(conversation, { tools });
    conversation.push({ role: 'assistant', content: res.content });

    if (!res.toolCalls?.length) {
      // No more tool calls — the agent is done
      return res.content;
    }

    // Execute each tool call and feed results back
    for (const tc of res.toolCalls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      log.info(`Tool call: ${tc.function.name}`, args);

      try {
        const result = await executeTool(tc.function.name, args);
        conversation.push({
          role: 'tool',
          content: result,
          tool_call_id: tc.id,
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        conversation.push({
          role: 'tool',
          content: `Error: ${errMsg}`,
          tool_call_id: tc.id,
        });
      }
    }
  }

  return conversation[conversation.length - 1]?.content ?? 'Agent loop exhausted iterations.';
}
