# Meta-Insta-Auth

Meta OAuth + Reel insights (Cloudflare Worker)

Minimal test app: **Facebook Login OAuth** → Instagram professional account → paste **Reel URL** → **Graph API insights**; plus **Meta webhooks** (verify + receive) so you can wire real-time signals and re-fetch metrics after activity.

The browser UI is **Meta OAuth Lab**: a dark sidebar app with **Dashboard**, **Setup** (Meta app ID, optional Instagram IDs/secrets, webhook verify token, public base URL), **Instagram login**, **Webhooks** (callback URL + copy), **Reel insights**, and **Graph playground** (server-proxied GET to Graph with your session token).

### Lab config storage

- **With `META_KV`:** **Setup → Save** writes to KV (`lab:config`) and the Worker merges those values into OAuth, redirect URI (`{publicBaseUrl}/api/auth/meta/callback`), webhook verify token, and app secret (Meta or Instagram secret field).
- **Without KV:** Save stores values in **localStorage** in the browser only (fine for quick local tries). Worker secrets from Wrangler still apply unless you add KV and save overrides.

### Tunnel + `config.json` (local public URL)

1. Terminal A: `npm run dev`
2. Terminal B: `npm run tunnel` (requires [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/) on your PATH)

The tunnel script watches quick-tunnel output and writes **`public/data/config.json`** and **`data/config.json`** with `publicBaseUrl` (both paths are gitignored once created). Open **Setup** and click **Reload from /data/config.json** to pull that URL into the form, then paste the same base URL into the Meta dashboard.

## Prerequisites

- Meta app at [developers.facebook.com](https://developers.facebook.com/) with **Facebook Login** and **Instagram** / Page linkage as required by [Instagram Graph API](https://developers.facebook.com/docs/instagram-api).
- Instagram account type: **Business** or **Creator**, linked to a **Facebook Page** you manage.
- Redirect URI and webhook URL must match your deployed (or local) Worker URL exactly.

## Local development

1. Copy [`.dev.vars.example`](.dev.vars.example) to `.dev.vars` and fill values.

2. In the Meta app, add **Valid OAuth Redirect URIs**, for example:

   `http://127.0.0.1:8787/api/auth/meta/callback`

   Set `META_REDIRECT_URI` to the same string.

3. Install and run:

   ```bash
   npm install
   npm run dev
   ```

4. Open the URL Wrangler prints (often `http://127.0.0.1:8787`). Use **Connect Instagram**, then paste a reel URL owned by the connected account.

## Cloudflare deploy

1. Create KV (recommended for webhooks **and** server-side Lab Setup):

   ```bash
   wrangler kv namespace create META_KV
   ```

   Put the namespace `id` in `wrangler.toml` under `[[kv_namespaces]]` with `binding = "META_KV"`.

2. Set secrets (do not commit these):

   ```bash
   wrangler secret put META_APP_ID
   wrangler secret put META_APP_SECRET
   wrangler secret put META_REDIRECT_URI
   wrangler secret put META_WEBHOOK_VERIFY_TOKEN
   wrangler secret put SESSION_SECRET
   ```

   `META_REDIRECT_URI` must be your **production** callback, e.g.  
   `https://<your-worker-host>/api/auth/meta/callback`

3. Deploy:

   ```bash
   npm run deploy
   ```

4. In Meta app settings, set **Valid OAuth Redirect URIs** and **Site URL** (if required) to your Worker origin.

## Webhooks

- **Callback URL:** `https://<your-worker-host>/api/webhook/meta`
- **Verify token:** same value as `META_WEBHOOK_VERIFY_TOKEN`
- Subscribe to the **object** and **fields** your product needs (e.g. comments, messaging). This repo only **verifies** the subscription and **stores a short last-event summary** when KV is configured; it does not replace App Review or field-specific processing.

Webhook **POST** requests are validated with `X-Hub-Signature-256` using `META_APP_SECRET`.

**Note:** Webhooks notify you of **events**; reel **metric numbers** still come from the **Insights** API when the user clicks **Fetch metrics** (or you add your own scheduler). The UI polls `/api/auth/status` and shows the last webhook time when KV is enabled.

## API routes

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/auth/meta/start` | Start OAuth |
| GET | `/api/auth/meta/switch` | Re-run OAuth (switch account) |
| GET | `/api/auth/meta/callback` | OAuth redirect handler |
| GET | `/api/auth/status` | Connection + optional last webhook info |
| POST | `/api/auth/disconnect` | Clear session |
| POST | `/api/reels/insights` | Body `{ "url": "<instagram reel url>" }` |
| GET | `/api/webhook/meta` | Meta verification (`hub.*` query params) |
| POST | `/api/webhook/meta` | Webhook events |
| GET | `/api/webhook/last` | JSON last webhook marker (KV) |
| GET | `/api/lab/config` | Non-secret lab + effective Meta fields for the Setup form |
| POST | `/api/lab/config` | Merge-save lab fields to KV when `META_KV` is bound (otherwise client-only) |
| GET | `/api/lab/status` | `{ setupComplete, instagramConnected, kvEnabled }` for nav status dots |
| POST | `/api/lab/graph` | Body `{ "path": "/me/accounts" }` — GET proxy to Graph (requires login) |

## Session storage

The signed **httpOnly** cookie `metaoauth_session` holds the long-lived user token and linked IG user id. For production hardening, consider moving tokens to **KV** or another server-side store and keeping only a session id in the cookie.

## Scopes

Default OAuth scopes are defined in [`src/lib/meta.ts`](src/lib/meta.ts). Override with env var `META_OAUTH_SCOPES` (comma-separated) if your app requires different permissions.

## Graph API version

Default `v21.0` is set in `wrangler.toml` as `META_GRAPH_API_VERSION`. Align with the version your Meta app uses.

## Verification checklist (local / CI)

1. `npm run typecheck` — TypeScript passes.
2. `npx wrangler deploy --dry-run` — Worker + assets bundle successfully.
3. With `.dev.vars` filled, `npm run dev` — open `/`, confirm static UI loads.
4. Webhook verification (replace `TOKEN` with your `META_WEBHOOK_VERIFY_TOKEN`):

   `GET /api/webhook/meta?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=pong`  
   Response body should be exactly `pong`.

5. OAuth — click **Connect Instagram**, complete login, land on `/` with **Instagram connected** (requires valid Meta app + redirect URI).
6. Reel insights — paste a reel URL from the connected account; **Fetch metrics** should return the metric grid (requires correct scopes + IG professional account).
7. Webhook POST — after configuring Meta to send events to `/api/webhook/meta`, confirm `GET /api/auth/status` shows `lastWebhook` when KV binding `META_KV` is enabled.
