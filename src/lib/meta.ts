import type { Env, NormalizedInsight, ReelPreview, SessionPayload } from "../types";

export const encoder = new TextEncoder();

const DEFAULT_SCOPES =
  "pages_show_list,pages_read_engagement,instagram_basic,instagram_manage_insights";

export function graphBase(env: Env): string {
  const v = env.META_GRAPH_API_VERSION || "v21.0";
  return `https://graph.facebook.com/${v}`;
}

export function oauthScopes(env: Env): string {
  return (env.META_OAUTH_SCOPES || DEFAULT_SCOPES).trim();
}

export function buildAuthorizeUrl(env: Env, state: string): string {
  const clientId = env.META_APP_ID?.trim();
  const redirect = env.META_REDIRECT_URI?.trim();
  if (!clientId || !redirect) throw new Error("META_APP_ID and META_REDIRECT_URI are required");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    state,
    response_type: "code",
    scope: oauthScopes(env),
  });
  const v = env.META_GRAPH_API_VERSION || "v21.0";
  return `https://www.facebook.com/${v}/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForToken(
  env: Env,
  code: string
): Promise<{ access_token: string; token_type?: string; expires_in?: number }> {
  const appId = env.META_APP_ID?.trim();
  const secret = env.META_APP_SECRET?.trim();
  const redirect = env.META_REDIRECT_URI?.trim();
  if (!appId || !secret || !redirect) throw new Error("META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI are required");
  const url = new URL(`${graphBase(env)}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", secret);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("code", code);
  const res = await fetch(url.toString());
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof json.error === "object" ? JSON.stringify(json.error) : String(json.error_message || json.error || res.statusText));
  }
  const token = json.access_token as string | undefined;
  if (!token) throw new Error("No access_token in token response");
  return json as { access_token: string; token_type?: string; expires_in?: number };
}

