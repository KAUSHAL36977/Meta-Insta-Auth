import type { Env } from "../types";

export const LAB_KV_KEY = "lab:config";

/** Persisted lab setup (KV). Do not log. */
export interface LabConfigStored {
  metaAppId?: string;
  instagramAppId?: string;
  /** If set, used as META_APP_SECRET when metaAppSecret empty */
  instagramAppSecret?: string;
  metaAppSecret?: string;
  webhookVerifyToken?: string;
  /** No trailing slash */
  publicBaseUrl?: string;
}

export async function readLabConfigFromKv(env: Env): Promise<LabConfigStored | null> {
  if (!env.META_KV) return null;
  const raw = await env.META_KV.get(LAB_KV_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LabConfigStored;
  } catch {
    return null;
  }
}

export async function writeLabConfigToKv(env: Env, next: LabConfigStored): Promise<void> {
  if (!env.META_KV) throw new Error("META_KV binding required to save lab config on the server");
  await env.META_KV.put(LAB_KV_KEY, JSON.stringify(next));
}

/** Merge Worker bindings with optional KV lab overrides (OAuth, webhooks, Graph). */
export async function resolveEffectiveEnv(env: Env): Promise<Env> {
  const lab = await readLabConfigFromKv(env);
  if (!lab) return env;

  const baseUrl = lab.publicBaseUrl?.trim().replace(/\/+$/, "");
  const redirect =
    baseUrl && baseUrl.startsWith("http") ? `${baseUrl}/api/auth/meta/callback` : env.META_REDIRECT_URI;

  const appSecret =
    lab.metaAppSecret?.trim() ||
    lab.instagramAppSecret?.trim() ||
    env.META_APP_SECRET;

  return {
    ...env,
    META_APP_ID: lab.metaAppId?.trim() || env.META_APP_ID,
    META_APP_SECRET: appSecret,
    META_REDIRECT_URI: redirect?.trim() || env.META_REDIRECT_URI,
    META_WEBHOOK_VERIFY_TOKEN: lab.webhookVerifyToken?.trim() || env.META_WEBHOOK_VERIFY_TOKEN,
  };
}

/** Safe JSON for the Setup UI (no raw secrets). */
export async function labConfigForClient(env: Env, eff: Env): Promise<Record<string, unknown>> {
  const stored = await readLabConfigFromKv(env);
  return {
    metaAppId: eff.META_APP_ID || "",
    instagramAppId: (stored?.instagramAppId || "").trim(),
    webhookVerifyToken: eff.META_WEBHOOK_VERIFY_TOKEN || "",
    publicBaseUrl:
      (stored?.publicBaseUrl || "").trim().replace(/\/+$/, "") || derivePublicBaseFromRedirect(eff.META_REDIRECT_URI) || "",
    hasMetaAppSecret: Boolean(stored?.metaAppSecret?.trim() || eff.META_APP_SECRET?.trim()),
    hasInstagramAppSecret: Boolean(stored?.instagramAppSecret?.trim()),
    redirectUri: eff.META_REDIRECT_URI || "",
    graphVersion: env.META_GRAPH_API_VERSION || "v21.0",
    kvEnabled: Boolean(env.META_KV),
  };
}

function derivePublicBaseFromRedirect(redirect: string | undefined): string {
  if (!redirect?.trim()) return "";
  try {
    const u = new URL(redirect);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

export function mergeLabSave(existing: LabConfigStored | null, body: Record<string, unknown>): LabConfigStored {
  const cur = { ...(existing || {}) };
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  if (body.metaAppId !== undefined) cur.metaAppId = str(body.metaAppId).trim();
  if (body.instagramAppId !== undefined) cur.instagramAppId = str(body.instagramAppId).trim();

  const appSecretIn = str(body.metaAppSecret);
  if (appSecretIn.trim()) cur.metaAppSecret = appSecretIn.trim();

  const igSecretIn = str(body.instagramAppSecret);
  if (igSecretIn.trim()) cur.instagramAppSecret = igSecretIn.trim();

  if (body.webhookVerifyToken !== undefined) cur.webhookVerifyToken = str(body.webhookVerifyToken).trim();

  if (body.publicBaseUrl !== undefined) cur.publicBaseUrl = str(body.publicBaseUrl).trim().replace(/\/+$/, "");

  return cur;
}
