import type { SessionPayload } from "../types";
import { signPayload, verifyPayload } from "./crypto";

export const SESSION_COOKIE = "metaoauth_session";
export const OAUTH_STATE_COOKIE = "metaoauth_oauth_state";
const MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14 days

function utf8ToBase64(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(buf);
}

export async function serializeSession(secret: string, data: SessionPayload): Promise<string> {
  const payload = utf8ToBase64(JSON.stringify(data));
  const sig = await signPayload(secret, payload);
  return `${payload}.${sig}`;
}

export async function parseSession(secret: string, cookieValue: string | undefined): Promise<SessionPayload | null> {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const ok = await verifyPayload(secret, payload, sig);
  if (!ok) return null;
  try {
    const json = base64ToUtf8(payload);
    const parsed = JSON.parse(json) as SessionPayload;
    if (parsed?.v !== 1 || !parsed.accessToken || !parsed.igUserId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) continue;
    const k = p.slice(0, eq);
    if (k === name) return decodeURIComponent(p.slice(eq + 1));
  }
  return undefined;
}

export function setSessionCookie(value: string, secure: boolean): string {
  const flags = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SEC}`,
    secure ? "Secure" : "",
  ].filter(Boolean);
  return flags.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const flags = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ].filter(Boolean);
  return flags.join("; ");
}

export function setOAuthStateCookie(state: string, secure: boolean): string {
  const flags = [
    `${OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=600`,
    secure ? "Secure" : "",
  ].filter(Boolean);
  return flags.join("; ");
}

export function clearOAuthStateCookie(secure: boolean): string {
  const flags = [
    `${OAUTH_STATE_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ].filter(Boolean);
  return flags.join("; ");
}
