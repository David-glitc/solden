// ── worker.ts — batch keygen + index-scoped vanity match ──────────────────────
import type { WorkerInit, WorkerMsg } from "./types.ts";
import { createLogger } from "./log.ts";
import { b58Encode, b58Pub32 } from "./b58.ts";
import { createKeygenEngine, subtlePair, type KeygenEngine } from "./keygen.ts";

const log = createLogger("worker");

const IS_NODE = typeof (globalThis as any).Deno === "undefined" && typeof (globalThis as any).Bun === "undefined";

let parentPort: any = null;
if (IS_NODE) {
  const wt = await import("node:worker_threads");
  parentPort = wt.parentPort;
}

function postMsg(msg: WorkerMsg) {
  if (IS_NODE) parentPort!.postMessage(msg);
  else (self as any).postMessage(msg);
}

// ── match state ───────────────────────────────────────────────────────────────
let pfx = "", sfx = "", pfxLen = 0, sfxLen = 0, total = 0;
let pfxC = new Uint8Array(0);
let sfxC = new Uint8Array(0);
let caseSensitive = false;
let threshold = 90;
let needScore = true;
let workerId = 0;
let progressEvery = 512;
let detailProgress = true;

function charEq(addr: string, ai: number, patCode: number): boolean {
  let ac = addr.charCodeAt(ai);
  if (!caseSensitive && ac >= 65 && ac <= 90) ac += 32;
  return ac === patCode;
}

function evalAddr(addr: string): { score: number; hit: boolean } {
  if (total === 0) return { score: 100, hit: true };
  let m = 0;
  let hit = true;
  for (let i = 0; i < pfxLen; i++) {
    if (charEq(addr, i, pfxC[i]!)) m++;
    else hit = false;
  }
  if (sfxLen > 0) {
    const base = addr.length - sfxLen;
    for (let i = 0; i < sfxLen; i++) {
      if (charEq(addr, base + i, sfxC[i]!)) m++;
      else hit = false;
    }
  }
  if (!needScore) return { score: hit ? 100 : 0, hit };
  return { score: Math.round((m / total) * 100), hit };
}

function matchStats(addr: string) {
  let matchedPrefixChars = 0;
  let matchedSuffixChars = 0;
  for (let i = 0; i < pfxLen; i++) if (charEq(addr, i, pfxC[i]!)) matchedPrefixChars++;
  const sfxBase = sfxLen ? addr.length - sfxLen : 0;
  for (let i = 0; i < sfxLen; i++) if (charEq(addr, sfxBase + i, sfxC[i]!)) matchedSuffixChars++;
  const matchedTargetChars = matchedPrefixChars + matchedSuffixChars;
  const targetLen = total;
  const accuracyPercent = targetLen ? Math.round((matchedTargetChars / targetLen) * 100) : 100;

  if (!detailProgress) {
    return {
      matchedPrefixChars,
      matchedSuffixChars,
      matchedTargetChars,
      targetLen,
      accuracyPercent,
      firstMismatchIndex: -1,
      lastMismatchIndex: -1,
      bestPrefixWindow: pfxLen ? addr.slice(0, pfxLen) : "",
      bestSuffixWindow: sfxLen ? addr.slice(sfxBase) : "",
    };
  }

  let firstMismatchIndex = -1;
  let lastMismatchIndex = -1;
  for (let i = 0; i < pfxLen; i++) {
    if (!charEq(addr, i, pfxC[i]!)) { firstMismatchIndex = i; break; }
  }
  if (firstMismatchIndex === -1) {
    for (let i = 0; i < sfxLen; i++) {
      if (!charEq(addr, sfxBase + i, sfxC[i]!)) { firstMismatchIndex = pfxLen + i; break; }
    }
  }
  for (let i = sfxLen - 1; i >= 0; i--) {
    if (!charEq(addr, sfxBase + i, sfxC[i]!)) { lastMismatchIndex = pfxLen + i; break; }
  }
  if (lastMismatchIndex === -1) {
    for (let i = pfxLen - 1; i >= 0; i--) {
      if (!charEq(addr, i, pfxC[i]!)) { lastMismatchIndex = i; break; }
    }
  }
  return {
    matchedPrefixChars,
    matchedSuffixChars,
    matchedTargetChars,
    targetLen,
    accuracyPercent,
    firstMismatchIndex,
    lastMismatchIndex,
    bestPrefixWindow: pfxLen ? addr.slice(0, pfxLen) : "",
    bestSuffixWindow: sfxLen ? addr.slice(sfxBase) : "",
  };
}

function emitHitOrThreshold(
  addr: string,
  secret: Uint8Array,
  sc: number,
  kind: "hit" | "threshold" | "bin",
) {
  postMsg({
    type: kind,
    workerId,
    address: addr,
    publicKey: addr,
    secretKey: b58Encode(secret),
    score: kind === "hit" ? 100 : sc,
  } as WorkerMsg);
}

