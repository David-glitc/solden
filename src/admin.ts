// Admin background jobs, resource monitoring, unthrottled worker caps.
import { createLogger } from "./log.ts";
import { cpuCount, RUNTIME } from "./runtime.ts";
import {
  deleteStoredAdminJob,
  initAdminJobStore,
  listStoredAdminJobs,
  saveAdminJob,
} from "./admin_store.ts";
import {
  adminPasswordConfigured,
  createAdminSession,
  extractAdminToken,
  isAdminRequest,
  verifyAdminPassword,
} from "./admin_auth.ts";
import type {
  AdminJob,
  AdminJobStatus,
  AdminPerfMode,
  GrindOpts,
  GrindResult,
  ThresholdCapture,
} from "./types.ts";

export type { AdminJob, AdminJobStatus, AdminPerfMode, ThresholdCapture };
export {
  adminPasswordConfigured,
  createAdminSession,
  extractAdminToken,
  isAdminRequest,
  verifyAdminPassword,
};

const log = createLogger("admin");

const jobs = new Map<string, AdminJob>();
const jobRunners = new Map<string, AbortController>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

let jobSeq = 0;
let storeLoaded = false;

function env(name: string): string | undefined {
  if (typeof (globalThis as any).Deno !== "undefined") {
    try { return (globalThis as any).Deno.env.get(name) ?? undefined; }
    catch { return undefined; }
  }
  if (typeof process !== "undefined") return (process as any).env?.[name];
  return undefined;
}

async function ensureJobsHydrated(): Promise<void> {
  if (storeLoaded) return;
  await initAdminJobStore(env("VANITY_DB_PATH") ?? "vanity.db");
  const stored = await listStoredAdminJobs();
  for (const j of stored) {
    const reconciled = reconcileStoredJob(j);
    jobs.set(j.id, reconciled);
    if (reconciled !== j) void saveAdminJob(reconciled);
  }
  storeLoaded = true;
}

const RECENT_PROGRESS_MS = 15 * 60 * 1000;
const STALE_JOB_MS = 6 * 60 * 60 * 1000;

function reconcileStoredJob(job: AdminJob): AdminJob {
  if ((job.status !== "running" && job.status !== "queued") || jobRunners.has(job.id)) {
    return { ...job, detached: false };
  }
  const last = job.progressUpdatedAt ?? job.startedAt ?? job.createdAt;
  const age = Date.now() - last;
  if (age < RECENT_PROGRESS_MS) {
    return { ...job, detached: true, error: null };
  }
  if (age < STALE_JOB_MS) {
    return {
      ...job,
      detached: true,
      error: "No live worker on this instance — showing last saved progress",
    };
  }
  return {
    ...job,
    status: "failed",
    detached: false,
    error: "worker stopped (timeout or server restart)",
    finishedAt: job.finishedAt ?? Date.now(),
  };
}

function applyProgress(job: AdminJob, p: Record<string, unknown>, wall0: number): void {
  job.progress = {
    totalChecked: Number(p.totalChecked ?? 0),
    aggregateKps: Number(p.aggregateKps ?? 0),
    bestScorePercent: Number(p.bestScorePercent ?? 0),
    wallElapsedSec: Number(p.wallElapsedSec ?? (Date.now() - wall0) / 1000),
    bestAddress: String(p.bestAddress ?? ""),
    bestAccuracyPercent: Number(p.bestAccuracyPercent ?? p.accuracyPercent ?? 0),
    bestMatchedTargetChars: Number(p.bestMatchedTargetChars ?? p.matchedTargetChars ?? 0),
    bestTargetLen: Number(p.bestTargetLen ?? p.targetLen ?? 0),
    bestPrefixWindow: String(p.bestPrefixWindow ?? ""),
    bestSuffixWindow: String(p.bestSuffixWindow ?? ""),
    firstMismatchIndex: Number(p.firstMismatchIndex ?? -1),
    lastMismatchIndex: Number(p.lastMismatchIndex ?? -1),
    matchedPrefixChars: Number(p.matchedPrefixChars ?? 0),
    matchedSuffixChars: Number(p.matchedSuffixChars ?? 0),
    accuracyPercent: Number(p.accuracyPercent ?? 0),
    runningAvgAccuracyPercent: Number(p.runningAvgAccuracyPercent ?? 0),
    keygenBackend: String(p.keygenBackend ?? ""),
    effectiveWorkers: Number(p.effectiveWorkers ?? 0),
    reportingWorkers: Number(p.reportingWorkers ?? 0),
    avgKpsWall: Number(p.avgKpsWall ?? 0),
  };
  job.progressUpdatedAt = Date.now();
  job.detached = false;
}

