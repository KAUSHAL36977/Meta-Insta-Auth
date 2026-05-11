export interface SessionPayload {
  v: 1;
  /** Long-lived user access token */
  accessToken: string;
  /** Instagram professional account id (IG User) */
  igUserId: string;
  igUsername: string;
  /** e.g. MEDIA_CREATOR or BUSINESS */
  accountType?: string;
  /** Page id linked to the IG account */
  pageId?: string;
  /** Page access token (some endpoints prefer this) */
  pageAccessToken?: string;
}

export interface Env {
  ASSETS: Fetcher;
  /** Optional KV for webhook last-event marker (recommended for production). */
  META_KV?: KVNamespace;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_REDIRECT_URI?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_GRAPH_API_VERSION?: string;
  SESSION_SECRET?: string;
  /** Optional override; default scopes in code */
  META_OAUTH_SCOPES?: string;
}

export interface NormalizedInsight {
  likes: number | null;
  comments: number | null;
  views: number | null;
  reach: number | null;
  saves: number | null;
  shares: number | null;
  totalInteractions: number | null;
  avgWatchTimeMs: number | null;
  totalWatchTimeMs: number | null;
}

export interface ReelPreview {
  id: string;
  permalink: string;
  caption: string | null;
  timestamp: string | null;
  mediaType: string | null;
  thumbnailUrl: string | null;
}
