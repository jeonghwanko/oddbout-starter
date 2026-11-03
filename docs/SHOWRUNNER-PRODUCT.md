# ODDBOUT Showrunner

Productized MVP of the approved monetization plan: buy credits, let an AI producer operate
tournaments within an approved budget, and pay creators appearance fees for completed cups.
User confirmed this scope on 2026-11-04 (Asia/Seoul). This is the existing PayPal Sandbox service;
it is not a launch of live-money billing.

## Identity and offer

- Service: **ODDBOUT Showrunner**. Customer promise: run a fight night with a defined lineup and budget.
- Currency: **Studio Credits**, a prepaid service balance separate from game gold.
- Service icon: four entrants feeding a tournament bracket and a play button. The original SVG is
  `web/broadcast/assets/showrunner.svg`; use the same mark in the header and favicon.
- A cup is four fighters, two semifinals and one final. A confirmed completed cup costs **25 credits**.
  Planning, status checks and retrieving the existing result do not consume credits.

| Pack | Purchase | Credits | Completed cups | Icon |
| --- | --- | --- | --- | --- |
| Starter | USD 10 | 1,000 | Up to 40 | Opening bell |
| Series | USD 50 | 5,000 | Up to 200 | Tournament bracket |

Both are one-time purchases at the same unit rate, with no subscription, bulk discount or automatic
renewal. Prices are Sandbox test prices. The 50,000-credit endurance pack remains compatible with
existing orders and operator tools, but is hidden from the normal storefront. `operatorOnly` is a
merchandising flag, not an authorization boundary.

The original Starter product ID and all existing monetary amounts stay unchanged. The catalog's
merchandising revision is separate from its unchanged cup price version, so renaming products does
not invalidate approved work. Historic purchases retain their stored money and credit quantities;
the history displays the current catalog label when the stored amount and quantity match. This label
does not claim to reproduce a historical PayPal description.

## Purchase and use

1. Compare packs, their prices and the number of cups they cover. Sign in with Google to buy.
2. Review the selected pack and use PayPal checkout. The server supplies product names and prices;
   a client or model cannot change the amount. Test mode stays visible throughout checkout.
3. The original order is verified before credits appear. Recent purchases show the latest 50 records,
   dates, amounts, credits and status. Continue a pending purchase using that record, never a new order.
4. Request a show from the concierge or enter its lineup and budget. Review and approve automatic
   producer start. Existing credits cover the budget; otherwise the same saved show links its purchase.
5. The producer schedules cups within the approved limit. Closing the browser does not discard the show.
   Returning to the same account restores its original state, costs and results.
6. Completion displays verified cups and spending. Exhausted budgets close after all jobs settle;
   unknown executions remain held. Failed jobs are not charged; unused reservations return to the wallet.
7. Creator appearance fees are separate from the customer's credits. The current fee is USD 0.02 per
   fighter per completed cup; only the owner's explicit payout approval sends a Sandbox batch.

The purchase receipt and the usage report are different records. Releasing unused credits after a
show is not a PayPal purchase refund. Do not imply cash redemption or a new refund policy.

## Shipping boundary

Keep the service promise limited to working tournament scheduling, execution and saved results.
The MVP does not sell Twitch streaming, fighter generation, downloadable video, game advantages or
24-hour availability. Existing Free hosting can sleep, so it does not promise unattended continuous
operation. Production-money activation, commercial refund terms and always-on hosting remain separate
launch decisions. The UI must clearly state Sandbox mode without naming the actual products as tests.

See [PAID-TASK-RECOVERY](PAID-TASK-RECOVERY.md) for durable execution and recovery,
[BROADCAST-HOSTING](BROADCAST-HOSTING.md) for deployment, and
[PAYPAL-AGENT-BROADCAST-PLAN](PAYPAL-AGENT-BROADCAST-PLAN.md) for the original monetization design.
