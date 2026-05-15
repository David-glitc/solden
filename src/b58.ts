// ── b58.ts — Solana base58 (hot path for 32-byte pubkeys) ─────────────────────
export const B58_ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ACC = new Int32Array(48);

/** Encode 32 bytes at `buf[offset..offset+32)` without allocating a subarray. */
export function b58Pub32(buf: Uint8Array, offset = 0): string {
  let n = 1;
  ACC[0] = 0;
  const end = offset + 32;
  for (let i = offset; i < end; i++) {
    let c = buf[i]!;
    for (let j = 0; j < n; j++) {
      c += ACC[j]! << 8;
      ACC[j] = c % 58;
      c = (c / 58) | 0;
    }
    while (c) {
      ACC[n++] = c % 58;
      c = (c / 58) | 0;
    }
  }
  let s = "";
  for (let i = n - 1; i >= 0; i--) s += B58_ALPHA[ACC[i]!];
  return s;
}

export function b58Encode(buf: Uint8Array): string {
  if (buf.length === 32) return b58Pub32(buf, 0);
  let n = 1;
  ACC[0] = 0;
  for (let i = 0; i < buf.length; i++) {
    let c = buf[i]!;
    for (let j = 0; j < n; j++) {
      c += ACC[j]! << 8;
      ACC[j] = c % 58;
      c = (c / 58) | 0;
    }
    while (c) {
      ACC[n++] = c % 58;
      c = (c / 58) | 0;
    }
  }
  let s = "";
  for (let i = n - 1; i >= 0; i--) s += B58_ALPHA[ACC[i]!];
  return s;
}
