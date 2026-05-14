// ── crypto.ts ─────────────────────────────────────────────────────────────────
// AES-256-GCM via Web Crypto — works on Deno · Bun · Node ≥ 18. Zero deps.
// Wire format: hex( iv[12] | authTag[16] | ciphertext )

// Node: must use globalThis.crypto (not destructured) to preserve `this` binding
const enc = new TextEncoder();
const dec = new TextDecoder();

function toHex(b: Uint8Array): string {
  return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}
function fromHex(h: string): Uint8Array {
  return Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
}

async function importRaw(bytes: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  const material = new Uint8Array(bytes.byteLength);
  material.set(bytes);
  return globalThis.crypto.subtle.importKey("raw", material, "AES-GCM", true, usage);
}

export interface EncryptResult { cipher: string; key: string; }

export async function encryptKey(secretKeyB58: string, passphrase = ""): Promise<EncryptResult> {
  let keyBytes: Uint8Array;
  let cryptoKey: CryptoKey;

  if (!passphrase) {
    keyBytes  = globalThis.crypto.getRandomValues(new Uint8Array(32));
    cryptoKey = await importRaw(keyBytes, ["encrypt"]);
  } else if (/^[0-9a-f]{64}$/i.test(passphrase)) {
    keyBytes  = fromHex(passphrase);
    cryptoKey = await importRaw(keyBytes, ["encrypt"]);
  } else {
    const salt    = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const baseKey = await globalThis.crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    cryptoKey     = await globalThis.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 200_000, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt"],
    );
    keyBytes = new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", cryptoKey));
  }

  const iv        = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, cryptoKey, enc.encode(secretKeyB58));

  const packed = new Uint8Array(12 + encrypted.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(encrypted), 12);

  return { cipher: toHex(packed), key: toHex(keyBytes) };
}

export async function decryptKey(cipherHex: string, keyHex: string): Promise<string> {
  const packed    = fromHex(cipherHex);
  const iv        = packed.slice(0, 12);
  const data      = packed.slice(12);
  const cryptoKey = await importRaw(fromHex(keyHex), ["decrypt"]);
  const plain     = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, cryptoKey, data);
  return dec.decode(plain);
}
