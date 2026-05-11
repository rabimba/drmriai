const isDev = import.meta.env.DEV;
const noop = () => {};

export interface DebugLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  scope: string;
  message: string;
  details?: unknown;
}

declare global {
  interface Window {
    __DRMRIAI_DEBUG_LOGS__?: DebugLogEntry[];
    __DRMRIAI_PRINT_DEBUG_LOGS__?: () => DebugLogEntry[];
  }
}

const DEBUG_LOG_LIMIT = 300;
const debugLogs: DebugLogEntry[] = [];

function exposeDebugLogs() {
  if (typeof window === 'undefined') return;
  window.__DRMRIAI_DEBUG_LOGS__ = debugLogs;
  window.__DRMRIAI_PRINT_DEBUG_LOGS__ = () => {
    console.table(debugLogs.map(({ timestamp, level, scope, message }) => ({
      timestamp,
      level,
      scope,
      message,
    })));
    return debugLogs;
  };
}

export function debugLog(
  level: DebugLogEntry['level'],
  scope: string,
  message: string,
  details?: unknown,
) {
  const entry: DebugLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    details,
  };
  debugLogs.push(entry);
  if (debugLogs.length > DEBUG_LOG_LIMIT) {
    debugLogs.splice(0, debugLogs.length - DEBUG_LOG_LIMIT);
  }
  exposeDebugLogs();

  const prefix = `[${scope}] ${message}`;
  const log = level === 'error' ? console.error
    : level === 'warn' ? console.warn
      : console.info;
  if (details === undefined) log(prefix);
  else log(prefix, details);
}

exposeDebugLogs();

export const logger = {
  log: isDev ? console.log.bind(console) : noop,
  warn: isDev ? console.warn.bind(console) : noop,
  error: isDev ? console.error.bind(console) : noop,
  group: isDev ? console.group.bind(console) : noop,
  groupEnd: isDev ? console.groupEnd.bind(console) : noop,
};
