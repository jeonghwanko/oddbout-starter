# One ODDBOUT workflow, two execution environments

Use the current user's chosen PC or hosted Dots workspace. A cloud connector is registration access,
not a generator, filesystem, or proof that a hosted execution environment exists. Check the current
host's execution, durable file storage and preview/file delivery capabilities separately. If those are
missing, explain the specific blocker without promising a complete character or demanding a second plugin.
Direct supported appearance previews can precede kit setup under `docs/DELIVERY.md`.

## Locate the kit and preserve work

This Git-installed Codex plugin contains skills only, without launcher.mjs or a bundled runtime.
For account lookup and hosted creation, use the existing connected MCP; no kit is needed.
For explicitly requested workspace creation, prefer the user's existing creator-kit checkout
and workspace. Read its AGENTS.md, docs/CREATION-UX.md, docs/DOT-CREATION.md,
docs/AUTHORING.md, docs/EXECUTION-HOST.md, docs/DELIVERY.md and vendor/sprite-gen/SKILL.md
before generation. Inspect existing notes, selected versions, jobs and sessions first.
Never pull or update an in-progress checkout, switch providers or copy credentials.
If there is no checkout, obtain the creator kit from the public oddbout-starter repository
using its docs/START-HERE.md and reviewed installation procedure, only within the user's
chosen workspace-creation scope. A repository link alone does not authorize generation.
Do not install dependencies, assets, a Python venv or project state in this plugin cache.
Use the chosen checkout as the runtime and the user's existing project as the workspace.
A missing runtime is not permission to switch a Dots task to this PC.

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
job ledger and package validator as the old local plugin. Exit nonzero or `isError: true` is a failure;
do not continue as though the mutation succeeded. Do not echo credentials into input JSON.

Use these calls wherever the main skill names `list_creation_sessions`, `create_creation_session`,
`get_creation_session`, `update_creation_session`, `prepare_creation_job`, `get_creation_job`,
`cancel_creation_job`, `resolve_creation_job`, `validate_fighter_manifest`, or `validate_fighter_package`.
Preparing a job never executes it. Run its returned exact cwd/command/args/env through normal host tools.
Preserve actual previews, user review boundaries, provider choices and unknown-outcome recovery.

Call workspace `check_creation_readiness` before generation, after restart and before registration,
using only the account choice stated by the user. It checks kit and project state and reports registration
as requiring connector verification. Also use the connected ODDBOUT `check_creation_readiness` for its
account checks. Neither response verifies generation, file delivery, visual acceptance or registration.
Cloud registration never requires `npm run login` in the workspace.

## Cloud registration

Use the same connected ODDBOUT account from PC and Dots. Verify `get_profile` and use the native
prepare/upload/submit/status tools with actual package files. Reuse immutable retry keys and preserve
submission IDs. Account lookup does not verify generation-provider identity. If a cloud tool fails,
inspect the existing submission instead of attempting the old local upload route with a different login.
