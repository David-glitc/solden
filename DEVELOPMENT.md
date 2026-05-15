## 2026-05-13 08:48 UTC+1
- Added concurrency tuning flags: `--bun-oversubscribe`, `--progress-every`, and `--ui-refresh-ms`.
- Added Bun-oriented tasks in `deno.json` (`bun-grind`, `bun-fast`, `grind-fast`) and updated CLI help for Bun high-concurrency usage.
- Extended worker progress telemetry with match-detail fields (matched prefix/suffix chars, target-char accuracy, mismatch boundaries, best prefix/suffix windows).
- Aggregated global best metrics in coordinator: best score, best matched-char accuracy, running average accuracy, effective worker count.
- Upgraded live progress line to compactly show throughput + telescoping fields + best accuracy.
- Verified with `deno check main.ts` and smoke runs on Deno/Bun (`-s 1 -n 1`).

## 2026-05-13 09:05 UTC+1
- Server mode: added `GET /` control panel (`ui.ts`), `GET /events` SSE stream, `GET /system` machine snapshot.
- Structured logs broadcast to SSE clients via `globalThis.__vanitySseBroadcast` hook from `log.ts` emit path.
- SSE clients removed on `AbortSignal` disconnect; `Deno.serve(handler)` without port when `DENO_DEPLOYMENT_ID` is set (`runtime.ts`).
- Deno KV: `openKv()` managed store on Deploy; file-backed `openKv(kvPath)` when not on Deploy (`db.ts`).
- UI: difficulty/ETA from 58^len and keys/sec; live keys/sec from progress; case-sensitive + encrypt toggles; threshold SSE lines.
- `deno.json`: added `server-ui` and `deploy` tasks. Help documents Deploy + KV link.
- Note: Deno Deploy isolates may restrict Web Workers or CPU; vanity grind may need a VM or self-hosted Deno instead if workers fail.

## 2026-05-13 09:25 UTC+1
- CLI: startup table (machine + grind params), stderr heartbeat every 15s (`cli_heartbeat`), mismatch display `mis P0→P0` (P=prefix index, S=suffix index).
- `--max-workers` / `-m` caps effective workers when Bun oversubscribe is high; warns when capped.
- Clarified in CLI banner: logs on stderr vs spinner on stdout; random Ed25519 search cannot “walk” base58 toward a prefix and remain a valid keypair.
- Web UI: `mis` legend aligned; fixed `updateDiff` function wrapper; POST includes `maxWorkers`.

## 2026-05-13 12:22 UTC+1
- Web UI: light black/white layout (rounded cards, spacing, readable type); live log panel uses wrap/break-word and hidden horizontal overflow to avoid sideways scroll; added `estKps` field; grind POST sends `uiRefreshMs` and `caseSensitive`; SSE `onopen` line for clarity.
- Server: ring buffer of last 200 structured log records; new `GET /events` clients receive `connected` then replayed `log` events so early `server_listen` lines appear after page load.

