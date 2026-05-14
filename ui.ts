import { LOGO_SVG } from "./brand.ts";

export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0a0a0a" />
  <meta name="color-scheme" content="light" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any" />
  <link rel="apple-touch-icon" href="/favicon.svg" />
  <title>Solden · Sol vanity control panel</title>
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
      background: linear-gradient(155deg, #121212 0%, #0a0a0a 55%, #101010 100%);
      color: var(--paper);
      border-radius: var(--radius-lg);
      padding: 22px 26px;
      margin-bottom: 22px;
      box-shadow: var(--shadow);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .brand-lockup {
      display: flex;
      gap: 18px;
      align-items: flex-start;
      width: 100%;
    }
    .brand-mark { flex: 0 0 auto; line-height: 0; }
    .brand-mark svg { width: clamp(48px, 14vw, 72px); height: auto; display: block; }
    header .solden-logo, header .solden-logo * { fill: #f4f4f4 !important; }
    .brand-copy { min-width: 0; flex: 1; }
    .brand-kicker {
      margin: 0 0 6px;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      opacity: 0.72;
    }
    header h1 { margin: 0; font-size: 1.42rem; font-weight: 650; letter-spacing: -0.02em; line-height: 1.2; }
    .brand-desc { margin: 10px 0 0; font-size: 0.92rem; opacity: 0.88; max-width: 62ch; line-height: 1.5; }
    .header-pill {
      margin-left: auto;
      flex-shrink: 0;
      font-size: 0.68rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 6px 12px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #f0f0f0;
    }
    .grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    @media (max-width: 900px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
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
    #throughput, #difficulty, #accuracy {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
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
      .brand-lockup { flex-wrap: wrap; gap: 14px; align-items: flex-start; }
      .header-pill { margin-left: 0; }
      header h1 { font-size: 1.2rem; line-height: 1.25; }
      .brand-desc { font-size: 0.9rem; }
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
      <div class="brand-lockup">
        <div class="brand-mark">${LOGO_SVG}</div>
        <div class="brand-copy">
          <p class="brand-kicker">Solden</p>
          <h1>Sol vanity control panel</h1>
          <p class="brand-desc">The fastest Solana vanity address grinder that doesn't need $1000+ to run</p>
        </div>
        <span class="header-pill" title="Served by this app">Live</span>
      </div>
    </header>

    <div class="grid">
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
      <p class="hint"><strong>Required:</strong> at least a prefix <em>or</em> a suffix. Other fields use safe defaults if left blank or invalid. Difficulty ≈ 58^(prefixLen+suffixLen); ETA ≈ tries / (keys/s) / 60.</p>
      <div class="legend"><strong>Mismatch legend:</strong> <span class="mono">P0→P3</span> means first/last wrong index in the combined pattern; <strong>P</strong> = prefix index, <strong>S</strong> = suffix index (0-based).</div>
    </div>

    <div class="card" style="margin-top:18px; min-width:0">
      <h3>Live stream</h3>
      <pre id="logs" class="mono" aria-live="polite"></pre>
    </div>

    <footer class="site-footer">
      <span>David Pere</span>
      <a href="https://davidpere.vercel.app" target="_blank" rel="noopener noreferrer">davidpere</a>
      <a href="https://x.com/davidpereishim" target="_blank" rel="noopener noreferrer">X · @davidpereishim</a>
      <a href="https://github.com/David-glitc/solden" target="_blank" rel="noopener noreferrer">Source · solden</a>
    </footer>
  </div>
  <script>
    const q = (id) => document.getElementById(id);
    const logs = q("logs");
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

    function now() { return new Date().toLocaleTimeString(); }
    function line(msg) {
      if (!logs) return;
      logs.textContent += "[" + now() + "] " + msg + "\\n";
      logs.scrollTop = logs.scrollHeight;
    }
    function getStr(id) {
      var el = q(id);
      return el && el.value != null ? String(el.value).trim() : "";
    }
    function pickInt(id, min, max, fallback) {
      var el = q(id);
      var raw = el && el.value != null && el.value !== "" ? String(el.value).trim() : "";
      var n = parseInt(raw, 10);
      if (Number.isNaN(n)) n = fallback;
      if (n < min) n = min;
      if (typeof max === "number" && n > max) n = max;
      return n;
    }
    function pickFloat(id, min, fallback) {
      var el = q(id);
      var raw = el && el.value != null && el.value !== "" ? String(el.value).trim() : "";
      var n = parseFloat(raw);
      if (Number.isNaN(n)) n = fallback;
      if (n < min) n = min;
      return n;
    }
    function estKpsVal() {
      var n = parseFloat(getStr("estKps"));
      if (Number.isNaN(n) || n < 1) n = 50000;
      return n;
    }
    function fmtMis(first, last, pLen, sLen) {
      const cell = (i) => {
        if (i == null || i < 0) return "—";
        if (i < pLen) return "P" + i;
        return "S" + (i - pLen);
      };
      return cell(first) + "→" + cell(last);
    }
    function updateDiff() {
      if (!difficulty) return;
      const p = getStr("prefix").length;
      const s = getStr("suffix").length;
      const len = p + s;
      const keysPerSec = estKpsVal();
      const tries = len === 0 ? 1 : Math.pow(58, len);
      const etaMin = tries / keysPerSec / 60;
      difficulty.textContent =
        "len=" + len + " | tries≈" + tries.toExponential(3) + " | ETA≈" + etaMin.toExponential(2) + " min @ " + keysPerSec + " keys/s (est)";
    }
    ["prefix","suffix","estKps"].forEach(function(id) {
      var el = q(id);
      if (el) el.addEventListener("input", updateDiff);
    });
    updateDiff();

    function safeJsonParse(s) {
      try { return JSON.parse(s); } catch (e) { return null; }
    }

    const es = new EventSource(apiUrl("/events"));
    es.onopen = function() { line("SSE connected."); };
    es.addEventListener("log", function(ev) {
      var d = safeJsonParse(ev.data);
      if (!d) return;
      var lvl = d.level ? "[" + d.level + "] " : "";
      line(lvl + (d.scope || "") + " " + (d.msg || "") + (d.data ? " " + JSON.stringify(d.data) : ""));
    });
    es.addEventListener("threshold", function(ev) {
      var d = safeJsonParse(ev.data);
      if (!d) return;
      line("threshold w" + d.workerId + " score=" + d.score + " addr=" + (d.address || "").slice(0, 12) + "…");
    });
    es.addEventListener("bin", function(ev) {
      var d = safeJsonParse(ev.data);
      if (!d) return;
      line("bin 70–80% w" + d.workerId + " score=" + d.score + " addr=" + (d.address || "").slice(0, 12) + "…");
    });
    es.addEventListener("progress", function(ev) {
      var d = safeJsonParse(ev.data);
      if (!d) return;
      latestAggKps = d.aggregateKps || latestAggKps;
      var ek = q("estKps");
      if (latestAggKps > 0 && ek) ek.value = String(Math.round(latestAggKps));
      if (throughput) {
        throughput.textContent =
          "workers=" + (d.effectiveWorkers ?? "?") +
          " | inst=" + (((d.aggregateKps||0)/1000).toFixed(2)) + "k kp/s" +
          " | checked=" + (d.totalChecked || 0);
      }
      if (accuracy) {
        accuracy.textContent =
          "bestScore=" + (d.bestScorePercent ?? 0) + "% | bestAcc=" + (d.bestMatchedTargetChars ?? 0) + "/" + (d.bestTargetLen ?? 0) +
          " (" + (d.bestAccuracyPercent ?? 0) + "%) | mis=" + fmtMis(d.firstMismatchIndex, d.lastMismatchIndex, getStr("prefix").length, getStr("suffix").length) +
          " | runAvg=" + (d.runningAvgAccuracyPercent ?? 0) + "%\n" +
          "best pfx=" + (d.bestPrefixWindow || "—") + " | best sfx=" + (d.bestSuffixWindow || "—");
      }
      updateDiff();
    });
    es.addEventListener("status", function(ev) {
      var d = safeJsonParse(ev.data);
      if (!d) return;
      line("status: " + JSON.stringify(d));
    });
    es.onerror = function() { line("stream reconnecting…"); };

    if (startBtn) startBtn.onclick = async function() {
      startBtn.disabled = true;
      try {
        var prefix = getStr("prefix");
        var suffix = getStr("suffix");
        if (!prefix && !suffix) {
          line("Add a prefix and/or suffix, then press Start grind again.");
          return;
        }
        var body = {
          prefix: prefix,
          suffix: suffix,
          count: pickInt("count", 1, 1000000, 1),
          threads: pickInt("threads", 1, 512, 16),
          bunOversubscribe: pickFloat("bunOver", 0.1, 1.5),
          threshold: pickInt("threshold", 0, 100, 90),
          progressEvery: pickInt("progressEvery", 64, 10000000, 1024),
          uiRefreshMs: pickInt("uiRefreshMs", 25, 60000, 500),
          maxWorkers: pickInt("maxWorkers", 1, 1024, 256),
          caseSensitive: !!(q("caseSensitive") && q("caseSensitive").checked),
          encrypt: !!(q("encrypt") && q("encrypt").checked),
          decryptKey: ""
        };
        line("POST /grind " + JSON.stringify(body));
        var r = await fetch(apiUrl("/grind"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          credentials: "same-origin"
        });
        var text = await r.text();
        var j = safeJsonParse(text);
        if (j === null) line("result status=" + r.status + " (non-JSON) " + text.slice(0, 240));
        else line("result status=" + r.status + " body=" + JSON.stringify(j));
      } catch (e) {
        line("request failed: " + (e && e.message ? e.message : String(e)));
      } finally {
        startBtn.disabled = false;
      }
    };
  </script>
</body>
</html>`;