function persistJob(job: AdminJob, immediate = false): void {
  jobs.set(job.id, job);
  const run = () => {
    persistTimers.delete(job.id);
    void saveAdminJob(job).catch((e) => log.warn("admin_job_persist_failed", { id: job.id, err: String(e) }));
  };
  if (immediate) {
    const t = persistTimers.get(job.id);
    if (t) clearTimeout(t);
    run();
    return;
  }
  if (persistTimers.has(job.id)) return;
  persistTimers.set(job.id, setTimeout(run, 900));
}

export function resolveAdminPerfMode(body: {
  perfMode?: string;
  extreme?: boolean;
  unthrottled?: boolean;
}): AdminPerfMode {
  const raw = String(body.perfMode ?? "").trim().toLowerCase();
  if (raw === "extreme" || body.extreme === true) return "extreme";
  if (raw === "unthrottled" || body.unthrottled === true) return "unthrottled";
  if (raw === "standard" || raw === "normal") return "standard";
  return "standard";
}

/** Worker caps per admin performance mode. */
export function computeAdminWorkerLimits(mode: AdminPerfMode): {
  threads: number;
  maxWorkers: number;
  label: string;
} {
  const cores = Math.max(1, cpuCount);
  if (mode === "extreme") {
    return {
      threads: cores,
      maxWorkers: cores,
      label: `extreme · ${cores}/${cores} cores`,
    };
  }
  if (mode === "unthrottled") {
    const threads = Math.max(1, Math.floor(cores * 0.9));
    return {
      threads,
      maxWorkers: Math.min(512, Math.max(threads, Math.floor(cores * 2.5))),
      label: `unthrottled · ~90% (${threads} threads)`,
    };
  }
  const threads = Math.min(cores, Math.max(1, Math.floor(cores * 0.75)));
  return {
    threads,
    maxWorkers: Math.max(threads, cores),
    label: `standard · ${threads} threads`,
  };
}

export function applyAdminOpts(base: GrindOpts, perfMode: AdminPerfMode): GrindOpts {
  const lim = computeAdminWorkerLimits(perfMode);
  const turbo = perfMode !== "standard";
  return {
    ...base,
    threads: turbo ? lim.threads : Math.min(base.threads, lim.maxWorkers),
    maxWorkers: turbo ? lim.maxWorkers : Math.min(base.maxWorkers, lim.maxWorkers),
    bunOversubscribe:
      perfMode === "extreme" && RUNTIME === "bun"
        ? 1
        : perfMode === "unthrottled" && RUNTIME === "bun"
        ? Math.max(base.bunOversubscribe, 1.5)
        : base.bunOversubscribe,
    progressEvery: turbo ? Math.max(64, Math.min(base.progressEvery, 4096)) : base.progressEvery,
  };
}

