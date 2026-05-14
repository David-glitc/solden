// ── decrypt.ts ────────────────────────────────────────────────────────────────
// Standalone CLI to decrypt an encrypted private key produced by SOL VANITY.
//
// Usage:
//   node --experimental-strip-types src/decrypt.ts <cipherHex> <keyHex>
//   bun src/decrypt.ts <cipherHex> <keyHex>
//   deno run --allow-read src/decrypt.ts <cipherHex> <keyHex>

import { argv, exit } from "./runtime.ts";
import { decryptKey } from "./crypto.ts";

const [cipherHex, keyHex] = argv;

if (!cipherHex || !keyHex) {
  console.error("Usage: <runtime> src/decrypt.ts <cipherHex> <keyHex>");
  exit(1);
}

try {
  const secretKey = await decryptKey(cipherHex, keyHex);
  console.log("\n\x1b[32m✅ Decrypted private key (base58):\x1b[0m\n");
  console.log("  " + secretKey);
  console.log("\n\x1b[2mImport into Phantom / Solflare as a base58 secret key.\x1b[0m\n");
} catch {
  console.error("\x1b[31m❌ Wrong key or corrupted ciphertext\x1b[0m");
  exit(1);
}
