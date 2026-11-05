# Submission rehearsal and demo video capture · 2026-11-05 KST

This record covers two runs of the deployed customer flow at <https://broadcast.oddbout.com/broadcast/>, made to film
the live-site part of the demo video. PayPal Sandbox only; no production money moved. Times are KST unless marked PT.

## Setup

- Deployed API/UI: `81d1c959` (oddbout-starter `main`, Render `oddbout-broadcast-sandbox`, deployed earlier the same day).
  `/readyz` returned 200 before each run; the served config reported Sandbox mode with payments, the automatic producer,
  PayPal MCP reconciliation and Payouts enabled, and `svl-mac-01` as the only execution host.
- Graphical runner: the `broadcast-runner.mjs --host svl-mac-01` process that has run since 2026-11-04 04:11.
- Browser: installed Chrome driven by a Playwright capture script outside this repository, recording 1920×1080.
  The script clicked the ODDBOUT pages. A person signed in to Google and approved each PayPal Sandbox checkout.
  The script never typed a password.
- Buyer: a US PayPal Sandbox personal account. The Devpost testing instructions carry its login; it is not published here.

## Run 2 · fresh Google account (used in the video)

A Google account that had never signed in to ODDBOUT, so the wallet started at 0 DON.

| Step | Observed evidence |
| --- | --- |
| Sign-in | New account accepted by Google sign-in |
| Top-up | Starter, USD 10. PayPal order `4R764743EF237153D`, capture `1SW10786XW838683W`. Return tab: "1,000 DON added. Your balance is ready." Wallet 0 → 1,000 DON |
| Ticket | Spotlight Hour `c755e75c-d4cd-4b05-a2b7-efc938251702`, 300 DON. Lineup Duldul, Kungjjak, Eoridung, Sikeundung |
| Promotion | `sample-promo.mp4` (6 s) verified; destination `https://oddbout.com/`; model-written sponsor introduction |
| Calendar | First save failed with a connection reset; the page said "Save not confirmed. Retry the same date; your ticket is unchanged." The retry with the same date saved Nov 5, 2:20 AM PT |
| Start | Accepted; the AI producer's first `host_cup` decision appeared about 20 s later |
| Broadcast | 3 cups, all `succeeded`. The watch page showed the paid sponsor break, then a replay of an agent-produced bout |
| End | Finished after the running cup completed |
| Settlement | `Matched`, checked with the official PayPal MCP server (`get_order`). Funding for this ticket: 300 DON · $3.00 from order `4R764743EF237153D`. The AI audit note confirmed the $10.00 order and the 1,000-credit ledger entry and found no mismatch |
| Creator fees | $0.24 (4 fighters × 3 cups × $0.02) approved by the owner |
| Payout | PayPal batch `QK843ADX5J4GQ`, "every recipient SUCCESS". All five ticket steps showed done: Paid, Scheduled, On air · 3 cups, Settled, Creators paid |

## Run 1 · existing rehearsal account

The same flow with the Google account used on Nov 4. It passed end to end but was not used in the video.

| Step | Observed evidence |
| --- | --- |
| Top-up | PayPal order `1D161225FY926621R`; wallet 46,425 → 47,425 DON |
| Ticket | `23e3ab0f-42dc-495d-aa0b-b951e49fe5bc`, 3 cups |
| Settlement | `Matched`, but against order `88V317260P462440Y` (capture `4PK99542NL408204G`), the account's older $500 top-up |
| Payout | PayPal batch `6HDR7NEMPC2KS`, every recipient `SUCCESS`, $0.24 |

The ticket drew its 300 DON from the oldest captured top-up first, so its settlement names the older order, not the
top-up made minutes before. That is the intended funding rule. It made the run unsuitable for a video that shows a
$10 top-up followed by its settlement, so the flow was filmed again with a fresh account.

## Findings

- A buyer whose PayPal account or guest card checkout is registered in Korea cannot pay this merchant: PayPal shows that
  payments between Korea-registered accounts are not allowed. A US Sandbox personal account works. The Devpost
  testing instructions must give judges a non-Korean buyer.
- The calendar save hit one transient connection reset. The page kept the ticket and asked for the same date again,
  and the retry succeeded. No code change was made.
- The ledger admin check (`scripts/paid-operation-admin.mjs status`) was not run for these runs. The evidence above is
  what the deployed pages showed.

## Demo video

<https://youtu.be/DW9NkqZrJnQ> (2:45, public). From 1:44 it shows Run 2: the top-up, the PayPal Sandbox approval page,
the ticket and promotion, Start and the first `host_cup` decision, the watch page, the `Matched` settlement and the
Payouts receipt. Waiting time is cut and the screens are not edited.
