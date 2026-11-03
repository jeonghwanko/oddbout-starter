# Spotlight integrated Sandbox rehearsal · 2026-11-04 KST

This record covers the deployed customer flow, not a production-money transaction or Twitch stream.

## Deployment

- Final API/UI: `aab5ebb5a6b5cdab9473ed57e0050b4d4b35194d` on `codex/paypal-task-recovery`, Render `Deploy succeeded | Live`.
- The live financial rehearsal ran on `cb41f59ae616cf0719f1425cea9380c249b6336b`; the final release adds recipient verification and player recovery.
- Integration base: `7d9d4afce7c3b83aebd9b0561fdd5c13ca3d740c`.
- Database recovery correction: `abc6e603`; it changes Sandbox SQL, tests and documentation only.
- Sandbox project: `kxxhrnomfeequyujyppn`. Production database was not changed.
- Render service: `srv-dbkgdte1egvs739542og`, Free retained, automatic deployment off.
- Graphical runner: `svl-mac-01`, existing clean checkout `3411ef3f`, Node 24.13.0, OBS 33.0.1.
- `/readyz` returned 200; final served `shop.mjs`, `execution.mjs` and `watch.mjs` matched deployed Git contents.

## Customer path and evidence

The account used existing PayPal-captured Sandbox DON. This rehearsal did not create a new top-up.
The new purchase used a separate ticket and test MP4; existing tickets and the user's selected upload were preserved.

| Step | Observed evidence |
| --- | --- |
| Purchase | Ticket `848e34f0-9687-43c0-a9af-ea0866115333`, 1 hour / 300 DON |
| Wallet | 46,725 → 46,425 DON at purchase; Start kept 46,425 with zero reserved wallet DON |
| Lineup | Quickcat, Beotim, Kungjjak, Eoridung, assigned once at purchase |
| Funding attribution | 300 DON from PayPal order `88V317260P462440Y`, capture `4PK99542NL408204G` |
| Promotion | Verified 7,008-byte, 3-second MP4; destination `https://oddbout.com/`; actual model-written introduction |
| Calendar | Saved 2026-11-04 04:25 Asia/Seoul; manual Start at 04:18:33 |
| Execution | Same session `e46f822e-a9d5-424b-8409-dce4afca36ad` retained across API deployment |
| Agent | Sol 6.1 produced `SPOTLIGHT: Quickcat, Beotim, Kungjjak & Eoridung Exhibition Cup` |
| Completed cups | 4 succeeded; 12 verified bouts; no queued/running/unknown jobs at completion |
| Stop | Requested 04:38:50 KST; the running cup finished at 04:40:24 KST |
| Settlement | Official PayPal MCP `get_order` returned a matching completed capture at 04:41:29 KST |
| Payout | Local batch `6c134259-ab1e-446d-b92d-b928fcfb9e45`, PayPal batch `BG2R7YQFNCV22`, one dispatch |
| Recipient receipt | PayPal item `U4FN6P272QXHU`, transaction `0X295206VU004515T`, `SUCCESS`, USD 0.32 |
| Final wallet | 46,425 DON, zero wallet reservations, not frozen; purchase was the only 300 DON debit |

Each of four fighters earned USD 0.08 across four cups (16 appearance records at USD 0.02 each).
The current Sandbox configuration maps those fighters to one test receiver, so PayPal sent one
aggregated USD 0.32 item. An independent, read-only API lookup verified the recipient's item success,
not only the batch header. The temporary local credentials used for that lookup were deleted.
The internal execution allowance consumed 100 units; that is not an additional wallet charge.

Completed job IDs:

- `607bcb7c-a6c6-4ff1-979c-af00cd962784`
- `1871417d-ea36-44ff-8c5a-e61c12cb8b7f`
- `73000ab2-f898-4478-ba1f-735b03f49d57`
- `5a9b2154-e6dd-4ace-a6d9-349f91513906`

## Issues found and corrected

The first Agent attempt stopped without creating a cup. A bounded local diagnostic reproduced a
valid `host_cup` proposal with a 246-character display title, exceeding the old 120-character label
validator. The adapter now shortens display labels without altering the action or fighter selection,
and records original label lengths. A subsequent actual Sol 6.1 call validated successfully.
Unusable responses expose an explicit Retry Agent control; counters, ownership and pending-job
barriers are preserved. No automatic retry of an uncertain cup mutation was introduced.

API restart discovery exposed a PL/pgSQL alias collision in the new continuation query. The follow-up
Sandbox migration fixes that alias; a service-role query and PostgreSQL recovery regression both passed.

The user's Chrome profile left the embedded battle blank, while direct playback and a separate
headless Chrome test of the deployed public watch page rendered the real bout. The profile-specific
cause is unverified. A timed direct-player fallback now provides the identical matchup and seed when
the iframe does not signal readiness; it clears at the next slot. No browser security setting changed.

The existing payout adapter accepted a successful batch header as payment completion. It now requires
a complete set of unique item results with every recipient marked `SUCCESS`. Unclaimed or partial
results stay reserved for review. This follows the [PayPal Payouts API](https://developer.paypal.com/api/payments.payouts-batch/v1/payouts-get).

## Automated verification

- PostgreSQL financial/recovery scenarios: 4 passed, including one ticket debit, duplicate completion,
  lost payout reply, unknown work, legacy metered billing, FIFO funding, expiry and refund freezes.
- Producer/reconciliation/browser acceptance: 39 passed, 1 skipped.
- Producer/supervisor/browser regression after the retry fix: 31 passed initially; the sole API-shape
  expectation was updated for the new retry method and its focused rerun passed.
- Typecheck and Git whitespace checks passed.
- Final upload/YouTube/Twitch browser regressions: 3 passed, including player fallback and slot cleanup.
- Final payout/PayPal regressions: 62 passed, including recipient-level completion, complete pagination,
  duplicate/partial results, lost replies, permissions and retry idempotency. Final typecheck passed.
- Public/anonymous and authenticated database roles cannot execute the private execution RPC;
  service_role can. Security advisors added no warning category beyond the pre-existing Auth warning.

## Scope

The viewing page plays sponsor slots and replays actual verified Agent-produced bouts. It labels them
as replays. Graphical execution and local playback do not certify Twitch streaming, audience reach,
continuous delivery or fulfillment of a full hour. The test clip is a technical fixture, not a customer ad.
This run ended early: about 20 minutes 17 seconds from Start to stop request, 21 minutes 50 seconds
through the final cup's completion. It did not verify a full hour or the 30-minute sponsor slot in the
deployed environment. Scheduled ad transitions were covered by browser fixtures. The graphical
runner remains connected for subsequent tickets; Twitch ingest remains disabled. Render Free was retained.
