// Stateless admin tokens (HMAC) — works across Deno Deploy isolates (no in-memory sessions).

function env(name: string): string | undefined {
  if (typeof (globalThis as any).Deno !== "undefined") {
    try { return (globalThis as any).Deno.env.get(name) ?? undefined; }
    catch { return undefined; }
  }
  if (typeof process !== "undefined") return (process as any).env?.[name];
  return undefined;
}

export function adminPasswordConfigured(): boolean {
  return Boolean((env("VANITY_ADMIN_PASSWORD") ?? "").length > 0);
}

export function verifyAdminPassword(password: string): boolean {
  const expected = env("VANITY_ADMIN_PASSWORD") ?? "";
  if (!expected) return false;
  return password === expected;
}

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function b64url(bytes: Uint8Array): string {
  let s = "";
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    s += abc[a >> 2] + abc[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? abc[((b & 15) << 2) | (c >> 6)] : "") +
      (i + 2 < bytes.length ? abc[c & 63] : "");
  }
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(s: string): Uint8Array | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

let hmacKey: CryptoKey | null = null;

async function getHmacKey(): Promise<CryptoKey | null> {
  const secret = env("VANITY_ADMIN_PASSWORD") ?? env("VANITY_ADMIN_TOKEN_SECRET") ?? "";
  if (!secret) return null;
  if (hmacKey) return hmacKey;
  const raw = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", raw);
  hmacKey = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return hmacKey;
}

export async function createAdminSession(): Promise<{ token: string; expiresAt: number } | null> {
  if (!adminPasswordConfigured()) return null;
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const payload = new TextEncoder().encode(String(expiresAt));
  const key = await getHmacKey();
  if (!key) return null;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
  const token = `v1.${expiresAt}.${b64url(sig)}`;
  return { token, expiresAt };
}

export async function verifyAdminToken(token: string | null): Promise<boolean> {
  if (!token || !adminPasswordConfigured()) return false;
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = parseInt(parts[1]!, 10);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const sigBytes = b64urlDecode(parts[2]!);
  if (!sigBytes) return false;
  const key = await getHmacKey();
  if (!key) return false;
  const payload = new TextEncoder().encode(String(exp));
  try {
    const sig = new Uint8Array(sigBytes);
    return await crypto.subtle.verify("HMAC", key, sig, payload);
  } catch {
    return false;
  }
}

export function extractAdminToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)vanity_admin=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

function extractTokenFromQuery(req: Request): string | null {
  try {
    const t = new URL(req.url).searchParams.get("token");
    return t && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

export async function isAdminRequest(req: Request): Promise<boolean> {
  const tok = extractAdminToken(req) ?? extractTokenFromQuery(req);
  return verifyAdminToken(tok);
}
