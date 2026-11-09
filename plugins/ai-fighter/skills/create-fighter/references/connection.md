# Connection-only checks and missing tools

Part of the `create-fighter` skill ([SKILL.md](../SKILL.md)); its rules apply here too.

A connection/status request does not authorize starting or resuming creation. Inspect this conversation's actual
ODDBOUT tools, call native `get_profile` when available, and use `get_my_fighters` view `readiness` with `purpose: connection`
(the cloud tool named `check_creation_readiness` until 2026-11-06; that name still answers).
Keep server discovery, account plugin import/update, installation and selection in this conversation, tool exposure,
and the returned account identity separate. A released ZIP, local Codex connection or successful public MCP tool listing
does not establish any Dots-native account connection.

In ChatGPT/Dots, reuse the existing available ODDBOUT cloud App with its account tools and creation skill.
Read the skill and support document from that same App through the host's skill tools; do not substitute an old ZIP package's skill.
An imported plugin's root `mcp.json`, even with an HTTPS server, may be desktop-only. The creator-kit ZIP is optional
reviewed source/runtime delivery for an explicitly chosen workspace, not the cloud App connection or a second required plugin.
Only when no existing App is available should supported first-time cloud MCP OAuth provisioning be considered.
Only an actually missing skill calls for a maintainer to add it through Plugin Creator to the same app-backed plugin,
preserving its binding and presentation. Do not copy the kit's root MCP declaration into that app-backed plugin.
After an explicitly requested old-plugin removal, verify the installed list, all host skill-list pages, and native account
lookup in the same conversation. Uninstall and permanent deletion of an owned plugin are different actions; do not turn
a `not_installed` response into permission for permanent deletion. Preserve existing work and use the verified App package.

If `get_profile` is absent, report tool exposure as unverified; do not start local login, device pairing or generation
to replace the missing cloud connection. Resolve the current plugin through the host's supported discovery and settings.
Use only a returned current plugin URL/ID, never a historical private link or an invented replacement. A missing ID or
empty search does not prove deletion, replacement or a server outage. Prefer refreshing/selecting an existing verified
plugin. Preserve OAuth grants, workspaces, pending requests and jobs. Remove an old connection only within an explicit
user request after the replacement succeeds in this same conversation and its account matches the intended account.
If a native call returns an authentication error, follow that error's supported connection action; missing tools alone
are not evidence that the token expired.

