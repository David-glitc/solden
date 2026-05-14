// Deno bench: Ed25519 keygen + pubkey base58 — same hot path as vanity grind for prefix "meth".
const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58(buf: Uint8Array): string {
  const d: number[] = [0];
  for (let i = 0; i < buf.length; i++) {
    let c = buf[i]!;
    for (let j = 0; j < d.length; j++) {
      c += d[j]! << 8;
      d[j] = c % 58;
      c = (c / 58) | 0;
    }
    while (c) {
      d.push(c % 58);
      c = (c / 58) | 0;
    }
  }
  let s = "";
  for (let i = d.length - 1; i >= 0; i--) s += ALPHA[d[i]!];
  return s;
}

Deno.bench({
  name: "meth vanity path: generateKey + export + b58(pub)",
  group: "meth-prefix keygen",
  baseline: true,
  async fn() {
    const kp = await globalThis.crypto.subtle.generateKey(
      { name: "Ed25519" } as AlgorithmIdentifier,
      true,
      ["sign", "verify"],
    ) as CryptoKeyPair;
    const pubSpki = await globalThis.crypto.subtle.exportKey("spki", kp.publicKey);
    const pub32 = new Uint8Array(pubSpki).slice(-32);
    b58(pub32);
  },
});
