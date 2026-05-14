// ── db.ts ─────────────────────────────────────────────────────────────────────
// Cross-runtime persistence.
//   Node ≥ 22   : node:sqlite  (built-in, --experimental-sqlite)
//   Bun         : bun:sqlite   (built-in, stable)
//   Deno Deploy : Deno KV (managed openKv)
//   Deno local  : node:sqlite  (same file as -d vanity.db — fast like Bun; KV fallback if sqlite unavailable)

import { RUNTIME } from "./runtime.ts";
import type { GrindResult } from "./types.ts";
import { createLogger } from "./log.ts";

const log = createLogger("db");

const DDL = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous  = NORMAL;
  CREATE TABLE IF NOT EXISTS hits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    address    TEXT    NOT NULL UNIQUE,
    public_key TEXT    NOT NULL,
    secret_key TEXT    NOT NULL,
    score      INTEGER NOT NULL,
    encrypted  INTEGER NOT NULL DEFAULT 0,
    found_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_address  ON hits(address);
  CREATE INDEX IF NOT EXISTS idx_found_at ON hits(found_at DESC);
`;

export interface DB {
  saveHit(r: GrindResult): Promise<void>;
  /** One transaction / one batched atomic — prefer after a grind instead of many `saveHit` calls. */
  saveHits(hits: GrindResult[]): Promise<void>;
  getHits(limit?: number): Promise<any[]>;
}

/** No disk/KV: HTTP responses return hits only in-memory; never persists secrets. */
export function createEphemeralDb(): DB {
  return {
    async saveHits(_hits: GrindResult[]) {},
    async saveHit(_r: GrindResult) {},
    async getHits(_limit = 200) {
      return [];
    },
  };
}

/** Deno KV file path derived from the SQLite-style -d path (vanity.db → vanity.kv). */
function denoKvStorePath(sqliteStylePath: string): string {
  if (sqliteStylePath.endsWith(".db")) return sqliteStylePath.slice(0, -3) + ".kv";
  return `${sqliteStylePath}.kv`;
}

type HitRow = {
  address: string;
  public_key: string;
  secret_key: string;
  score: number;
  encrypted: number;
  found_at: number;
};

function wrapSqlite(raw: any): DB {
  if (typeof raw.exec === "function") raw.exec(DDL);
  else if (typeof raw.execute === "function") raw.execute(DDL);
  else raw.run(DDL);

  const INSERT = `INSERT OR IGNORE INTO hits (address, public_key, secret_key, score, encrypted, found_at) VALUES (?,?,?,?,?,?)`;
  const SELECT = `SELECT * FROM hits ORDER BY found_at DESC LIMIT ?`;
  const stmt = raw.prepare(INSERT);
  const selectStmt = raw.prepare(SELECT);

  const runTx = (fn: () => void) => {
    const begin = () => {
      if (typeof raw.exec === "function") raw.exec("BEGIN IMMEDIATE");
      else if (typeof raw.run === "function") raw.run("BEGIN IMMEDIATE");
    };
    const commit = () => {
      if (typeof raw.exec === "function") raw.exec("COMMIT");
      else if (typeof raw.run === "function") raw.run("COMMIT");
    };
    const rollback = () => {
      try {
        if (typeof raw.exec === "function") raw.exec("ROLLBACK");
        else if (typeof raw.run === "function") raw.run("ROLLBACK");
      } catch { /* ignore */ }
    };
    if (typeof raw.exec === "function" || typeof raw.run === "function") {
      begin();
      try {
        fn();
        commit();
      } catch (e) {
        rollback();
        throw e;
      }
      return;
    }
    fn();
  };

  async function saveHits(hits: GrindResult[]) {
    if (!hits.length) return;
    runTx(() => {
      for (const r of hits) {
        stmt.run(r.address, r.publicKey, r.secretKey, r.score, r.encrypted ? 1 : 0, r.foundAt);
      }
    });
  }

  return {
    saveHits,
    saveHit: async (r: GrindResult) => saveHits([r]),
    async getHits(limit = 200) {
      return selectStmt.all(limit);
    },
  };
}

function wrapDenoKv(kv: any): DB {
  const ATOMIC_CHUNK = 48;

  async function saveHits(hits: GrindResult[]) {
    if (!hits.length) return;
    for (let i = 0; i < hits.length; i += ATOMIC_CHUNK) {
      const slice = hits.slice(i, i + ATOMIC_CHUNK);
      let op = kv.atomic();
      for (const r of slice) {
        const row: HitRow = {
          address: r.address,
          public_key: r.publicKey,
          secret_key: r.secretKey,
          score: r.score,
          encrypted: r.encrypted ? 1 : 0,
          found_at: r.foundAt,
        };
        op = op.check({ key: ["hit", r.address], versionstamp: null }).set(["hit", r.address], row);
      }
      await op.commit();
    }
  }

  return {
    saveHits,
    saveHit: async (r: GrindResult) => saveHits([r]),
    async getHits(limit = 200) {
      const byAddr = new Map<string, HitRow>();
      for await (const e of kv.list({ prefix: ["hit"] })) {
        if (e.value != null) {
          const row = e.value as HitRow;
          byAddr.set(row.address, row);
        }
      }
      for await (const e of kv.list({ prefix: ["hit_time"] })) {
        if (e.value != null) {
          const row = e.value as HitRow;
          if (!byAddr.has(row.address)) byAddr.set(row.address, row);
        }
      }
      return [...byAddr.values()].sort((a, b) => b.found_at - a.found_at).slice(0, limit);
    },
  };
}

export async function initDb(path: string): Promise<DB> {
  if (RUNTIME === "bun") {
    const { Database } = await import("bun:sqlite" as string) as any;
    log.info("db_open", { backend: "bun-sqlite", path });
    return wrapSqlite(new Database(path));
  }
  if (RUNTIME === "node") {
    const { DatabaseSync } = await import("node:sqlite" as string) as any;
    log.info("db_open", { backend: "node-sqlite", path });
    return wrapSqlite(new DatabaseSync(path));
  }
  const DenoApi = (globalThis as any).Deno;
  let onDeploy = false;
  try {
    onDeploy = Boolean(DenoApi.env.get("DENO_DEPLOYMENT_ID"));
  } catch { /* ignore */ }

  if (onDeploy) {
    const kv = await DenoApi.openKv();
    log.info("db_open", { backend: "deno-kv", path, kvPath: "(managed)", deploy: true });
    return wrapDenoKv(kv);
  }

  try {
    const { DatabaseSync } = await import("node:sqlite" as string) as any;
    log.info("db_open", { backend: "deno-sqlite", path });
    return wrapSqlite(new DatabaseSync(path));
  } catch (e) {
    const kvPath = denoKvStorePath(path);
    const kv = await DenoApi.openKv(kvPath);
    log.warn("db_open", { backend: "deno-kv-fallback", path, kvPath, err: String(e) });
    return wrapDenoKv(kv);
  }
}
