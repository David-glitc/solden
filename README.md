# Solden — Solana vanity address grinder

Fast **Solana vanity** (Ed25519) grinding with a **web control panel**, **NDJSON/SSE streaming**, and a **zero-dependency** CLI. Runs on **Deno**, **Bun**, or **Node ≥ 22** (with built-in SQLite where used).

---

## Solden mark (SVG)

Use this mark in your own apps, README badges, or print collateral. **Canonical file in the repo:** [`static/solden-mark.svg`](static/solden-mark.svg).

When the HTTP server is running, the same bytes are served at:

- **`/solden-mark.svg`** (explicit path for docs or hotlinking)
- **`/favicon.svg`** and **`/favicon.ico`** (browser favicon; body is still SVG)

Copy-paste markup (tweak `width` / `height` / `fill` as needed):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" class="solden-mark" width="72" height="72" aria-hidden="true">
  <rect width="100%" height="100%" fill="none"/>
  <g fill="#111111">
    <path d="M 250,50 A 200,200 0 0,1 450,250 L 370,250 A 120,120 0 0,0 250,130 Z" />
    <path d="M 250,450 A 200,200 0 0,1 50,250 L 130,250 A 120,120 0 0,0 250,370 Z" />
    <circle cx="250" cy="250" r="40" />
  </g>
  <text x="250" y="490" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="32" font-weight="bold" letter-spacing="6" fill="#111111" text-anchor="middle">SOLDEN</text>
</svg>
```

**Dark UI tip:** set `fill` on the `<g>` and `<text>` to `#e2e8f0` (or your token) for light-on-dark themes.

---

## Repository layout

| Path | Role |
|------|------|
| [`main.ts`](main.ts) | **Entry shim** — imports [`src/main.ts`](src/main.ts) (keeps `deno run main.ts` and Deno Deploy default entry at repo root) |
| [`decrypt.ts`](decrypt.ts) | **CLI shim** — imports [`src/decrypt.ts`](src/decrypt.ts) |
| [`src/main.ts`](src/main.ts) | CLI + HTTP server (`--server`, `POST /grind`, panel paths, `/system`) |
| [`src/worker.ts`](src/worker.ts) | Worker module (keygen loop, progress) |
| [`src/grind.ts`](src/grind.ts) | Worker orchestration, encryption option, aggregates |
| [`src/db.ts`](src/db.ts) | SQLite / Deno KV / ephemeral no-op persistence |
| [`src/runtime.ts`](src/runtime.ts) | Cross-runtime I/O (`serveHttp`, workers, append files) |
| [`src/crypto.ts`](src/crypto.ts) | AES-GCM helpers |
| [`src/log.ts`](src/log.ts) | Structured logs + optional SSE hook |
| [`src/types.ts`](src/types.ts) | Shared TypeScript types |
| [`src/webgpu_env.ts`](src/webgpu_env.ts) | WebGPU probe (Deno local) |
| [`static/index.html`](static/index.html) | Control panel (`GET /`) |
| [`static/solden-mark.svg`](static/solden-mark.svg) | Logo / favicon file on disk |
| [`benchmarks/`](benchmarks/) | `deno bench` targets |
| [`deno.json`](deno.json) | Tasks, unstable KV |
| [`package.json`](package.json) | Optional Node/Bun npm scripts |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Dated implementation notes |

---

## Requirements

| Runtime | Notes |
|---------|--------|
| **Deno** | `deno.json` uses `unstable: ["kv"]` for local KV fallback paths |
| **Bun** | `bun:sqlite`, native workers |
| **Node** | ≥ **22.6**, `--experimental-sqlite --experimental-strip-types` |

---

## Quick start (Deno)

```bash
# HTTP server + web UI (default port 3737, or PORT env)
deno task server

# Open http://127.0.0.1:3737/
```

**One-off CLI grind** (writes `hits.jsonl` / `bin.jsonl` / DB per your flags):

```bash
deno task grind -- -p meth -s ic -n 1 -t 8
```

**GPU probe on Deno** (keygen still CPU unless you extend workers):

```bash
deno task grind-gpu -- -p meth -n 1 -t 4
```

**Typecheck the main modules:**

```bash
deno task check
```

### Deno tasks (from [`deno.json`](deno.json))

