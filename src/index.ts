import type { Env } from "./types";
import {
  buildAuthorizeUrl,
  buildSessionFromUserToken,
  exchangeCodeForToken,
  exchangeLongLivedUserToken,
  extractInstagramShortcode,
  fetchMediaDetails,
  fetchMediaInsightsWithFallback,
  findMediaByShortcode,
  graphBase,
  normalizeInsights,
  toReelPreview,
} from "./lib/meta";
import { randomBytesHex } from "./lib/crypto";
import {
  clearOAuthStateCookie,
  clearSessionCookie,
  OAUTH_STATE_COOKIE,
  parseSession,
  readCookie,
  serializeSession,
  SESSION_COOKIE,
  setOAuthStateCookie,
  setSessionCookie,
} from "./lib/session";
import { verifyMetaWebhookSignature } from "./lib/webhook";
import {
  labConfigForClient,
  mergeLabSave,
  readLabConfigFromKv,
  resolveEffectiveEnv,
  writeLabConfigToKv,
} from "./lib/lab-config";

const WEBHOOK_KV_KEY = "webhook:last";

function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function json(data: unknown, init: ResponseInit & { headers?: HeadersInit } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function requireEnv(eff: Env): string | null {
  if (!eff.META_APP_ID?.trim()) return "META_APP_ID is not set (Worker env or Lab Setup + KV)";
  if (!eff.META_APP_SECRET?.trim()) return "META_APP_SECRET is not set (Worker secret or Lab Setup + KV)";
  if (!eff.META_REDIRECT_URI?.trim()) return "META_REDIRECT_URI is not set (set Public base URL in Lab Setup + KV, or META_REDIRECT_URI)";
  if (!eff.META_WEBHOOK_VERIFY_TOKEN?.trim()) return "META_WEBHOOK_VERIFY_TOKEN is not set";
  if (!eff.SESSION_SECRET?.trim() || eff.SESSION_SECRET.length < 16) return "SESSION_SECRET must be set (min 16 chars)";
  return null;
}

function sessionSecret(env: Env): string {
  const s = env.SESSION_SECRET?.trim();
  if (!s || s.length < 16) throw new Error("SESSION_SECRET invalid");
  return s;
}

async function readWebhookLast(env: Env): Promise<{ at: string; summary?: string } | null> {
  if (!env.META_KV) return null;
  const raw = await env.META_KV.get(WEBHOOK_KV_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { at: string; summary?: string };
  } catch {
    return null;
  }
}

async function writeWebhookLast(env: Env, summary: string): Promise<void> {
  if (!env.META_KV) return;
  const payload = JSON.stringify({ at: new Date().toISOString(), summary });
  await env.META_KV.put(WEBHOOK_KV_KEY, payload);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path.startsWith("/api/")) {
      return handleApi(request, env, path);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Missing ASSETS binding", { status: 500 });
  },
};

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  const secure = isSecure(request);
  const cookieHeader = request.headers.get("Cookie");
  const eff = await resolveEffectiveEnv(env);

  try {
    if ((path === "/api/auth/meta/start" || path === "/api/auth/meta/switch") && request.method === "GET") {
      const err = requireEnv(eff);
      if (err) return json({ error: err }, { status: 500 });
      const state = randomBytesHex(16);
      const location = buildAuthorizeUrl(eff, state);
      const headers = new Headers({ Location: location });
      headers.append("Set-Cookie", setOAuthStateCookie(state, secure));
      return new Response(null, { status: 302, headers });
    }

    if (path === "/api/auth/meta/callback" && request.method === "GET") {
      const err = requireEnv(eff);
      if (err) return json({ error: err }, { status: 500 });

      const params = new URL(request.url).searchParams;
      const code = params.get("code");
      const state = params.get("state");
      const oauthError = params.get("error");
      if (oauthError) {
        return Response.redirect(new URL(`/?error=${encodeURIComponent(oauthError)}`, request.url).toString(), 302);
      }
      if (!code || !state) {
        return Response.redirect(new URL("/?error=missing_code_or_state", request.url).toString(), 302);
      }
      const expected = readCookie(cookieHeader, OAUTH_STATE_COOKIE);
      if (!expected || expected !== state) {
        return Response.redirect(new URL("/?error=invalid_oauth_state", request.url).toString(), 302);
      }

      const short = await exchangeCodeForToken(eff, code);
      const longLived = await exchangeLongLivedUserToken(eff, short.access_token);
      const session = await buildSessionFromUserToken(eff, longLived);
      const sessionCookie = await serializeSession(sessionSecret(env), session);

      const headers = new Headers({
        Location: new URL("/", request.url).toString(),
      });
      headers.append("Set-Cookie", setSessionCookie(sessionCookie, secure));
      headers.append("Set-Cookie", clearOAuthStateCookie(secure));
      return new Response(null, { status: 302, headers });
    }

    if (path === "/api/auth/status" && request.method === "GET") {
      const sk = env.SESSION_SECRET?.trim();
      if (!sk || sk.length < 16) {
        const last = await readWebhookLast(env);
        return json({
          connected: false,
          lastWebhook: last,
          configError: "SESSION_SECRET must be set (min 16 chars)",
        });
      }
      const session = await parseSession(sk, readCookie(cookieHeader, SESSION_COOKIE));
      const last = await readWebhookLast(env);
      if (!session) {
        return json({
          connected: false,
          lastWebhook: last,
          setupComplete: requireEnv(eff) === null,
        });
      }
      return json({
        connected: true,
        igUsername: session.igUsername,
        igUserId: session.igUserId,
        accountType: session.accountType || "MEDIA_CREATOR",
        graphVersion: eff.META_GRAPH_API_VERSION,
        lastWebhook: last,
        setupComplete: requireEnv(eff) === null,
      });
    }

    if (path === "/api/auth/disconnect" && request.method === "POST") {
      const headers = new Headers({ "Content-Type": "application/json" });
      headers.append("Set-Cookie", clearSessionCookie(secure));
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    if (path === "/api/reels/insights" && request.method === "POST") {
      const err = requireEnv(eff);
      if (err) return json({ error: err }, { status: 500 });

      const session = await parseSession(sessionSecret(env), readCookie(cookieHeader, SESSION_COOKIE));
      if (!session) return json({ error: "Not connected" }, { status: 401 });

      let body: { url?: string };
      try {
        body = (await request.json()) as { url?: string };
      } catch {
        return json({ error: "Invalid JSON body" }, { status: 400 });
      }
      const reelUrl = body.url?.trim();
      if (!reelUrl) return json({ error: "Missing url" }, { status: 400 });

      const shortcode = extractInstagramShortcode(reelUrl);
      if (!shortcode) return json({ error: "Could not parse Instagram reel/post URL" }, { status: 400 });

      const media = await findMediaByShortcode(eff, session, shortcode);
      if (!media) {
        return json(
          { error: "Reel not found for this account (or not loaded in recent media pages). Try a reel owned by the connected IG account." },
          { status: 404 }
        );
      }

      const details = await fetchMediaDetails(eff, session, media.id);
      const insights = await fetchMediaInsightsWithFallback(eff, session, media.id);
      const metrics = normalizeInsights(insights, details);
      const preview = toReelPreview({ ...media, ...details });

      return json({ preview, metrics });
    }

    if (path === "/api/webhook/meta" && request.method === "GET") {
      const mode = new URL(request.url).searchParams.get("hub.mode");
      const token = new URL(request.url).searchParams.get("hub.verify_token");
      const challenge = new URL(request.url).searchParams.get("hub.challenge");
      const verify = eff.META_WEBHOOK_VERIFY_TOKEN?.trim();
      if (mode === "subscribe" && verify && token === verify && challenge) {
        return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
      return new Response("Forbidden", { status: 403 });
    }

    if (path === "/api/webhook/meta" && request.method === "POST") {
      const appSecret = eff.META_APP_SECRET?.trim();
      if (!appSecret) return new Response("META_APP_SECRET not configured", { status: 500 });
      const raw = await request.text();
      const sig = request.headers.get("X-Hub-Signature-256");
      const ok = await verifyMetaWebhookSignature(raw, sig, appSecret);
      if (!ok) return new Response("Invalid signature", { status: 401 });

      let summary = "event";
      try {
        const payload = JSON.parse(raw) as { object?: string; entry?: unknown[] };
        summary = `${payload.object || "unknown"} (${(payload.entry || []).length} entries)`;
      } catch {
        summary = "unparsed payload";
      }
      await writeWebhookLast(env, summary);

      return json({ ok: true });
    }

    if (path === "/api/webhook/last" && request.method === "GET") {
      const last = await readWebhookLast(env);
      return json({ lastWebhook: last });
    }

    if (path === "/api/lab/config" && request.method === "GET") {
      const data = await labConfigForClient(env, eff);
      return json(data);
    }

    if (path === "/api/lab/config" && request.method === "POST") {
      if (!env.META_KV) {
        return json(
          {
            ok: false,
            stored: "client",
            message:
              "META_KV is not bound. Save from the browser (localStorage) or set secrets in the Worker. For server-side Lab Setup, add a KV namespace and binding META_KV in wrangler.toml.",
          },
          { status: 200 }
        );
      }
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return json({ error: "Invalid JSON" }, { status: 400 });
      }
      const existing = await readLabConfigFromKv(env);
      const next = mergeLabSave(existing, body);
      await writeLabConfigToKv(env, next);
      const refreshed = await resolveEffectiveEnv(env);
      return json({ ok: true, stored: "kv", config: await labConfigForClient(env, refreshed) });
    }

    if (path === "/api/lab/status" && request.method === "GET") {
      const sk = env.SESSION_SECRET?.trim();
      let instagramConnected = false;
      if (sk && sk.length >= 16) {
        const session = await parseSession(sk, readCookie(cookieHeader, SESSION_COOKIE));
        instagramConnected = Boolean(session);
      }
      const setupComplete = requireEnv(eff) === null;
      return json({
        setupComplete,
        instagramConnected,
        kvEnabled: Boolean(env.META_KV),
      });
    }

    if (path === "/api/lab/graph" && request.method === "POST") {
      const err = requireEnv(eff);
      if (err) return json({ error: err }, { status: 500 });
      const session = await parseSession(sessionSecret(env), readCookie(cookieHeader, SESSION_COOKIE));
      if (!session) return json({ error: "Not connected" }, { status: 401 });

      let body: { path?: string };
      try {
        body = (await request.json()) as { path?: string };
      } catch {
        return json({ error: "Invalid JSON" }, { status: 400 });
      }
      let rel = (body.path || "").trim();
      if (!rel.startsWith("/")) rel = `/${rel}`;
      if (!/^\/[a-zA-Z0-9_/?.=&-]+$/.test(rel)) {
        return json({ error: "Path must look like /me/accounts or /1784.../media (letters, digits, /, ?, &, =, -, _ only)" }, { status: 400 });
      }

      const token = session.pageAccessToken || session.accessToken;
      const url = `${graphBase(eff)}${rel}${rel.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url, { method: "GET" });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
      return json({ status: res.status, body: parsed });
    }

    return json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, { status: 500 });
  }
}
