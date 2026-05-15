// ── worker.ts ─────────────────────────────────────────────────────────────────
// Hot-loop worker. Runs on Deno · Bun · Node as an ESM Worker.
//
// Node      : worker_threads — parentPort for messaging, no `self`
// Deno/Bun  : Web Worker API — self.onmessage / self.postMessage
//
// Node keygen : node:crypto generateKeyPairSync  ~13k kp/s per thread (native C)
// Deno keygen : node:crypto when available; else crypto.subtle.generateKey (~4k kp/s)

import type { WorkerInit, WorkerMsg } from "./types.ts";
import { createLogger } from "./log.ts";

const log = createLogger("worker");

// ── detect runtime inside worker (no imports from runtime.ts) ─────────────────
const IS_DENO = typeof (globalThis as any).Deno !== "undefined";
const IS_BUN  = typeof (globalThis as any).Bun  !== "undefined";
const IS_NODE = !IS_DENO && !IS_BUN;

// ── Node: import parentPort at module level (ESM — no require) ────────────────
let parentPort: any = null;
if (IS_NODE) {
  const wt = await import("node:worker_threads");
  parentPort = wt.parentPort;
}

// ── crypto: node:crypto fast path (Node, Bun, Deno with Node compat) ──────────
let nodeCrypto: any = null;
try {
  nodeCrypto = await import("node:crypto");
} catch {
  nodeCrypto = null;
}

function useNodeKeygen(): boolean {
  return nodeCrypto != null && typeof nodeCrypto.generateKeyPairSync === "function";
}

// ── messaging shim ────────────────────────────────────────────────────────────
function postMsg(msg: WorkerMsg) {
  if (IS_NODE) parentPort!.postMessage(msg);
  else         (self as any).postMessage(msg);
}

// ── inline base58 ─────────────────────────────────────────────────────────────
const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(buf: Uint8Array): string {
  const d: number[] = [0];
  for (let i = 0; i < buf.length; i++) {
    let c = buf[i]!;
    for (let j = 0; j < d.length; j++) { c += d[j]! << 8; d[j] = c % 58; c = (c / 58) | 0; }
    while (c) { d.push(c % 58); c = (c / 58) | 0; }
  }
  let s = "";
  for (let i = d.length - 1; i >= 0; i--) s += ALPHA[d[i]!];
  return s;
}

// ── keypair generators ────────────────────────────────────────────────────────
function nodePair(): { pub: Uint8Array; secret: Uint8Array } {
  const { publicKey: pubObj, privateKey: privObj } = nodeCrypto.generateKeyPairSync("ed25519");
  const pubDer  = pubObj.export({ type: "spki",  format: "der" }) as Uint8Array;
  const privDer = privObj.export({ type: "pkcs8", format: "der" }) as Uint8Array;
  const pub32   = new Uint8Array(pubDer.buffer,  pubDer.byteOffset  + pubDer.byteLength  - 32, 32);
  const seed32  = new Uint8Array(privDer.buffer, privDer.byteOffset + privDer.byteLength - 32, 32);
  const secret  = new Uint8Array(64);
  secret.set(seed32); secret.set(pub32, 32);
  return { pub: new Uint8Array(pub32), secret };
}

async function denoPair(): Promise<{ pub: Uint8Array; secret: Uint8Array }> {
  const kp       = await globalThis.crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]) as CryptoKeyPair;
  const pubSpki  = await globalThis.crypto.subtle.exportKey("spki",  kp.publicKey);
  const privPkcs = await globalThis.crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const pub32    = new Uint8Array(pubSpki).slice(-32);
  const seed32   = new Uint8Array(privPkcs).slice(-32);
  const secret   = new Uint8Array(64);
  secret.set(seed32); secret.set(pub32, 32);
  return { pub: pub32, secret };
}

// ── match state ───────────────────────────────────────────────────────────────
let pfx = "", sfx = "", pfxLen = 0, sfxLen = 0, total = 0;
let caseSensitive = false, threshold = 90, workerId = 0;
let progressEvery = 512;

/** Single pass: match count, full hit, and score (0–100). */
function evalAddr(addr: string): { score: number; hit: boolean } {
  if (total === 0) return { score: 100, hit: true };
  const al = caseSensitive ? addr : addr.toLowerCase();
  let m = 0;
  let hit = true;
  for (let i = 0; i < pfxLen; i++) {
    if (al[i] === pfx[i]) m++;
    else hit = false;
  }
  for (let i = 0; i < sfxLen; i++) {
    const j = addr.length - sfxLen + i;
    if (al[j] === sfx[i]) m++;
    else hit = false;
  }
  return { score: Math.round((m / total) * 100), hit };
}

