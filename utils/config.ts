/**
 * Central configuration for all AI agents.
 * Reads from .env, provides typed defaults.
 */

import dotenv from 'dotenv';
dotenv.config();

export interface AgentConfig {
  ollama: {
    endpoint: string;
    model: string;
    timeoutMs: number;
    maxRetries: number;
  };
  dynatrace: {
    environmentUrl: string;
    apiToken: string;
    mcpServerUrl: string;
  };
  memory: {
    vectorDir: string;
    historyDir: string;
    maxHistoryEntries: number;
  };
  chaos: {
    maxConcurrentFaults: number;
    defaultDurationMs: number;
    safetyLockEnabled: boolean;
  };
  server: {
    port: number;
    host: string;
  };
}

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (!v) return fallback;
  return v === 'true' || v === '1';
}

export const config: AgentConfig = {
  ollama: {
    endpoint: env('OLLAMA_ENDPOINT', 'http://localhost:11434'),
    model: env('OLLAMA_MODEL', 'llama3.2'),
    timeoutMs: envInt('OLLAMA_TIMEOUT_MS', 60_000),
    maxRetries: envInt('OLLAMA_MAX_RETRIES', 2),
  },
  dynatrace: {
    environmentUrl: env('DT_ENVIRONMENT_URL', ''),
    apiToken: env('DT_API_TOKEN', ''),
    mcpServerUrl: env('MCP_SERVER_URL', 'http://localhost:3000'),
  },
  memory: {
    vectorDir: env('VECTOR_STORE_DIR', './memory/vector/data'),
    historyDir: env('HISTORY_DIR', './memory/history'),
    maxHistoryEntries: envInt('MAX_HISTORY', 500),
  },
  chaos: {
    maxConcurrentFaults: envInt('MAX_CONCURRENT_FAULTS', 3),
    defaultDurationMs: envInt('CHAOS_DURATION_MS', 30_000),
    safetyLockEnabled: envBool('CHAOS_SAFETY_LOCK', true),
  },
  server: {
    port: envInt('PORT', 8080),
    host: env('HOST', '0.0.0.0'),
  },
};

export default config;
