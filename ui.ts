export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#111111" />
  <meta name="color-scheme" content="light" />
  <title>SOLDEN · Sol vanity</title>
  <link rel="icon" href="/logo.svg" type="image/svg+xml" sizes="any" />
  <link rel="apple-touch-icon" href="/logo.svg" />
  <style>
    :root {
      --ink: #0a0a0a;
      --paper: #ffffff;
      --muted: #5c5c5c;
      --line: #d9d9d9;
      --surface: #f6f6f6;
      --radius-lg: 18px;
      --radius-md: 12px;
      --shadow: 0 8px 28px rgba(0,0,0,.08);
      --touch-min: 48px;
    }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; }
    body {
      margin: 0;
      font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.5;
      color: var(--ink);
      background: linear-gradient(160deg, #f0f0f0 0%, #fafafa 40%, #fff 100%);
      min-height: 100dvh;
      overflow-x: clip;
      -webkit-tap-highlight-color: rgba(10, 10, 10, 0.08);
    }
    .shell {
      max-width: 1120px;
      margin: 0 auto;
      padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
        max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    }
    header {
      background: var(--ink);
      color: var(--paper);
      border-radius: var(--radius-lg);
      padding: 22px 26px;
      margin-bottom: 22px;
      box-shadow: var(--shadow);
    }
    .header-top {
      display: flex;
      align-items: flex-start;
      gap: 18px;
    }
    .brand-mark {
      flex-shrink: 0;
      background: var(--paper);
      border-radius: 14px;
      padding: 6px;
      line-height: 0;
      box-shadow: 0 1px 0 rgba(255,255,255,.12) inset;
    }
    .brand-mark img {
      display: block;
      width: 52px;
      height: 52px;
    }
    .header-copy { min-width: 0; flex: 1; }
    header h1 { margin: 0; font-size: 1.35rem; font-weight: 650; letter-spacing: -0.02em; }
    header p { margin: 8px 0 0; font-size: 0.92rem; opacity: .88; max-width: 62ch; }
    .grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    @media (max-width: 960px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 520px) { .grid { grid-template-columns: 1fr; } }
    .card {
      min-width: 0;
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 18px 20px;
      box-shadow: var(--shadow);
    }
    .card h3 {
      margin: 0 0 12px;
      font-size: 0.78rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .card .body { font-size: 0.95rem; line-height: 1.55; }
    label {
      display: block;
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin-bottom: 6px;
    }
    input, select, button {
      width: 100%;
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      background: var(--paper);
      color: var(--ink);
      padding: 11px 14px;
      font-size: 1rem;
      min-height: 44px;
    }
    input:focus, select:focus, button:focus-visible {
      outline: 2px solid var(--ink);
      outline-offset: 2px;
    }
    .row {
      display: grid;
      gap: 14px 16px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    @media (max-width: 900px) { .row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 520px) { .row { grid-template-columns: 1fr; } }
    .checks {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 18px;
      padding-top: 4px;
    }
    .checks label {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 10px;
      margin: 0;
      text-transform: none;
      font-size: 0.92rem;
      font-weight: 500;
      letter-spacing: 0;
      color: var(--ink);
      cursor: pointer;
    }
    .checks input {
      width: 22px;
      height: 22px;
      min-width: 22px;
      min-height: 22px;
      flex-shrink: 0;
      accent-color: var(--ink);
    }
    #startBtn {
      margin-top: 16px;
      max-width: 220px;
      width: 100%;
      background: var(--ink);
      color: var(--paper);
      border: none;
      font-weight: 650;
      padding: 14px 20px;
      border-radius: 999px;
      cursor: pointer;
      min-height: var(--touch-min);
    }
    #startBtn:disabled { opacity: .45; cursor: not-allowed; }
    .hint {
      margin-top: 12px;
      font-size: 0.85rem;
      color: var(--muted);
      max-width: 85ch;
    }
    .legend {
      margin-top: 14px;
      padding: 14px 16px;
      background: var(--surface);
      border-radius: var(--radius-md);
      border: 1px solid var(--line);
      font-size: 0.86rem;
      color: var(--muted);
    }
    .legend strong { color: var(--ink); }
    .mono {
      font-family: ui-monospace, "Cascadia Code", Consolas, Menlo, monospace;
      font-size: 0.9rem;
      letter-spacing: 0.01em;
    }
    #logs {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      overflow-x: hidden;
      overflow-y: auto;
      max-height: min(52vh, 480px);
      min-height: 200px;
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      padding: 18px 20px;
      font-size: 0.92rem;
      line-height: 1.6;
      color: var(--ink);
      -webkit-overflow-scrolling: touch;
      overscroll-behavior: contain;
    }
    #machine, #throughput, #difficulty, #accuracy {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    #machine { white-space: pre-line; }
    #accuracy { white-space: pre-line; }
    .muted { color: var(--muted); }
    .site-footer {
      margin-top: 28px;
      padding: 18px 22px;
      border-radius: var(--radius-lg);
      border: 1px solid var(--line);
      background: var(--paper);
      box-shadow: var(--shadow);
      font-size: 0.9rem;
      color: var(--muted);
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 18px;
    }
    .site-footer a {
      color: var(--ink);
      font-weight: 600;
      text-decoration: none;
      border-bottom: 1px solid var(--line);
    }
    .site-footer a:hover { border-bottom-color: var(--ink); }
    .site-footer a:active { opacity: 0.85; }

    @media (max-width: 640px) {
      body { font-size: 16px; }
      .shell { padding-left: max(12px, env(safe-area-inset-left)); padding-right: max(12px, env(safe-area-inset-right)); }
      header { padding: 18px 18px; border-radius: 14px; }
      .header-top { gap: 14px; align-items: center; }
      .brand-mark img { width: 48px; height: 48px; }
      .brand-mark { padding: 5px; border-radius: 12px; }
      header h1 { font-size: 1.2rem; line-height: 1.25; }
      header p { font-size: 0.9rem; }
      .card { padding: 16px 16px; border-radius: 14px; }
      .row { gap: 16px; }
      input, select, button {
        font-size: 16px;
        min-height: var(--touch-min);
        padding: 12px 14px;
      }
      #startBtn {
        max-width: none;
        min-height: var(--touch-min);
      }
      .checks {
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
      }
      .checks label {
        min-height: var(--touch-min);
        padding: 12px 14px;
        border-radius: var(--radius-md);
        background: var(--surface);
        border: 1px solid var(--line);
        width: 100%;
      }
      .checks input {
        width: 24px;
        height: 24px;
        min-width: 24px;
        min-height: 24px;
      }
      .legend { font-size: 0.85rem; padding: 12px 14px; }
      .hint { font-size: 0.88rem; }
      #logs {
        max-height: min(42dvh, 360px);
        min-height: 160px;
        padding: 14px 14px;
        font-size: 0.88rem;
      }
      .mono { font-size: 0.86rem; }
      .site-footer {
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
        padding: 16px 16px;
      }
      .site-footer a {
        display: block;
        padding: 12px 0;
        min-height: 44px;
        line-height: 1.4;
        border-bottom: none;
        border-radius: var(--radius-md);
      }
    }

    @media (min-width: 641px) {
      #startBtn { width: auto; }
    }
  </style>
