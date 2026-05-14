// ── grind.ts ──────────────────────────────────────────────────────────────────
import type { GrindOpts, GrindResult, WorkerMsg } from "./types.ts";
import { encryptKey } from "./crypto.ts";
import { RUNTIME, resolveWorker } from "./runtime.ts";
import { createLogger } from "./log.ts";
import { evaluateWebGpuForGrind } from "./webgpu_env.ts";

const log = createLogger("grind");

const WORKER_URL = resolveWorker("./worker.ts");

async function getWorkerCtor(): Promise<any> {
  if (RUNTIME === "node") {
    const { Worker } = await import("node:worker_threads");
    return Worker;
  }
  return globalThis.Worker;
}

export async function grind(
  opts: GrindOpts,
  onProgress?: (msg: WorkerMsg & { type: "progress" }) => void,
  onThreshold?: (msg: WorkerMsg & { type: "threshold" }) => void,
  onBin?: (msg: WorkerMsg & { type: "bin" }) => void,
  signal?: AbortSignal,
): Promise<GrindResult[]> {
  const gpuCtx = await evaluateWebGpuForGrind(Boolean(opts.useWebgpu));
  const WorkerCtor = await getWorkerCtor();
  const rawEffective = RUNTIME === "bun"
    ? Math.max(1, Math.round(opts.threads * opts.bunOversubscribe))
    : Math.max(1, opts.threads);
  const maxCap = Math.max(1, opts.maxWorkers);
  const effectiveWorkers = Math.min(rawEffective, maxCap);

  return new Promise((resolve, reject) => {
    const results: GrindResult[] = [];
    const workers: any[]         = [];
    let found = 0;

    const killAll = () => workers.forEach(w => w.terminate());

    let cancelled = false;
    const abortErr = () => new DOMException("Grind aborted", "AbortError");

    const onAbort = () => {
      cancelled = true;
      killAll();
      reject(abortErr());
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const progressSnapshot = new Map<number, { rate: number; checked: number }>();
    let bestScorePercent = 0;
    let bestAccuracyPercent = 0;
    let bestMatchedTargetChars = 0;
    let bestTargetLen = 0;
    let bestAddress = "";
    let bestPrefixWindow = "";
    let bestSuffixWindow = "";
    let firstMismatchIndex = -1;
    let lastMismatchIndex = -1;
    let runningAccSum = 0;
    let runningAccN = 0;

    if (rawEffective > maxCap) {
      log.warn("grind_workers_capped", { raw: rawEffective, capped: effectiveWorkers, maxWorkers: maxCap });
    }

    log.info("grind_start", {
      workers: effectiveWorkers,
      count: opts.count,
      pfxLen: opts.prefix.length,
      sfxLen: opts.suffix.length,
      gpu: gpuCtx.status,
    });

    for (let i = 0; i < effectiveWorkers; i++) {
      if (cancelled) return;
      // Node: pass execArgv so TS stripping works inside the worker
      const workerOpts: any = { type: "module" };
      if (RUNTIME === "node") {
        workerOpts.execArgv = ["--experimental-strip-types"];
      }

      const w = new WorkerCtor(WORKER_URL, workerOpts);
      workers.push(w);

      const payload = {
        prefix:        opts.prefix,
        suffix:        opts.suffix,
        caseSensitive: opts.caseSensitive,
        threshold:     opts.threshold,
        workerId:      i,
        progressEvery: opts.progressEvery,
      };

      w.postMessage(payload);

      const onMsg = async (raw: any) => {
        const msg: WorkerMsg = raw?.data ?? raw;

        if (msg.type === "progress") {
          progressSnapshot.set(msg.workerId, { rate: msg.rate, checked: msg.checked });
          if (typeof msg.accuracyPercent === "number") {
            runningAccSum += msg.accuracyPercent;
            runningAccN++;
          }
          if (typeof msg.bestScorePercent === "number" && msg.bestScorePercent >= bestScorePercent) {
            bestScorePercent = msg.bestScorePercent;
            bestAccuracyPercent = msg.accuracyPercent ?? bestAccuracyPercent;
            bestMatchedTargetChars = msg.matchedTargetChars ?? bestMatchedTargetChars;
            bestTargetLen = msg.targetLen ?? bestTargetLen;
            bestAddress = msg.bestAddress ?? bestAddress;
            bestPrefixWindow = msg.bestPrefixWindow ?? bestPrefixWindow;
            bestSuffixWindow = msg.bestSuffixWindow ?? bestSuffixWindow;
            firstMismatchIndex = msg.firstMismatchIndex ?? firstMismatchIndex;
            lastMismatchIndex = msg.lastMismatchIndex ?? lastMismatchIndex;
          }
          let totalChecked = 0;
          let aggregateKps = 0;
          for (const v of progressSnapshot.values()) {
            totalChecked += v.checked;
            aggregateKps += v.rate;
          }
          onProgress?.({
            ...msg,
            totalChecked,
            aggregateKps,
            reportingWorkers: progressSnapshot.size,
            effectiveWorkers,
            bestScorePercent,
            bestAccuracyPercent,
            bestMatchedTargetChars,
            bestTargetLen,
            bestAddress,
            bestPrefixWindow,
            bestSuffixWindow,
            firstMismatchIndex,
            lastMismatchIndex,
            runningAvgAccuracyPercent: runningAccN ? Math.round(runningAccSum / runningAccN) : 0,
          } as WorkerMsg & { type: "progress" });
          return;
        }
        if (msg.type === "threshold") { onThreshold?.(msg as any); return; }
        if (msg.type === "bin") { onBin?.(msg as any); return; }

        if (msg.type === "hit") {
          found++;
          let secretKey = msg.secretKey, encrypted = false, decryptKey = "";
          if (opts.encrypt) {
            const res = await encryptKey(msg.secretKey, opts.decryptKey);
            secretKey = res.cipher; decryptKey = res.key; encrypted = true;
          }
          results.push({
            address: msg.address, publicKey: msg.publicKey,
            secretKey, score: 100, foundAt: Date.now(), encrypted, decryptKey,
          });
          if (found >= opts.count) {
            log.info("grind_complete", { hits: results.length, workers: effectiveWorkers });
            killAll();
            if (signal) signal.removeEventListener("abort", onAbort);
            resolve(results);
          }
        }

        if (msg.type === "error") {
          const err = new Error((msg as any).message);
          log.error("worker_message_error", { message: (msg as any).message }, err);
          killAll();
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(err);
        }
      };

      if (RUNTIME === "node") {
        w.on("message", onMsg);
        w.on("error", (e: unknown) => {
          const err = e instanceof Error ? e : new Error(String(e));
          log.error("worker_thread_error", { workerId: i }, err);
          killAll();
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(err);
        });
      }
      else { w.onmessage = onMsg; w.onerror = (e: ErrorEvent) => {
        const err = new Error(e.message || "worker error");
        log.error("worker_onerror", { workerId: i }, err);
        killAll();
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(err);
      }; }
    }
  });
}