## 2026-05-14
- Web UI (`ui.ts`): mobile-focused layout — `viewport-fit=cover`, safe-area padding on `.shell`, `100dvh`, `overflow-x: clip`, 16px inputs on narrow viewports (iOS focus zoom), 48px min touch targets, full-width primary button and stacked checkbox rows under 640px, `-webkit-overflow-scrolling: touch` on logs, `theme-color` meta, word-wrap on stat cards.
- `/system` + UI: `getSystemInfo()` hardened for Deno Deploy (explicit `environment`, no host RAM), full try/catch; optional CORS via `ACCESS_CONTROL_ALLOW_ORIGIN`; UI uses `data-api-base`, checks `fetch` HTTP status, 12s timeout, and always updates Machine card on failure (grind uses same API base). Footer: David Pere, davidpere.vercel.app.
- Deno Deploy: `LOG_LEVEL` defaults to `info` when unset (same as local); use `LOG_VERBOSE=1` or `-v` for more detail.
- Added `.env.example` (Deno Deploy / local env hints for https://solden.atomiclabs.cc/); `.gitignore` includes `.env`.
- Branding: canonical **`static/solden-mark.svg`** (served as **`/favicon.svg`**, **`/favicon.ico`**, **`/solden-mark.svg`** via cached read in `main.ts`), header mark in panel, footer source link https://github.com/David-glitc/solden
- Machine + header: HTML embeds `__VANITY_SYSTEM_BOOT_JSON__` replaced at `GET /` with `getSystemInfo()` so the card is filled without relying on `fetch(/system)` alone; Machine **Refresh** button; header gradient, kicker, Live pill; fetch uses `cache: no-store`; failed refresh does not wipe boot snapshot.
- UI: removed Machine card and boot JSON; `GET /` serves static `UI_HTML` again. Grind form uses `pickInt`/`pickFloat` + client check for prefix/suffix; SSE JSON guarded; POST body clamped on server. Hint clarifies only prefix/suffix required.

## 2026-05-14 — WebGPU probe + compact logging (session)
- `webgpu_env.ts`: environment-aware WebGPU probe (`evaluateWebGpuForGrind`); Deploy skip; Deno local uses `navigator.gpu` when enabled; keygen remains on CPU workers.
- `types.ts` / `main.ts`: `useWebgpu` via `-W`/`--use-webgpu`, `VANITY_USE_WEBGPU`, and HTTP `useWebgpu` when env does not override.
- `grind.ts`: `grind_start` logs `workers`, `count`, `pfxLen`, `sfxLen`, `gpu` status only.
- `log.ts`: unset `LOG_LEVEL` defaults to `info` everywhere (no Deploy-only debug); `LOG_VERBOSE=1` on TTY shows full pretty `cli_heartbeat` JSON; otherwise a single-line pulse; long pretty JSON payloads truncated.
- CLI stdout: one live progress line (`t=…s`, workers, keys, k/s, score/acc/mis; no best-address line); stderr heartbeat payload slimmed to `tSec`, `w`, `chk`, `instK`, `avgK`, `score`.
- `deno.json`: `grind-gpu` task runs with `--unstable-webgpu` for adapter probing where supported.
- `ui.ts`: optional “Probe WebGPU” checkbox on grind POST (`useWebgpu`).

## 2026-05-14 — UI grind diagnostics + CORS error path
- `ui.ts`: Live stream logs page origin, API base, SSE URL, full POST target on click; notes long-running grind; logs HTTP status/elapsed and error bodies; clearer SSE reconnect hint; `fetch` errors mention CORS/mixed content.
- `main.ts`: `http_grind` includes `useWebgpu`, `origin`, `referer`; `http_grind_reject_empty_pattern` on 400; `http_unhandled` responses use `applyCors` via `done()`.
- `webgpu_env.ts`: comment that Bun has no built-in `navigator.gpu`; local probe is Deno + `--unstable-webgpu`.

## 2026-05-14 — SSE grind pulses, Deno SQLite, faster Deno keygen, Bun deploy notes
- **Server logs → UI:** throttled `http_grind_pulse` every 5s during `POST /grind` (same fields as CLI heartbeat + `addrHead` + human `elapsed`); emitted via `log.info` so `/events` SSE mirrors stderr JSON; TTY uses compact pulse for `http_grind_pulse` too.
- **`log.ts`:** `formatElapsedSeconds()` for `8.4s` → `12m03s` → `1h02m15s`; CLI pulse and pretty line use it; `cli_heartbeat` includes `addrHead` when known.
- **`db.ts`:** Deno **local** uses `node:sqlite` on `vanity.db` (same low-latency path as Bun); **Deploy** stays managed Deno KV; KV file fallback only if sqlite import fails.
- **`worker.ts`:** Deno workers use **`node:crypto` `generateKeyPairSync`** when available (much higher kp/s than `crypto.subtle` alone).
- **`ui.ts`:** fixed `file://` warning string (no nested backticks inside `UI_HTML` template).

### Bun runtime deploy (not Deno Deploy)
- Run `bun main.ts --server` (or `bun main.ts --server -P 8080`); set **`PORT`** if the host injects it.
- **Docker:** `FROM oven/bun:1`, copy repo, `CMD ["bun", "main.ts", "--server"]`; expose `PORT`; mount a volume on `vanity.db` if you need durable hits across restarts.
- **Fly.io / Railway / Render:** set start command to the above; no `--allow-*` flags (Bun). Point a DNS hostname at the service; optional `ACCESS_CONTROL_ALLOW_ORIGIN` if the UI is on another origin.
- **Deno Deploy** remains Deno-only; for Bun you self-host on a VM or container platform.

## 2026-05-14 — Static panel HTML + grind button fix
- **Root cause:** the inline `UI_HTML` script lost `if (startBtn) startBtn.onclick = async function() {`, so the browser hit a **syntax error** and never bound the button (no fetch).
- **Panel:** `static/index.html` is served for **`GET /`** and **`GET /index.html`** (`getControlPanelHtml()` in `main.ts`, cached per process). Edit that file directly; no TS template literal.
- **`ui.ts` removed** (was only `UI_HTML`). Logo in header uses **`/solden-mark.svg`**.
- On **Deno**, raise workers with CLI **`-t` / `--threads`** and optional cap **`-m` / `--max-workers`** (`-B` Bun oversubscribe is Bun-only, ignored on Deno).
- **UI:** boot `GET /system` logs `Backend /grind runs on: runtime=…` so you can confirm Deno vs Bun; hint text explains browser vs server.

## 2026-05-14 — Server `--watch`, grind POST logs, `grind-gpu` defaults `-W`
- `deno.json`: **`deno run --watch`** on `server`, `server-ui`, and `dev` (not on bare `start`). A trailing `--watch` on the **task** was only forwarded to `main.ts` and did nothing.
- **`grind-gpu`** appends **`-W`** so GPU probe is requested; without `-W` or `VANITY_USE_WEBGPU`, `grind_start` shows `gpu: off`.
- **`http_grind_post`** logs as soon as **`POST /grind`** is received; **`http_grind`** includes **`effectiveWorkers`**; **`http_response`** for `/grind` still logs only after the grind finishes.

## 2026-05-14 — Panel: timer, results export, tooltips
- **`static/index.html`:** Loading **spinner + elapsed clock** during grind; **Results** with per-row **Copy**; **Copy JSON**, **Download .json / .jsonl**, **Download keypair.json** (64-byte Solana CLI array, first hit, plaintext only).
- Server **log JSON** no longer streams into the main UI; optional **Technical diagnostics** `<details>` for error dumps only. **SSE `progress`** still drives the three stat cards.
- Shorter hero copy; **tooltips** on form labels; **logo** in white rounded frame. **New grind** clears diagnostics, hides old results until the new response completes.

## 2026-05-14 — Streamed throughput, cancel, panel API cleanup
- **`grind.ts`:** optional `AbortSignal`; abort terminates workers and rejects with `AbortError`; HTTP `/grind` passes `req.signal` so client disconnect or **Cancel** stops the run.
- **`main.ts`:** every SSE `progress` tick includes **`avgKpsWall`** / **`wallElapsedSec`**; throttled **`http_grind_pulse`** logs add **`bestAcc`**, **`runAvgAcc`**, **`mis`**; grind abort handling accepts any **`AbortError`**-named failure, not only `DOMException`; **`cli_heartbeat`** includes the same accuracy/mismatch fields for compact pulses.
- **`static/index.html`:** no manual avg keys/s input; throughput / difficulty ETA / best score / accuracy update from SSE **`progress`**; **Cancel** uses `AbortController` + `fetch(..., signal)`; POST sends **`threadsMultiplier: 1`** (server still accepts legacy **`bunOversubscribe`**).
- **`log.ts`:** one-line pulse formatter shows optional accuracy + mismatch tail when those fields are present.

## 2026-05-14 — Deploy: SSE connect + client bootstrap
- **`main.ts` `/events`:** return the **`Response` immediately**; replay **`logRing`** in a **background** async loop so the browser leaves the EventSource **“connecting”** state without waiting for up to 200 writes. Removed hop-by-hop **`Connection: keep-alive`** (problematic on HTTP/2). Added **`x-accel-buffering: no`** and periodic **`: ping`** frames; **idempotent detach** and **abort-if-already-aborted** on `req.signal`.
- **`main.ts` `/grind` (NDJSON):** emit an immediate **`{ type: "started", … }`** line so the POST body starts streaming before the first worker progress tick.
- **`static/index.html`:** **`fetchWithTimeout`** for **`/health`** and **`/system`** (10s); always surface **`/system`** HTTP errors and non-JSON; **EventSource** `onopen` only upgrades the bar from **`pending`**; **`onerror`** does not clobber **`ok`**. NDJSON consumer ignores **`started`**.

## 2026-05-14 — POST /grind NDJSON body stream
- **`main.ts`:** when `Accept` includes **`application/x-ndjson`**, **`POST /grind`** returns **200** immediately with a **`ReadableStream`** body: one JSON object per line — repeated **`type: "progress"`** lines (same fields as SSE progress), then a terminal **`type: "done"`** (with `hits`), **`type: "cancelled"`**, or **`type: "error"`**. Headers include **`x-accel-buffering: no`** for reverse proxies. Without that Accept value, the handler still returns a single JSON array after the grind (legacy `curl` / scripts).
- **`static/index.html`:** grind **`fetch`** sends **`Accept: application/x-ndjson, application/json`** and **`consumeGrindNdjsonStream`** updates the stat cards from each progress line; **`applyGrindProgressFromServer`** is shared with the SSE `progress` listener.

## 2026-05-14 — Panel UI refresh (accessibility + dark mode)
- **`static/index.html`:** skip link, **`<main id="main">`**, **`color-scheme: light dark`** with **`prefers-color-scheme: dark`** tokens; accent stripe on stat cards; server status **dot** via **`data-state`** + **`#serverBarText`**; fieldsets for Pattern / Run / Performance / Options; **`for=`** labels; **`aria-live`** on stats and progress, **`aria-busy`** on grind card; **`setServerState`**, error/results **scrollIntoView**; fixed **`??`** regressions in progress handler; diagnostics **`<pre>`** framed; reduced-motion overrides.

## 2026-05-14 — Panel: client request clock vs server final wall
- **`static/index.html`:** While **`clientGrindActive`**, throughput uses **browser elapsed** for avg keys/s and the subtitle **`…s request`** (250 ms tick + last progress snapshot); **`wallElapsedSec`** from SSE/NDJSON is used only when **not** in a local grind. **Final** toast, banner, and **`setGrindElapsedBanner`** prefer **`wallElapsedSec`** on NDJSON **`done`**, else **`x-grind-wall-ms`** on the JSON grind response, else client RTT.
- **`main.ts`:** NDJSON **`done`** includes **`wallElapsedSec`** (from **`grindWall0`**). Non-NDJSON **`POST /grind`** returns JSON with header **`x-grind-wall-ms`** (grind wall ms).

## 2026-05-14 — Panel: diagnostics contrast, wall time, Deploy cap in bar
- **`static/index.html`:** Diagnostics **`<pre>`** uses a fixed **high-contrast** palette (`.diag-log`, not `var(--muted)`/`var(--surface)`); **Clear log** / **Copy log**; **`#grindElapsedBanner`** under Results shows **wall time** after a successful grind; success **toast** includes **`formatGrindClock`**; first NDJSON **`started`** line can log **`appliedThreads`**, **`appliedMaxWorkers`**, **`deployWorkerCap`**; **`/system`** status text includes **Deploy worker cap** when the JSON field is present.
- **`main.ts`:** **`POST /grind`** empty prefix/suffix check uses **`go`** (before **`goForGrind`** is declared); Deploy serialization / worker cap behavior unchanged from prior commit.

## 2026-05-14 — HTTP prod: ephemeral hits, lighter SSE/NDJSON on Deploy
- **`db.ts`:** **`createEphemeralDb()`** — no-op **`saveHits`**, empty **`getHits`** (no KV/SQLite open).
- **`main.ts`:** **`httpUsesEphemeralHits()`** — default on **Deno Deploy** (no **`VANITY_HTTP_PERSIST_HITS`**); any host with **`VANITY_HTTP_EPHEMERAL=1`** skips persist. **`/system`** includes **`httpEphemeralHits`**. Deploy: smaller **SSE log ring**, **`http_grind_pulse`** omitted from the ring unless **`VANITY_SSE_LOG_PULSE=1`**; **SSE + NDJSON progress** coalesced to at most ~**`uiRefreshMs`** (120–2000 ms cap) per request to cut wire and encode work.

## 2026-05-14 — Repo layout, README, single SVG asset
- **Removed:** duplicate **`logo.svg`** (root), unused **`logo.ts`**, in-repo **`brand.ts`** (`LOGO_SVG` inlined in TS). **Added:** **`static/solden-mark.svg`** as the only on-disk mark; **`main.ts`** reads it via **`readTextFromModuleUrl`** (shared with the control panel HTML) and caches **`getSoldMarkSvg()`** for **`/favicon.svg`**, **`/favicon.ico`**, **`/solden-mark.svg`**.
- **`README.md`:** Full usage (Deno/Bun/Node), API table, env vars, embedded SVG for copy-paste, repo file table. **`package.json`** scripts now point at repo-root **`main.ts`** / **`decrypt.ts`**. **`.gitignore`:** default DB/KV/JSONL artifacts. **`deno task check`** widened to core modules. **`.env.example`:** Deploy-related **`VANITY_*`** placeholders. Panel favicon + hero image use **`/solden-mark.svg`**.

## 2026-05-14 — Panel copy: end-user friendly status (no CPU line)
- **`static/index.html`:** Status bar hides **runtime / CPU / region / worker-cap** strings; short **plain-language** ready and error lines. Hero, stat cards, form labels, hints, and errors reworded for non-technical readers; **Troubleshooting log** (was Technical diagnostics); throughput uses **parallel lanes**; **Start search** button; page title and accuracy copy softened.

## 2026-05-15 — Admin panel, threshold keys UI, worker eval fast path
- **`src/admin.ts`:** `VANITY_ADMIN_PASSWORD` sessions; background jobs (survive disconnect); `/admin/api/monitor`; unthrottled ~90% CPU worker caps via `applyAdminOpts`.
- **`static/admin.html`:** Login, resource monitor, spawn/list/cancel jobs, copy/keypair for threshold+ hits.
- **`static/index.html`:** Header light text; **4 taps** on logo → `/admin.html`; **Near matches** section with copy + keypair; NDJSON/SSE `threshold` lines.
- **`src/worker.ts`:** Single-pass `evalAddr` (score + hit); defer secret b58 encode until threshold/hit.

## 2026-05-15 — Index-scoped address eval (prefix/suffix chunks only)
- **`src/worker.ts`:** `evalAddr` / `matchStats` compare only `addr[0..pfxLen)` and `addr[len-sfxLen..len)` via `addrCharEq`; no full-address `toLowerCase()` on the hot path.

## 2026-05-15 — Admin UI layout, extreme perf mode, full job params
- **`static/admin.html`:** Grid layout, RAM hero + bar, CPU stats, performance mode (standard / unthrottled / extreme = all cores), full job form (keygen, batch, threads, caps, encrypt…).
- **`src/admin.ts`:** `perfMode` extreme uses `threads = maxWorkers = cpuCount`; monitor adds `memoryFreePercent`, `adminExtremeThreads`.

## 2026-05-15 — README overhaul + UI Advanced mode (all GrindOpts)
- **`README.md`:** Full CLI/API/env tables, architecture diagram, performance notes, Advanced mode docs.
- **`static/index.html`:** Advanced mode toggle + panel (`keygen`, `keygenBatch`, `bunOversubscribe`, `progressEvery`, `uiRefreshMs`, `maxWorkers`, `useWebgpu`, `decryptKey`); `buildGrindBody()`; live `keygenBackend` in throughput card.

## 2026-05-15 — Multi-backend batch keygen (path to ~500k keys/s aggregate)
- **`src/keygen.ts`:** `auto` → sodium-native → `@noble/ed25519` batch → `node:crypto` → `subtle`.
- **`src/b58.ts`:** shared `b58Pub32` with offset (no subarray alloc).
- **`src/worker.ts`:** batch loop (`VANITY_KEYGEN`, `VANITY_KEYGEN_BATCH`); progress reports `keygenBackend`.
- **CLI:** `-K` / `--keygen`, `-G` / `--keygen-batch`; tasks `grind-turbo`, `bench-keygen`; optional npm deps in `package.json`.

## 2026-05-15 — Admin memory usage chart (Chart.js)
- **`static/admin.html`:** Live memory chart (used RAM, process RSS, heap MB) updated from SSE monitor snapshots.

## 2026-05-15 — Admin full run profile + reload-safe running jobs
- **`src/types.ts` / `src/admin.ts`:** Progress stores best address, prefix/suffix windows, accuracy, keygen backend, workers; `progressUpdatedAt` + `detached` keep running jobs visible after reload (15min window).
- **`static/admin.html`:** Run profile panel (score %, addr head, full address, match details).

## 2026-05-15 — Admin UI: charts, advanced opts, threshold log, run times
- **`static/admin.html`:** Chart.js CDN throughput chart; advanced job form (case sensitive, encrypt, keygen…); per-job run clock + timestamps; threshold vs final hit tables with copy.

## 2026-05-15 — Admin fix: stateless auth, job persistence, SSE UI
- **`src/admin_auth.ts`:** HMAC signed tokens (no in-memory sessions) — fixes 401 on Deno Deploy isolates.
- **`src/admin_store.ts`:** Jobs persisted to Deno KV (Deploy) or SQLite `admin_jobs` table (local).
- **`static/admin.html`:** Simpler flex/grid UI; `EventSource` `/admin/api/stream` for live jobs + monitor; no logout on transient errors.

## 2026-05-15 — Admin: delete jobs, live refresh, memory cleanup, restart
- **`src/admin.ts`:** `deleteJob`, `deleteFinishedJobs`, `adminMemoryCleanup` (GC + drop finished jobs), `adminRequestRestart` (env-gated).
- **`src/main.ts`:** `DELETE /admin/api/jobs/:id` removes job (`?cancel=1` to cancel only); `POST /admin/api/system/cleanup`, `POST /admin/api/system/restart`.
- **`static/admin.html`:** Delete per job; Cancel vs Delete; 0.8s poll while jobs run; Clear memory + Restart process buttons.

## 2026-05-15 — Worker hot-path acceleration (sync loop, scratch buffers)
- **`src/worker.ts`:** Node path uses sync `runLoop()` (no `await` per key); `generateKeyPairSync` with DER encoding options; reused `scratchPub`/`scratchSecret` + `b58_32` digit buffer; precomputed `pfxC`/`sfxC`; `publicKey` reuses `address` string; `detailProgress` off when `progressEvery >= 4096`; `needScore` off when `threshold === 100`.

## 2026-05-14 — `src/` layout; root entry shims
- **Moved:** application modules to **`src/`** (`main`, `worker`, `grind`, `db`, `crypto`, `log`, `runtime`, `types`, `webgpu_env`, `decrypt`). **Repo root** keeps thin **`main.ts`** / **`decrypt.ts`** that `import "./src/…"` so **`deno run main.ts`**, **`deno task`**, and Deno Deploy default entry stay on familiar paths.
- **`src/main.ts`:** loads **`../static/index.html`** and **`../static/solden-mark.svg`**. **`deno task check`** typechecks root shims + all **`src/*.ts`**. **`README.md`** layout table updated.
