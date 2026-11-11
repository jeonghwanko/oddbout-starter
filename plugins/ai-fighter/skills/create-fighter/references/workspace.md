# One ODDBOUT workflow, two execution environments

Read this page when the work is in a PC or Dots workspace. Hosted creation and a connection check do not start here and do not install this kit. The skill body's hard rules win if this page disagrees. Lifetimes of the skill, the kit and the project: `docs/LIFECYCLE.md`.

Use the current user's chosen PC or hosted Dots workspace. A cloud connector is registration access,
not a generator, filesystem, or proof that a hosted execution environment exists. Check the current
host's execution, durable file storage and preview/file delivery capabilities separately. If those are
missing, explain the specific blocker without promising a complete character or demanding a second plugin.
Direct supported appearance previews can precede kit setup under `docs/DELIVERY.md`.

## Locate the kit and preserve work

Prefer an existing kit/workspace for a project already in progress. Read its notes, versions and jobs
before creating anything. Never pull/update an in-progress checkout, copy another user's credentials,
or switch providers. Existing `~/.ai-fighter/creator/workspace/` and `AI_FIGHTER_ROOT` are retained.
An older kit without `scripts/creation-tool.mjs` can continue with its existing MCP tools; do not update
it mid-character. Use connected ODDBOUT for registration and keep workspace login advice separate.

For a fresh bundled installation, resolve this skill's plugin root and run `node <plugin-root>/launcher.mjs --status`.
It verifies source and any installed runtime, reports `runtime` and `root` (workspace), and writes nothing.
Installation is explicit: `node <plugin-root>/launcher.mjs --install --manifest-sha256 <reviewed-runtime-manifest-sha256>`.
Obtain that hash from the independently reviewed build/release, not a caller's readiness claim. Only this
command copies source to a writable user directory; it does not install dependencies, log in or generate.
Read `docs/DOTS-QUICKSTART.md` and use the returned runtime's offline doctor and resume inventory before
`bootstrap --install`. Bundle doctor/bootstrap also require that manifest hash. Never install dependencies or a venv in
the plugin cache. A local developer build reports the existing checkout/workspace instead of copying it.
The source bundle is portable source, not a promise that every host has been tested.
An older bundle has its own launcher contract; never update an active project just to obtain these commands.
Dots generation requiring protected session output is blocked before dispatch. No version string or login
proves an official image bridge; use an actually supported host route or report the blocker.

In the returned runtime, use Node 22.12+ and run `npm ci --ignore-scripts` if dependencies are missing.
When generation in this workspace is the agreed route, and only then, read `AGENTS.md`, `docs/DOT-CREATION.md`, `docs/AUTHORING.md`, `docs/EXECUTION-HOST.md`,
`docs/DELIVERY.md` and `vendor/sprite-gen/SKILL.md`. Run `npm run creation:preflight -- --purpose generation` before that setup, and run sprite setup only when the preflight names it and the user is generating here. A kit older than 0.6.21 has no preflight: use workspace `check_creation_readiness` there.
If the host cannot expose the bundled files, preserve the task and report that limitation. Do not claim
another chat's files or an arbitrary PC path exist in this workspace.

## Call the workspace tools

For a new GPT workspace connection, read `docs/ENVIRONMENT-ONBOARDING.md`. Use
`get_creation_environment`, `update_creation_environment` and `prepare_generation_login`
through the workspace CLI below. Preserve saved account choices; record only actual user capability
statements. Network approval is not host application, and bootstrap HEAD responses are not image access.
Use the host's supported permission UI and record its real result. The current adapter cannot change
Dots firewall rules. Run the prepared official device login only within the user's connection request;
show only its public verification link/code. Never paste callbacks, infer a successful generation, or
switch to an API key. Direct conversation appearance routes still take precedence under DELIVERY.md.


Set cwd to the returned runtime and substitute the absolute workspace path:

```sh
npm run creation:tool -- list "<workspace>"
npm run creation:tool -- call "<workspace>" list_creation_sessions
npm run creation:tool -- call "<workspace>" get_fighter_spec "<arguments.json>"
```

Write arguments as an ordinary JSON file with a file tool, e.g. `{"section":"creation"}`. Read the
`list` result for actual tool schemas. Calls use the same MCP validation, store locks, version checks,
job ledger and package validator as the old local plugin. Read a result's data in `structuredContent`:
a large result's text only lists its fields. Exit nonzero or `isError: true` is a failure;
do not continue as though the mutation succeeded. Do not echo credentials into input JSON.

Use these calls wherever the main skill names `list_creation_sessions`, `create_creation_session`,
`get_creation_session`, `update_creation_session`, `prepare_creation_job`, `get_creation_job`,
`cancel_creation_job`, `resolve_creation_job`, `validate_fighter_manifest`, or `validate_fighter_package`.
Preparing a job never executes it. Run its returned exact cwd/command/args/env through normal host tools.
Preserve actual previews, user review boundaries, provider choices and unknown-outcome recovery.

Call workspace `check_creation_readiness` before generation, after restart and before registration,
using only the account choice stated by the user. It checks kit and project state and reports registration
as requiring connector verification. Also use the connected ODDBOUT `get_my_fighters` view `readiness` for its
account checks. Neither response verifies generation, file delivery, visual acceptance or registration.
Cloud registration never requires `npm run login` in the workspace.

## Cloud registration

Use the same connected ODDBOUT account from PC and Dots. Verify `get_profile` and use the native
prepare/upload/submit/status tools with actual package files. Reuse immutable retry keys and preserve
submission IDs. Account lookup does not verify generation-provider identity. If a cloud tool fails,
inspect the existing submission instead of attempting the old local upload route with a different login.
