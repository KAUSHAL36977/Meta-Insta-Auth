const encoder = new TextEncoder();

/** Verify X-Hub-Signature-256: sha256=<hex> */
export async function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): Promise<boolean> {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expectedHex = signatureHeader.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const actualHex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expectedHex.length !== actualHex.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedHex.length; i++) diff |= expectedHex.charCodeAt(i) ^ actualHex.charCodeAt(i);
  return diff === 0;
}
