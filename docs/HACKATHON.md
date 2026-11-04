# ODDBOUT Showrunner · PayPal AI Hackathon entry

**Sponsors pay with PayPal. An AI producer runs the show. Creators get paid.**

ODDBOUT Showrunner turns one PayPal payment into an hour of AI-produced fighter cups with your promo in the breaks.
Then it checks the payment with PayPal and pays the fighters' creators.

- Hosted demo: <https://broadcast.oddbout.com/broadcast/> (PayPal Sandbox, test money only)
- Judges' page: <https://broadcast.oddbout.com/broadcast/judges/> (this write-up as one page, with a sample clip to upload)
- Demo video: coming soon
- Source: this repository ([MIT](../LICENSE)) and the arena renderer,
  [oddbout-twitch-cup](https://github.com/jeonghwanko/oddbout-twitch-cup)

The PayPal Sandbox buyer login for the demo is in our Devpost testing instructions. It is not published here.

## The money loop

Real records from our Nov 4, 2026 Sandbox rehearsal (times in KST, test money only). The full record, including the
issues found and fixed during that run, is [SPOTLIGHT-INTEGRATION-2026-11-04](records/SPOTLIGHT-INTEGRATION-2026-11-04.md).

| Step | What happens | Evidence |
| --- | --- | --- |
| 1. Sponsor pays (PayPal Checkout) | Orders v2: the buyer approves and our server captures. DON is credited only after a verified capture. | Order `88V317260P462440Y`, capture `4PK99542NL408204G` |
| 2. One ticket, one debit (ledger) | Spotlight · 1 hour costs 300 DON. Four fighters are assigned at purchase. | 46,725 → 46,425 DON; no other charge |
| 3. The AI producer runs the show (AI · MCP) | The On-Air Agent schedules cups through ODDBOUT's MCP tool `host_cup`, inside the ticket's allowance. | 4 cups, 12 verified bouts |
| 4. The payment is reconciled (PayPal MCP) | The official PayPal MCP server's `get_order` confirms the capture that funded this ticket. | Matched at 04:41:29 KST |
| 5. Creators get paid (PayPal Payouts) | Appearance fees go out after the owner approves. "Paid" requires every recipient item to report `SUCCESS`. | Batch `BG2R7YQFNCV22`, item `U4FN6P272QXHU`, USD 0.32 `SUCCESS` |

Each fighter earns USD 0.02 per completed cup: four fighters × four cups = USD 0.32. This Sandbox maps all four fighters
to one test receiver, so PayPal sent a single item.

## Try it in 10 minutes

You need any Google account, the PayPal Sandbox buyer login from our Devpost testing instructions, and a short MP4.
Our sample clip works: [sample-promo.mp4](https://broadcast.oddbout.com/broadcast/assets/sample-promo.mp4)
(6 seconds, 31 KB, in the repository as `web/broadcast/assets/sample-promo.mp4`).

| # | Do this at <https://broadcast.oddbout.com/broadcast/> | You should see |
| --- | --- | --- |
| 1 | Sign in with Google. | Your DON shows 0 |
| 2 | Add DON → Starter, USD 10. Approve with the Sandbox buyer. | "1,000 DON added" |
| 3 | Choose 1 hour for 300 DON. | A ticket with four fighters |
| 4 | Add your promotion: the MP4 and a promo URL, then Save Promotion. | An AI-written sponsor introduction |
| 5 | Add to Calendar → On-Air Agent → tick the check → Start. | "Agent running" |
| 6 | Wait for the first cup, about 5 minutes, then open Watch broadcast. | Your promo break and a replay of the verified bout |
| 7 | Press End broadcast and confirm. The current cup finishes. | "Finished" |
| 8 | Press Check settlement. | Settlement shows "Matched" |
| 9 | Tick the approval for the creator fees and press Pay with PayPal. | "Paid · PayPal batch … · every recipient SUCCESS" |

One graphical runner serves this demo. If Start says another broadcast is using the host, your ticket is saved: try again
in a few minutes. Ending after the first cup keeps the runner free for the next judge.

## Where PayPal does the work

- **Orders v2 · Checkout** (`api/commerce/paypal.mjs`, `api/commerce/service.mjs`). Create, buyer approval, server
  capture. Before any DON is credited, `validateCapturedOrder` checks the COMPLETED, final capture against the order ID,
  payee merchant, amount, currency and the account's own top-up record (the purchase unit's `reference_id`). An uncertain
  capture is re-read from the same order, never replaced; each capture ID can credit once.
- **Webhooks** (`verifyWebhook` in `api/commerce/paypal.mjs`, `webhook` in `api/commerce/service.mjs`). Signatures are
  verified with PayPal's `verify-webhook-signature` API. `CHECKOUT.ORDER.APPROVED` and `PAYMENT.CAPTURE.COMPLETED` use
  the same capture and credit path as the synchronous return, so a late or repeated event does not credit again.
  `PAYMENT.CAPTURE.REFUNDED` and `PAYMENT.CAPTURE.REVERSED` are stored once per event ID and freeze the wallet's spending.
- **Official PayPal MCP server** (`broadcast/reconcile.mjs`, installed from `deploy/paypal-mcp/package.json`).
  `@paypal/mcp` runs as a child process with only its read tools enabled: `get_order`, `list_transactions` and
  `get_refund` (`PAYPAL_READ_TOOLS`). The connection is refused if the server offers any other tool. **Check settlement**
  makes the server call `get_order` for exactly the top-ups that funded the ticket and compare each with the ledger
  (`api/commerce/campaign-execution.mjs`).
- **Payouts** (`api/commerce/payouts.mjs`, `createPayout` and `getPayout` in `api/commerce/paypal.mjs`). Creator
  appearance fees, sent only after the ticket owner approves on the ticket page. The local batch ID is also PayPal's
  `sender_batch_id` and request ID, so retrying an uncertain send reuses the same batch and can never create a second
  one. A batch is paid only when PayPal returns a complete set of unique item results with every recipient `SUCCESS`; a
  successful batch header alone is not enough. A refund or reversal freezes payment.

## Where AI does the work

- **On-Air Agent** (`broadcast/producer.mjs`, `broadcast/supervisor.mjs`). Each turn a model reads the ticket's lineup
  and remaining time and proposes one structured decision: host a cup, wait or stop. The server validates the proposal and
  hosts cups only through ODDBOUT's MCP tool `host_cup`, with a grant scoped to that one broadcast
  (`mcp/cloud/commerce-handler.mjs`). It cannot pay, approve, or change prices, limits or payouts. The model is the
  operator's explicit choice in `ODDBOUT_BROADCAST_MODEL`, called through the OpenAI Responses API with no fallback model.
  The Nov 4 record names Sol 6.1 as the model that produced its cups.
- **Sponsor introduction** (`introduction` in `api/commerce/campaign-media.mjs`). A model writes a 25 to 45 word
  introduction from the promo URL's hostname only. The prompt labels it a paid sponsor break and forbids product claims,
  because the model has not seen the video or the site. The owner reviews it before pressing Start.
- **Settlement auditor** (`createReconciler` in `broadcast/reconcile.mjs`). After the server's own comparison, a model may
  call the same read-only PayPal MCP tools to look into mismatched or pending rows, then explains the result to the owner
  in at most six sentences. Its summary travels with the settlement report; the server's comparison decides the result,
  never the model.
- **Bounded by design.** Producer model calls are capped per broadcast and per day; auditor calls per check and per day.
  An unusable AI answer shows **Retry Agent**, which continues the same ticket, session and model-call count with no
  extra DON. An uncertain cup is held for review, never retried automatically.

## Architecture

```text
 Browser (shop, ticket page, watch page)          PayPal Sandbox
   web/broadcast/*.html, *.mjs                      Orders v2 · webhooks · Payouts · official MCP server
            │ HTTPS                                          ▲
            ▼                                                │
 Demo server: scripts/broadcast-demo.mjs  ───────────────────┘
   commerce API ........ api/commerce/handler.mjs, service.mjs, paypal.mjs
   Spotlight tickets ... api/commerce/campaigns.mjs, campaign-media.mjs, campaign-execution.mjs
   creator payouts ..... api/commerce/payouts.mjs
   reconciliation ...... broadcast/reconcile.mjs (+ deploy/paypal-mcp)
   AI producer ......... broadcast/supervisor.mjs → broadcast/producer.mjs → producer MCP (mcp/cloud/commerce-handler.mjs)
   worker API .......... broadcast/worker-api.mjs
            │                                  │
            ▼                                  ▼
 Supabase Sandbox ledger              Graphical runner (one macOS host)
   supabase/sandbox/*.sql               scripts/broadcast-runner.mjs, broadcast/runner.mjs, broadcast/obs.mjs
   wallet, tickets, jobs,               plays each cup in the oddbout-twitch-cup arena and reports the
   funding, payouts                     result; the ledger applies each report once
```

| Part | Where | Notes |
| --- | --- | --- |
| Hosted service | `deploy/broadcast.render.yaml` | One Render web service for the demo server, one static site for the arena |
| Ledger | `supabase/sandbox/` | Separate Sandbox project; one debit per ticket, one credit per capture, fenced job completion |
| Storefront and ticket page | `web/broadcast/shop.html`, `web/broadcast/shop.mjs`, `web/broadcast/execution.mjs` | Google sign-in, DON wallet, Spotlight tickets, settlement and payouts |
| Watch page | `web/broadcast/watch.html`, `web/broadcast/watch.mjs` | Plays the sponsor break and replays verified bouts on the web |
| Judges' page | `web/broadcast/judges.html` | Static, no scripts |
| Arena renderer | [oddbout-twitch-cup](https://github.com/jeonghwanko/oddbout-twitch-cup) | Fenced tournament renderer (#1); Spotlight playback adapter (#5, open) |

## Built during the hackathon

The submission period opened Oct 1, 2026. Not part of this entry: the ODDBOUT game with its fighters and bout engine,
developed in a separate repository, and the fighter creator kit this repository has held since its first commit on
Oct 19, 2026 (`git log --reverse` shows `api/`, `worker/`, `mcp/` and `scripts/` starting that day). Showrunner's code
first appears on Nov 2: `broadcast/` and `api/commerce/` have no earlier history. The arena repository's history starts
Nov 2, extracted from the game with nine built-in fighters and a bout-only host.

Dates are GitHub merge times (UTC); the two open pull requests show when they were opened.

| Date | Change | Pull request |
| --- | --- | --- |
| Nov 2 | Fenced tournament renderer for agent broadcasts | [twitch-cup #1](https://github.com/jeonghwanko/oddbout-twitch-cup/pull/1) |
| Nov 2 | PayPal Sandbox credits and scoped agent broadcasts | [starter #264](https://github.com/jeonghwanko/oddbout-starter/pull/264) |
| Nov 2 | Sandbox hardening: kept out of production; an unknown job no longer holds a host | [starter #266](https://github.com/jeonghwanko/oddbout-starter/pull/266) |
| Nov 2 | Winner card held between broadcast bouts | [twitch-cup #2](https://github.com/jeonghwanko/oddbout-twitch-cup/pull/2) |
| Nov 2 | Isolated hosted PayPal Sandbox and reproducible cup checks | [starter #290](https://github.com/jeonghwanko/oddbout-starter/pull/290) |
| Nov 2 | Broadcast Studio refresh and Google sign-in | [starter #296](https://github.com/jeonghwanko/oddbout-starter/pull/296) |
| Nov 3 | Broadcast audio fix and Sandbox endurance package | [starter #302](https://github.com/jeonghwanko/oddbout-starter/pull/302) |
| Nov 4 | Spotlight tickets, PayPal MCP reconciliation, creator Payouts, paid-task recovery | [starter #329](https://github.com/jeonghwanko/oddbout-starter/pull/329) |
| Nov 4 (opened) | MIT license for the Twitch Cup code, with art terms in NOTICE | [twitch-cup #4](https://github.com/jeonghwanko/oddbout-twitch-cup/pull/4) (open) |
| Nov 4 (opened) | Read-only Spotlight playback adapter, already served by the hosted arena | [twitch-cup #5](https://github.com/jeonghwanko/oddbout-twitch-cup/pull/5) (open) |

## What this demo does not claim

- PayPal Sandbox only. No live payments or real customers.
- Creator payouts always wait for a person to approve them.
- One graphical runner serves the demo, so one broadcast runs at a time.
- The watch page replays verified bouts on the web. It is not a Twitch stream.
- Our Nov 4 run was ended after about 20 minutes. A full hour, including the second sponsor break at 30 minutes, is not
  yet verified on the hosted demo.
- Live Twitch or YouTube output and 24-hour runs are planned work and not verified. The runner's `--live` mode stays
  blocked until Twitch channel verification exists.

## Run it yourself

- [BROADCAST-HOSTING](BROADCAST-HOSTING.md): the hosted Sandbox, its isolated database, the runner and producer, and the
  acceptance gates.
- [SHOWRUNNER-PRODUCT](SHOWRUNNER-PRODUCT.md): Spotlight tickets, promotion media, scheduling, settlement and payouts.
- [PAID-TASK-RECOVERY](PAID-TASK-RECOVERY.md): paid broadcasts that continue after checkout closes, a lost agent or a
  server restart, and their deployed acceptance run.
- [BROADCAST-SANDBOX](BROADCAST-SANDBOX.md) (Korean): local console, host doctor, runner and producer commands.

Use your own PayPal Sandbox app, Supabase test project and model key. Keep them in a local `.env` or the host's secret
store, never in the repository.

## What's next

- The live service sells tickets directly through PayPal Checkout, with no prepaid wallet balance, starting with
  overseas business sponsors.
- Creator payouts go live once PayPal Payouts support for the creators' countries is confirmed.
- Live streaming to Twitch or YouTube, and verified 24-hour runs.

## Licenses

- oddbout-starter (Showrunner and the creator kit): [MIT](../LICENSE). The bundled [sprite-gen](../vendor/sprite-gen)
  submodule keeps its own Apache-2.0 license and NOTICE.
- oddbout-twitch-cup: the code becomes MIT when [#4](https://github.com/jeonghwanko/oddbout-twitch-cup/pull/4) merges.
  Its artwork, voices, fighter names and logos stay under the terms in its NOTICE.
- DM Sans and Space Grotesk ship under the SIL Open Font License (`web/broadcast/assets/*-OFL.txt`). PayPal and Google
  marks belong to their owners.
