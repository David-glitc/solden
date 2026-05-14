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
  if (data && Object.keys(data).length) {
    const ser = JSON.stringify(data);
    const body = ser.length > 160 ? ser.slice(0, 157) + "…" : ser;
    s += ` ${dim}${body}${rst}`;
  }
  return s;
}

function logVerboseData(): boolean {
  const v = env("LOG_VERBOSE");
  return v === "1" || v === "true" || v === "yes";
}

/** Wall-clock elapsed for pulses and UI: seconds → `59s` → `12m03s` → `1h02m15s`. */
export function formatElapsedSeconds(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "0s";
  if (totalSec < 60) return totalSec < 10 ? `${totalSec.toFixed(1)}s` : `${Math.round(totalSec)}s`;
  const t = Math.floor(totalSec);
  const s = t % 60;
  const m = Math.floor((t % 3600) / 60);
  const h = Math.floor(t / 3600);
  if (h === 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
}

function formatCliPulse(data: Record<string, unknown>): string {
  const dim = "\x1b[2m", rst = "\x1b[0m", c = "\x1b[36m";
  const tRaw = data.tSec ?? data.wallSec;
  const tNum = typeof tRaw === "number" ? tRaw : parseFloat(String(tRaw ?? "0"));
  const tLabel = Number.isFinite(tNum) ? formatElapsedSeconds(tNum) : String(tRaw ?? "?");
  const w = data.w ?? data.workers ?? "?";
  const chk = data.chk ?? data.totalChecked ?? 0;
  const ik = data.instK ?? data.instKpsK ?? 0;
  const ak = data.avgK ?? data.avgKpsK ?? 0;
  const sc = data.score ?? data.bestScorePercent ?? 0;
  const head = typeof data.addrHead === "string" && data.addrHead.length ? data.addrHead : "";
  const addrPart = head ? `  ${dim}addr${rst} ${head}` : "";
  const bestAcc = data.bestAcc ?? data.bestAccuracyPercent;
  const runAvgAcc = data.runAvgAcc ?? data.runningAvgAccuracyPercent;
  const mis = data.mis;
  let accPart = "";
  if (typeof bestAcc === "number" || typeof runAvgAcc === "number") {
    const b = typeof bestAcc === "number" ? `${Number(bestAcc)}%` : "?";
    const r = typeof runAvgAcc === "number" ? `${Number(runAvgAcc)}%` : "?";
    accPart = `  acc=${b} ravg=${r}`;
  }
  const misPart = typeof mis === "string" && mis.length && mis !== "—" ? `  mis=${mis}` : "";
  return `${dim}▣${rst} ${c}t=${tLabel}${rst}  workers=${w}  keys=${chk}  ${ik}k/s inst  ${ak}k/s avg  best=${sc}%${accPart}${misPart}${addrPart}`;
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
  const pulse = !json && level === "info" && safeData && !logVerboseData() &&
    (msg === "cli_heartbeat" || msg === "http_grind_pulse");
  if (pulse) {
    writeStderrLine(formatCliPulse(safeData));
  } else if (!json) {
    writeStderrLine(formatPretty(ts, level, scope, msg, safeData));
  } else {
    writeStderrLine(JSON.stringify(record));
  }
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

/** Reads `LOG_LEVEL`, `LOG_JSON`, `LOG_VERBOSE`. Deno Deploy uses the same defaults as local unless `LOG_LEVEL` is set. */
export function initLoggingFromEnv(): void {
  const raw = env("LOG_LEVEL");
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
