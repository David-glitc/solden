// ── main.ts ───────────────────────────────────────────────────────────────────
// SOL VANITY — CLI + HTTP server
//
// Run with (from repo root):
//   node --experimental-sqlite --experimental-strip-types main.ts [opts]
//   bun main.ts [opts]
//   deno run --allow-read --allow-write --allow-net --allow-sys main.ts [opts]

import { RUNTIME, cpuCount, argv, exit, isTTY, writeStdout, stdoutColumns, openAppend, serveHttp } from "./runtime.ts";
import { createEphemeralDb, initDb } from "./db.ts";
import { grind }      from "./grind.ts";
import { configureLogging, createLogger, formatElapsedSeconds } from "./log.ts";
import type { GrindOpts, GrindResult, WorkerMsg } from "./types.ts";
import {
  adminPasswordConfigured,
  applyAdminOpts,
  resolveAdminPerfMode,
  adminMemoryCleanup,
  adminRequestRestart,
  adminRestartAllowed,
  cancelJob,
  createAdminSession,
  deleteJob,
  extractAdminToken,
  getJob,
  getResourceMonitor,
  isAdminRequest,
  listJobs,
  revokeAdminSession,
  startBackgroundJob,
  verifyAdminPassword,
  type ThresholdCapture,
} from "./admin.ts";

async function readTextFromModuleUrl(moduleUrl: URL): Promise<string> {
  const { fileURLToPath } = await import("node:url");
  const filePath = fileURLToPath(moduleUrl);
  if (RUNTIME === "deno") {
    return await (globalThis as any).Deno.readTextFile(filePath);
  }
  if (RUNTIME === "bun") {
    return await (globalThis as any).Bun.file(filePath).text();
  }
  const { readFileSync } = await import("node:fs");
  return readFileSync(filePath, "utf8");
}

const CONTROL_PANEL_HTML = new URL("../static/index.html", import.meta.url);
const ADMIN_PANEL_HTML = new URL("../static/admin.html", import.meta.url);
const SOLD_MARK_SVG_URL = new URL("../static/solden-mark.svg", import.meta.url);
let controlPanelHtmlCache: string | null = null;
let adminPanelHtmlCache: string | null = null;
let soldMarkSvgCache: string | null = null;

async function getControlPanelHtml(): Promise<string> {
  if (controlPanelHtmlCache) return controlPanelHtmlCache;
  controlPanelHtmlCache = await readTextFromModuleUrl(CONTROL_PANEL_HTML);
  return controlPanelHtmlCache;
}

async function getSoldMarkSvg(): Promise<string> {
  if (soldMarkSvgCache) return soldMarkSvgCache;
  soldMarkSvgCache = await readTextFromModuleUrl(SOLD_MARK_SVG_URL);
  return soldMarkSvgCache;
}

async function getAdminPanelHtml(): Promise<string> {
  if (adminPanelHtmlCache) return adminPanelHtmlCache;
  adminPanelHtmlCache = await readTextFromModuleUrl(ADMIN_PANEL_HTML);
  return adminPanelHtmlCache;
}

function captureThreshold(msg: { address: string; publicKey: string; secretKey: string; score: number }): ThresholdCapture {
  return {
    address: msg.address,
    publicKey: msg.publicKey,
    secretKey: msg.secretKey,
    score: msg.score,
    foundAt: Date.now(),
  };
}

function parseHttpGrindBody(body: Partial<GrindOpts>): GrindOpts {
  const scaleRaw = (body as Record<string, unknown>).threadsMultiplier ?? body.bunOversubscribe;
  return {
    prefix:        String(body.prefix ?? "").trim(),
    suffix:        String(body.suffix ?? "").trim(),
    count:         Math.max(1, Math.min(1_000_000, Number(body.count) || 1)),
    threads:       Math.max(1, Math.min(512, Number(body.threads) || cpuCount)),
    bunOversubscribe: Math.max(0.1, Number(scaleRaw) || 1),
    progressEvery: Math.max(64, Math.min(10_000_000, Number(body.progressEvery) || 512)),
    uiRefreshMs:   Math.max(25, Math.min(60_000, Number(body.uiRefreshMs) || 100)),
    maxWorkers:    Math.max(1, Math.min(1024, Number(body.maxWorkers) || 256)),
    caseSensitive: Boolean(body.caseSensitive),
    threshold:     Math.max(0, Math.min(100, Number(body.threshold) || 90)),
    encrypt:       Boolean(body.encrypt),
    decryptKey:    String(body.decryptKey ?? ""),
    useWebgpu:     resolveWebGpuForHttp(Boolean(body.useWebgpu)),
    keygen:        resolveKeygenForHttp(body.keygen),
    keygenBatch:   Math.max(8, Math.min(256, Number(body.keygenBatch) || keygenBatchDefault())),
  };
}

// ── arg parser (zero deps) ────────────────────────────────────────────────────
function parseArgs(args: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("-")) continue;
    const key = a.replace(/^-+/, "");
    const next = args[i + 1];
    if (next && !next.startsWith("-")) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

const a = parseArgs(argv);

function str(keys: string[], def = "")   { for (const k of keys) if (typeof a[k] === "string") return a[k] as string; return def; }
function num(keys: string[], def: number) { const v = str(keys); return v ? parseInt(v, 10) : def; }
function numf(keys: string[], def: number) { const v = str(keys); return v ? parseFloat(v) : def; }
function flag(keys: string[])            { return keys.some(k => a[k] === true || a[k] === "true"); }

function env(name: string): string | undefined {
  if (typeof (globalThis as any).Deno !== "undefined") {
    try { return (globalThis as any).Deno.env.get(name) ?? undefined; }
    catch { return undefined; }
  }
  if (typeof process !== "undefined") return (process as any).env?.[name];
  return undefined;
}

function webGpuWanted(): boolean {
  const e = (env("VANITY_USE_WEBGPU") ?? "").trim().toLowerCase();
  if (e === "0" || e === "false" || e === "off") return false;
  if (e === "1" || e === "true" || e === "yes" || e === "auto") return true;
  return flag(["use-webgpu", "W"]);
}

function resolveWebGpuForHttp(bodyFlag: boolean): boolean {
  const e = (env("VANITY_USE_WEBGPU") ?? "").trim().toLowerCase();
  if (e === "0" || e === "false" || e === "off") return false;
  if (e === "1" || e === "true" || e === "yes" || e === "auto") return true;
  return bodyFlag;
}

function keygenBatchDefault(): number {
  const n = parseInt(env("VANITY_KEYGEN_BATCH") ?? "64", 10);
  return Number.isFinite(n) ? n : 64;
}

