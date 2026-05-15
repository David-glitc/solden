// ── keygen.ts — pluggable Ed25519 batch backends (auto → sodium → noble → node → subtle)
import { createLogger } from "./log.ts";

const log = createLogger("keygen");

export type KeygenKind = "sodium" | "noble" | "node" | "subtle";
export type KeygenRequest = "auto" | KeygenKind;

export interface KeygenEngine {
  kind: KeygenKind;
  batchSize: number;
  /** Writes `batchSize` keys: pubs[i*32..], secrets[i*64..] (seed32 ‖ pub32). */
  fillBatch(pubs: Uint8Array, secrets: Uint8Array): void;
}

function parseRequest(raw: string | undefined): KeygenRequest {
  const v = (raw ?? "auto").trim().toLowerCase();
  if (v === "auto" || v === "sodium" || v === "noble" || v === "node" || v === "subtle") return v;
  return "auto";
}

async function trySodium(batchSize: number): Promise<KeygenEngine | null> {
  try {
    const sodium = await import("sodium-native");
    if (typeof sodium.crypto_sign_seed_keypair !== "function") return null;
    const pk = new Uint8Array(32);
    const sk = new Uint8Array(64);
    const seed = new Uint8Array(32);
    return {
      kind: "sodium",
      batchSize,
      fillBatch(pubs, secrets) {
        for (let i = 0; i < batchSize; i++) {
          sodium.randombytes_buf(seed);
          sodium.crypto_sign_seed_keypair(pk, sk, seed);
          const po = i * 32;
          const so = i * 64;
          pubs.set(pk, po);
          secrets.set(sk, so);
        }
      },
    };
  } catch {
    return null;
  }
}

async function configureNobleEd25519(ed: typeof import("@noble/ed25519")): Promise<void> {
  if (ed.etc.sha512Sync) return;
  const { sha512 } = await import("@noble/hashes/sha512.js");
  ed.etc.sha512Sync = (...msgs: Uint8Array[]) => sha512(ed.etc.concatBytes(...msgs));
}

async function tryNoble(batchSize: number): Promise<KeygenEngine | null> {
  try {
    const ed = await import("@noble/ed25519");
    await configureNobleEd25519(ed);
    const { randomBytes } = await import("@noble/hashes/utils.js");
    const seeds = new Uint8Array(batchSize * 32);
    return {
      kind: "noble",
      batchSize,
      fillBatch(pubs, secrets) {
        seeds.set(randomBytes(seeds.length));
        for (let i = 0; i < batchSize; i++) {
          const off = i * 32;
          const seed = seeds.subarray(off, off + 32);
          const pub = ed.getPublicKey(seed);
          const so = i * 64;
          secrets.set(seed, so);
          secrets.set(pub, so + 32);
          pubs.set(pub, off);
        }
      },
    };
  } catch {
    return null;
  }
}

async function tryNode(batchSize: number): Promise<KeygenEngine | null> {
  try {
    const nodeCrypto: {
      generateKeyPairSync: (type: string, opts: object) => { publicKey: Uint8Array; privateKey: Uint8Array };
    } = await import("node:crypto") as any;
    if (typeof nodeCrypto.generateKeyPairSync !== "function") return null;
    const opts = {
      publicKeyEncoding:  { type: "spki",  format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    } as const;
    const pk = new Uint8Array(32);
    const sk = new Uint8Array(64);
    return {
      kind: "node",
      batchSize,
      fillBatch(pubs, secrets) {
        for (let i = 0; i < batchSize; i++) {
          const { publicKey: pubDer, privateKey: privDer } = nodeCrypto.generateKeyPairSync("ed25519", opts);
          const po = pubDer.byteLength - 32;
          const so = privDer.byteLength - 32;
          pk.set(pubDer.subarray(po, po + 32));
          sk.set(privDer.subarray(so, so + 32));
          sk.set(pk, 32);
          const off = i * 32;
          const secOff = i * 64;
          pubs.set(pk, off);
          secrets.set(sk, secOff);
        }
      },
    };
  } catch {
    return null;
  }
}

function subtleEngine(batchSize: number): KeygenEngine {
  return {
    kind: "subtle",
    batchSize,
    fillBatch() {
      throw new Error("subtle backend is async-only; worker must not call fillBatch");
    },
  };
}

export async function createKeygenEngine(
  requested: string | undefined,
  batchSize: number,
): Promise<KeygenEngine> {
  const want = parseRequest(requested);
  const n = Math.max(8, Math.min(256, batchSize | 0) || 64);
  const order: KeygenKind[] = want === "auto"
    ? ["sodium", "node", "noble", "subtle"]
    : [want as KeygenKind];

  for (const kind of order) {
    if (kind === "sodium") {
      const e = await trySodium(n);
      if (e) {
        log.info("keygen_backend", { kind: e.kind, batchSize: n });
        return e;
      }
      if (want === "sodium") break;
    }
    if (kind === "node") {
      const e = await tryNode(n);
      if (e) {
        log.info("keygen_backend", { kind: e.kind, batchSize: n });
        return e;
      }
      if (want === "node") break;
    }
    if (kind === "noble") {
      const e = await tryNoble(n);
      if (e) {
        log.info("keygen_backend", { kind: e.kind, batchSize: n });
        return e;
      }
      if (want === "noble") break;
    }
    if (kind === "subtle") {
      log.info("keygen_backend", { kind: "subtle", batchSize: n });
      return subtleEngine(n);
    }
  }

  const fallback = await tryNode(n) ?? await tryNoble(n);
  if (fallback) {
    log.warn("keygen_fallback", { kind: fallback.kind, requested: want });
    return fallback;
  }
  log.warn("keygen_fallback", { kind: "subtle", requested: want });
  return subtleEngine(n);
}

/** One key via Web Crypto (Deno without node:crypto / noble). */
export async function subtlePair(): Promise<{ pub: Uint8Array; secret: Uint8Array }> {
  const kp = await globalThis.crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]) as CryptoKeyPair;
  const pubSpki = await globalThis.crypto.subtle.exportKey("spki", kp.publicKey);
  const privPkcs = await globalThis.crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const pub32 = new Uint8Array(pubSpki).slice(-32);
  const seed32 = new Uint8Array(privPkcs).slice(-32);
  const secret = new Uint8Array(64);
  secret.set(seed32);
  secret.set(pub32, 32);
  return { pub: pub32, secret };
}
