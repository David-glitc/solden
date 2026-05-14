// ── main.ts ───────────────────────────────────────────────────────────────────
// SOL VANITY — CLI + HTTP server
//
// Run with:
//   node --experimental-sqlite --experimental-strip-types main.ts [opts]
//   bun main.ts [opts]
//   deno run --allow-read --allow-write --allow-net main.ts [opts]

import { RUNTIME, cpuCount, argv, exit, isTTY, writeStdout, stdoutColumns, openAppend, serveHttp } from "./runtime.ts";
import { initDb }     from "./db.ts";
import { grind }      from "./grind.ts";
import { configureLogging, createLogger } from "./log.ts";
import type { GrindOpts, GrindResult } from "./types.ts";
import { UI_HTML } from "./ui.ts";
import { LOGO_SVG } from "./brand.ts";

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
};

const dbPath  = str(["db-path", "d"], "vanity.db");
const outFile = str(["output",  "o"], "hits.jsonl");
const binFile = str(["bin-jsonl", "f"], "bin.jsonl");
function env(name: string): string | undefined {
  if (typeof (globalThis as any).Deno !== "undefined") {
    try { return (globalThis as any).Deno.env.get(name) ?? undefined; }
    catch { return undefined; }
  }
  if (typeof process !== "undefined") return (process as any).env?.[name];
  return undefined;
}
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
  <runtime> main.ts [options]
  <runtime> main.ts --server

OPTIONS
  -p, --prefix <str>        Target prefix             e.g. ATOM
  -s, --suffix <str>        Target suffix             e.g. ic
  -n, --count  <int>        Addresses to find         [default: 1]
  -t, --threads <int>       Worker count              [default: all CPUs]
  -B, --bun-oversubscribe <float>  Bun worker multiplier [default: 1.0]
  -g, --progress-every <int> Worker progress cadence  [default: 512]
  -u, --ui-refresh-ms <int> Progress redraw cadence   [default: 5000]
  -f, --bin-jsonl <path>    JSONL for scores 70–80%   [default: bin.jsonl]
  -m, --max-workers <int>   Cap effective workers     [default: 256]
  -c, --case-sensitive      Case-sensitive matching   [default: false]
  -r, --threshold <0-100>   Write partial matches ≥%  [default: 90]
  -e, --encrypt             Encrypt private key (AES-256-GCM)
  -k, --decrypt-key <str>   Passphrase or 64-char hex AES key (blank=auto)
  -o, --output <path>       JSONL output file         [default: hits.jsonl]
  -d, --db-path <path>      DB path (SQLite on Node/Bun; Deno KV file at <stem>.kv) [default: vanity.db]
  -S, --server              HTTP server mode
  -P, --port <int>          Server port               [default: 3737]
  -v, --verbose             Debug logging (LOG_LEVEL=debug)

SERVER ENDPOINTS
  GET  /                     Web control panel UI
  GET  /favicon.svg          App mark (also used as favicon)
  GET  /events              Server-Sent Events stream (logs/progress/status)
  GET  /system               Machine/runtime capabilities
  GET  /health              { ok, ts }
  GET  /results             last 200 hits from DB (JSON)
  POST /grind               GrindOpts body → GrindResult[]
  OPTIONS *                  CORS preflight when ACCESS_CONTROL_ALLOW_ORIGIN is set

RUNTIMES
  node --experimental-sqlite --experimental-strip-types main.ts -p ATOM
  bun main.ts -p ATOM
  deno run --allow-read --allow-write --allow-net main.ts -p ATOM

BUN SETUP (high concurrency presets)
  deno task bun-grind -- -p meth -s ic -n 1 -t 16
  deno task bun-fast  -- -p meth -s ic -n 1 -t 16

DEPLOY (Deno Deploy)
  Set entrypoint to main.ts. When DENO_DEPLOYMENT_ID is set, server mode starts automatically.
  KV uses managed openKv() on deploy. Link a KV database in the Deploy dashboard.

ENV (optional: add --allow-env to deno run if you want LOG_LEVEL / LOG_JSON from the environment)
  LOG_LEVEL   trace | debug | info | warn | error   [default: info; on Deno Deploy: debug when unset]
  LOG_JSON    1 | true — force JSON lines (no TTY colors)
  ACCESS_CONTROL_ALLOW_ORIGIN  e.g. https://your-site.vercel.app — enables CORS on /system, /events, /grind, /health (host UI elsewhere)

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

