# MCP gateway on Cloudflare

The shared policy is [gateway-core.mjs](../worker/gateway-core.mjs). The
[Node adapter](../worker/cloud-gateway.mjs) keeps the existing Render service
available. The [Worker entry point](../cloudflare/mcp-gateway/index.mjs) sends
unrecognized paths to the DNS origin with `fetch(request)`. Addresses remain owned
by [resources.mjs](../mcp/cloud/resources.mjs).

## Deployment state

Adding these files does not change DNS or deploy either service. Verify the live
state before resuming: `npm run gateway:smoke -- https://mcp.oddbout.com --worker`.
`server: cloudflare` and `cf-ray` alone do not prove Worker execution; proxied
Render responses also have them. Handled responses carry
`x-oddbout-gateway: cloudflare`; origin passthrough responses do not.

## Local checks

```sh
node --test test/cloud-gateway.test.mjs test/gateway-core.test.mjs test/gateway-worker.test.mjs test/worker-server.test.mjs test/typecheck.test.mjs
npm run gateway:deploy -- --dry-run
npm run gateway:deploy -- --env staging --dry-run
```

The workerd test runs the actual entry point with isolated outbound services.
It checks SSE, compression, redirect refusal and origin passthrough without
contacting production. The core test checks routes, credentials/header filtering,
byte limits, request IDs, timeouts and cancellation.

## Account setup and migration

1. Sign in to Cloudflare, verify the account email, and approve Wrangler's browser
   OAuth flow. Use only the deployment scopes needed:
   `npx wrangler login --scopes account:read user:read workers_scripts:write workers_routes:write zone:read`.
   If the localhost callback expires or cannot be reached, repeat with `--device`
   and approve the matching displayed code within its validity window.
   Do not paste OAuth callback URLs or tokens into chat or the repository.
2. Add `oddbout.com` to Cloudflare's Free DNS plan. Compare the complete registrar
   DNS export with the imported list, including mail, verification and other
   subdomains. Public lookups cannot enumerate a zone.
3. Preserve the four GitHub Pages apex A records and `www` CNAME as **DNS only**.
   Preserve verification TXT records and `broadcast`'s DNS-only CNAME to
   `oddbout-broadcast-sandbox.onrender.com`. Keep `mcp` as a **proxied** CNAME to
   `ai-fighter-validator.onrender.com`. Do not delete Render's custom domain.
4. Configure SSL/TLS **Full**, following [Render's Cloudflare setup](https://render.com/docs/configure-cloudflare-dns).
   Full encrypts origin traffic but does not validate the origin certificate;
   treat that as an explicit tradeoff and review strict mode once origin renewal
   behind the proxy has been verified. Do not change other proxied services' TLS
   policy without reviewing their requirements.
5. Deploy an isolated workers.dev staging service first:
   `npm run gateway:deploy -- --env staging`, then
   `npm run gateway:smoke -- https://oddbout-mcp-gateway-staging.<subdomain>.workers.dev --worker`.
   This environment has no production route. Its unbranded host uses the legacy
   MCP resource and does not expose `/claude` or `/signin`.
6. **Before replacing nameservers**, remove the existing DNSSEC DS at Spaceship.
   Record the old parent DS TTL and the time deletion is confirmed at the parent.
   Wait at least that TTL after confirmed deletion. A cached recursive answer's
   absence by itself is not proof of deletion at every parent server. For the
   2026-11-04 DS (TTL 86,400 seconds), allow at least 24 hours; 48 hours is the
   conservative window. Keep the old nameservers and records during this wait.
7. Only after that wait and DNS comparison, replace Spaceship nameservers with
   the exact two assigned by Cloudflare. Wait for the zone to become Active and
   its edge certificate to be active before sending proxied traffic.
8. Deploy production with `npm run gateway:deploy`. The configuration installs a
   **route** `mcp.oddbout.com/*`, not a Worker Custom Domain. In the route settings,
   set **Request limit failure mode → Fail open (proceed)** and read the saved
   setting back. Wrangler's route declaration does not guarantee this setting.
   Recheck it after each route redeploy. If it is unavailable or cannot be verified,
   do not claim free-quota fallback is ready.
9. Run `npm run gateway:smoke -- https://mcp.oddbout.com --worker`. Check the legacy
   Render MCP address separately. Test ChatGPT, Claude `/claude` and Cursor
   `/signin` through their actual clients, including login and an account tool.
   HTTP smoke alone does not certify client OAuth success.
10. Enable Cloudflare DNSSEC, publish the new DS at Spaceship, and verify the
    chain after propagation. Compare Render HTTP-response bandwidth and request
    counts the following day. Keep the validation worker, health wakeup and
    Render custom domain until a separate decision changes them.

On the free plan, exceeding the daily Worker request quota falls back to Render
only when the route's fail-open setting is enabled. Render must also remain
available within its own billing limits. Fail open is not a general exception
handler: an upstream 502 or a CPU-limit failure is not a guaranteed origin retry.
See [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/).

## Rollback

Disable/remove the Worker route and keep the proxied CNAME pointing to Render.
This restores origin handling without a nameserver change. Verify `/mcp`,
`/claude`, `/signin`, their metadata, the branded challenge and `/health`.
Keep the last reviewed Render revision available; its existing implementation
already serves these routes. Deploy the shared Node adapter once with the next
reviewed Render release, not as a prerequisite to staging the Worker.

A full nameserver rollback requires removing the current DS and waiting its TTL
before returning to the former nameservers. Restore records and DNSSEC for the
destination provider afterward. Never use a nameserver change as the first rollback.

## Runtime details

The core uses standards-based Request/Response/Streams and no Node imports.
It requests `Accept-Encoding: identity`; the runtime decodes upstream content
before the allowlisted response is streamed, and Cloudflare negotiates client
compression. Redirects use `manual` and every 3xx fails as 502, because Workers
does not support `redirect: error`. The compatibility flag `enable_request_signal`
propagates client disconnects before its default activation date.
Timers stay active until stream completion/cancellation. Node pipelines also
honor downstream backpressure and cancel the upstream on disconnect.