export async function listJobs(): Promise<AdminJob[]> {
  await ensureJobsHydrated();
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export async function getJob(id: string): Promise<AdminJob | undefined> {
  await ensureJobsHydrated();
  return jobs.get(id);
}

export type ResourceMonitor = {
  ts: number;
  runtime: string;
  cpuCount: number;
  adminThreadsCap: number;
  adminExtremeThreads: number;
  adminUnthrottledThreads: number;
  adminPerfLabels: Record<AdminPerfMode, string>;
  memoryTotalMB: number | null;
  memoryFreeMB: number | null;
  memoryUsedMB: number | null;
  memoryFreePercent: number | null;
  rssMB: number | null;
  heapUsedMB: number | null;
  heapTotalMB: number | null;
  activeJobs: number;
  runningJobs: number;
  finishedJobs: number;
  thresholdHitsStored: number;
};

export async function getResourceMonitor(): Promise<ResourceMonitor> {
  const limStd = computeAdminWorkerLimits("standard");
  const limTurbo = computeAdminWorkerLimits("unthrottled");
  const limExt = computeAdminWorkerLimits("extreme");
  let memoryTotalMB: number | null = null;
  let memoryFreeMB: number | null = null;
  let rssMB: number | null = null;
  let heapUsedMB: number | null = null;
  let heapTotalMB: number | null = null;

  try {
    const mu = (globalThis as any).Deno?.memoryUsage?.();
    if (mu?.rss) rssMB = Number((mu.rss / (1024 * 1024)).toFixed(2));
    if (mu?.heapUsed) heapUsedMB = Number((mu.heapUsed / (1024 * 1024)).toFixed(2));
    if (mu?.heapTotal) heapTotalMB = Number((mu.heapTotal / (1024 * 1024)).toFixed(2));
  } catch { /* ignore */ }

  if (RUNTIME === "deno") {
    try {
      const mem = (globalThis as any).Deno?.systemMemoryInfo?.();
      if (mem?.total) memoryTotalMB = Math.round(mem.total / (1024 * 1024));
      if (mem?.free) memoryFreeMB = Math.round(mem.free / (1024 * 1024));
    } catch { /* ignore */ }
  } else {
    try {
      const os = await import("node:os");
      memoryTotalMB = Math.round(os.totalmem() / (1024 * 1024));
      memoryFreeMB = Math.round(os.freemem() / (1024 * 1024));
    } catch { /* ignore */ }
  }

  const memoryUsedMB =
    memoryTotalMB != null && memoryFreeMB != null ? memoryTotalMB - memoryFreeMB : null;

  const memoryFreePercent =
    memoryTotalMB != null && memoryFreeMB != null && memoryTotalMB > 0
      ? Math.round((memoryFreeMB / memoryTotalMB) * 100)
      : null;

  const all = [...jobs.values()];
  return {
    ts: Date.now(),
    runtime: RUNTIME,
    cpuCount,
    adminThreadsCap: limTurbo.threads,
    adminExtremeThreads: limExt.threads,
    adminUnthrottledThreads: limTurbo.threads,
    adminPerfLabels: {
      standard: limStd.label,
      unthrottled: limTurbo.label,
      extreme: limExt.label,
    },
    memoryTotalMB,
    memoryFreeMB,
    memoryUsedMB,
    memoryFreePercent,
    rssMB,
    heapUsedMB,
    heapTotalMB,
    activeJobs: all.filter((j) => j.status === "queued" || j.status === "running").length,
    runningJobs: all.filter((j) => j.status === "running").length,
    finishedJobs: all.filter((j) => j.status === "done" || j.status === "failed" || j.status === "cancelled").length,
    thresholdHitsStored: all.reduce((n, j) => n + j.thresholdHits.length, 0),
  };
}

export type JobRunner = (
  opts: GrindOpts,
  hooks: {
    onProgress: (p: Record<string, unknown>) => void;
    onThreshold: (t: ThresholdCapture) => void;
  },
  signal: AbortSignal,
) => Promise<GrindResult[]>;

export function startBackgroundJob(
  baseOpts: GrindOpts,
  perfMode: AdminPerfMode,
  runGrind: JobRunner,
): AdminJob | { error: string } {
  if (!adminPasswordConfigured()) return { error: "admin not configured" };
  const id = `job-${Date.now()}-${++jobSeq}`;
  const opts = applyAdminOpts(baseOpts, perfMode);
  const job: AdminJob = {
    id,
    status: "queued",
    opts,
    perfMode,
    unthrottled: perfMode === "unthrottled",
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    hits: [],
    thresholdHits: [],
    error: null,
    progress: { totalChecked: 0, aggregateKps: 0, bestScorePercent: 0, wallElapsedSec: 0, bestAddress: "" },
    progressUpdatedAt: Date.now(),
    detached: false,
  };
  persistJob(job, true);
  const ac = new AbortController();
  jobRunners.set(id, ac);

  void (async () => {
    job.status = "running";
    job.startedAt = Date.now();
    job.detached = false;
    persistJob(job, true);
    const wall0 = Date.now();
    log.info("admin_job_start", { id, perfMode, threads: opts.threads, maxWorkers: opts.maxWorkers });
    try {
      const hits = await runGrind(
        opts,
        {
          onProgress: (p) => {
            const wallSec = (Date.now() - wall0) / 1000;
            applyProgress(job, { ...p, wallElapsedSec: wallSec }, wall0);
            persistJob(job);
          },
          onThreshold: (t) => {
            job.thresholdHits.push(t);
            persistJob(job, true);
            log.info("admin_threshold_hit", { jobId: id, score: t.score, address: t.address.slice(0, 8) + "…" });
          },
        },
        ac.signal,
      );
      job.hits = hits;
      job.status = "done";
      log.info("admin_job_done", { id, hits: hits.length, thresholdHits: job.thresholdHits.length });
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      if (err.name === "AbortError") {
        job.status = "cancelled";
        job.error = "cancelled";
      } else {
        job.status = "failed";
        job.error = err.message;
        log.error("admin_job_failed", { id }, err);
      }
    } finally {
      job.finishedAt = Date.now();
      jobRunners.delete(id);
      persistJob(job, true);
    }
  })();

  return job;
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === "done" || job.status === "failed" || job.status === "cancelled") return false;

  const ac = jobRunners.get(id);
  if (job.status === "queued") {
    job.status = "cancelled";
    job.error = "cancelled";
    job.finishedAt = Date.now();
    if (ac) ac.abort();
    jobRunners.delete(id);
    persistJob(job, true);
    log.info("admin_job_cancelled_queued", { id });
    return true;
  }

  if (!ac) return false;
  ac.abort();
  log.info("admin_job_cancel_requested", { id });
  return true;
}

