/**
 * Structured logger for all AI agents.
 * Outputs JSON lines with timestamp, level, agent, and message.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type AgentName = 'gremlin' | 'fixit' | 'librarian' | 'system' | 'otel' | 'gremlin-scheduler' | 'problem-detector' | 'dt-events' | 'workflow-webhook';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  agent: AgentName;
  message: string;
  data?: Record<string, unknown>;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

// Ensure log directory exists
const logDir = path.resolve(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logStream = fs.createWriteStream(path.join(logDir, 'agents.log'), { flags: 'a' });

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';
const AGENT_ICONS: Record<AgentName, string> = {
  gremlin: '👹',
  fixit: '🔧',
  librarian: '📚',
  system: '⚙️',
  otel: '📡',
  'gremlin-scheduler': '🤖',
  'problem-detector': '🔍',
  'dt-events': '📊',
  'workflow-webhook': '🔗',
};

function formatConsole(entry: LogEntry): string {
  const icon = AGENT_ICONS[entry.agent];
  const color = COLORS[entry.level];
  const ts = entry.timestamp.split('T')[1]?.replace('Z', '') ?? entry.timestamp;
  const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
  return `${color}[${ts}] ${icon} [${entry.agent}] ${entry.level.toUpperCase()}: ${entry.message}${dataStr}${RESET}`;
}

function log(level: LogLevel, agent: AgentName, message: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    agent,
    message,
    ...(data ? { data } : {}),
  };

  // Write structured JSON to file
  logStream.write(JSON.stringify(entry) + '\n');

  // Pretty print to console
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleFn(formatConsole(entry));
}

export function createLogger(agent: AgentName) {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => log('debug', agent, msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log('info', agent, msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log('warn', agent, msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log('error', agent, msg, data),
  };
}

export type Logger = ReturnType<typeof createLogger>;
export default createLogger;
