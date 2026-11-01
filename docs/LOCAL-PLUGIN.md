# ODDBOUT plugin and workspace tools

For the Git-installable Codex skill that reuses an existing MCP without adding a server, follow [CODEX-PLUGIN.md](CODEX-PLUGIN.md). The full developer kit below is a separate optional workflow.

**Reuse the existing available ODDBOUT cloud App in ChatGPT/Dots.** Select it in the intended chat and verify native `get_profile`.
Find `create-fighter` in the host's actual skill list and read that same App's skill or linked support document; metadata alone does not verify skill access.
This does not establish public availability; private App links are not public distribution links.
The separately reviewed creator-kit provides optional local tooling and an `mcp.json` client for the hosted MCP;
its build or ZIP does not establish cloud App installation or connection. Follow
[ODDBOUT-PLUGIN.md](ODDBOUT-PLUGIN.md) for installation and migration. Registration uses the existing
connected ODDBOUT account only after native `get_profile` verifies the intended account in the current conversation.
Local filesystem and workspace tools run through the `creation:tool` CLI; cloud account operations use the hosted MCP
only when its tools are actually exposed in that conversation.

For the source ZIP and distribution boundaries, see [ODDBOUT-PLUGIN.md](ODDBOUT-PLUGIN.md).

This version packages the creation skill, desktop `mcp.json` client configuration and workspace command tools. It retains persistent projects,
immutable version snapshots, group gates, and a managed CLI job ledger. Generation, gait inspection
and packaging continue to use the pinned sprite-gen and existing fighter tools. Credentials are not
included in the plugin; each creator uses their own accounts.

