# Tool permission tiers

Machine-readable source: `mcp/tool-permissions.mjs`. The dummy connector checks the tier before it runs a handler. There is no mode that confirms every tool. The workspace server keeps its existing schemas, so `check_creation_readiness` can still fast-forward when it is called. `preflight_creation` is the read-only summary: it forces remote fetch off and does not install, elicit, generate or register.

| Tier | Meaning |
| --- | --- |
| `read` | The dummy call may run. `get_hosted_fighter` is read. The connector forces `observe: true` and `waitSeconds: 0`, so that call does not advance a job. |
| `mutate` | The dummy call runs only when that call passes boolean `confirmed: true` and a `confirmationText` of at least 8 characters that is not only a bypass word. The text is echoed on that result as `confirmationTrail` and is not reused for a later call. `advance_hosted_fighter` is mutate. `check_creation_readiness` is classified mutate because it can fast-forward; the read-only stand-in is `preflight_creation`. |
| `forbidden` | The dummy call does not run. `enter_fighter`, `delete_fighter`, and `withdraw_fighter` are forbidden here. The owner enters a fighter on the site. |

An unknown tool name is forbidden. `yolo`, `confirmAll`, `skipConfirmation`, `allowAll`, and `autoApprove` are ignored. A forbidden tool stays forbidden when `confirmed` is true.

A headless run must not treat a mutate tool as confirmed. The scripted dummy scenarios pass `confirmed: true` only for the step the scenario already authorized. Probes that omit it receive `permission-required` and `executed: false`.