/** Remove job from memory; cancels if still active. */
export async function deleteJob(id: string): Promise<boolean> {
  await ensureJobsHydrated();
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === "running" || job.status === "queued") cancelJob(id);
  jobs.delete(id);
  jobRunners.delete(id);
  await deleteStoredAdminJob(id).catch(() => {});
  log.info("admin_job_deleted", { id, status: job.status });
  return true;
}

export async function deleteFinishedJobs(): Promise<number> {
  await ensureJobsHydrated();
  let n = 0;
  for (const [id, j] of jobs) {
    if (j.status !== "running" && j.status !== "queued") {
      jobs.delete(id);
      await deleteStoredAdminJob(id).catch(() => {});
      n++;
    }
  }
  if (n) log.info("admin_jobs_cleared_finished", { count: n });
  return n;
}

export type MemoryCleanupResult = {
  removedJobs: number;
  prunedOld: number;
  gcAttempted: boolean;
  rssMBBefore: number | null;
  rssMBAfter: number | null;
};

function readRssMB(): number | null {
  try {
    const mu = (globalThis as any).Deno?.memoryUsage?.();
    if (mu?.rss) return Number((mu.rss / (1024 * 1024)).toFixed(2));
  } catch { /* ignore */ }
  try {
    const mu = (process as any).memoryUsage?.();
    if (mu?.rss) return Number((mu.rss / (1024 * 1024)).toFixed(2));
  } catch { /* ignore */ }
  return null;
}

/** Drop finished jobs and nudge GC (best-effort; isolate RSS may not drop on Deploy). */
export async function adminMemoryCleanup(): Promise<MemoryCleanupResult> {
  const rssMBBefore = readRssMB();
  const removedJobs = await deleteFinishedJobs();
  const prunedOld = await pruneOldJobs(0);
  let gcAttempted = false;
  try {
    const g = (globalThis as any).gc;
    if (typeof g === "function") {
      g();
      gcAttempted = true;
    }
  } catch { /* ignore */ }
  try {
    const Bun = (globalThis as any).Bun;
    if (Bun?.gc) {
      Bun.gc(true);
      gcAttempted = true;
    }
  } catch { /* ignore */ }
  await new Promise((r) => setTimeout(r, 50));
  return {
    removedJobs,
    prunedOld,
    gcAttempted,
    rssMBBefore,
    rssMBAfter: readRssMB(),
  };
}

export function adminRestartAllowed(): boolean {
  return env("VANITY_ADMIN_ALLOW_RESTART") === "1";
}

/** Exit process so the host / platform restarts the worker (requires env flag). */
export function adminRequestRestart(): { ok: boolean; message: string } {
  if (!adminRestartAllowed()) {
    return {
      ok: false,
      message: "Set VANITY_ADMIN_ALLOW_RESTART=1 on the server to enable restart",
    };
  }
  log.warn("admin_restart_requested");
  setTimeout(() => {
    if (typeof (globalThis as any).Deno !== "undefined") {
      try { (globalThis as any).Deno.exit(0); } catch { /* ignore */ }
    }
    if (typeof process !== "undefined") {
      try { (process as any).exit?.(0); } catch { /* ignore */ }
    }
  }, 400);
  return { ok: true, message: "Process exiting — platform should start a fresh worker" };
}

/** Prune finished jobs older than maxAgeMs (default 24h). */
export async function pruneOldJobs(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
  await ensureJobsHydrated();
  const cutoff = Date.now() - maxAgeMs;
  let n = 0;
  for (const [id, j] of jobs) {
    if (j.finishedAt != null && j.finishedAt < cutoff) {
      jobs.delete(id);
      await deleteStoredAdminJob(id).catch(() => {});
      n++;
    }
  }
  return n;
}

export async function initAdmin(dbPath = "vanity.db"): Promise<void> {
  await initAdminJobStore(dbPath);
  await ensureJobsHydrated();
}
