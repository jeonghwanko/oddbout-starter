# Paid tasks that survive a disconnected agent

An agent prepares a task on a VM. Its owner approves and funds it with PayPal on a phone.
If the VM or conversation disappears, a new PC agent finds the original task and resumes it.
No old conversation, shared browser storage or pasted PayPal order ID is needed.

This service targets paid MCP tool developers and currently runs in PayPal Sandbox. Its first workload is one four-fighter cup:
three rendered bouts on an existing host. It is not universal merchant checkout or a guarantee
of exactly-once external execution. Unknown execution stays held for reconciliation.

## Implementation

- A durable operation binds owner, immutable task/price/original deadline, web consent, top-up, session and job.
  A person can explicitly renew an expired approval before execution, retaining the original task and funding.
- `/broadcast/tasks/` provides phone review, separate task consent and official PayPal checkout.
- Local MCP clients connect through phone pairing. Their secret stays in process memory; the server
  stores its hash. The model never receives a user JWT, password, OTP or merchant key.
- The browser concierge can prepare/find saved tasks, but cannot approve or execute them.
- Signed `CHECKOUT.ORDER.APPROVED` webhooks verify/capture the saved order without a browser return.
  A durable recovery queue and PC recovery check that same order if the webhook is missed. Approval alone is not payment.
- Database leases fence recovery across server restarts and replicas. Transient failures back off; repeated
  failures and unbound orders outside the safe replay window require review. No replacement order is created.
- Account-scoped keyset pagination, search, status filters and append-only history keep old tasks discoverable.
  The phone page uses PKCE with tab-scoped session storage and explicit account-change invalidation.
- Session creation, queue insertion and ID binding are one transaction. A database guard refuses
  additional jobs in that session. Confirmed completion closes it without a connected client.
- Existing PayPal validation, credit ledger, worker leases, reconciliation and creator payouts are reused.

Prices remain **$10 Sandbox for 1,000 credits; 25 credits per completed cup**. Remaining credits stay
in the wallet. Already-funded accounts need no new purchase. Cancellation/expiry does not refund
a credit purchase. Failed jobs are not charged; uncertain jobs retain their allocation. Recovery
never extends consent automatically or changes execution hosts. Wallet credits are shared: if other tasks
consume them before this task starts, add credits in Broadcast Studio and resume this same task.

## Deploy to the isolated Sandbox

Follow [BROADCAST-HOSTING](BROADCAST-HOSTING.md) for the existing service and runner.

1. Confirm the dedicated Sandbox project. Apply files from `supabase/sandbox/` in this explicit order:
   ledger `20261102115107_commerce_broadcast_ledger.sql`, payouts `20261104090000_commerce_payouts.sql`,
   then `20261103131740_commerce_paid_operations.sql`, then `20261103134354_commerce_paid_operation_recovery.sql`.
   Existing WP5 databases need the last two files. An existing task-recovery deployment needs only the last file.
   Never apply them to production or through production `supabase db push`.
2. Install with `npm ci --ignore-scripts`. Deploy the reviewed commit and set `ODDBOUT_PAID_OPERATIONS=1`
   alongside existing commerce settings. Default `0` keeps old databases operational until migration.
3. Add exact `https://<console-host>/broadcast/tasks/` to the **Sandbox Supabase Auth redirect allowlist**,
   preserving `/broadcast/`. Google's existing Sandbox Supabase `/auth/v1/callback` remains the same.
