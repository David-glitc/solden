// Persist admin jobs (Deno KV on Deploy, SQLite locally).
import { RUNTIME } from "./runtime.ts";
import { createLogger } from "./log.ts";
import type { AdminJob } from "./types.ts";

const log = createLogger("admin_store");

let kv: any = null;
let sqlite: any = null;
let ready: Promise<void> | null = null;

function onDeploy(): boolean {
  try {
    return Boolean((globalThis as any).Deno?.env?.get?.("DENO_DEPLOYMENT_ID"));
  } catch {
    return false;
  }
}

export async function initAdminJobStore(dbPath = "vanity.db"): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const DenoApi = (globalThis as any).Deno;
    if (onDeploy() && DenoApi?.openKv) {
      kv = await DenoApi.openKv();
      log.info("admin_store", { backend: "deno-kv" });
      return;
    }
    if (RUNTIME === "bun") {
      const { Database } = await import("bun:sqlite" as string) as any;
      sqlite = new Database(dbPath);
    } else {
      try {
        const { DatabaseSync } = await import("node:sqlite" as string) as any;
        sqlite = new DatabaseSync(dbPath);
      } catch {
        if (DenoApi?.openKv) {
          const kvPath = dbPath.endsWith(".db") ? dbPath.slice(0, -3) + ".kv" : `${dbPath}.kv`;
          kv = await DenoApi.openKv(kvPath);
          log.info("admin_store", { backend: "deno-kv-file", kvPath });
          return;
        }
        throw new Error("no admin job store backend");
      }
    }
    const ddl = `CREATE TABLE IF NOT EXISTS admin_jobs (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`;
    if (typeof sqlite.exec === "function") sqlite.exec(ddl);
    else sqlite.run(ddl);
    log.info("admin_store", { backend: "sqlite", path: dbPath });
  })();
  return ready;
}

export async function saveAdminJob(job: AdminJob): Promise<void> {
  await initAdminJobStore();
  const updatedAt = Date.now();
  if (kv) {
    await kv.set(["admin_job", job.id], { job, updatedAt });
    return;
  }
  const data = JSON.stringify(job);
  const sql = `INSERT INTO admin_jobs (id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`;
  if (sqlite.prepare) {
    sqlite.prepare(sql).run(job.id, data, updatedAt);
  } else {
    sqlite.run(sql, job.id, data, updatedAt);
  }
}

export async function loadAdminJob(id: string): Promise<AdminJob | null> {
  await initAdminJobStore();
  if (kv) {
    const e = await kv.get(["admin_job", id]);
    return (e.value as { job: AdminJob } | null)?.job ?? null;
  }
  const row = sqlite.prepare
    ? sqlite.prepare("SELECT data FROM admin_jobs WHERE id = ?").get(id)
    : sqlite.query("SELECT data FROM admin_jobs WHERE id = ?").get(id);
  if (!row?.data) return null;
  try {
    return JSON.parse(String(row.data)) as AdminJob;
  } catch {
    return null;
  }
}

export async function listStoredAdminJobs(): Promise<AdminJob[]> {
  await initAdminJobStore();
  const out: AdminJob[] = [];
  if (kv) {
    for await (const e of kv.list({ prefix: ["admin_job"] })) {
      const v = e.value as { job: AdminJob } | null;
      if (v?.job) out.push(v.job);
    }
  } else {
    const rows = sqlite.prepare
      ? sqlite.prepare("SELECT data FROM admin_jobs ORDER BY updated_at DESC").all()
      : sqlite.query("SELECT data FROM admin_jobs ORDER BY updated_at DESC").all();
    for (const row of rows) {
      try {
        out.push(JSON.parse(String(row.data)) as AdminJob);
      } catch { /* skip */ }
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteStoredAdminJob(id: string): Promise<void> {
  await initAdminJobStore();
  if (kv) {
    await kv.delete(["admin_job", id]);
    return;
  }
  const sql = "DELETE FROM admin_jobs WHERE id = ?";
  if (sqlite.prepare) sqlite.prepare(sql).run(id);
  else sqlite.run(sql, id);
}