| Task | Purpose |
|------|---------|
| `server` | Watch mode + HTTP server |
| `server-ui` | Same as `server` (alias for UI work) |
| `dev` | Watch + verbose logging |
| `start` | Run server once without watch |
| `grind` | Pass-through to `main.ts --` for CLI args |
| `grind-gpu` | Adds `--unstable-webgpu` + `-W` |
| `grind-fast` | Preset threads / oversample / refresh |
| `deploy` | `deno deploy .` (project entry is repo root) |
| `bench` | `deno bench benchmarks/...` |
| `check` | `deno check` on core `.ts` files |
| `decrypt` | Run `decrypt.ts` |

---

## Bun and Node (optional `package.json` scripts)

```bash
npm run server    # Node: HTTP server
npm run bun       # Bun: CLI entry
npm run node      # Node: CLI entry
npm run decrypt   # Node: decrypt helper
```

---

## HTTP API (server mode)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` , `/index.html` | Control panel HTML |
| `GET` | `/solden-mark.svg` , `/favicon.svg` , `/favicon.ico` | SVG mark (cached read from disk) |
| `GET` | `/health` | `{ ok, ts, runtime }` |
| `GET` | `/system` | Runtime, CPU hints, Deploy worker cap, `httpEphemeralHits`, etc. |
| `GET` | `/events` | **SSE**: logs, `progress`, `status` |
| `GET` | `/results` | Last hits from DB (empty when ephemeral HTTP mode) |
| `POST` | `/grind` | JSON body [`GrindOpts`](types.ts); JSON array **or** NDJSON stream if `Accept: application/x-ndjson` |
| `OPTIONS` | `*` | CORS preflight when `ACCESS_CONTROL_ALLOW_ORIGIN` is set |

**CORS:** set `ACCESS_CONTROL_ALLOW_ORIGIN` to your UI origin if the panel is hosted elsewhere.

---

## Environment variables

Copy [`.env.example`](.env.example) to `.env` for local Deno with `--allow-env` if you use env-based config.

| Variable | Purpose |
|----------|---------|
| `PORT` | HTTP listen port (default **3737**) |
| `LOG_LEVEL` | `trace` … `error` |
| `LOG_JSON` | `1` / `true` — JSON lines on stderr |
| `LOG_VERBOSE` | Richer pulse data on TTY |
| `ACCESS_CONTROL_ALLOW_ORIGIN` | Enables CORS for browser UIs on another origin |
| `DENO_DEPLOYMENT_ID` | Set on Deno Deploy — auto server mode, Deploy-specific caps |
| `VANITY_HTTP_EPHEMERAL` | `1` — never persist hits to DB/KV (any host) |
| `VANITY_HTTP_PERSIST_HITS` | `1` — **on Deploy only**, store hits in KV (default off) |
| `VANITY_SSE_LOG_PULSE` | `1` — mirror grind pulse logs into SSE ring on Deploy |
| `VANITY_DEPLOY_MAX_WORKERS` | Hard cap on workers per Deploy isolate |
| `VANITY_DEPLOY_MEMORY_BUDGET_MB` / `VANITY_DEPLOY_MB_PER_WORKER` | Heuristic worker cap |
| `VANITY_USE_WEBGPU` | WebGPU probe policy (see `--help` in `main.ts`) |

Run **`deno run --allow-read --allow-write --allow-net --allow-sys main.ts --help`** for the full option list (`-p` prefix, `-s` suffix, `-t` threads, `-m` max workers, etc.).

---

## Persistence and privacy (HTTP)

- **Deno Deploy (default):** user hits are **not** written to KV unless `VANITY_HTTP_PERSIST_HITS=1`. The server uses an in-memory no-op DB for HTTP grinds in that mode (`GET /results` is empty).
- **Self-hosted:** SQLite (or KV fallback on Deno) under `-d` / `vanity.db` unless you set `VANITY_HTTP_EPHEMERAL=1`.

---

## Decrypt (encrypted CLI output)

```bash
deno task decrypt
# or: deno run --allow-read decrypt.ts
```

Pass ciphertext + key per `decrypt.ts` usage (see file header).

---

## Benchmarks

```bash
deno task bench
```

---

## Development log

Incremental notes live in [`DEVELOPMENT.md`](DEVELOPMENT.md) (dated entries).

---

## License

No `LICENSE` file is committed in this tree; refer to the **solden** GitHub project linked in the web panel footer for upstream terms.
