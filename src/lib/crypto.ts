const encoder = new TextEncoder();

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const keyData = encoder.encode(secret);
  return crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "====".slice(s.length % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64Url(sig);
}

export async function verifyPayload(secret: string, payload: string, sigB64Url: string): Promise<boolean> {
  const key = await importHmacKey(secret);
  const expected = fromBase64Url(sigB64Url);
  const actual = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
  return diff === 0;
}

export function randomBytesHex(len: number): string {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}
