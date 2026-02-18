import { dim } from './cli/colors.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let globalLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

function emit(level: LogLevel, subsystem: string, msg: string, data?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[globalLevel]) return;

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    sub: subsystem,
    msg,
  };
  if (data) entry.data = data;

  process.stderr.write(dim(JSON.stringify(entry)) + '\n');
}

export function createLogger(subsystem: string) {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => emit('debug', subsystem, msg, data),
    info: (msg: string, data?: Record<string, unknown>) => emit('info', subsystem, msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => emit('warn', subsystem, msg, data),
    error: (msg: string, data?: Record<string, unknown>) => emit('error', subsystem, msg, data),
  };
}
