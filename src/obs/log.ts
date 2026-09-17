/**
 * Structured logging, dependency-free.
 *
 * In production (NODE_ENV=production) each line is one JSON object, so a log
 * aggregator can index it. Locally it is a terse human line. A caregiving service
 * must never log the care itself - medication names, notes, member identities are
 * PHI - so callers pass only operational fields (ids, counts, durations, outcomes),
 * never free text from the record.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const isProd = process.env['NODE_ENV'] === 'production';
const threshold = ORDER[(process.env['LOG_LEVEL'] as Level) in ORDER
  ? (process.env['LOG_LEVEL'] as Level)
  : (isProd ? 'info' : 'debug')];

function emit(level: Level, msg: string, fields?: Fields): void {
  if (ORDER[level] < threshold) return;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (isProd) {
    stream.write(`${JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields })}\n`);
  } else {
    const extra = fields && Object.keys(fields).length
      ? ` ${Object.entries(fields).map(([k, v]) => `${k}=${format(v)}`).join(' ')}`
      : '';
    stream.write(`${level.toUpperCase().padEnd(5)} ${msg}${extra}\n`);
  }
}

function format(v: unknown): string {
  if (v instanceof Error) return v.message;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

export const log = {
  debug: (msg: string, fields?: Fields) => emit('debug', msg, fields),
  info: (msg: string, fields?: Fields) => emit('info', msg, fields),
  warn: (msg: string, fields?: Fields) => emit('warn', msg, fields),
  error: (msg: string, fields?: Fields) => emit('error', msg, fields),
};
