// ── runtime.ts ────────────────────────────────────────────────────────────────
export type RT = "deno" | "bun" | "node";

export const RUNTIME: RT = (() => {
  if (typeof (globalThis as any).Deno !== "undefined") return "deno";
  if (typeof (globalThis as any).Bun  !== "undefined") return "bun";
  return "node";
})();

export const cpuCount: number = (() => {
  if (RUNTIME === "deno") return (globalThis as any).Deno.availableParallelism?.() ?? 4;
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) return navigator.hardwareConcurrency;
  try { return (require("os") as typeof import("os")).cpus().length; } catch { return 4; }
})();

export const argv: string[] = (() => {
  if (RUNTIME === "deno") return [...(globalThis as any).Deno.args] as string[];
  return (process as any).argv.slice(2) as string[];
})();

export function exit(code: number): never {
  if (RUNTIME === "deno") (globalThis as any).Deno.exit(code);
  else (process as any).exit(code);
  throw 0;
}

export const isTTY: boolean = (() => {
  if (RUNTIME === "deno") return Boolean((globalThis as any).Deno.stdout.isTerminal?.());
  return Boolean((process as any).stdout?.isTTY);
})();

export function writeStdout(s: string): void {
  if (RUNTIME === "deno") (globalThis as any).Deno.stdout.writeSync(new TextEncoder().encode(s));
  else (process as any).stdout.write(s);
}

/** Terminal width for TTY layouts; falls back when columns are unavailable. */
export function stdoutColumns(fallback = 96): number {
  try {
    if (RUNTIME === "deno") {
      const c = (globalThis as any).Deno.stdout?.columns;
      if (typeof c === "number" && c > 20) return c;
    }
    if (typeof process !== "undefined") {
      const c = (process as any).stdout?.columns;
      if (typeof c === "number" && c > 20) return c;
    }
  } catch { /* ignore */ }
  return fallback;
}

export interface FileWriter { write(s: string): void; close(): void; }

export async function openAppend(path: string): Promise<FileWriter> {
  if (RUNTIME === "deno") {
    const f = await (globalThis as any).Deno.open(path, { write: true, append: true, create: true });
    const e = new TextEncoder();
    return { write: (s: string) => f.writeSync(e.encode(s)), close: () => f.close() };
  }
  const { createWriteStream } = await import("node:fs");
  const stream = createWriteStream(path, { flags: "a" });
  return { write: (s: string) => stream.write(s), close: () => stream.end() };
}

// Returns a URL object on Node (required by worker_threads), href string on Deno/Bun
export function resolveWorker(rel: string): URL | string {
  const url = new URL(rel, import.meta.url);
  return RUNTIME === "node" ? url : url.href;
}

export type Handler = (req: Request) => Promise<Response>;

export function serveHttp(port: number, handler: Handler): void {
  if (RUNTIME === "deno") {
    const DenoApi = (globalThis as any).Deno;
    let onDeploy = false;
    try {
      onDeploy = Boolean(DenoApi.env.get("DENO_DEPLOYMENT_ID"));
    } catch { /* env may be unavailable */ }
    if (onDeploy) DenoApi.serve(handler);
    else DenoApi.serve({ port }, handler);
    return;
  }
  if (RUNTIME === "bun")  { (globalThis as any).Bun.serve({ port, fetch: handler }); return; }
  // Node: wrap node:http
  import("node:http").then(({ createServer }) => {
    createServer(async (req: any, res: any) => {
      const url = `http://localhost${req.url ?? "/"}`;
      const chunks: Uint8Array[] = [];
      for await (const c of req) chunks.push(c as Uint8Array);
      let body: Uint8Array | undefined;
      if (chunks.length) {
        let len = 0;
        for (const p of chunks) len += p.length;
        body = new Uint8Array(len);
        let o = 0;
        for (const p of chunks) {
          body.set(p, o);
          o += p.length;
        }
      }
      const request = new Request(url, {
        method: req.method,
        headers: req.headers as any,
        body: (body ?? null) as BodyInit | null,
      });
      const resp = await handler(request);
      res.writeHead(resp.status, Object.fromEntries(resp.headers.entries()));
      res.end(new Uint8Array(await resp.arrayBuffer()));
    }).listen(port);
  });
}