async function getSystemInfo(): Promise<Record<string, unknown>> {
  const base = {
    runtime: RUNTIME,
    cpuCount,
    recommendedThreads: cpuCount,
    memoryTotalMB: null as number | null,
    memoryFreeMB: null as number | null,
    platform: "unknown",
  };
  try {
    const deployId = env("DENO_DEPLOYMENT_ID");
    if (deployId) {
      let region: string | null = null;
      try {
        region = (globalThis as any).Deno?.env?.get?.("DENO_REGION") ?? null;
      } catch { /* no env cap */ }
      return {
        ...base,
        platform: "deno-deploy",
        environment: "deno-deploy",
        region,
        memoryTotalMB: null,
        memoryFreeMB: null,
        note: "Deno Deploy isolate: host memory is not exposed; cores below are parallelism hints.",
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
  const db = await initDb(dbPath);
  const sseClients = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  const sseEncoder = new TextEncoder();
  const LOG_RING_MAX = 200;
  const logRing: Record<string, unknown>[] = [];
  const pushLogRing = (rec: Record<string, unknown>) => {
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
  log.info("server_listen", { port, dbPath, runtime: RUNTIME });

  const corsOrigin = (env("ACCESS_CONTROL_ALLOW_ORIGIN") ?? "").trim();
  const applyCors = (res: Response): Response => {
    if (!corsOrigin) return res;
    const h = new Headers(res.headers);
    h.set("access-control-allow-origin", corsOrigin);
    h.set("access-control-allow-methods", "GET, HEAD, POST, OPTIONS");
    h.set("access-control-allow-headers", "content-type, accept");
    h.set("vary", "origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  };

  serveHttp(port, async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const t0 = Date.now();
    log.debug("http_request", { method: req.method, path: url.pathname });

    const done = (res: Response) => {
      const out = applyCors(res);
      log.info("http_response", { method: req.method, path: url.pathname, status: out.status, ms: Date.now() - t0 });
      return out;
    };

    try {
      if (corsOrigin && req.method === "OPTIONS")
        return done(new Response(null, { status: 204 }));
      if (req.method === "GET" && url.pathname === "/health")
        return done(Response.json({ ok: true, ts: Date.now(), runtime: RUNTIME }));

      if (req.method === "GET" && (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico")) {
        return done(new Response(LOGO_SVG, {
          headers: {
            "content-type": "image/svg+xml; charset=utf-8",
            "cache-control": "public, max-age=86400",
          },
        }));
      }

      if (req.method === "GET" && url.pathname === "/")
        return done(new Response(UI_HTML, { headers: { "content-type": "text/html; charset=utf-8" } }));

      if (req.method === "GET" && url.pathname === "/events") {
        const stream = new TransformStream<Uint8Array, Uint8Array>();
        const writer = stream.writable.getWriter();
        sseClients.add(writer);
        const detach = () => {
          sseClients.delete(writer);
          writer.close().catch(() => {});
        };
        req.signal.addEventListener("abort", detach);
        writer.write(sseEncoder.encode(`event: status\ndata: ${JSON.stringify({ message: "connected" })}\n\n`)).catch(detach);
        for (const rec of logRing) {
          await writer.write(sseEncoder.encode(`event: log\ndata: ${JSON.stringify(rec)}\n\n`)).catch(detach);
        }
        return done(new Response(stream.readable, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            "connection": "keep-alive",
          },
        }));
      }

      if (req.method === "GET" && url.pathname === "/system")
        return done(Response.json(await getSystemInfo()));

      if (req.method === "GET" && url.pathname === "/results")
        return done(Response.json(await db.getHits()));

      if (req.method === "POST" && url.pathname === "/grind") {
        let body: Partial<GrindOpts>;
        try { body = await req.json(); }
        catch {
          log.warn("grind_invalid_json", { ms: Date.now() - t0 });
          return done(Response.json({ error: "invalid JSON" }, { status: 400 }));
        }

        const go: GrindOpts = {
          prefix:        String(body.prefix ?? "").trim(),
          suffix:        String(body.suffix ?? "").trim(),
          count:         Math.max(1, Math.min(1_000_000, Number(body.count) || 1)),
          threads:       Math.max(1, Math.min(512, Number(body.threads) || cpuCount)),
          bunOversubscribe: Math.max(0.1, Number(body.bunOversubscribe) || 1),
          progressEvery: Math.max(64, Math.min(10_000_000, Number(body.progressEvery) || 512)),
          uiRefreshMs:   Math.max(25, Math.min(60_000, Number(body.uiRefreshMs) || 100)),
          maxWorkers:    Math.max(1, Math.min(1024, Number(body.maxWorkers) || 256)),
          caseSensitive: Boolean(body.caseSensitive),
          threshold:     Math.max(0, Math.min(100, Number(body.threshold) || 90)),
          encrypt:       Boolean(body.encrypt),
          decryptKey:    String(body.decryptKey ?? ""),
        };

        if (!go.prefix && !go.suffix)
          return done(Response.json({ error: "prefix or suffix required" }, { status: 400 }));

        log.info("http_grind", { prefix: go.prefix, suffix: go.suffix, count: go.count, threads: go.threads });
        sseSend("status", { message: "grind_started", opts: { ...go, decryptKey: undefined } });

        try {
          const results = await grind(
            go,
            (msg) => sseSend("progress", msg),
            (msg) => sseSend("threshold", { workerId: msg.workerId, score: msg.score, address: msg.address }),
            (msg) => sseSend("bin", { workerId: msg.workerId, score: msg.score, address: msg.address }),
          );
          await db.saveHits(results);
          log.info("http_grind_ok", { hits: results.length, ms: Date.now() - t0 });
          sseSend("status", { message: "grind_complete", hits: results.length, ms: Date.now() - t0 });
          return done(Response.json(results));
        } catch (e: unknown) {
          const err = e instanceof Error ? e : new Error(String(e));
          log.error("http_grind_failed", { prefix: go.prefix, ms: Date.now() - t0 }, err);
          sseSend("status", { message: "grind_failed", error: err.message });
          return done(Response.json({ error: err.message }, { status: 500 }));
        }
      }

      return done(Response.json({ error: "not found" }, { status: 404 }));
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      log.error("http_unhandled", { method: req.method, path: url.pathname, ms: Date.now() - t0 }, err);
      return Response.json({ error: err.message }, { status: 500 });
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
  console.log("\x1b[2mLive table: stdout (2 lines max) · stderr: structured logs + 5s heartbeat with full telemetry.\x1b[0m");
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

  let progressLinesPrimed = false;
  function renderProgressTwoLines() {
    if (!isTTY) return;
    if (!progressLinesPrimed) {
      writeStdout("\n\n\x1b[2A");
      progressLinesPrimed = true;
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
    const row1Raw =
      `${bar}${String(snap.effectiveWorkers).padStart(2)}w${bar}` +
      `${instKps.toFixed(1)}k ins${bar}${avgKps.toFixed(1)}k avg${bar}` +
      `${snap.totalChecked.toLocaleString()} chk${bar}` +
      `sc ${snap.bestScorePercent}%${bar}acc ${accChunk}${bar}mis ${mis}${bar}ravg ${snap.runningAvgAccuracyPercent}%${bar}`;
    const clip = (s: string, max: number) => (s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + "…");
    const row1 = clip(row1Raw, W);
    const pfx = snap.bestPrefixWindow || "—";
    const sfx = snap.bestSuffixWindow || "—";
    const addr = snap.bestAddress ? clip(snap.bestAddress, Math.min(52, Math.max(20, W - 36))) : "—";
    const row2Raw = `${dim}best windows${rst} ${bar} pfx ${pfx} ${bar} sfx ${sfx} ${bar} ${addr} ${bar}`;
    const row2 = clip(row2Raw, W);
    writeStdout(`\r\x1b[2K${row1}\n\r\x1b[2K${row2}\n\x1b[2A`);
  }

  let spin: ReturnType<typeof setInterval> | undefined;
  if (isTTY) spin = setInterval(renderProgressTwoLines, Math.max(50, opts.uiRefreshMs | 0));

  const HEARTBEAT_MS = 5000;
  const hb = setInterval(() => {
    const wallSec = Math.max(0.001, (Date.now() - t0) / 1000);
    const avgKps = snap.totalChecked / wallSec / 1000;
    const instKps = snap.aggregateKps / 1000;
    const mis = formatMismatch(snap.firstMismatchIndex, snap.lastMismatchIndex, opts.prefix.length, opts.suffix.length);
    log.info("cli_heartbeat", {
      wallSec: Number(wallSec.toFixed(1)),
      workers: snap.effectiveWorkers,
      totalChecked: snap.totalChecked,
      instKpsK: Number(instKps.toFixed(2)),
      avgKpsK: Number(avgKps.toFixed(2)),
      bestScorePercent: snap.bestScorePercent,
      bestAccuracyPercent: snap.bestAccuracyPercent,
      matchedTarget: `${snap.bestMatchedTargetChars}/${snap.bestTargetLen}`,
      mis,
      bestPrefixWindow: snap.bestPrefixWindow,
      bestSuffixWindow: snap.bestSuffixWindow,
      bestAddressHead: snap.bestAddress ? snap.bestAddress.slice(0, 8) + "…" + snap.bestAddress.slice(-6) : "",
      runningAvgAccuracyPercent: snap.runningAvgAccuracyPercent,
      patternPrefix: opts.prefix,
      patternSuffix: opts.suffix,
      outFile,
      binFile,
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
          renderProgressTwoLines();
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

  if (isTTY && progressLinesPrimed) writeStdout("\x1b[2B\r\x1b[2K\n\r\x1b[2K\n");
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
