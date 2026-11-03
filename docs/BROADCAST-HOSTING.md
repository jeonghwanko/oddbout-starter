# Hosted PayPal Sandbox demo

This is a separate hackathon environment. Deployment preparation does not prove a
payment, model call, Twitch stream or 24-hour run. The runner's `--live` mode remains
blocked until Twitch channel/ingest verification is implemented.

## What runs where

| Component | Location | Entry point |
| --- | --- | --- |
| Judge console, PayPal callbacks, commerce API, producer MCP, worker API | Dedicated HTTPS web service | `scripts/broadcast-demo.mjs` |
| Wallet, reservations, jobs, accounting | Dedicated Supabase test project | `supabase/sandbox/20261102115107_commerce_broadcast_ledger.sql` |
| Public battle page and built-in assets | Static HTTPS host | Cup repository's `dist/broadcast.html` |
| Visible browser, OBS, persistent runner/producer checkpoints | Selected always-on PC or graphical host | `broadcast-runner.mjs`, `broadcast-producer.mjs` |

Judges use the public console without installing Node or OBS. The runner makes
outbound HTTPS requests to the API and arena; OBS WebSocket stays local to its host.
A static site or ordinary headless web service cannot replace the graphical host.
Fully remote operation needs a separate graphical machine; using the current PC
still depends on that PC remaining awake and connected.

## Deploy the public services

1. Publish the reviewed changes to starter `main`. Record exact starter/Cup commits
   before deployment and keep auto-deploy disabled during measured runs.
2. Create a separate Render Blueprint using `deploy/broadcast.render.yaml`. Check
   that its service names do not collide with existing services. This template
   declares a Node API and static Cup site, initially with commerce disabled.
3. Set `ODDBOUT_COMMERCE_ORIGIN` to the console's exact public HTTPS origin without
   a trailing slash. Omit `ODDBOUT_BROADCAST_PORT` on Render to use platform `PORT`.
4. Verify `/healthz`, `/broadcast/`, `/broadcast/config`, `/broadcast/supabase.js`
   and the arena's `/broadcast.html`. Health is process liveness only;
   `preview-unconfigured` is not an operational payment demo.

Other TLS hosts: `npm ci --omit=dev --ignore-scripts`, then
`node scripts/broadcast-demo.mjs` with `ODDBOUT_BROADCAST_BIND_HOST=0.0.0.0`, `PORT`
and the HTTPS origin. The listener is HTTP behind a TLS proxy which must preserve
external `Host`. Forwarded headers never override origin/Host validation.