export async function exchangeLongLivedUserToken(env: Env, shortLivedUserToken: string): Promise<string> {
  const appId = env.META_APP_ID?.trim();
  const secret = env.META_APP_SECRET?.trim();
  if (!appId || !secret) throw new Error("META_APP_ID and META_APP_SECRET are required");
  const url = new URL(`${graphBase(env)}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", secret);
  url.searchParams.set("fb_exchange_token", shortLivedUserToken);
  const res = await fetch(url.toString());
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(json.error_message || json.error || res.statusText));
  }
  const token = json.access_token as string | undefined;
  if (!token) throw new Error("No access_token in long-lived response");
  return token;
}

async function graphGet<T>(url: string, accessToken: string): Promise<T> {
  const u = new URL(url);
  if (!u.searchParams.has("access_token")) u.searchParams.set("access_token", accessToken);
  const res = await fetch(u.toString());
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as { message?: string } | undefined;
    throw new Error(err?.message || String(json.error_message || res.statusText));
  }
  return json as T;
}

export interface IgLinkedPage {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: {
    id: string;
    username?: string;
    profile_picture_url?: string;
  };
}

export async function fetchLinkedInstagramAccounts(
  env: Env,
  userAccessToken: string
): Promise<IgLinkedPage[]> {
  const fields = "name,access_token,instagram_business_account{id,username,profile_picture_url}";
  const data = await graphGet<{ data?: IgLinkedPage[] }>(
    `${graphBase(env)}/me/accounts?fields=${encodeURIComponent(fields)}`,
    userAccessToken
  );
  return (data.data || []).filter((p) => p.instagram_business_account?.id);
}

/** Pick first linked IG account (test app); production may let user choose */
export async function buildSessionFromUserToken(
  env: Env,
  userAccessToken: string
): Promise<SessionPayload> {
  const pages = await fetchLinkedInstagramAccounts(env, userAccessToken);
  if (!pages.length) {
    throw new Error(
      "No Instagram Business/Creator account linked to a Facebook Page for this user. Link IG to a Page in Meta Business settings."
    );
  }
  const page = pages[0];
  const ig = page.instagram_business_account!;
  return {
    v: 1,
    accessToken: userAccessToken,
    igUserId: ig.id,
    igUsername: ig.username || "",
    accountType: "MEDIA_CREATOR",
    pageId: page.id,
    pageAccessToken: page.access_token,
  };
}

export function extractInstagramShortcode(input: string): string | null {
  const trimmed = input.trim();
  const m = trimmed.match(/instagram\.com\/(?:reel|p|tv)\/([^/?#]+)/i);
  return m?.[1] || null;
}

export interface IgMediaItem {
  id: string;
  media_type?: string;
  permalink?: string;
  caption?: string;
  timestamp?: string;
  thumbnail_url?: string;
}

export async function findMediaByShortcode(
  env: Env,
  session: SessionPayload,
  shortcode: string
): Promise<IgMediaItem | null> {
  const token = session.pageAccessToken || session.accessToken;
  let url: string | null = `${graphBase(env)}/${session.igUserId}/media?fields=id,media_type,permalink,caption,timestamp,thumbnail_url&limit=50`;

  while (url) {
    const page: { data: IgMediaItem[]; paging?: { next?: string } } = await graphGet(url, token);
    for (const item of page.data || []) {
      if (item.permalink?.includes(`/${shortcode}`)) return item;
    }
    url = page.paging?.next ?? null;
  }
  return null;
}

export async function fetchMediaDetails(
  env: Env,
  session: SessionPayload,
  mediaId: string
): Promise<IgMediaItem & { like_count?: number; comments_count?: number }> {
  const token = session.pageAccessToken || session.accessToken;
  const fields = "id,media_type,permalink,caption,timestamp,thumbnail_url,like_count,comments_count";
  return graphGet(`${graphBase(env)}/${mediaId}?fields=${encodeURIComponent(fields)}`, token);
}

type InsightMetricValue = { name: string; values?: { value?: number }[]; value?: number };

export async function fetchMediaInsights(env: Env, session: SessionPayload, mediaId: string, metricsCsv: string): Promise<InsightMetricValue[]> {
  const token = session.pageAccessToken || session.accessToken;
  const data = await graphGet<{ data?: InsightMetricValue[] }>(
    `${graphBase(env)}/${mediaId}/insights?metric=${encodeURIComponent(metricsCsv)}`,
    token
  );
  return data.data || [];
}

const METRICS_FULL = [
  "engagement",
  "impressions",
  "reach",
  "saved",
  "shares",
  "total_interactions",
  "video_views",
  "plays",
  "ig_reels_avg_watch_time",
  "ig_reels_video_view_total_time",
].join(",");

const METRICS_MINIMAL = ["impressions", "reach", "saved", "engagement", "video_views"].join(",");

/** Try full reel metric set; fall back if Graph rejects some metrics for this media type. */
export async function fetchMediaInsightsWithFallback(env: Env, session: SessionPayload, mediaId: string): Promise<InsightMetricValue[]> {
  try {
    return await fetchMediaInsights(env, session, mediaId, METRICS_FULL);
  } catch {
    return fetchMediaInsights(env, session, mediaId, METRICS_MINIMAL);
  }
}

function firstValue(m: InsightMetricValue): number | null {
  const v = m.values?.[0]?.value ?? m.value;
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  return null;
}

export function normalizeInsights(
  insightRows: InsightMetricValue[],
  details: { like_count?: number; comments_count?: number }
): NormalizedInsight {
  const byName = Object.fromEntries(insightRows.map((r) => [r.name, r]));
  const views =
    firstValue(byName["plays"]) ??
    firstValue(byName["video_views"]) ??
    firstValue(byName["impressions"]);
  return {
    likes: typeof details.like_count === "number" ? details.like_count : null,
    comments: typeof details.comments_count === "number" ? details.comments_count : null,
    views,
    reach: firstValue(byName["reach"]),
    saves: firstValue(byName["saved"]),
    shares: firstValue(byName["shares"]),
    totalInteractions: firstValue(byName["total_interactions"]) ?? firstValue(byName["engagement"]),
    avgWatchTimeMs: firstValue(byName["ig_reels_avg_watch_time"]),
    totalWatchTimeMs: firstValue(byName["ig_reels_video_view_total_time"]),
  };
}

export function toReelPreview(media: IgMediaItem): ReelPreview {
  return {
    id: media.id,
    permalink: media.permalink || "",
    caption: media.caption ?? null,
    timestamp: media.timestamp ?? null,
    mediaType: media.media_type ?? null,
    thumbnailUrl: media.thumbnail_url ?? null,
  };
}