</head>
<body data-api-base="">
  <div class="shell">
    <header>
      <div class="header-top">
        <div class="brand-mark" aria-hidden="true"><img src="/logo.svg" width="52" height="52" alt="" decoding="async" /></div>
        <div class="header-copy">
          <h1>Sol vanity control panel</h1>
          <p>Light UI, high contrast. Live logs wrap (no horizontal scroll). Connect the event stream to see buffered server logs after load.</p>
        </div>
      </div>
    </header>

    <div class="grid">
      <div class="card"><h3>Machine</h3><div id="machine" class="mono body muted">Loading…</div></div>
      <div class="card"><h3>Throughput</h3><div id="throughput" class="mono body">No live data yet</div></div>
      <div class="card"><h3>Difficulty</h3><div id="difficulty" class="mono body">Set params to estimate</div></div>
      <div class="card"><h3>Best accuracy</h3><div id="accuracy" class="mono body">No progress yet</div></div>
    </div>

    <div class="card" style="margin-top:18px">
      <h3>Grind parameters</h3>
      <div class="row">
        <div><label>Prefix</label><input id="prefix" value="meth" autocomplete="off" /></div>
        <div><label>Suffix</label><input id="suffix" value="" autocomplete="off" /></div>
        <div><label>Count</label><input id="count" type="number" min="1" value="1" /></div>
        <div><label>Threads</label><input id="threads" type="number" min="1" value="16" /></div>
        <div><label>Bun oversubscribe</label><input id="bunOver" type="number" min="1" step="0.1" value="1.5" /></div>
        <div><label>Threshold %</label><input id="threshold" type="number" min="0" max="100" value="90" /></div>
        <div><label>Progress every</label><input id="progressEvery" type="number" min="64" value="1024" /></div>
        <div><label>UI refresh ms</label><input id="uiRefreshMs" type="number" min="25" value="120" /></div>
        <div><label>Max workers (cap)</label><input id="maxWorkers" type="number" min="1" value="256" /></div>
        <div><label>Est. keys/s (ETA)</label><input id="estKps" type="number" min="1" step="100" value="50000" /></div>
        <div class="checks" style="grid-column: 1 / -1">
          <label><input id="caseSensitive" type="checkbox" /> Case-sensitive</label>
          <label><input id="encrypt" type="checkbox" /> Encrypt keys</label>
        </div>
      </div>
      <button type="button" id="startBtn">Start grind</button>
      <p class="hint">Difficulty: expected tries ≈ 58^(prefixLen+suffixLen). ETA (min) ≈ tries / (keys/s) / 60. Progress events can overwrite the estimated keys/s field.</p>
      <div class="legend"><strong>Mismatch legend:</strong> <span class="mono">P0→P3</span> means first/last wrong index in the combined pattern; <strong>P</strong> = prefix index, <strong>S</strong> = suffix index (0-based).</div>
    </div>

    <div class="card" style="margin-top:18px; min-width:0">
      <h3>Live stream</h3>
      <pre id="logs" class="mono" aria-live="polite"></pre>
    </div>

    <footer class="site-footer">
      <span>David Pere</span>
      <a href="https://davidpere.vercel.app" target="_blank" rel="noopener noreferrer">davidpere.vercel.app</a>
      <a href="https://x.com/davidpereishim" target="_blank" rel="noopener noreferrer">X · @davidpereishim</a>
      <a href="https://github.com/David-gllitc" target="_blank" rel="noopener noreferrer">GitHub · David-gllitc</a>
    </footer>
  </div>
  <script>
    const q = (id) => document.getElementById(id);
    const logs = q("logs");
    const machine = q("machine");
    const throughput = q("throughput");
    const difficulty = q("difficulty");
    const accuracy = q("accuracy");
    const startBtn = q("startBtn");
    let latestAggKps = 0;

    var API_BASE = (document.body.getAttribute("data-api-base") || "").trim();
    if (API_BASE.endsWith("/")) API_BASE = API_BASE.slice(0, -1);
    function apiUrl(path) {
      if (path.charAt(0) !== "/") path = "/" + path;
      return API_BASE ? (API_BASE + path) : path;
    }
    function formatMachine(s) {
      var lines = [
        "runtime=" + (s.runtime || "?"),
        "cores=" + (s.cpuCount ?? "?"),
        "platform=" + (s.platform || "?"),
        "memTotalMB=" + (s.memoryTotalMB != null ? s.memoryTotalMB : "n/a"),
        "memFreeMB=" + (s.memoryFreeMB != null ? s.memoryFreeMB : "n/a")
      ];
      if (s.environment) lines.push("environment=" + s.environment);
      if (s.region) lines.push("region=" + s.region);
      if (s.note) lines.push(String(s.note));
      if (s.error) lines.push("error=" + s.error);
      return lines.join("\\n");
    }
    function loadSystemInfo() {
      var ctrl = new AbortController();
      var tid = setTimeout(function() { ctrl.abort(); }, 12000);
      fetch(apiUrl("/system"), { signal: ctrl.signal })
        .then(function(r) {
          clearTimeout(tid);
          if (!r.ok) {
            return r.text().then(function(t) {
              throw new Error("HTTP " + r.status + " " + (t || "").trim().slice(0, 160));
            });
          }
          return r.json();
        })
        .then(function(s) { machine.textContent = formatMachine(s); })
        .catch(function(e) {
          clearTimeout(tid);
          var msg = (e && e.name === "AbortError")
            ? "Request timed out (12s). Open this UI from the same host:port as the vanity server."
            : ((e && e.message) ? e.message : String(e));
          machine.textContent =
            "Could not load /system\\n" + msg +
            "\\n\\nGrind still works if POST /grind reaches this app. If this page is not served by the vanity app, set data-api-base on body to your API origin (e.g. https://yoursub.deno.dev) and set server env ACCESS_CONTROL_ALLOW_ORIGIN to this page origin.";
          try { line("system: " + msg); } catch (ignore) {}
        });
    }

    function now() { return new Date().toLocaleTimeString(); }
    function line(msg) { logs.textContent += "[" + now() + "] " + msg + "\\n"; logs.scrollTop = logs.scrollHeight; }
    function getNum(id) { return Number(q(id).value || 0); }
    function getStr(id) { return (q(id).value || "").trim(); }
    function fmtMis(first, last, pLen, sLen) {
      const cell = (i) => {
        if (i == null || i < 0) return "—";
        if (i < pLen) return "P" + i;
        return "S" + (i - pLen);
      };
      return cell(first) + "→" + cell(last);
    }
    function updateDiff() {
      const p = getStr("prefix").length;
      const s = getStr("suffix").length;
      const len = p + s;
      const keysPerSec = Math.max(1, getNum("estKps"));
      const tries = len === 0 ? 1 : Math.pow(58, len);
      const etaMin = tries / keysPerSec / 60;
      difficulty.textContent =
        "len=" + len + " | tries≈" + tries.toExponential(3) + " | ETA≈" + etaMin.toExponential(2) + " min @ " + keysPerSec + " keys/s (est)";
    }
    ["prefix","suffix","estKps"].forEach(function(id) { q(id).addEventListener("input", updateDiff); });
    updateDiff();

    loadSystemInfo();

    const es = new EventSource(apiUrl("/events"));
    es.onopen = function() { line("SSE connected."); };
    es.addEventListener("log", function(ev) {
      const d = JSON.parse(ev.data);
      const lvl = d.level ? "[" + d.level + "] " : "";
      line(lvl + (d.scope || "") + " " + (d.msg || "") + (d.data ? " " + JSON.stringify(d.data) : ""));
    });
    es.addEventListener("threshold", function(ev) {
      const d = JSON.parse(ev.data);
      line("threshold w" + d.workerId + " score=" + d.score + " addr=" + (d.address || "").slice(0, 12) + "…");
    });
    es.addEventListener("bin", function(ev) {
      const d = JSON.parse(ev.data);
      line("bin 70–80% w" + d.workerId + " score=" + d.score + " addr=" + (d.address || "").slice(0, 12) + "…");
    });
    es.addEventListener("progress", function(ev) {
      const d = JSON.parse(ev.data);
      latestAggKps = d.aggregateKps || latestAggKps;
      if (latestAggKps > 0) q("estKps").value = String(Math.round(latestAggKps));
      throughput.textContent =
        "workers=" + (d.effectiveWorkers ?? "?") +
        " | inst=" + (((d.aggregateKps||0)/1000).toFixed(2)) + "k kp/s" +
        " | checked=" + (d.totalChecked || 0);
      accuracy.textContent =
        "bestScore=" + (d.bestScorePercent ?? 0) + "% | bestAcc=" + (d.bestMatchedTargetChars ?? 0) + "/" + (d.bestTargetLen ?? 0) +
        " (" + (d.bestAccuracyPercent ?? 0) + "%) | mis=" + fmtMis(d.firstMismatchIndex, d.lastMismatchIndex, getStr("prefix").length, getStr("suffix").length) +
        " | runAvg=" + (d.runningAvgAccuracyPercent ?? 0) + "%\n" +
        "best pfx=" + (d.bestPrefixWindow || "—") + " | best sfx=" + (d.bestSuffixWindow || "—");
      updateDiff();
    });
    es.addEventListener("status", function(ev) {
      const d = JSON.parse(ev.data);
      line("status: " + JSON.stringify(d));
    });
    es.onerror = function() { line("stream reconnecting…"); };

    startBtn.onclick = async function() {
      startBtn.disabled = true;
      const body = {
        prefix: getStr("prefix"),
        suffix: getStr("suffix"),
        count: getNum("count"),
        threads: getNum("threads"),
        bunOversubscribe: getNum("bunOver"),
        threshold: getNum("threshold"),
        progressEvery: getNum("progressEvery"),
        uiRefreshMs: getNum("uiRefreshMs"),
        maxWorkers: getNum("maxWorkers"),
        caseSensitive: q("caseSensitive").checked,
        encrypt: q("encrypt").checked,
        decryptKey: ""
      };
      line("POST /grind " + JSON.stringify(body));
      try {
        const r = await fetch(apiUrl("/grind"), { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) });
        const j = await r.json();
        line("result status=" + r.status + " body=" + JSON.stringify(j));
      } catch (e) {
        line("request failed: " + e.message);
      } finally {
        startBtn.disabled = false;
      }
    };
  </script>
</body>
</html>`;