The kit source's `mcp.json` runs the hosted HTTPS endpoint from an imported desktop plugin. It does not create or connect a cloud app in Dots.
The official [plugin management guidance](https://learn.chatgpt.com/docs/enterprise/plugin-management#desktop-only-plugins) says imported plugins
declaring remote HTTPS MCP may be desktop-only; an `.app.json` reference alone does not change that. Check the existing App and its skill first.
Only if the skill is actually missing may a maintainer add it through supported Plugin Creator functionality, preserving the same App's identity and OAuth settings.
Custom MCP OAuth provisioning is for first-time setup or maintainer repair when no existing App is available, not routine repeat setup.
Do not create a second wrapper plugin. Server deployment, ZIP release,
plugin import/update, selection in a conversation, tool exposure and account verification are separate steps. Preserve existing OAuth connections and sessions
during migration. The legacy stdio server remains for older clients, but its full-session handoff across the permission boundary is not part of this route.
Missing tools, an empty listing, 404 or `not-found` is inconclusive; do not switch to local CLI login for cloud registration.

## Optional local development installation on this computer

These steps are for an explicitly chosen local checkout workflow. Cloud account lookup and hosted creation do not require this installation.
Verify the existing App's skill before considering local installation; do not add this local package merely to reconnect the App.

From a checkout with Node 22.12+ and `npm ci --ignore-scripts` completed:

```sh
npm run plugin:build
codex plugin marketplace add /absolute/path/printed/as/marketplace
codex plugin add oddbout@ai-fighter-local
```

The builder prints the paths and exact marketplace arguments. On Windows, quote the printed path in
PowerShell. The last command installs the plugin; alternatively install it from **ODDBOUT** in
the desktop Plugins Directory only if an ODDBOUT listing is actually visible and verified there. A local build or ZIP
does not create a public listing. Open a new chat after local installation. Restart the desktop app if it has not appeared. Invoke
`$create-fighter`, or describe the fighter you want to make.

The generated marketplace is under `output/ai-fighter-marketplace/`. It contains `plugin.json`, the
hosted ODDBOUT MCP (`mcp.json`, Google sign-in), the skill and a local marketplace catalog. `kit-location.json` points to
**this user's existing checkout and workspace**. Keep the checkout in place. Rebuild on each computer; do not
publish the generated directory as a standalone distributable. The builder does not change host settings.

For updates, build into a fresh directory (`npm run plugin:build -- output/ai-fighter-marketplace-v2`),
register that source and refresh/reinstall the plugin. Existing build output is never overwritten.
After changing a plugin, open a new chat for its updated skill. Use the workspace CLI for local creation and
the connected ODDBOUT MCP for cloud operations. Find the needed cloud tools through the host's tool discovery/catalog, then
verify native `get_profile` in the intended conversation (Codex or Dots) matches the intended registration account. Generation uses
the user's own explicitly chosen generation account. Before removing any existing MCP/plugin connection, require
the user's explicit request and successful same-account `get_profile` through the replacement in that same conversation.
An empty listing, 404 or `not-found` does not establish that an old entry was deleted or replaced. `creation:tool list`
and fixture validation check local CLI discovery and fixture format only; they do not verify cloud registration.
Preserve current OAuth state, sessions and project data. Locks protect local writers across connections.

Generation runtime setup is separate: `npm run sprite:setup` needs Python 3.11+ and installs the pinned
source in its venv. `npm run sprite:status` reports installation, not login or quota. Public plugin
publication and a host without execution/file delivery are outside this local package. Actual generated
media must be shown in the current conversation; a dedicated comparison UI is not included.

## Project tools and evidence

A configured `AI_FIGHTER_ROOT` enables these local tools:

| Tool | Purpose |
| --- | --- |
| `list_creation_sessions` | Find projects to resume |
| `create_creation_session` | Create a project with current game context; no generation |
| `get_creation_session` | Read preserved versions, selections and remaining group blockers |
| `update_creation_session` | Record a version, review, user choice, edit or transition |
| `prepare_creation_job` | Reserve a command and return local execution arguments |
| `get_creation_job` | Read one job or list jobs; never execute or retry |
| `cancel_creation_job` | Discard an unstarted reservation |
| `resolve_creation_job` | Record evidence resolving an unknown outcome |
| `inspect_fighter_packaging` | Measure/encode existing game-pack inputs without writing; return layout blockers and supported fits |
| `pack_fighter_package` | Build a new artifact package with all required file checks; never generate or register |

For packaging recovery in Dots, first call the cloud MCP's `prepare_fighter_packaging`. It checks the deployed
contract and returns structured invocations for these two workspace MCP tools. The cloud server cannot open a VM
path: the agent runs the returned `creation:tool` invocation through the host's execution tool, using the supplied
JSON arguments file. This is an agent task, not a request for the user to relay errors or patch the kit manually.
The kit and existing workspace may be separate directories; install locked Node dependencies in the reviewed kit.

Both tools take workspace-relative `planPath` and optional `outputPath`; output must be a new
`output/<session>-work/artifacts/<name>` directory. `fitSheets: true` permits bounded resampling after normalizing
body size, keeping every original frame identity, playback order, timing and contact step. It writes the contract's
`pixelScale` so game size stays consistent. Use it only when the user permits resolution optimization and the live
server advertises `texture-resolution-1`. Default false preserves resolution. Neither mode overwrites original
assets, selected versions or an existing package; quality diagnostics stay deferred. Inspect output after a timeout.
An inspection result is not full file validation; a successful build is not server registration.

State lives at `output/<sessionId>-work/creation-session.json`; IDs are lowercase slugs. Each update
supplies `expectedRevision`. On conflict, read again and reconcile the actual feedback. An exclusive
file lock also serializes jobs and state across processes. Atomic replacement preserves complete JSON.

`version` copies files into `versions/<item>/<version>/` and measures their bytes and SHA-256. Editing
the source cannot destroy the selected copy. Version IDs are never reused. `select` accepts the current
version; `restore` selects a preserved earlier version at the user's request. `revision` records affected
items while preserving earlier selections. Versions record the earlier groups they depend on; changing
appearance invalidates dependent motion reviews without deleting their art.

`review` binds evidence hashes and the game context revision. Reviews are **agent-reported observations**,
not automatic visual certification or user permission. Changed saved files/evidence or a changed basis
make effective checks unverified. `advance` uses the existing game-owned group checks. `delegate` records
only the groups the user explicitly delegated. Dialogue-only sessions cannot run jobs or store production
approvals. Do not infer the user's intent from a test example.

Example `update_creation_session` arguments:

```json
{
  "sessionId": "my-fighter",
  "expectedRevision": 1,
  "change": {
    "type": "version", "item": "idle", "version": "v1",
    "files": ["output/my-fighter-work/artifacts/idle/v1/base.png"],
    "note": "Actual generated base; appearance feedback pending"
  }
}
```

`profile` records the chosen name and description. `package` needs exactly one `fighter.json`, runs
full-file validation, checks that profile, and fingerprints every manifest asset automatically.
Record `package-review` separately with actual preview feedback and evidence. A metadata edit invalidates
the package binding while preserving animation selections. Validate the new package bytes without
repeating approval of unchanged animations. Final session review never grants registration authorization.

## Managed execution

`prepare_creation_job` does not launch anything. Run its returned command, args, cwd and environment
through the host's ordinary terminal permission flow. With the default workspace:

```sh
npm run creation:run -- my-fighter <job-uuid>
```

The runner uses the explicit Node executable, existing sprite/pack scripts and `shell: false`. It is not
a background service: keep the terminal job alive and poll it normally. Upstream stdout/stderr stay in
that terminal; reports stay where the engine writes them. Declare useful report files in the plan.

| Plan field | Meaning |
| --- | --- |
| `engine` | `sprite` or `fighter-pack` |
| `args` | Exact existing CLI arguments, including the sprite command |
| `groupId` | Current review group |
| `targets` | `{item, version}` entries for affected motions in that group |
| `inputs` | Existing workspace-relative input files, including nested recipe assets |
| `outputs` | New files under `output/<sessionId>-work/artifacts/` |
| `workflowArgs` | Fresh upstream workflow preflight required for generation |

The initial sprite command allowlist is in `mcp/creation-jobs.mjs`. Other utilities remain available
through their existing CLI, without managed-job guarantees. The runner does not rewrite recipes, parse
every nested engine-specific path, or provide OS sandboxing. Use trusted local recipes and project paths;
host execution permissions still apply. Managed record paths and output flags reject traversal, symbolic
link parents, Windows device paths and alternate streams. Never put credentials in arguments or notes.

Preserve the user's exact provider/access choices and run the preflight before generation. The job UUID
is an idempotency key for **one local execution**, separate from provider IDs and server submission keys.

| Status | Meaning |
| --- | --- |
| `prepared` | Reserved, not executed; may be cancelled |
| `running` | Attempt recorded before launch; inspect before further action |
| `succeeded` | Exit 0 and declared outputs fingerprinted; visual quality unverified |
| `needs-input` | Preflight did not pass or upstream returned 75 |
| `failed` | Launch known not to start, a non-generation utility failed, or a generation's own report shows no provider request left (exit 3) or the request left and failed for a reason it names |
| `unknown` | A generation whose request may have been billed with no result: no report from this run, an `outcome-unknown` error, a run stopped after its request left, a video request xAI took, a lost result or missing declared outputs |
| `resolved` | Evidence about an unknown outcome recorded; no rerun |
| `cancelled` | Unstarted reservation cancelled |

A generation job that does not succeed carries `outcome`: the engine's own report
(vendor/sprite-gen `docs/gen.md` "Outcome": `--report`, or the set report of `gen-set` / `video-set`) read
only when this run wrote it. `charge` is `not-charged` (exit 3, or the report says no provider request left),
`request-sent` (one left: it may have been billed) or `unknown` (no report). `next` is `retry` (every error
says the same command may succeed), `fix` (it would fail the same way again), `inspect`, `resume` (a video
request xAI took: ask for it with `video-resume --request-id`, never generate it again) or `answer` (the codex
question). A stopped job is judged the same way: sprite-gen writes its report on SIGTERM before it exits, and
the kit's wrapper waits for it. `retryable` alone never reruns a job whose report says `outcome-unknown` or
names a video request; nothing reruns a job automatically.

Identical preparation retries return the same job. Changed args under the same ID are rejected. An
attempted ID never executes again. A new ID targeting prepared/running/unknown work is blocked. A missing
runner is observed as unknown; a reused PID may conservatively keep it looking running, never success.

Inspect provider request records, original reports and outputs before resolving an unknown result,
even when no request ID exists. `recovered`, `not-started` and `duplicate-risk-accepted` require evidence.
The last requires an explicit user choice accepting possible duplicate usage; a generic continuation
does not suffice. Resolution is labeled agent-reported and never validates the evidence's meaning or
reruns a job. Inspect and record recovered output instead of generating again. To revise an unstarted
plan after a session/input change, cancel it and reserve a new ID.

Calls on one session queue for `creation.lock`; another process's writer is waited for up to 10 seconds,
then mutations report `session-busy-or-interrupted-lock` (retry later). The holder refreshes the lock while it
works, so a lock left by a killed process goes stale after 60 seconds and the next call reclaims it; do not
delete lock files by hand. Never erase the session, jobs or claim markers, or infer a failed generation from an
interrupted lock.

## Verification

```sh
node --test test/creator-plugin.test.mjs test/creation-context.test.mjs test/mcp.test.mjs
```

Tests cover real MCP startup from the built plugin, preserved selections, dependency freshness, group
gates, concurrent edits, idempotent execution, unknown outcomes, preflight, path safety and existing
validation/registration behavior. Generation calls are stubbed and labeled as such. Tests do not use
generation accounts, register fighters, or run CI.

Packaging follows the official [plugin format](https://developers.openai.com/plugins/build/plugins)
and [local MCP launch format](https://developers.openai.com/plugins/deploy/desktop-only).
