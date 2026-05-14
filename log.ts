// ── log.ts ────────────────────────────────────────────────────────────────────
// Structured logging: JSON lines (default) or pretty TTY; levels via env / API.

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
};

let minRank = LEVEL_RANK.info;
let forceJson = false;

function env(name: string): string | undefined {
  if (typeof (globalThis as any).Deno !== "undefined") {
    try {
      return (globalThis as any).Deno.env.get(name) ?? undefined;
    } catch {
      // Without `--allow-env`, Deno throws NotCapable; fall back to defaults.
      return undefined;
    }
  }
  if (typeof process !== "undefined" && (process as any).env) return (process as any).env[name];
  return undefined;
}

function parseLevel(s: string): LogLevel {
  const x = s.trim().toLowerCase();
  if (x === "trace" || x === "debug" || x === "info" || x === "warn" || x === "error") return x;
  return "info";
}

function stderrTTY(): boolean {
  try {
    if (typeof (globalThis as any).Deno !== "undefined") return Boolean((globalThis as any).Deno.stderr?.isTerminal?.());
    if (typeof process !== "undefined") return Boolean((process as any).stderr?.isTTY);
  } catch { /* ignore */ }
  return false;
}

function writeStderrLine(s: string): void {
  const line = s.endsWith("\n") ? s : s + "\n";
  const bytes = new TextEncoder().encode(line);
  if (typeof (globalThis as any).Deno !== "undefined") {
    (globalThis as any).Deno.stderr.writeSync(bytes);
    return;
  }
  if (typeof process !== "undefined") {
    (process as any).stderr.write(bytes);
    return;
  }
}

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactValue);
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(o)) {
    if (/secret|password|decrypt|private|cipher|passphrase/i.test(key)) out[key] = "[redacted]";
    else if (typeof child === "object" && child !== null && !Array.isArray(child)) out[key] = redactValue(child);
    else out[key] = child;
  }
  return out;
}

function formatPretty(ts: string, level: LogLevel, scope: string, msg: string, data?: Record<string, unknown>): string {
  const dim = "\x1b[2m", rst = "\x1b[0m", cyn = "\x1b[36m", yel = "\x1b[33m", red = "\x1b[31m", grn = "\x1b[32m";
  const lvl =
    level === "error" ? red + level + rst :
    level === "warn"  ? yel + level + rst :
    level === "info" ? grn + level + rst :
    dim + level + rst;
  let s = `${dim}${ts}${rst} ${lvl} ${cyn}${scope}${rst} ${msg}`;
  if (data && Object.keys(data).length) s += ` ${dim}${JSON.stringify(data)}${rst}`;
  return s;
}

function emit(scope: string, level: LogLevel, msg: string, data?: Record<string, unknown>, err?: Error): void {
  if (LEVEL_RANK[level] < minRank) return;
  const ts = new Date().toISOString();
  const safeData = data ? redactValue(data) as Record<string, unknown> : undefined;
  const record: Record<string, unknown> = { ts, level, scope, msg, runtime: detectRuntime() };
  if (safeData && Object.keys(safeData).length) record.data = safeData;
  if (err) {
    record.err = { name: err.name, message: err.message, stack: err.stack };
  }
  const json = forceJson || !stderrTTY();
  if (json) writeStderrLine(JSON.stringify(record));
  else writeStderrLine(formatPretty(ts, level, scope, msg, safeData));
  try {
    const hook = (globalThis as any).__vanitySseBroadcast;
    if (typeof hook === "function") hook(record);
  } catch { /* ignore */ }
}

function detectRuntime(): string {
  if (typeof (globalThis as any).Deno !== "undefined") return "deno";
  if (typeof (globalThis as any).Bun !== "undefined") return "bun";
  return "node";
}

/** Call from main after parsing args; reads `LOG_LEVEL`, `LOG_JSON`. On Deno Deploy, defaults to `debug` when `LOG_LEVEL` is unset. */
export function initLoggingFromEnv(): void {
  let raw = env("LOG_LEVEL");
  if (!raw) {
    try {
      const id = (globalThis as any).Deno?.env?.get?.("DENO_DEPLOYMENT_ID");
      if (id) raw = "debug";
    } catch { /* no env cap */ }
  }
  minRank = LEVEL_RANK[parseLevel(raw ?? "info")];
  const j = env("LOG_JSON");
  forceJson = j === "1" || j === "true" || j === "yes";
}

export function configureLogging(opts: { level?: LogLevel; json?: boolean }): void {
  if (opts.level !== undefined) minRank = LEVEL_RANK[opts.level];
  if (opts.json !== undefined) forceJson = opts.json;
}

export function createLogger(scope: string) {
  return {
    trace(msg: string, data?: Record<string, unknown>) { emit(scope, "trace", msg, data); },
    debug(msg: string, data?: Record<string, unknown>) { emit(scope, "debug", msg, data); },
    info(msg: string, data?: Record<string, unknown>) { emit(scope, "info", msg, data); },
    warn(msg: string, data?: Record<string, unknown>) { emit(scope, "warn", msg, data); },
    error(msg: string, data?: Record<string, unknown>, err?: Error) { emit(scope, "error", msg, data, err); },
  };
}

initLoggingFromEnv();
