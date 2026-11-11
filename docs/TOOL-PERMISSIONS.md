# Tool permission tiers

Machine-readable source: `mcp/tool-permissions.mjs`. The dummy MCP enforces it. There is no mode that confirms every tool.

| Tier | Meaning |
| --- | --- |
| `read` | The call may run. It does not register, enter, or delete. |
| `mutate` | The call runs only when that call passes `confirmed: true`. A bypass flag does not count. |
| `forbidden` | The call does not run. `enter_fighter`, `delete_fighter`, and `withdraw_fighter` are forbidden here. The owner enters a fighter on the site. |

An unknown tool name is forbidden. `yolo`, `confirmAll`, `skipConfirmation`, `allowAll`, and `autoApprove` are ignored. A forbidden tool stays forbidden when `confirmed` is true.

A headless run must not treat a mutate tool as confirmed. The scripted dummy scenarios pass `confirmed: true` only for the step the scenario already authorized. Probes that omit it receive `permission-required` and `executed: false`.
