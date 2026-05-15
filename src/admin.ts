// Admin auth, background jobs, resource monitoring, unthrottled worker caps.
import { createLogger } from "./log.ts";
import { cpuCount, RUNTIME } from "./runtime.ts";
import type { GrindOpts, GrindResult } from "./types.ts";

const log = createLogger("admin");

export type ThresholdCapture = {
  address: string;
  publicKey: string;
  secretKey: string;
  score: number;
  foundAt: number;
};

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type AdminJob = {
  id: string;
  status: JobStatus;
  opts: GrindOpts;
  unthrottled: boolean;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  hits: GrindResult[];
  thresholdHits: ThresholdCapture[];
  error: string | null;
  progress: {
    totalChecked: number;
    aggregateKps: number;
    bestScorePercent: number;
    wallElapsedSec: number;
  };
};

type Session = { expiresAt: number };

const sessions = new Map<string, Session>();
const jobs = new Map<string, AdminJob>();
const jobRunners = new Map<string, AbortController>();

let jobSeq = 0;

function env(name: string): string | undefined {
  if (typeof (globalThis as any).Deno !== "undefined") {
    try { return (globalThis as any).Deno.env.get(name) ?? undefined; }
    catch { return undefined; }
  }
  if (typeof process !== "undefined") return (process as any).env?.[name];
  return undefined;
}

export function adminPasswordConfigured(): boolean {
  return Boolean((env("VANITY_ADMIN_PASSWORD") ?? "").length > 0);
}

export function verifyAdminPassword(password: string): boolean {
  const expected = env("VANITY_ADMIN_PASSWORD") ?? "";
  if (!expected) return false;
  return password === expected;
}

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createAdminSession(): { token: string; expiresAt: number } | null {
  if (!adminPasswordConfigured()) return null;
  const token = newToken();
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  sessions.set(token, { expiresAt });
  return { token, expiresAt };
}

export function revokeAdminSession(token: string): void {
  sessions.delete(token);
}

export function extractAdminToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)vanity_admin=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export function isAdminRequest(req: Request): boolean {
  const token = extractAdminToken(req);
  if (!token) return false;
  const s = sessions.get(token);
  if (!s || s.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/** ~90% of reported CPUs for threads; high maxWorkers when admin unthrottled. */
export function computeAdminWorkerLimits(unthrottled: boolean): { threads: number; maxWorkers: number } {
  const cores = Math.max(1, cpuCount);
  const threads = Math.max(1, Math.floor(cores * 0.9));
  const maxWorkers = unthrottled
    ? Math.min(512, Math.max(threads, Math.floor(cores * 2.5)))
    : threads;
  return { threads, maxWorkers };
}

export function applyAdminOpts(base: GrindOpts, unthrottled: boolean): GrindOpts {
  const lim = computeAdminWorkerLimits(unthrottled);
  return {
    ...base,
    threads: lim.threads,
    maxWorkers: lim.maxWorkers,
    bunOversubscribe: unthrottled && RUNTIME === "bun" ? 1.5 : base.bunOversubscribe,
    progressEvery: unthrottled ? Math.max(64, Math.min(base.progressEvery, 256)) : base.progressEvery,
  };
}

export function listJobs(): AdminJob[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getJob(id: string): AdminJob | undefined {
  return jobs.get(id);
}

export type ResourceMonitor = {
  ts: number;
  runtime: string;
  cpuCount: number;
  adminThreadsCap: number;
  memoryTotalMB: number | null;
  memoryFreeMB: number | null;
  memoryUsedMB: number | null;
  rssMB: number | null;
  heapUsedMB: number | null;
  heapTotalMB: number | null;
  activeJobs: number;
  runningJobs: number;
  finishedJobs: number;
  thresholdHitsStored: number;
};

export async function getResourceMonitor(): Promise<ResourceMonitor> {
  const lim = computeAdminWorkerLimits(true);
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

  const all = listJobs();
  return {
    ts: Date.now(),
    runtime: RUNTIME,
    cpuCount,
    adminThreadsCap: lim.threads,
    memoryTotalMB,
    memoryFreeMB,
    memoryUsedMB,
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
  unthrottled: boolean,
  runGrind: JobRunner,
): AdminJob | { error: string } {
  if (!adminPasswordConfigured()) return { error: "admin not configured" };
  const id = `job-${Date.now()}-${++jobSeq}`;
  const opts = applyAdminOpts(baseOpts, unthrottled);
  const job: AdminJob = {
    id,
    status: "queued",
    opts,
    unthrottled,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    hits: [],
    thresholdHits: [],
    error: null,
    progress: { totalChecked: 0, aggregateKps: 0, bestScorePercent: 0, wallElapsedSec: 0 },
  };
  jobs.set(id, job);
  const ac = new AbortController();
  jobRunners.set(id, ac);

  void (async () => {
    job.status = "running";
    job.startedAt = Date.now();
    const wall0 = Date.now();
    log.info("admin_job_start", { id, unthrottled, threads: opts.threads, maxWorkers: opts.maxWorkers });
    try {
      const hits = await runGrind(
        opts,
        {
          onProgress: (p) => {
            job.progress = {
              totalChecked: Number(p.totalChecked ?? 0),
              aggregateKps: Number(p.aggregateKps ?? 0),
              bestScorePercent: Number(p.bestScorePercent ?? 0),
              wallElapsedSec: Number(((Date.now() - wall0) / 1000).toFixed(2)),
            };
          },
          onThreshold: (t) => {
            job.thresholdHits.push(t);
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
    }
  })();

  return job;
}

export function cancelJob(id: string): boolean {
  const ac = jobRunners.get(id);
  if (!ac) return false;
  ac.abort();
  return true;
}

/** Prune finished jobs older than maxAgeMs (default 24h). */
export function pruneOldJobs(maxAgeMs = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs;
  let n = 0;
  for (const [id, j] of jobs) {
    if (j.finishedAt != null && j.finishedAt < cutoff) {
      jobs.delete(id);
      n++;
    }
  }
  return n;
}