function resolveKeygenCli(): string {
  const e = (env("VANITY_KEYGEN") ?? "").trim().toLowerCase();
  if (e) return e;
  const k = str(["keygen", "K"], "");
  return k || "auto";
}

function resolveKeygenForHttp(bodyVal: string | undefined): string {
  const e = (env("VANITY_KEYGEN") ?? "").trim().toLowerCase();
  if (e) return e;
  const v = String(bodyVal ?? "").trim().toLowerCase();
  return v || "auto";
}

if (flag(["verbose", "v"])) configureLogging({ level: "debug" });
const log = createLogger("main");

const opts: GrindOpts = {
  prefix:        str(["prefix",     "p"]),
  suffix:        str(["suffix",     "s"]),
  count:         num(["count",      "n"], 1),
  threads:       num(["threads",    "t"], cpuCount),
  bunOversubscribe: numf(["bun-oversubscribe", "B"], 1),
  progressEvery: num(["progress-every", "g"], 512),
  uiRefreshMs:   num(["ui-refresh-ms", "u"], 5000),
  maxWorkers:    num(["max-workers", "m"], 256),
  caseSensitive: flag(["case-sensitive", "c"]),
  threshold:     num(["threshold",  "r"], 90),
  encrypt:       flag(["encrypt",   "e"]),
  decryptKey:    str(["decrypt-key","k"]),
  useWebgpu:     webGpuWanted(),
  keygen:        resolveKeygenCli(),
  keygenBatch:   num(["keygen-batch", "G"], keygenBatchDefault()),
};

const dbPath  = str(["db-path", "d"], "vanity.db");
const outFile = str(["output",  "o"], "hits.jsonl");
const binFile = str(["bin-jsonl", "f"], "bin.jsonl");
const portEnv = env("PORT");
const port    = portEnv ? parseInt(portEnv, 10) : num(["port", "P"], 3737);
const autoServer = Boolean(env("DENO_DEPLOYMENT_ID")) || env("SERVER_MODE") === "server";
const server  = flag(["server", "S"]) || autoServer;
const help    = flag(["help",   "h"]);

// ── banner + help ─────────────────────────────────────────────────────────────
const BANNER = `\x1b[38;5;208m⚡ SOL VANITY\x1b[0m  \x1b[2mSolana vanity address grinder · ${RUNTIME} · ed25519 · AES-256-GCM\x1b[0m`;

if (help) {
  console.log(BANNER);
  console.log(`
USAGE
  <runtime> main.ts [options]     (repo root; forwards to src/main.ts)
  <runtime> main.ts --server

OPTIONS
  -p, --prefix <str>        Target prefix             e.g. ATOM
  -s, --suffix <str>        Target suffix             e.g. ic
  -n, --count  <int>        Addresses to find         [default: 1]
  -t, --threads <int>       Worker count              [default: all CPUs]
  -B, --bun-oversubscribe <float>  Bun only: multiply workers (ignored on Deno/Node)
  -g, --progress-every <int> Worker progress cadence  [default: 512]
  -u, --ui-refresh-ms <int> Progress redraw cadence   [default: 5000]
  -f, --bin-jsonl <path>    JSONL for scores 70–80%   [default: bin.jsonl]
  -m, --max-workers <int>   Cap effective workers     [default: 256]
  -c, --case-sensitive      Case-sensitive matching   [default: false]
  -r, --threshold <0-100>   Write partial matches ≥%  [default: 90]
  -e, --encrypt             Encrypt private key (AES-256-GCM)
  -k, --decrypt-key <str>   Passphrase or 64-char hex AES key (blank=auto)
  -o, --output <path>       JSONL output file         [default: hits.jsonl]
  -d, --db-path <path>      DB path (SQLite Node/Bun/Deno local; Deno Deploy uses KV) [default: vanity.db]
  -S, --server              HTTP server mode
  -P, --port <int>          Server port               [default: 3737]
  -v, --verbose             Debug logging (LOG_LEVEL=debug)
  -W, --use-webgpu          Probe WebGPU (Deno local only; keygen stays CPU unless extended)
  -K, --keygen <mode>       Keygen: auto|sodium|noble|node|subtle  [default: auto]
  -G, --keygen-batch <int>  Keys per worker batch (8–256)         [default: 64]

ENV (local max throughput toward ~500k keys/s aggregate)
  VANITY_KEYGEN=auto|sodium|noble|node|subtle
  VANITY_KEYGEN_BATCH=64
  Install optional native speed: npm i sodium-native @noble/ed25519 @noble/hashes
  Example: bun main.ts -t 16 -m 32 -B 1.5 -K auto -G 64 -g 8192 -p XXXX

DEV & LOGS
  deno task server-ui       Restarts the server when project files change (uses deno run --watch).
  Pass --watch only via this task; a stray --watch after the task name is treated as a main.ts argument and does nothing.
  stderr lines are JSON when not on a color TTY: keys include ts, level, scope, msg, data.
  POST /grind logs http_grind_post as soon as the request arrives; http_response logs only after the grind finishes.

SERVER ENDPOINTS
  GET  /                     Control panel (static/index.html)
  GET  /index.html           Same HTML as /
  GET  /favicon.svg          Solden mark (SVG; same file as static/solden-mark.svg)
  GET  /solden-mark.svg      Same SVG asset (explicit path for docs / hotlinking)
  GET  /events              Server-Sent Events stream (logs/progress/status)
  GET  /system               Machine/runtime capabilities
  GET  /health              { ok, ts }
  GET  /results             last 200 hits from DB (JSON)
  GET  /admin.html          Admin panel (jobs, monitor, login)
  POST /admin/api/login     { password } → { token }
  GET  /admin/api/jobs      Background jobs (Bearer admin token)
  POST /admin/api/jobs      Start background job (Bearer)
  GET  /admin/api/monitor   Resource monitor (Bearer)
  POST /grind               GrindOpts body → GrindResult[]
  OPTIONS *                  CORS preflight when ACCESS_CONTROL_ALLOW_ORIGIN is set

RUNTIMES
  node --experimental-sqlite --experimental-strip-types main.ts -p ATOM
  bun main.ts -p ATOM
  deno run --allow-read --allow-write --allow-net main.ts -p ATOM

BUN SETUP (high concurrency presets)
  deno task bun-grind -p meth -s ic -n 1 -t 16
  deno task bun-fast -p meth -s ic -n 1 -t 16

DEPLOY (Deno Deploy)
  Entry file: main.ts (repo root). It imports src/main.ts. When DENO_DEPLOYMENT_ID is set, server mode starts automatically.
  By default hits are NOT written to Deno KV (ephemeral HTTP). Set VANITY_HTTP_PERSIST_HITS=1 to enable KV and link a KV database.

ENV (optional: add --allow-env to deno run if you want LOG_LEVEL / LOG_JSON from the environment)
  LOG_LEVEL   trace | debug | info | warn | error   [default: info]
  LOG_JSON    1 | true — force JSON lines (no TTY colors)
  LOG_VERBOSE 1 | true — full JSON on stderr (default: compact heartbeat on TTY)
  VANITY_USE_WEBGPU  0|off|false | 1|true|auto — probe GPU on Deno local (needs -W or this env; deno task grind-gpu passes -W and --unstable-webgpu)
  ACCESS_CONTROL_ALLOW_ORIGIN  e.g. https://your-site.vercel.app — enables CORS on /system, /events, /grind, /health (host UI elsewhere)
  VANITY_HTTP_EPHEMERAL  1|true — HTTP server never persists hits to DB/KV (self-hosted prod)
  VANITY_HTTP_PERSIST_HITS  1|true — on Deno Deploy only: store hits in KV (default off on Deploy)
  VANITY_SSE_LOG_PULSE  1|true — on Deploy: also mirror http_grind_pulse lines into the SSE log ring (default: pulse skipped to save RAM/wire)
  VANITY_ADMIN_PASSWORD     Admin page (/admin.html) password; enables unthrottled grinds + background jobs

DECRYPT
  <runtime> decrypt.ts <cipherHex> <keyHex>
`);
  exit(0);
}