// ── tight loop ────────────────────────────────────────────────────────────────
function matchStats(addr: string) {
  const a = caseSensitive ? addr : addr.toLowerCase();
  let matchedPrefixChars = 0;
  let matchedSuffixChars = 0;
  for (let i = 0; i < pfxLen; i++) if (a[i] === pfx[i]) matchedPrefixChars++;
  for (let i = 0; i < sfxLen; i++) if (a[a.length - sfxLen + i] === sfx[i]) matchedSuffixChars++;
  const matchedTargetChars = matchedPrefixChars + matchedSuffixChars;
  const targetLen = total;
  const accuracyPercent = targetLen ? Math.round((matchedTargetChars / targetLen) * 100) : 100;

  let firstMismatchIndex = -1;
  let lastMismatchIndex = -1;
  for (let i = 0; i < pfxLen; i++) {
    if (a[i] !== pfx[i]) { firstMismatchIndex = i; break; }
  }
  if (firstMismatchIndex === -1) {
    for (let i = 0; i < sfxLen; i++) {
      if (a[a.length - sfxLen + i] !== sfx[i]) { firstMismatchIndex = pfxLen + i; break; }
    }
  }
  for (let i = sfxLen - 1; i >= 0; i--) {
    if (a[a.length - sfxLen + i] !== sfx[i]) { lastMismatchIndex = pfxLen + i; break; }
  }
  if (lastMismatchIndex === -1) {
    for (let i = pfxLen - 1; i >= 0; i--) {
      if (a[i] !== pfx[i]) { lastMismatchIndex = i; break; }
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
    bestSuffixWindow: sfxLen ? addr.slice(-sfxLen) : "",
  };
}

async function loop() {
  let checked = 0, t0 = Date.now();
  let windowBestScore = -1;
  let windowBestAddr = "";
  while (true) {
    const { pub, secret } = useNodeKeygen() ? nodePair() : await denoPair();
    const addr = b58(pub);
    const { score: sc, hit } = evalAddr(addr);
    if (sc > windowBestScore) {
      windowBestScore = sc;
      windowBestAddr = addr;
    }
    checked++;
    if (checked % progressEvery === 0) {
      const now = Date.now();
      const dt = Math.max(1, now - t0);
      const bestAddr = windowBestAddr || addr;
      const stats = matchStats(bestAddr);
      postMsg({
        type: "progress",
        workerId,
        rate: Math.round((progressEvery / dt) * 1000),
        checked,
        bestAddress: bestAddr,
        bestScorePercent: windowBestScore < 0 ? sc : windowBestScore,
        prefixPatternLen: pfxLen,
        suffixPatternLen: sfxLen,
        ...stats,
      } as WorkerMsg);
      t0 = now;
      windowBestScore = -1;
      windowBestAddr = "";
    }
    if (hit) {
      const pk = b58(pub);
      const sk = b58(secret);
      postMsg({ type: "hit", workerId, address: addr, publicKey: pk, secretKey: sk, score: 100 });
    } else if (sc >= threshold) {
      const pk = b58(pub);
      const sk = b58(secret);
      postMsg({ type: "threshold", workerId, address: addr, publicKey: pk, secretKey: sk, score: sc });
      if (sc >= 70 && sc <= 80)
        postMsg({ type: "bin", workerId, address: addr, publicKey: pk, secretKey: sk, score: sc });
    }
  }
}

// ── boot ──────────────────────────────────────────────────────────────────────
function boot(cfg: WorkerInit) {
  workerId = cfg.workerId; caseSensitive = cfg.caseSensitive; threshold = cfg.threshold;
  progressEvery = Math.max(64, cfg.progressEvery | 0);
  pfx = caseSensitive ? cfg.prefix : cfg.prefix.toLowerCase();
  sfx = caseSensitive ? cfg.suffix : cfg.suffix.toLowerCase();
  pfxLen = pfx.length; sfxLen = sfx.length; total = pfxLen + sfxLen;
  log.debug("worker_boot", {
    workerId,
    prefixLen: pfxLen,
    suffixLen: sfxLen,
    caseSensitive,
    threshold,
    progressEvery,
  });
  loop().catch((e: unknown) => {
    const message = String(e);
    log.error("worker_loop_failed", { workerId }, e instanceof Error ? e : new Error(message));
    postMsg({ type: "error", message } as any);
  });
}

if (IS_NODE) parentPort!.once("message", boot);
else         (self as any).onmessage = (ev: MessageEvent<WorkerInit>) => boot(ev.data);