4. Subscribe the existing PayPal Sandbox webhook to `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`,
   `PAYMENT.CAPTURE.REFUNDED` and `PAYMENT.CAPTURE.REVERSED`. Keep signature verification enabled.
   [PayPal event reference](https://developer.paypal.com/api/rest/webhooks/event-names/).
5. Verify `/broadcast/config` reports `paidOperations: true` and `/readyz` returns HTTP 200 with recovery enabled.
   Readiness checks the required database schema; `/healthz` checks only process liveness.
   Use `/readyz` as the hosting health check. Keep the original renderer host and worker.
   One-cup recovery does not launch an extra producer; ordinary broadcast sessions retain theirs.

Rollback: disable `ODDBOUT_PAID_OPERATIONS`, restore the previous application commit if necessary,
and retain all operation/payment/job records. Do not drop tables or reapply the original ledger.
This feature does not deploy to production fighter Edge functions or require Twitch streaming.

## VM and PC MCP setup

Use Node 22.12+ with dependencies installed. Register a local stdio server in your agent's native
configuration format. Run `node` directly so npm status messages do not enter the protocol stream:

```json
{"mcpServers":{"paid-tasks":{
  "command":"node",
  "args":["/absolute/path/to/oddbout-starter/scripts/paid-operation-mcp.mjs"],
  "env":{"ODDBOUT_COMMERCE_ORIGIN":"https://your-sandbox-console.example"}
}}}
```

No service key or PayPal credential belongs in this configuration. Exact HTTPS origin is required;
loopback HTTP is allowed for development.

| Tool | Behavior |
| --- | --- |
| `connect_paid_operations` | Public pairing link/code/QR; call again after phone approval. |
| `get_paid_operation_catalog` | Configured hosts, fighters and server prices. |
| `prepare_paid_operation` | Save one task; return a human approval link/QR without spending. |
| `list_my_operations` | Paginated account tasks, with `cursor`, `limit`, `filter` and name `query`. |
| `get_paid_operation` | Read saved payment, job and result. |
| `resume_paid_operation` | Reconcile funding and queue approved work, or return its existing status/result. |

Pairing expires in 10 minutes; a grant expires 24 hours after creation. Revoke it under **Connected
agents**. Restarted MCP processes reconnect instead of loading secrets from disk. Only approve a
connection you initiated whose code matches. Device approval is not task/payment consent.

Prepare with a UUID `requestKey`, configured `hostId`, a `channelId` label, four `fighterIds` and ISO
`endsAt` within 24 hours. Leave at least 10 minutes for approval/rendering. Reuse exact input/key
after a lost reply. After a restart, list first: a new key means new work. Use the same ODDBOUT
Google account across devices; the PayPal buyer is a separate Sandbox account.

## Verification and rehearsal

Run `npm run paid:check` and `npm run typecheck`. Automated tests use real PGlite/PostgreSQL
transactions, services, payment adapter, routes and MCP, with fixtures at PayPal HTTP and auth
boundaries. Separate phone-sized/desktop browser contexts share no storage. Screenshots in
`output/paid-recovery-tests/` are **fixtures**, not real-payment evidence.

For actual multi-connection locking checks, set `ODDBOUT_TEST_POSTGRES_BIN` to an installed PostgreSQL
binary directory and run `node --test test/paid-postgres.test.mjs`. It creates and stops a disposable
loopback cluster under the ignored output directory, applies the same SQL and races separate backend
connections through claim, credit, resume and completion. This is a concurrency check, not a load/SLA certificate.

## Operating recovery

The HTTP service starts its recovery loop after listening and stops dispatching on shutdown. Every ten
seconds it processes up to three due records. A 120-second database lease can be reclaimed after a crash;
an old holder cannot overwrite its successor or a webhook-confirmed credit. Provider calls are bounded to
ten seconds. Transient failures retry after 15 seconds up to 15 minutes, then require review after eight
failures. Pending captures never credit a wallet. Unapproved checkouts are checked once per minute and
move to review after 24 hours. Funding confirmation alone never starts execution.

Run operator commands with the **dedicated Sandbox** environment loaded; keep keys out of shell arguments:

```sh
node scripts/paid-operation-admin.mjs status
node scripts/paid-operation-admin.mjs inspect <operation-id>
node scripts/paid-operation-admin.mjs retry-payment <operation-id> "Reason for review and retry"
node scripts/paid-operation-admin.mjs link-order <operation-id> <original-paypal-order-id> "Verified original order after response loss"
```

`status` reports pending/review counts, last check, oldest due time and unknown executions. Inspect the
timeline before retrying. `link-order` fetches the canonical Sandbox order and verifies its merchant,
intent reference, amount and currency before linking; it does not approve a payment. Never link a
replacement order or reset an operation/request key to clear an error. Both interventions append a note.
Unknown execution follows the existing renderer reconciliation procedure in [BROADCAST-SANDBOX](BROADCAST-SANDBOX.md);
payment retry cannot release or rerun an uncertain job. Refund/reversal events freeze spending.

The current ledger serializes short transactions through one database mutex. Do not advertise unlimited
throughput. Connection creation is capped per server/direct peer and across the DB's pending queue;
authenticated mutations are rate limited per account. Behind a shared proxy, peer limits are shared;
use a hosting edge limiter before exposing high-volume public traffic. Do not trust arbitrary forwarded IPs.
Recovery requires an awake service: a sleeping Free instance cannot promise background completion.
Do not change the hosting plan or claim continuous availability without selecting and verifying it.

Operational acceptance includes an always-on host, monitored pending/review queues, database backup/restore
drill, and a real three-device run. The local suites do not prove these conditions.

## Deployed acceptance run

Deployed physical-device rehearsal:

1. Pair the VM client, prepare one task, then terminate the **requesting agent**, leaving its renderer alive.
2. Phone: sign into the same account, approve the task and pay through PayPal Sandbox; close the return page.
3. Fresh PC client: pair, list tasks, resume the returned original operation ID without copying an order ID.
4. Observe actual renderer completion; recover again from another fresh client and compare the saved result.
5. Record operation/approval/order/capture/session/job IDs, one top-up ledger entry, one job, one charge,
   a completed session and zero reserved credits. Run existing PayPal reconciliation. Optional creator
   payouts retain their original human approval in Broadcast Studio.

Also test duplicate webhook/recovery calls, lost capture/enqueue replies, wrong-account access, expiry,
failure and unknown execution. Unknown work must return `needs_reconciliation`, not a replacement job.
Refunds/reversals block further spending. Never create replacement work merely to finish a demo.

Local tests do not certify a physical-phone run, actual Sandbox payment, Google OAuth configuration or
a deployed release. Record those separately; do not reuse earlier WP5 transactions as new evidence.

## Hackathon demo (2:40)

| Time | Show |
| --- | --- |
| 0:00–0:25 | VM prepares a paid task; show the approval link/QR. |
| 0:25–0:55 | Terminate that agent; phone approves task and Sandbox funding. |
| 0:55–1:30 | Fresh PC agent discovers and resumes the original task. |
| 1:30–2:10 | Actual rendered result; label any edited wait. |
| 2:10–2:40 | Repeat recovery; show the same result and one payment/job/charge. |

Opening: “Your agent disconnected after you paid. Your task should not disappear with it.”
PayPal processes payment; this application binds consent, funding and execution durably. Keep the
cup brief as a real workload. Submit pinned source, deployment instructions and measured evidence;
do not present fixtures as a completed live rehearsal.
