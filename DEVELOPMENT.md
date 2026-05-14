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