// ── format hit for terminal ───────────────────────────────────────────────────
function fmt(r: GrindResult): string {
  const enc = r.encrypted ? "\x1b[33m[ENC]\x1b[0m" : "\x1b[32m[PLAIN]\x1b[0m";
  let s = `\x1b[32m✔\x1b[0m ${enc} \x1b[36m${r.address}\x1b[0m\n`;
  s    += `  secretKey : ${r.secretKey}\n`;
  if (r.encrypted) s += `  \x1b[33mdecryptKey: ${r.decryptKey}\x1b[0m\n`;
  return s;
}

function envInt(name: string, fallback?: number): number | undefined {
  const v = env(name);
  if (v == null || v === "") return fallback;
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

function envTruthy(name: string): boolean {
  const v = (env(name) ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Deploy: no KV/SQLite for user hits unless VANITY_HTTP_PERSIST_HITS. Any host: VANITY_HTTP_EPHEMERAL=1 skips persist. */
function httpUsesEphemeralHits(): boolean {
  if (envTruthy("VANITY_HTTP_EPHEMERAL")) return true;
  const onDeploy = Boolean(env("DENO_DEPLOYMENT_ID"));
  if (!onDeploy) return false;
  return !envTruthy("VANITY_HTTP_PERSIST_HITS");
}

/** One grind at a time on Deno Deploy to avoid multiplying worker memory across requests. */
let deployGrindChain = Promise.resolve();
function runDeploySerialized<T>(fn: () => Promise<T>): Promise<T> {
  if (!env("DENO_DEPLOYMENT_ID")) return fn();
  const next = deployGrindChain.then(() => fn());
  deployGrindChain = next.then(() => {}).catch(() => {});
  return next;
}

type DeployCapInfo = {
  cap: number;
  rssMB: number | null;
  heapMB: number | null;
  source: string;
};

/** Isolate RSS/heap hints on Deploy (not host RAM). Override with VANITY_DEPLOY_MAX_WORKERS or budget envs. */
function computeDeployWorkerCap(): DeployCapInfo {
  if (!env("DENO_DEPLOYMENT_ID")) {
    return { cap: 1024, rssMB: null, heapMB: null, source: "not-deploy" };
  }
  const hard = envInt("VANITY_DEPLOY_MAX_WORKERS");
  if (hard != null && hard >= 1) {
    return { cap: Math.min(512, hard), rssMB: null, heapMB: null, source: "env:VANITY_DEPLOY_MAX_WORKERS" };
  }
  let rss = 0;
  let heap = 0;
  try {
    const mu = (globalThis as any).Deno?.memoryUsage?.();
    if (mu && typeof mu.rss === "number") rss = mu.rss;
    if (mu && typeof mu.heapUsed === "number") heap = mu.heapUsed;
  } catch { /* ignore */ }
  const rssMB = rss > 0 ? rss / (1024 * 1024) : null;
  const heapMB = heap > 0 ? heap / (1024 * 1024) : null;
  const budgetMb = envInt("VANITY_DEPLOY_MEMORY_BUDGET_MB");
  const perWorkerMb = envInt("VANITY_DEPLOY_MB_PER_WORKER") ?? 48;
  if (budgetMb != null && budgetMb > 0) {
    const c = Math.max(2, Math.min(128, Math.floor(budgetMb / Math.max(8, perWorkerMb))));
    return { cap: c, rssMB, heapMB, source: "env-budget" };
  }
  let cap = 6;
  if (rssMB != null) {
    if (rssMB < 70) cap = 8;
    else if (rssMB < 110) cap = 6;
    else if (rssMB < 180) cap = 4;
    else cap = 3;
  }
  if (heapMB != null && heapMB > 200) cap = Math.min(cap, 4);
  return { cap, rssMB, heapMB, source: "rss-tiers" };
}

async function getSystemInfo(): Promise<Record<string, unknown>> {
  const base = {
    runtime: RUNTIME,
    cpuCount,
    recommendedThreads: cpuCount,
    memoryTotalMB: null as number | null,
    memoryFreeMB: null as number | null,
    platform: "unknown",
    httpEphemeralHits: httpUsesEphemeralHits(),
  };
  try {
    const deployId = env("DENO_DEPLOYMENT_ID");
    if (deployId) {
      let region: string | null = null;
      try {
        region = (globalThis as any).Deno?.env?.get?.("DENO_REGION") ?? null;
      } catch { /* no env cap */ }
      const cap = computeDeployWorkerCap();
      return {
        ...base,
        platform: "deno-deploy",
        environment: "deno-deploy",
        region,
        memoryTotalMB: null,
        memoryFreeMB: null,
        deployWorkerCap: cap.cap,
        deployWorkerCapSource: cap.source,
        deployRssMB: cap.rssMB != null ? Number(cap.rssMB.toFixed(2)) : null,
        deployHeapMB: cap.heapMB != null ? Number(cap.heapMB.toFixed(2)) : null,
        deploySerializeGrinds: true,
        note:
          "Deno Deploy: host RAM is not exposed; worker cap uses isolate RSS/heap heuristics (or VANITY_DEPLOY_MAX_WORKERS / VANITY_DEPLOY_MEMORY_BUDGET_MB + VANITY_DEPLOY_MB_PER_WORKER). POST /grind runs one at a time per isolate. User hits are not persisted unless VANITY_HTTP_PERSIST_HITS=1 (KV).",
      };
    }
    if (RUNTIME === "deno") {
      base.platform = (globalThis as any).Deno?.build?.os ?? "deno";
      try {
        const mem = (globalThis as any).Deno?.systemMemoryInfo?.();
        if (mem?.total) base.memoryTotalMB = Math.round(mem.total / (1024 * 1024));
        if (mem?.free) base.memoryFreeMB = Math.round(mem.free / (1024 * 1024));
      } catch { /* missing --allow-sys etc. */ }
      return { ...base };
    }
    try {
      const os = await import("node:os");
      base.platform = `${os.platform()}-${os.arch()}`;
      base.memoryTotalMB = Math.round(os.totalmem() / (1024 * 1024));
      base.memoryFreeMB = Math.round(os.freemem() / (1024 * 1024));
    } catch {
      base.platform = RUNTIME;
    }
    return { ...base };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, platform: "error", error: msg };
  }
}

function effectiveWorkerPreview(o: GrindOpts): { raw: number; capped: number } {
  const raw = RUNTIME === "bun"
    ? Math.max(1, Math.round(o.threads * o.bunOversubscribe))
    : Math.max(1, o.threads);
  const capped = Math.min(raw, Math.max(1, o.maxWorkers));
  return { raw, capped };
}

function formatMismatch(first: number, last: number, pLen: number, _sLen: number): string {
  if (first < 0 && last < 0) return "—";
  const cell = (i: number) => {
    if (i < 0) return "—";
    if (i < pLen) return `P${i}`;
    return `S${i - pLen}`;
  };
  return `${cell(first)}→${cell(last)}`;
}

// ── server mode ───────────────────────────────────────────────────────────────
async function runServer() {
  const onDeploy = Boolean(env("DENO_DEPLOYMENT_ID"));
  const db = httpUsesEphemeralHits() ? createEphemeralDb() : await initDb(dbPath);
  const sseClients = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  const sseEncoder = new TextEncoder();
  const LOG_RING_MAX = onDeploy ? 48 : 200;
  const skipRingPulse = onDeploy && !envTruthy("VANITY_SSE_LOG_PULSE");
  const logRing: Record<string, unknown>[] = [];
  const pushLogRing = (rec: Record<string, unknown>) => {
    if (skipRingPulse && rec.msg === "http_grind_pulse") return;
    logRing.push(rec);
    if (logRing.length > LOG_RING_MAX) logRing.splice(0, logRing.length - LOG_RING_MAX);
  };
  const sseSend = (event: string, payload: unknown) => {
    const frame = sseEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    for (const client of [...sseClients]) {
      client.write(frame).catch(() => { sseClients.delete(client); });
    }
  };
  (globalThis as any).__vanitySseBroadcast = (rec: Record<string, unknown>) => {
    pushLogRing(rec);
    sseSend("log", rec);
  };
  console.log(BANNER);
  console.log(`\x1b[32m🌐  http://0.0.0.0:${port}\x1b[0m\n`);
  log.info("server_listen", { port, dbPath, runtime: RUNTIME, httpEphemeralHits: httpUsesEphemeralHits() });

  const corsConfigured = Boolean((env("ACCESS_CONTROL_ALLOW_ORIGIN") ?? "").trim());

  /** Reflect request origin when allowed; always allow same-host (fixes local dev with production CORS env). */
  const resolveCorsAllowOrigin = (req: Request): string | null => {
    const raw = (env("ACCESS_CONTROL_ALLOW_ORIGIN") ?? "").trim();
    if (!raw) return null;
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.get("origin");
    try {
      const reqOrigin = `${new URL(req.url).protocol}//${new URL(req.url).host}`;
      if (origin && origin === reqOrigin) return origin;
    } catch { /* ignore */ }
    if (origin && (list.includes(origin) || list.includes("*"))) return origin;
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      if (env("VANITY_CORS_ALLOW_LOCALHOST") === "1" || list.some((o) => /localhost|127\.0\.0\.1/i.test(o))) {
        return origin;
      }
    }
    return null;
  };

  const applyCors = (req: Request, res: Response): Response => {
    const allow = resolveCorsAllowOrigin(req);
    if (!allow) return res;
    const h = new Headers(res.headers);
    h.set("access-control-allow-origin", allow);
    h.set("access-control-allow-methods", "GET, HEAD, POST, DELETE, OPTIONS");
    h.set("access-control-allow-headers", "content-type, accept, authorization");
    h.set("vary", "origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  };

  serveHttp(port, async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const t0 = Date.now();
    log.debug("http_request", { method: req.method, path: url.pathname });

    const done = (res: Response) => {
      const out = applyCors(req, res);
      log.info("http_response", { method: req.method, path: url.pathname, status: out.status, ms: Date.now() - t0 });
      return out;
    };

    try {
      if (corsConfigured && req.method === "OPTIONS") {
        const allow = resolveCorsAllowOrigin(req);
        if (!allow) {
          return new Response(JSON.stringify({ error: "CORS origin not allowed" }), { status: 403 });
        }
        return done(new Response(null, { status: 204 }));
      }
      if (req.method === "GET" && url.pathname === "/health")
        return done(Response.json({ ok: true, ts: Date.now(), runtime: RUNTIME }));

      if (
        req.method === "GET" &&
        (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico" || url.pathname === "/solden-mark.svg")
      ) {
        return done(new Response(await getSoldMarkSvg(), {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=86400",
          },
        }));
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html"))
        return done(new Response(await getControlPanelHtml(), { headers: { "content-type": "text/html; charset=utf-8" } }));

      if (req.method === "GET" && url.pathname === "/events") {
        const stream = new TransformStream<Uint8Array, Uint8Array>();
        const writer = stream.writable.getWriter();
        sseClients.add(writer);
        let closed = false;
        let pingTimer: ReturnType<typeof setInterval> | undefined;
        const detach = () => {
          if (closed) return;
          closed = true;
          if (pingTimer !== undefined) clearInterval(pingTimer);
          pingTimer = undefined;
          sseClients.delete(writer);
          writer.close().catch(() => {});
        };
        if (req.signal.aborted) detach();
        else req.signal.addEventListener("abort", detach, { once: true });
        void writer.write(sseEncoder.encode(`event: status\ndata: ${JSON.stringify({ message: "connected" })}\n\n`)).catch(detach);
        void (async () => {
          for (const rec of logRing) {
            if (closed) return;
            await writer.write(sseEncoder.encode(`event: log\ndata: ${JSON.stringify(rec)}\n\n`)).catch(detach);
          }
        })();
        pingTimer = setInterval(() => {
          if (closed) return;
          void writer.write(sseEncoder.encode(": ping\n\n")).catch(detach);
        }, 20_000);
        return done(new Response(stream.readable, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            "x-accel-buffering": "no",
          },
        }));
      }

      if (req.method === "GET" && url.pathname === "/system")
        return done(Response.json(await getSystemInfo()));

      if (req.method === "GET" && url.pathname === "/results")
        return done(Response.json(await db.getHits()));

      if (req.method === "POST" && url.pathname === "/grind") {
        log.info("http_grind_post", {
          origin: req.headers.get("origin") ?? null,
          contentLength: req.headers.get("content-length") ?? null,
          acceptNdjson: (req.headers.get("accept") ?? "").toLowerCase().includes("application/x-ndjson"),
          note: "response may stream NDJSON when Accept includes application/x-ndjson",
        });
        let body: Partial<GrindOpts>;
        try { body = await req.json(); }
        catch {
          log.warn("grind_invalid_json", { ms: Date.now() - t0 });
          return done(Response.json({ error: "invalid JSON" }, { status: 400 }));
        }

        const go = parseHttpGrindBody(body);
        const adminMode = isAdminRequest(req);
        const adminPerf = adminMode
          ? resolveAdminPerfMode(body as Record<string, unknown>)
          : "standard";

        if (!go.prefix && !go.suffix) {
          log.warn("http_grind_reject_empty_pattern", { origin: req.headers.get("origin") ?? null });
          return done(Response.json({ error: "prefix or suffix required" }, { status: 400 }));
        }

        let goForGrind: GrindOpts;
        let capInfo = computeDeployWorkerCap();
        if (adminMode) {
          goForGrind = applyAdminOpts(go, adminPerf);
          log.info("http_grind_admin_perf", {
            perfMode: adminPerf,
            threads: goForGrind.threads,
            maxWorkers: goForGrind.maxWorkers,
          });
        } else {
          goForGrind = {
            ...go,
            threads: Math.min(go.threads, capInfo.cap),
            maxWorkers: Math.min(go.maxWorkers, capInfo.cap),
          };
          if (go.threads !== goForGrind.threads || go.maxWorkers !== goForGrind.maxWorkers) {
            log.warn("http_grind_deploy_worker_cap", {
              requestedThreads: go.threads,
              requestedMaxWorkers: go.maxWorkers,
              appliedCap: capInfo.cap,
              capSource: capInfo.source,
              rssMB: capInfo.rssMB != null ? Number(capInfo.rssMB.toFixed(2)) : undefined,
              heapMB: capInfo.heapMB != null ? Number(capInfo.heapMB.toFixed(2)) : undefined,
            });
          }
        }

        const thresholdHits: ThresholdCapture[] = [];

        const rawHttpWorkers = RUNTIME === "bun"
          ? Math.max(1, Math.round(goForGrind.threads * goForGrind.bunOversubscribe))
          : Math.max(1, goForGrind.threads);
        const httpEffWorkers = Math.min(rawHttpWorkers, Math.max(1, goForGrind.maxWorkers));

        log.info("http_grind", {
          prefix: goForGrind.prefix,
          suffix: goForGrind.suffix,
          count: goForGrind.count,
          threads: goForGrind.threads,
          effectiveWorkers: httpEffWorkers,
          deployCap: env("DENO_DEPLOYMENT_ID") ? capInfo.cap : undefined,
          useWebgpu: goForGrind.useWebgpu,
          origin: req.headers.get("origin") ?? null,
          referer: (req.headers.get("referer") ?? "").slice(0, 120) || null,
        });
        sseSend("status", { message: "grind_started", opts: { ...goForGrind, decryptKey: undefined } });

        const grindWall0 = Date.now();
        let lastGrindLogMs = 0;
        let lastWireProgressMs = 0;
        const GRIND_LOG_INTERVAL_MS = 5000;
        const deployProgressWireMs = onDeploy ? Math.max(120, Math.min(2000, goForGrind.uiRefreshMs)) : 0;
        const wantNdjson = (req.headers.get("accept") ?? "").toLowerCase().includes("application/x-ndjson");
        let ndjsonWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
        const ndjsonEnc = new TextEncoder();

        const onHttpProgress = (msg: WorkerMsg & { type: "progress" }) => {
          const now = Date.now();
          const wallSec = Math.max(0.001, (now - grindWall0) / 1000);
          const tc = msg.totalChecked ?? 0;
          const avgKpsWall = tc / wallSec;
          const payload = {
            ...msg,
            avgKpsWall,
            wallElapsedSec: Number(wallSec.toFixed(2)),
          };
          const allowWire = deployProgressWireMs === 0 || now - lastWireProgressMs >= deployProgressWireMs;
          if (allowWire) {
            lastWireProgressMs = now;
            sseSend("progress", payload);
            if (ndjsonWriter) {
              void ndjsonWriter.write(ndjsonEnc.encode(JSON.stringify(payload) + "\n")).catch(() => {});
            }
          }
          if (now - lastGrindLogMs < GRIND_LOG_INTERVAL_MS) return;
          lastGrindLogMs = now;
          const elapsedSec = wallSec;
          const avgK = avgKpsWall / 1000;
          const instK = (msg.aggregateKps ?? 0) / 1000;
          const addr = msg.bestAddress ?? "";
          const addrHead = addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : (addr || "");
          const pLen = goForGrind.prefix.length;
          const fi = msg.firstMismatchIndex ?? -1;
          const li = msg.lastMismatchIndex ?? -1;
          const misCell = (i: number) => {
            if (i < 0) return "—";
            if (i < pLen) return `P${i}`;
            return `S${i - pLen}`;
          };
          const misPulse = fi < 0 && li < 0 ? "—" : `${misCell(fi)}→${misCell(li)}`;
          log.info("http_grind_pulse", {
            elapsed: formatElapsedSeconds(elapsedSec),
            tSec: Number(elapsedSec.toFixed(1)),
            w: msg.effectiveWorkers,
            chk: tc,
            instK: Number(instK.toFixed(2)),
            avgK: Number(avgK.toFixed(2)),
            score: msg.bestScorePercent,
            bestAcc: msg.bestAccuracyPercent,
            runAvgAcc: msg.runningAvgAccuracyPercent,
            mis: misPulse,
            addrHead: addrHead || undefined,
          });
        };

        const onThresholdHit = (msg: WorkerMsg & { type: "threshold" }) => {
          const cap = captureThreshold(msg);
          thresholdHits.push(cap);
          log.info("http_threshold_hit", { score: cap.score, address: cap.address.slice(0, 10) + "…" });
          sseSend("threshold", { ...msg, ...cap });
          if (ndjsonWriter) {
            void ndjsonWriter.write(
              ndjsonEnc.encode(JSON.stringify({ type: "threshold", ...cap }) + "\n"),
            ).catch(() => {});
          }
        };

        const runGrindWithHandlers = async () => {
          const run = () => grind(
            goForGrind,
            onHttpProgress,
            onThresholdHit,
            (msg) => sseSend("bin", { workerId: msg.workerId, score: msg.score, address: msg.address }),
            req.signal,
          );
          if (adminMode && adminPerf !== "standard") return await run();
          return await runDeploySerialized(run);
        };

        const isGrindAbortError = (e: unknown) =>
          (typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError") ||
          (e instanceof Error && e.name === "AbortError");

        if (wantNdjson) {
          const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
          ndjsonWriter = writable.getWriter();
          void ndjsonWriter.write(
            ndjsonEnc.encode(
              JSON.stringify({
                type: "started",
                t: Date.now(),
                prefix: goForGrind.prefix,
                suffix: goForGrind.suffix,
                appliedThreads: goForGrind.threads,
                appliedMaxWorkers: goForGrind.maxWorkers,
                deployCap: env("DENO_DEPLOYMENT_ID") ? capInfo.cap : undefined,
              }) + "\n",
            ),
          ).catch(() => {});
          void (async () => {
            try {
              const results = await runGrindWithHandlers();
              await db.saveHits(results);
              log.info("http_grind_ok", { hits: results.length, ms: Date.now() - t0, stream: "ndjson" });
              sseSend("status", { message: "grind_complete", hits: results.length, ms: Date.now() - t0 });
              const grindWallMs = Date.now() - grindWall0;
              await ndjsonWriter!.write(
                ndjsonEnc.encode(
                  JSON.stringify({
                    type: "done",
                    hits: results,
                    thresholdHits,
                    wallElapsedSec: Number((grindWallMs / 1000).toFixed(3)),
                  }) + "\n",
                ),
              );
            } catch (e: unknown) {
              if (isGrindAbortError(e)) {
                log.warn("http_grind_aborted", { prefix: goForGrind.prefix, ms: Date.now() - t0, stream: "ndjson" });
                sseSend("status", { message: "grind_cancelled", ms: Date.now() - t0 });
                await ndjsonWriter!.write(
                  ndjsonEnc.encode(
                    JSON.stringify({
                      type: "cancelled",
                      message: "client disconnected or aborted",
                    }) + "\n",
                  ),
                ).catch(() => {});
              } else {
                const err = e instanceof Error ? e : new Error(String(e));
                log.error("http_grind_failed", { prefix: goForGrind.prefix, ms: Date.now() - t0, stream: "ndjson" }, err);
                sseSend("status", { message: "grind_failed", error: err.message });
                await ndjsonWriter!.write(ndjsonEnc.encode(JSON.stringify({ type: "error", message: err.message }) + "\n")).catch(
                  () => {},
                );
              }
            } finally {
              try {
                await ndjsonWriter?.close();
              } catch { /* ignore */ }
              ndjsonWriter = null;
            }
          })();
          return done(new Response(readable, {
            status: 200,
            headers: {
              "content-type": "application/x-ndjson; charset=utf-8",
              "cache-control": "no-cache, no-transform",
              "x-accel-buffering": "no",
            },
          }));
        }

        try {
          const results = await runGrindWithHandlers();
          await db.saveHits(results);
          const grindWallMs = Date.now() - grindWall0;
          log.info("http_grind_ok", { hits: results.length, ms: Date.now() - t0 });
          sseSend("status", { message: "grind_complete", hits: results.length, ms: Date.now() - t0 });
          return done(
            new Response(JSON.stringify({ hits: results, thresholdHits }), {
              headers: {
                "content-type": "application/json; charset=utf-8",
                "x-grind-wall-ms": String(grindWallMs),
              },
            }),
          );
        } catch (e: unknown) {
          if (isGrindAbortError(e)) {
            log.warn("http_grind_aborted", { prefix: goForGrind.prefix, ms: Date.now() - t0 });
            sseSend("status", { message: "grind_cancelled", ms: Date.now() - t0 });
            return done(Response.json({ error: "cancelled", message: "client disconnected or aborted" }, { status: 499 }));
          }
          const err = e instanceof Error ? e : new Error(String(e));
          log.error("http_grind_failed", { prefix: goForGrind.prefix, ms: Date.now() - t0 }, err);
          sseSend("status", { message: "grind_failed", error: err.message });
          return done(Response.json({ error: err.message }, { status: 500 }));
        }
      }

      if (req.method === "GET" && url.pathname === "/admin.html")
        return done(new Response(await getAdminPanelHtml(), { headers: { "content-type": "text/html; charset=utf-8" } }));

      if (req.method === "POST" && url.pathname === "/admin/api/login") {
        let pw = "";
        try {
          const j = await req.json() as { password?: string };
          pw = String(j.password ?? "");
        } catch { /* ignore */ }
        if (!verifyAdminPassword(pw)) {
          return done(Response.json({ error: "invalid password" }, { status: 401 }));
        }
        const sess = createAdminSession();
        if (!sess) return done(Response.json({ error: "admin not configured" }, { status: 503 }));
        return done(Response.json(sess));
      }

      if (req.method === "POST" && url.pathname === "/admin/api/logout") {
        const tok = extractAdminToken(req);
        if (tok) revokeAdminSession(tok);
        return done(Response.json({ ok: true }));
      }

      if (req.method === "GET" && url.pathname === "/admin/api/status") {
        return done(Response.json({ configured: adminPasswordConfigured() }));
      }

      if (url.pathname.startsWith("/admin/api/")) {
        if (!isAdminRequest(req)) {
          return done(Response.json({ error: "unauthorized" }, { status: 401 }));
        }

        if (req.method === "GET" && url.pathname === "/admin/api/monitor") {
          return done(Response.json(await getResourceMonitor()));
        }

        if (req.method === "GET" && url.pathname === "/admin/api/jobs") {
          return done(Response.json(listJobs()));
        }

        const jobMatch = url.pathname.match(/^\/admin\/api\/jobs\/([^/]+)$/);
        if (jobMatch) {
          const jobId = jobMatch[1]!;
          if (req.method === "GET") {
            const job = getJob(jobId);
            if (!job) return done(Response.json({ error: "not found" }, { status: 404 }));
            return done(Response.json(job));
          }
          if (req.method === "DELETE") {
            const job = getJob(jobId);
            if (!job) return done(Response.json({ error: "not found" }, { status: 404 }));
            const cancelOnly = url.searchParams.get("cancel") === "1";
            if (cancelOnly) {
              if (!cancelJob(jobId)) {
                return done(Response.json({
                  error: "cannot cancel",
                  status: job.status,
                }, { status: 409 }));
              }
              return done(Response.json({ ok: true, id: jobId, status: getJob(jobId)?.status ?? "cancelled" }));
            }
            if (!deleteJob(jobId)) {
              return done(Response.json({ error: "delete failed" }, { status: 409 }));
            }
            return done(Response.json({ ok: true, id: jobId, deleted: true }));
          }
        }

        if (req.method === "POST" && url.pathname === "/admin/api/system/cleanup") {
          return done(Response.json(await adminMemoryCleanup()));
        }

        if (req.method === "POST" && url.pathname === "/admin/api/system/restart") {
          const restartAllowed = adminRestartAllowed();
          if (!restartAllowed) {
            return done(Response.json({
              ok: false,
              allowed: false,
              message: "Set VANITY_ADMIN_ALLOW_RESTART=1 on the server to enable restart",
            }, { status: 403 }));
          }
          const result = adminRequestRestart();
          return done(Response.json({ ...result, allowed: true }));
        }

        if (req.method === "POST" && url.pathname === "/admin/api/jobs") {
          let body: Partial<GrindOpts> & { unthrottled?: boolean };
          try { body = await req.json(); }
          catch { return done(Response.json({ error: "invalid JSON" }, { status: 400 })); }
          const go = parseHttpGrindBody(body);
          if (!go.prefix && !go.suffix) {
            return done(Response.json({ error: "prefix or suffix required" }, { status: 400 }));
          }
          const perfMode = resolveAdminPerfMode(body);
          const jobOrErr = startBackgroundJob(go, perfMode, async (opts, hooks, signal) => {
            return grind(
              opts,
              (p) => hooks.onProgress(p as Record<string, unknown>),
              (m) => hooks.onThreshold(captureThreshold(m)),
              undefined,
              signal,
            );
          });
          if ("error" in jobOrErr) {
            return done(Response.json({ error: jobOrErr.error }, { status: 503 }));
          }
          return done(Response.json(jobOrErr, { status: 201 }));
        }
      }

      return done(Response.json({ error: "not found" }, { status: 404 }));
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      log.error("http_unhandled", { method: req.method, path: url.pathname, ms: Date.now() - t0 }, err);
      return done(Response.json({ error: err.message }, { status: 500 }));
    }
  });
}

// ── CLI mode ──────────────────────────────────────────────────────────────────
async function runCli() {
  if (!opts.prefix && !opts.suffix) {
    log.error("cli_missing_prefix_suffix", {});
    console.error("\x1b[31m❌  --prefix and/or --suffix required\x1b[0m");
    exit(1);
  }

  log.info("cli_start", {
    prefix: opts.prefix,
    suffix: opts.suffix,
    workers: opts.threads,
    bunOversubscribe: opts.bunOversubscribe,
    maxWorkers: opts.maxWorkers,
    progressEvery: opts.progressEvery,
    keygen: opts.keygen,
    keygenBatch: opts.keygenBatch,
    uiRefreshMs: opts.uiRefreshMs,
    count: opts.count,
    threshold: opts.threshold,
    encrypt: opts.encrypt,
    outFile,
    binFile,
    dbPath,
  });

  const { raw: rawEff, capped: previewEff } = effectiveWorkerPreview(opts);
  if (rawEff > opts.maxWorkers) log.warn("cli_workers_capped", { raw: rawEff, cap: opts.maxWorkers });

  console.log(BANNER);
  const sys = await getSystemInfo();
  const rows: [string, string][] = [
    ["Runtime", String(sys.runtime)],
    ["CPU cores", String(sys.cpuCount)],
    ["Platform", String(sys.platform)],
    ["Memory MB (total / free)", `${sys.memoryTotalMB ?? "n/a"} / ${sys.memoryFreeMB ?? "n/a"}`],
    ["Threads (-t)", String(opts.threads)],
    ["Bun oversubscribe (-B)", String(opts.bunOversubscribe)],
    ["Workers (raw → capped)", `${rawEff} → ${previewEff}`],
    ["Max workers cap (-m)", String(opts.maxWorkers)],
    ["Prefix / suffix", `"${opts.prefix}" / "${opts.suffix}"`],
    ["Pattern lens pfx,sfx", `${opts.prefix.length},${opts.suffix.length}`],
    ["Case-sensitive", String(opts.caseSensitive)],
    ["Threshold / count", `${opts.threshold}% / ${opts.count}`],
    ["Keygen (-K)", String(opts.keygen)],
    ["Keygen batch (-G)", String(opts.keygenBatch)],
    ["DB path", dbPath],
    ["Output JSONL", outFile],
    ["Bin JSONL (70–80%)", binFile],
  ];
  const kW = Math.max(...rows.map((r) => r[0].length), 8);
  const vW = 44;
  const bar = (n: number) => "─".repeat(n);
  console.log(`\x1b[2m┌${bar(kW + 2)}┬${bar(vW + 2)}┐\x1b[0m`);
  for (const [k, v] of rows) {
    const vv = v.length > vW ? v.slice(0, vW - 1) + "…" : v;
    console.log(`\x1b[2m│ ${k.padEnd(kW)} │ ${vv.padEnd(vW)} │\x1b[0m`);
  }
  console.log(`\x1b[2m└${bar(kW + 2)}┴${bar(vW + 2)}┘\x1b[0m`);
  console.log("\x1b[2mLive: stdout (one progress line) · stderr: JSON or compact 5s pulse (set LOG_VERBOSE=1 for full heartbeat JSON on TTY).\x1b[0m");
  console.log("\x1b[2mMis Pk→Sn: first/last mismatch vs target (P=prefix index, S=suffix index). Example P0→P0 = only first char differs.\x1b[0m");
  console.log("\x1b[2mVanity search is random valid Ed25519 keys; you cannot “walk” base58 toward a prefix and stay on-curve.\x1b[0m\n");

  const db       = await initDb(dbPath);
  const writer   = await openAppend(outFile);
  const binWriter = await openAppend(binFile);
  const t0       = Date.now();

  const threshLines: string[] = [];
  const THRESH_BATCH = 64;
  const flushThresholds = () => {
    if (!threshLines.length) return;
    writer.write(threshLines.join(""));
    threshLines.length = 0;
  };

  const binLines: string[] = [];
  const BIN_BATCH = 48;
  const flushBins = () => {
    if (!binLines.length) return;
    binWriter.write(binLines.join(""));
    binLines.length = 0;
  };

  const snap = {
    totalChecked: 0,
    aggregateKps: 0,
    effectiveWorkers: previewEff,
    bestScorePercent: 0,
    bestAccuracyPercent: 0,
    bestMatchedTargetChars: 0,
    bestTargetLen: 0,
    bestAddress: "",
    bestPrefixWindow: "",
    bestSuffixWindow: "",
    firstMismatchIndex: -1,
    lastMismatchIndex: -1,
    runningAvgAccuracyPercent: 0,
  };

  let progressLinePrimed = false;
  function renderProgressLine() {
    if (!isTTY) return;
    if (!progressLinePrimed) {
      writeStdout("\n\x1b[1A");
      progressLinePrimed = true;
    }
    const W = stdoutColumns();
    const wallSec = Math.max(0.001, (Date.now() - t0) / 1000);
    const avgKps = snap.totalChecked / wallSec / 1000;
    const instKps = snap.aggregateKps / 1000;
    const accChunk = snap.bestTargetLen
      ? `${snap.bestMatchedTargetChars}/${snap.bestTargetLen}@${snap.bestAccuracyPercent}%`
      : "n/a";
    const mis = formatMismatch(snap.firstMismatchIndex, snap.lastMismatchIndex, opts.prefix.length, opts.suffix.length);
    const dim = "\x1b[2m", rst = "\x1b[0m", bar = "\x1b[36m│\x1b[0m";
    const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…");
    const lineRaw =
      `${dim}t=${formatElapsedSeconds(wallSec)}${rst}${bar}` +
      `${String(snap.effectiveWorkers).padStart(2)}w${bar}` +
      `${snap.totalChecked.toLocaleString()} keys${bar}` +
      `${instKps.toFixed(1)}/${avgKps.toFixed(1)}k/s${bar}` +
      `sc ${snap.bestScorePercent}%${bar}acc ${accChunk}${bar}mis ${mis}${bar}ravg ${snap.runningAvgAccuracyPercent}%`;
    writeStdout(`\r\x1b[2K${clip(lineRaw, W)}`);
  }

  let spin: ReturnType<typeof setInterval> | undefined;
  if (isTTY) spin = setInterval(renderProgressLine, Math.max(50, opts.uiRefreshMs | 0));

  const HEARTBEAT_MS = 5000;
  const hb = setInterval(() => {
    const wallSec = Math.max(0.001, (Date.now() - t0) / 1000);
    const avgKps = snap.totalChecked / wallSec / 1000;
    const instKps = snap.aggregateKps / 1000;
    const ba = snap.bestAddress ?? "";
    const addrHead = ba.length > 12 ? `${ba.slice(0, 6)}…${ba.slice(-6)}` : ba;
    log.info("cli_heartbeat", {
      tSec: Number(wallSec.toFixed(1)),
      w: snap.effectiveWorkers,
      chk: snap.totalChecked,
      instK: Number(instKps.toFixed(2)),
      avgK: Number(avgKps.toFixed(2)),
      score: snap.bestScorePercent,
      bestAcc: snap.bestAccuracyPercent,
      runAvgAcc: snap.runningAvgAccuracyPercent,
      mis: formatMismatch(snap.firstMismatchIndex, snap.lastMismatchIndex, opts.prefix.length, opts.suffix.length),
      addrHead: addrHead || undefined,
    });
  }, HEARTBEAT_MS);

  let results: GrindResult[];
  try {
    results = await grind(
      opts,
      (msg) => {
        if (msg.type === "progress") {
          if (msg.totalChecked != null) {
            snap.totalChecked = msg.totalChecked;
            snap.aggregateKps = msg.aggregateKps ?? 0;
            snap.effectiveWorkers = msg.effectiveWorkers ?? snap.effectiveWorkers;
            snap.bestScorePercent = msg.bestScorePercent ?? snap.bestScorePercent;
            snap.bestAccuracyPercent = msg.bestAccuracyPercent ?? snap.bestAccuracyPercent;
            snap.bestMatchedTargetChars = msg.bestMatchedTargetChars ?? snap.bestMatchedTargetChars;
            snap.bestTargetLen = msg.bestTargetLen ?? snap.bestTargetLen;
            snap.bestAddress = msg.bestAddress ?? snap.bestAddress;
            snap.bestPrefixWindow = msg.bestPrefixWindow ?? snap.bestPrefixWindow;
            snap.bestSuffixWindow = msg.bestSuffixWindow ?? snap.bestSuffixWindow;
            snap.firstMismatchIndex = msg.firstMismatchIndex ?? snap.firstMismatchIndex;
            snap.lastMismatchIndex = msg.lastMismatchIndex ?? snap.lastMismatchIndex;
            snap.runningAvgAccuracyPercent = msg.runningAvgAccuracyPercent ?? snap.runningAvgAccuracyPercent;
          }
          renderProgressLine();
        }
      },
      (msg) => {
        threshLines.push(JSON.stringify({ ...msg, ts: Date.now() }) + "\n");
        if (threshLines.length >= THRESH_BATCH) flushThresholds();
        log.debug("threshold_candidate", { workerId: msg.workerId, score: msg.score, address: msg.address });
      },
      (msg) => {
        binLines.push(JSON.stringify({ ...msg, ts: Date.now() }) + "\n");
        if (binLines.length >= BIN_BATCH) flushBins();
        log.debug("bin_band_candidate", { workerId: msg.workerId, score: msg.score, address: msg.address });
      },
    );
  } finally {
    if (spin !== undefined) clearInterval(spin);
    clearInterval(hb);
  }

  flushThresholds();
  flushBins();

  log.info("cli_grind_finished", { hits: results.length, ms: Date.now() - t0 });

  if (isTTY && progressLinePrimed) writeStdout("\x1b[1B\r\x1b[2K\n");
  else if (isTTY) writeStdout("\r" + " ".repeat(Math.min(100, stdoutColumns())) + "\r");

  await db.saveHits(results);
  if (results.length) writer.write(results.map((r) => JSON.stringify(r) + "\n").join(""));

  for (const r of results) {
    console.log(fmt(r));
  }

  writer.close();
  binWriter.close();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  log.info("cli_done", { hits: results.length, elapsedSec: elapsed, outFile, binFile, dbPath });
  console.log(`\x1b[2m✅  ${results.length} found in ${elapsed}s  →  ${outFile}  |  ${binFile}  |  ${dbPath}\x1b[0m`);
}

// ── entry ─────────────────────────────────────────────────────────────────────
if (server) runServer().catch((e) => { log.error("server_fatal", {}, e instanceof Error ? e : new Error(String(e))); exit(1); });
else        runCli().catch((e) => { log.error("cli_fatal", {}, e instanceof Error ? e : new Error(String(e))); exit(1); });
