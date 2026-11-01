# Install ODDBOUT in Codex

This is a local custom plugin distributed through this public Git repository, not an
OpenAI directory listing or a Dots cloud App. It adds the `create-fighter` skill and
reuses your existing ODDBOUT MCP connection. No public-directory approval is needed.
Installation does not log in, generate a fighter, or install the generation engine.

## Install from the repository

With Git and a current Codex CLI installed, run in a terminal:

```sh
codex plugin marketplace add https://github.com/jeonghwanko/oddbout-starter --ref main --sparse .agents/plugins --sparse plugins/oddbout-codex
codex plugin add oddbout@oddbout
```

Open the desktop app's **Plugins** page, clear the search, then search for **ODDBOUT**.
If the app still shows its earlier list, restart it after saving ongoing work.
Start a new chat to load the installed `create-fighter` skill.
`codex plugin list --json` also reports the installed package as `oddbout@oddbout`.

## Connect once, without duplicate servers

This package intentionally has no `mcp.json`, `.mcp.json` or cloud App binding.
Adding a bundled MCP alongside an existing server can create two connections, so the
skill and the account connection are configured separately.

Inspect **Settings → MCP servers**, or run `codex mcp list`.
If any existing server uses `https://mcp.oddbout.com/mcp`, reuse its name and settings.
Do not add another server, remove it, or log out just to install this plugin.
Only if that endpoint is absent, add it once:

```sh
codex mcp add oddbout-mcp --url https://mcp.oddbout.com/mcp
```

When ready to sign in (use the existing server's name if different):

```sh
codex mcp login oddbout-mcp
```

Complete Google sign-in and ODDBOUT consent in your browser. Do not paste callback
URLs, codes or tokens into chat. For a recording, leave this step until recording starts.
Installing the skill does not change stored OAuth credentials.

After login, ask in the intended Codex chat:

> Use the ODDBOUT create-fighter skill to check my connected account. Show only my nickname and connection status. Do not create a fighter.

Verify an actual `get_profile` response separately from skill installation. A tool listing,
plugin card or login success alone is not account verification. This does not verify Dots:
Dots needs its own supported cloud App connection and skill in that conversation.

## Updates and local development

```sh
codex plugin marketplace upgrade oddbout
codex plugin add oddbout@oddbout
```

Restart the app if needed and use a new chat. Preserve active creator workspaces and
selected assets; updating the skill does not update a generation runtime.

To test an unmerged branch, replace `--ref main` with its exact branch name. To use a
local checkout instead of Git, register its absolute root with
`codex plugin marketplace add /absolute/path/to/oddbout-starter`, then use the same
`codex plugin add oddbout@oddbout` command. Keep that checkout in place. Do not register
both sources under the same marketplace name; inspect `codex plugin marketplace list` first.

The lightweight package lives in `plugins/oddbout-codex`. Its creation workflow and icon
are copied from `plugins/ai-fighter` by `node scripts/sync-codex-plugin.mjs`; its workspace
adapter uses a separate user-owned creator kit, without a bundled launcher. After changing
the canonical skill, run that command and commit the generated files. Bump the local
plugin version for published changes. CI checks synchronization and the absence of MCP
declarations, App bindings, hooks, credentials and machine-specific runtime pointers.

This Git install route is independent of the optional full creator-kit ZIP and the private
ChatGPT/Dots plugin. Neither a private plugin link nor a Codex Cloud environment is the
installation source for this local package.