The Blueprint uses Free for initial preview. Render currently sleeps a Free web
service after 15 minutes without inbound traffic. Select an appropriate always-on
service for sustained tests; a paid plan alone does not prove continuity.
See [port binding](https://render.com/docs/web-services#port-binding),
[Blueprint fields](https://render.com/docs/blueprint-spec) and
[Free limitations](https://render.com/docs/free).

## Enable the isolated Sandbox

1. Confirm the test Supabase project name/reference before applying the single
   Sandbox SQL file. Never apply it to the game's production project.
2. Put its `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`
   in API secret settings. Allow Auth redirect `https://<console-host>/broadcast/`.
   Enable the Google provider with the ODDBOUT OAuth web client. Add this isolated
   project's `/auth/v1/callback` to the Google client's authorized redirect URIs,
   preserving existing callbacks. Test Google login with the intended judge account.
   The console offers Google only; it does not use email login links or SMTP.
3. Create/select a PayPal Sandbox REST app, business account and separate personal
   buyer test account. Set `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`,
   `PAYPAL_SANDBOX_MERCHANT_ID` on the API service only.
4. Register `https://<console-host>/commerce/webhook` for the capture events handled
   by `api/commerce/paypal.mjs`; set `PAYPAL_SANDBOX_WEBHOOK_ID`. Keep keys out of chat/Git.
5. Set `ODDBOUT_COMMERCE_ENABLED=1`, restart, sign in, create a top-up, approve it
   using the Sandbox buyer, return to the original console and **Verify payment**.
   Record order/capture IDs and the ledger change. Repeat verification of that same
   order to prove a single credit, rather than starting another top-up.

A real Sandbox transaction uses PayPal's test service and virtual funds; it is not
a live-money charge. See the [PayPal Sandbox guide](https://developer.paypal.com/sandbox-testing/overview).
Supabase login redirects must match the project's [allowed redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).

## Connect a runner and producer

Follow [BROADCAST-SANDBOX](BROADCAST-SANDBOX.md) for host inventory and scoped grants.
Provision a random worker token on API (`ODDBOUT_BROADCAST_WORKERS_JSON`) and host
(`ODDBOUT_BROADCAST_WORKER_TOKEN`). Set host API/MCP URLs to the public console and
arena URL to the public `/broadcast.html`. Tokens/OBS passwords stay off the static site.

The runner needs dev dependencies (`npm ci --ignore-scripts`), a graphical session
and a browser. Install its default using `npx playwright install chromium`, or
explicitly set `ODDBOUT_BROADCAST_BROWSER_CHANNEL=chrome` or `msedge` to use an
installed browser. There is no automatic fallback. Run one uncharged renderer check:

```sh
npm run broadcast:check-renderer -- https://<arena-host>/broadcast.html
```

This runs four built-in fighters through three actual battles with the normal
renderer/validator and saves JSON under `output/`. It does not claim a worker job,
charge a wallet, call a model or start OBS/Twitch. Inspect incomplete records before
another run. Completion proves rendering only.

To run the producer automatically for every started session, set
`ODDBOUT_BROADCAST_AUTO_PRODUCER=1`, `ODDBOUT_BROADCAST_MODEL` and `OPENAI_API_KEY` on the API
service. Its daily and concurrent limits, the state directory and restart behavior are in
[BROADCAST-SANDBOX](BROADCAST-SANDBOX.md#자동-실행-데모-서버). Put
`ODDBOUT_BROADCAST_PRODUCER_STATE_DIR` on a persistent disk so producers resume after a restart.
To offer the console's AI concierge (balance, prices, quotes and PayPal Sandbox top-up, no approval
or start), also set `ODDBOUT_BROADCAST_CONCIERGE=1`; see
[BROADCAST-SANDBOX](BROADCAST-SANDBOX.md#5-1-ai-컨시어지-데모-서버).
To let owners check their top-ups against PayPal through the official PayPal MCP server, set
`ODDBOUT_PAYPAL_RECONCILIATION=1`; the Blueprint's build command already installs that server
(`npm ci --prefix deploy/paypal-mcp`). See
[BROADCAST-SANDBOX](BROADCAST-SANDBOX.md#5-2-paypal-정산-대조-데모-서버).
Otherwise, after the user approves a session in the console, provision its matching expiring
`obp_` producer grant. Select model, API account and spending limit before calling
the model. Invocation/token limits are not a dollar billing cap; API cost is
separate from Sandbox credits. Preserve checkpoint files and request keys.

## External acceptance gates

| Gate | Evidence still needed from the external environment |
| --- | --- |
| G0 | Public URLs, test DB/app/accounts, chosen host/channel/model, actual approval return |
| G1 | Sandbox capture and one ledger credit; duplicate/cancel/mismatch/webhook checks |
| G2 | Approved session, scoped producer grant, actual model/MCP trace, budget enforcement |
| G3 | Runner claim → public arena result → one charge; retry reconciliation |
| G4 | Channel ownership/ingest verification, OBS start/stop/telemetry; 30-minute stream and recovery |
| G5 | Actual producer decisions; two-hour run, faults, stop/budget exhaustion, reconciled report |
| G6 | Fixed-version 24-hour run, timestamped stream observations and explicit gaps |
| G7 | Clean public checkout, integrated-path reproduction, final English instructions |
| G8 | Under-three-minute video, public demo access, licenses, pinned commits and submission |

Do not remove the `--live` guard to present rendering as streaming. Record elapsed
time separately from observed live time, reconnects, gaps and unknown outcomes.
