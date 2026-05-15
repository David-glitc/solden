// ── types.ts ──────────────────────────────────────────────────────────────────

export interface GrindOpts {
  prefix:        string;
  suffix:        string;
  count:         number;
  threads:       number;
  /** Multiplier applied to `threads` on runtimes that use it for effective worker count. */
  bunOversubscribe: number;
  progressEvery: number;    // Worker progress emission cadence (iterations)
  uiRefreshMs:   number;    // CLI redraw cadence (ms)
  maxWorkers:    number;   // Hard cap on effective parallel workers
  caseSensitive: boolean;
  threshold:     number;   // 0–100 – write partial matches ≥ this to file
  encrypt:       boolean;
  decryptKey:    string;   // passphrase or 64-char hex AES key; blank = auto
  /** Probe WebGPU when set (`--use-webgpu` / `VANITY_USE_WEBGPU`); Ed25519 grind remains CPU workers. */
  useWebgpu?:    boolean;
  /** Keygen backend: auto | sodium | noble | node | subtle (`VANITY_KEYGEN`). */
  keygen?:       string;
  /** Keys per worker batch before match loop (`VANITY_KEYGEN_BATCH`). */
  keygenBatch?:  number;
}

export interface GrindResult {
  address:    string;
  publicKey:  string;
  secretKey:  string;   // base58 or AES-GCM hex ciphertext when encrypted
  score:      number;
  foundAt:    number;
  encrypted:  boolean;
  decryptKey: string;   // AES key hex – returned in response, NEVER stored in DB
}

export interface WorkerInit {
  prefix:        string;
  suffix:        string;
  caseSensitive: boolean;
  threshold:     number;
  workerId:      number;
  progressEvery: number;
  keygen?:       string;
  keygenBatch?:  number;
}

export type WorkerMsg =
  | { type: "hit" | "threshold" | "bin"; workerId: number; address: string; publicKey: string; secretKey: string; score: number }
  | {
    type: "progress";
    workerId: number;
    rate: number;
    checked: number;
    /** Parent aggregate: sum of each worker’s cumulative `checked`. */
    totalChecked?: number;
    /** Parent aggregate: sum of per-worker instantaneous rates (keys/s). */
    aggregateKps?: number;
    reportingWorkers?: number;
    effectiveWorkers?: number;
    matchedPrefixChars?: number;
    matchedSuffixChars?: number;
    matchedTargetChars?: number;
    targetLen?: number;
    accuracyPercent?: number;
    bestScorePercent?: number;
    bestAccuracyPercent?: number;
    bestMatchedTargetChars?: number;
    bestTargetLen?: number;
    bestAddress?: string;
    bestPrefixWindow?: string;
    bestSuffixWindow?: string;
    firstMismatchIndex?: number;
    lastMismatchIndex?: number;
    prefixPatternLen?: number;
    suffixPatternLen?: number;
    keygenBackend?: string;
    runningAvgAccuracyPercent?: number;
    /** Wall-clock keys/s since this HTTP grind started (server). */
    avgKpsWall?: number;
    /** Seconds since grind start for this HTTP request (server). */
    wallElapsedSec?: number;
  }
  | { type: "error";             message: string };