function processKey(pubOff: number, pubs: Uint8Array, secrets: Uint8Array, i: number): {
  addr: string;
  score: number;
  hit: boolean;
} {
  const addr = b58Pub32(pubs, pubOff);
  const { score, hit } = evalAddr(addr);
  if (hit) {
    emitHitOrThreshold(addr, secrets.subarray(i * 64, i * 64 + 64).slice(), 100, "hit");
  } else if (score >= threshold) {
    const snap = secrets.subarray(i * 64, i * 64 + 64).slice();
    emitHitOrThreshold(addr, snap, score, "threshold");
    if (score >= 70 && score <= 80) emitHitOrThreshold(addr, snap, score, "bin");
  }
  return { addr, score, hit };
}

function runBatchLoop(engine: KeygenEngine): void {
  const n = engine.batchSize;
  const pubs = new Uint8Array(n * 32);
  const secrets = new Uint8Array(n * 64);
  let checked = 0;
  let t0 = Date.now();
  let windowBestScore = -1;
  let windowBestAddr = "";

  while (true) {
    engine.fillBatch(pubs, secrets);
    for (let i = 0; i < n; i++) {
      const { addr, score: sc } = processKey(i * 32, pubs, secrets, i);
      if (sc > windowBestScore) {
        windowBestScore = sc;
        windowBestAddr = addr;
      }
      checked++;
      if (checked % progressEvery === 0) {
        const dt = Math.max(1, Date.now() - t0);
        const bestAddr = windowBestAddr || addr;
        postMsg({
          type: "progress",
          workerId,
          rate: Math.round((progressEvery / dt) * 1000),
          checked,
          bestAddress: bestAddr,
          bestScorePercent: windowBestScore < 0 ? sc : windowBestScore,
          prefixPatternLen: pfxLen,
          suffixPatternLen: sfxLen,
          keygenBackend: engine.kind,
          ...matchStats(bestAddr),
        } as WorkerMsg);
        t0 = Date.now();
        windowBestScore = -1;
        windowBestAddr = "";
      }
    }
  }
}

async function runSubtleLoop(): Promise<void> {
  let checked = 0;
  let t0 = Date.now();
  let windowBestScore = -1;
  let windowBestAddr = "";

  while (true) {
    const { pub, secret } = await subtlePair();
    const addr = b58Pub32(pub, 0);
    const { score: sc, hit } = evalAddr(addr);

    if (sc > windowBestScore) {
      windowBestScore = sc;
      windowBestAddr = addr;
    }
    checked++;

    if (checked % progressEvery === 0) {
      const dt = Math.max(1, Date.now() - t0);
      const bestAddr = windowBestAddr || addr;
      postMsg({
        type: "progress",
        workerId,
        rate: Math.round((progressEvery / dt) * 1000),
        checked,
        bestAddress: bestAddr,
        bestScorePercent: windowBestScore < 0 ? sc : windowBestScore,
        prefixPatternLen: pfxLen,
        suffixPatternLen: sfxLen,
        keygenBackend: "subtle",
        ...matchStats(bestAddr),
      } as WorkerMsg);
      t0 = Date.now();
      windowBestScore = -1;
      windowBestAddr = "";
    }

    if (hit) emitHitOrThreshold(addr, secret, 100, "hit");
    else if (sc >= threshold) {
      emitHitOrThreshold(addr, secret, sc, "threshold");
      if (sc >= 70 && sc <= 80) emitHitOrThreshold(addr, secret, sc, "bin");
    }
  }
}

async function boot(cfg: WorkerInit) {
  workerId = cfg.workerId;
  caseSensitive = cfg.caseSensitive;
  threshold = cfg.threshold;
  progressEvery = Math.max(64, cfg.progressEvery | 0);
  detailProgress = progressEvery < 4096;
  needScore = threshold < 100;

  pfx = caseSensitive ? cfg.prefix : cfg.prefix.toLowerCase();
  sfx = caseSensitive ? cfg.suffix : cfg.suffix.toLowerCase();
  pfxLen = pfx.length;
  sfxLen = sfx.length;
  total = pfxLen + sfxLen;

  pfxC = new Uint8Array(pfxLen);
  for (let i = 0; i < pfxLen; i++) pfxC[i] = pfx.charCodeAt(i);
  sfxC = new Uint8Array(sfxLen);
  for (let i = 0; i < sfxLen; i++) sfxC[i] = sfx.charCodeAt(i);

  const engine = await createKeygenEngine(cfg.keygen, cfg.keygenBatch ?? 64);

  log.debug("worker_boot", {
    workerId,
    prefixLen: pfxLen,
    suffixLen: sfxLen,
    keygen: engine.kind,
    keygenBatch: engine.batchSize,
    caseSensitive,
    threshold,
    progressEvery,
    needScore,
    detailProgress,
  });

  const onFail = (e: unknown) => {
    const message = String(e);
    log.error("worker_loop_failed", { workerId }, e instanceof Error ? e : new Error(message));
    postMsg({ type: "error", message } as any);
  };

  if (engine.kind === "subtle") {
    runSubtleLoop().catch(onFail);
  } else {
    try {
      runBatchLoop(engine);
    } catch (e) {
      onFail(e);
    }
  }
}

if (IS_NODE) parentPort!.once("message", (cfg: WorkerInit) => { boot(cfg); });
else (self as any).onmessage = (ev: MessageEvent<WorkerInit>) => { boot(ev.data); };
