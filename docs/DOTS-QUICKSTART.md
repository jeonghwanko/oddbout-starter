# Dots: prepare once, resume the same fighter

This guide is for an explicitly selected saved-VM generation workflow. Cloud account connection and hosted creation
do not require VM setup. Reuse the existing available ODDBOUT App and verify native `get_profile` in the intended chat;
connection readiness uses `purpose: "connection"` and never authorizes generation.
Find `create-fighter` in the host's actual skill list and read that same App's skill or linked support document;
metadata alone does not verify skill access. Do not install a separate skill or wrapper to reconnect it.
Its private link is not a public distribution link. A separately reviewed creator-kit and its runtime installation remain distinct from App connection.

A Git URL identifies software. It does not grant generation, registration, account access or network access.
An explicit request to make a fighter authorizes the normal preparation and requested creation steps;
do not ask again for every command. Keep the agreed review groups, provider, billing and retry boundaries.

## Choose the right environment and source

Use a per-user **saved Codex cloud environment** for this repository, with Node 22.12+, Git,
Python 3.11+ and venv, ffmpeg and ffprobe. Start from `main`, then record the exact
commit. The ordinary main checkout inspected on 2026-10-27 was kit 0.2.0; service commit
`5cddc786bc7ca4d41a06c1e2ed10a0160b081a44` was 0.5.4. A delivered 0.5.2 plugin and the preserved
0.4.0 validation runtime are separate artifacts. Read their manifests; never rename a version to imply an upgrade.
These new commands require the Dots runtime contract in this change. They do not retrofit an older kit.
The implementation is local until merged/published; the base service commit alone does not contain
these commands. Select a reviewed revision carrying them before following the commands below.

Creator-kit 0.6.5 includes the game-context fetch fix: it uses the host's inherited HTTP(S) proxy,
`NO_PROXY` and CA settings. It does not grant network permission or change an existing task.
A new workspace from `node dots.mjs --install` gets the commit pinned in `deploy/dots-release.json`,
so it has this fix only when that pin names 0.6.5 or later.
For DNS or pre-HTTP connection failures, follow [the context network guide](GAME-CREATION-CONTEXT.md#network-errors-and-existing-workspaces).
Keep account login, per-command network approval and successful generation distinct. A default-sandbox
`EPERM` does not invalidate a prior successful approved job. If supported official tools can fetch and
deliver the public context, use the [explicit file handoff](GAME-CREATION-CONTEXT.md#explicit-public-context-file-handoff);
it keeps freshness, integrity and review checks and does not transport Grok requests.
Keep an active fighter on its recorded runtime; do not pull, replace it or rerun generation to test a release.
Retain sessions, jobs, selected versions and original outputs. Review the new kit separately for a new environment
or an update after the current creation work finishes.

In the official saved environment setup, install common tools and locked dependencies, review the report,
then Publish. Set [DOTS-START.md](DOTS-START.md) as the Start skill/instructions. Republish updates the
prepared filesystem for **new tasks**; existing tasks keep their own files and installed tools. Continue a
fighter in its original task. Save its output separately through a supported private artifact route;
temporary files and dependency caches are not a durability guarantee.

The default Dot/Work cloud and a saved Codex coding VM have different capability and network settings.
Neither another task's `/workspace` path nor a browser/connector login grants access in this VM. Do not
assume a browser exists in the coding VM. Where supported, the user approves official device login in
their own browser outside it. A direct appearance image tool in the parent conversation is another route;
verify its actual original file handoff before the VM uses that image.

Official references (checked 2026-10-27): [cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments),
[Dots tasks](https://learn.chatgpt.com/docs/dots/tasks-and-memory), [authentication](https://learn.chatgpt.com/docs/auth).

## Source checkout

For a **new** workspace only, after the host has allowed the required installation destinations:

```sh
git clone --branch main --single-branch https://github.com/jeonghwanko/oddbout-starter.git /workspace/oddbout-kit
cd /workspace/oddbout-kit
git checkout --detach <reviewed-commit-containing-the-Dots-bootstrap>
node scripts/dots-workspace.mjs doctor --workspace /workspace/my-fighter
node scripts/dots-workspace.mjs bootstrap --workspace /workspace/my-fighter --install
```

The bootstrap never fetches/merges the kit or changes its vendor pin. The existing sprite setup obtains
the gitlink's source and installs it. Source edits, a mismatched installed vendor pin, existing sessions
or incomplete recovery records block installation. Inspect them; do not reset, stash, delete locks or
start a new project to hide the problem. Preserve the commit and runtime throughout creation.

`bootstrap` without `--install` only inspects. `--install` runs `npm ci --ignore-scripts --no-audit --no-fund`
and `node scripts/sprite-gen.mjs setup --skip-rife` when needed, using the package lock, recorded source identity and a local
install receipt. Missing dependency packages or a broken Python import trigger repair on a later explicit
install. Failures do not retry. An uncertain timeout keeps the bootstrap lock for investigation.
Python dependencies currently have upstream version ranges; this is not a fully hash-locked Python wheelhouse.

ffmpeg/ffprobe belong in the prepared environment image; bootstrap never uses sudo. img2webp must support
`-exact`; sprite setup can install the pinned binary. This bootstrap skips RIFE probes and downloads;
RIFE remains optional and is never a generation gate.
Installation success is separate from tool, auth, generation and delivery readiness.

### Node child-process output on managed hosts

Some Dots hosts deny the socket metadata calls Node uses to classify inherited
stdout/stderr. A child can then exit normally while its `console.log` output is
empty. An empty result is not valid JSON, a completed installation, or a generation
failure. Preserve the original command and records before considering another run.

The front-door `dots.mjs` writes its JSON to the inherited file descriptors
directly, preserving UTF-8 bytes, partial writes, stderr and failure exit codes.
This change does not replace process-global streams, relax host policy, or update
the runtime bound to an existing workspace. Other Node programs that rely on
socket-backed streams are outside this fix.

For relevant repository tests in an affected prepared VM, Node 22.22.2 supports
`node --test --experimental-test-isolation=none test/cli-fd-output.test.mjs test/dots-start.test.mjs`.
This avoids the test runner's extra file-level subprocess transport; the tests
still execute their real CLI children and assertions. Keep ordinary CI invocation
unchanged. Inspect actual test counts and exit status; never convert empty output
or a failed test into a pass.

## Verified immutable bundle

Use a reviewed release's immutable URL and **independently reviewed** helper/manifest hashes with
`fetch-creator-kit.py` as documented in [ENVIRONMENT-ONBOARDING.md](ENVIRONMENT-ONBOARDING.md).
Do not derive trust just by downloading a checksum beside an unreviewed ZIP. Record the archive hash,
release version and the bundled `runtime-manifest.json` SHA256 from the reviewed build. No `latest` alias.

For a bundle that contains this new launcher contract:

```sh
node /absolute/plugin/launcher.mjs --status
node /absolute/plugin/launcher.mjs --install --manifest-sha256 <reviewed-runtime-manifest-sha256>
```

`--status` verifies files and reports planned `runtime` and `root` paths **without writing anything**.
Only `--install` copies source. It requires the reviewed hash and retains provenance in the writable
runtime. Run the following from the **returned runtime**, using its returned absolute root:

```sh
node scripts/dots-workspace.mjs doctor --workspace <returned-root> --manifest-sha256 <reviewed-runtime-manifest-sha256>
node scripts/dots-workspace.mjs bootstrap --workspace <returned-root> --manifest-sha256 <reviewed-runtime-manifest-sha256> --install
```

A raw Git checkout is not a bundle; it has no built runtime manifest. Do not run its launcher as a
substitute for source bootstrap. Do not install a venv or node_modules in a plugin cache. Old launchers
may give `--status` different semantics: consult that artifact's own docs and do not update an active fighter.

## Doctor scopes and account boundaries

Default doctor uses local source/manifest metadata, read-only local Git commands, filesystem permission
checks and binary discovery. It does not create the workspace/cache, execute a CLI, read auth/session files,
install, log in, generate, register or use a network. Exit 0 means inspected without listed blockers;
exit 1 means action required; exit 2 means invalid input or inspection failure. Generation remains unverified.

Explicit options:

| Option | Additional scope |
| --- | --- |
| `--check-cli` | bounded version/help commands; checks img2webp `-exact` and Python version |
| `--check-auth --provider codex` | official `codex login status` only; raw output stays in memory |
| `--check-network` | public bootstrap HEAD requests only, no credentials or redirects; preserves host proxy/CA through runtimeFetch |
| `--evidence output/receipt.json` | checks a workspace-local evidence record and actual artifact bytes; never trusts `ready`, `supportsImages` or `displayed` |
| `--report output/new-report.json` | explicit new report write; never overwrites an existing report |

Doctor never certifies image access, decode, parent display or registration from login, tool names,
version strings, a marker or an agent-written receipt. Authentication may be signed-in while the image
bridge is blocked. Unknown/expired evidence remains unknown/stale. No API-key/provider/model fallback.
Grok has no official status adapter in this doctor, so it remains unknown rather than attempting a login.

The previously inspected vendor pin `38bddef764183fe2044bc85c764b0572409a6b15` reads and normally deletes
Codex rollout files. The service pin `0dc264ba257c0d417f86ef797bc503f933e1e142` was unavailable locally
during this change; its implementation remains unverified. Doctor inspects only provider source, never
session contents. Commands that actually select Codex image output are blocked **before workflow probes or dispatch**.
Explicit Grok `gen`/`gen-set`, Grok `video` and existing-request `video-resume` retain their own provider checks
without inspecting Codex source. `video-set` is Grok; only front/back walk with `--walk-start redraw` (the default)
also uses an image provider. Its explicit `--still-provider`, then `SPRITE_GEN_DEFAULT_PROVIDER`, selects that
redraw route. Side-facing vision is Grok. `--walk-start as-given` performs no redraw. Do not alter these choices
to bypass a blocker. Missing image provider selection gives a specific error rather than invoking a fallback.
CLI provider names remain `codex`/`grok`, not account labels such as GPT. `--provider=grok` is also accepted;
duplicate/abbreviated route flags are rejected. Managed Grok `gen-set` uses matching image/Grok workflow
preflight; the existing Codex sprite/`gpt-rows` preflight remains required for Codex rows.
Doctor reports only the selected provider: Grok capability remains unverified without imposing a Codex gate.
Even Codex source without the protected-session signature remains unverified
until an audited official host-file adapter exists. This change does not modify vendor code or invent that
adapter. Do not relocate CODEX_HOME, read protected sessions or enable an unrestricted sandbox to work around it.
Official `exec --json` events and `--output-last-message` are supported output mechanisms, but a final
message is not image bytes. A future adapter must bind actual tool completion to a supported original file.

`AI_FIGHTER_EXECUTION_HOST=dots`, the new bootstrap runtime marker, or a workspace environment record
with `host: dots` activates this provider-specific boundary. These are application guards, not an OS sandbox. Use the host's
security policy as well; do not bypass the wrapper by running vendor commands directly.

ODDBOUT's connected cloud tools own registration auth. Verify that account with `get_profile` and cloud
readiness; do not run local login or copy a connector session for that route. Provider device login is
separate, uses only the user's own account, and is performed only within an account-connection request.

## Network destinations: allow only the selected route

All entries below use HTTPS 443. Keep existing restrictions, proxy and CA settings. A public response,
even HTTP 403, is not proof of permission, entitlement or complete CDN coverage.

| Role | Destination | When needed |
| --- | --- | --- |
| Git and submodule | github.com | fresh Git installation |
| npm, optional Codex npm installation | registry.npmjs.org | uncached packages |
| Python | pypi.org, files.pythonhosted.org | uncached PyPI packages |
| immutable kit | oddbout.com | the reviewed release-download route |
| img2webp | storage.googleapis.com | pinned binary missing |
| optional RIFE | github.com, release-assets.githubusercontent.com | selected release download; verify the actual redirect host |
| other source/release assets | raw.githubusercontent.com, objects.githubusercontent.com | only if the chosen operation actually needs them |
| GPT bootstrap | auth.openai.com, chatgpt.com | selected GPT login/request route |
| Grok request | api.x.ai | preserved provider source; login and artifact hosts still need verification |
| ODDBOUT | oddbout.com, ztfxxhtmtrvxvuxlqmgz.supabase.co | homepage/context or direct VM API route |
| original image/video and Library bridge | exact officially returned/documented host | unknown until observed; no guessed CDN or wildcard |

The Package managers preset may already contain some installation hosts. Add only missing destinations
required for the selected route, publish/republish through the official environment UI, then verify in a
new task. The kit cannot perform that UI operation. Hosted apps/web search and VM commands have separate
network boundaries. Library `tools/list network` happens before materialization/file download; it is not
evidence of a particular host block. Never retry an unknown transfer or switch upload paths to bypass it.

## Storage, evidence and resume

`AI_FIGHTER_ROOT` selects the workspace; `AI_FIGHTER_CREATOR_HOME` selects writable bundled runtimes.
Default bootstrap caches are `<workspace>/.cache/oddbout/{npm,pip}`; `--cache <absolute-user-directory>`
changes that base using `npm_config_cache` and `PIP_CACHE_DIR`. HOME and CODEX_HOME are not changed.
Keep official CLI credentials in the user's private credential store, never Git, a shared template,
creation output or a dependency cache. `SPRITE_GEN_CONFIG_DIR` stores preferences, not credentials.

```sh
node scripts/dots-workspace.mjs resume --workspace /workspace/my-fighter
node scripts/dots-workspace.mjs resume --workspace /workspace/my-fighter --report output/recovery-20261027.json
```

Resume emits only session/job identifiers, revisions, verified input/output byte hashes and blockers.
It omits prompts, argv, tokens, signed URLs and raw provider output. It never dispatches or resolves jobs.
Preserve the whole project (including attempt records and raw files), not just this inventory.
Use the normal session/job tools afterward. Unknown or running jobs require original-run inspection,
never another generation because the UI stopped waiting. Lost output is not permission to regenerate.

Start a prepared job through the official host exec tool with an initial wait of **30000 ms**. If it
returns a running session/cell identifier, wait/poll that same identifier; do not start another command.
Report progress while waiting. After interruption, get the existing job and original output evidence.
No session ID or a timeout is not proof that a provider request never started. Respect explicit stop rules.

Evidence schema for doctor (all values below are placeholders, not proof):

```json
{
  "schemaVersion": 1,
  "environmentId": "doctor environmentId",
  "auth": {"checkedAt": "ISO timestamp", "expiresAt": "ISO timestamp"},
  "registration": {"checkedAt": "ISO timestamp"},
  "delivery": {"file": {"path": "output/original.png", "bytes": 123, "sha256": "64 hex characters"}}
}
```

Actual byte receipt, MIME/decode, Library storage, native parent attachment and parent rendering are
separate observations. Doctor verifies only the declared file bytes; decode/display stay unverified.
The delivery workflow must inspect actual media and target-conversation display before asking for feedback.
An attachment ID string, child-only preview or queued message is insufficient. See [DELIVERY.md](DELIVERY.md).


## File-only packaging repair (0.6.8)

With 0.6.10 and the server's `texture-resolution-1` capability, use native MCP `prepare_fighter_packaging` for
packaging recovery. It returns structured `inspect_fighter_packaging` and `pack_fighter_package` invocations
for the host's ordinary execution tool. Run them yourself against the preserved workspace; do not ask the user
to relay diagnostics or hand-edit the packer. The cloud preparation response is not execution evidence.
`fitSheets: true` fits individual sheets and then total/per-asset byte and decoded-pixel budgets. If totals exceed
the limits, it reduces density across all normalized motions, remeasures actual encoded bytes and padded sheet
pixels, and runs unchanged validators. It preserves frame count and timing, and records the density used by the
game to preserve apparent body size. It requires the user's
resolution-optimization scope; it does not preserve pixel identity. All original files remain unchanged.
Never submit density metadata to a server that does not advertise the capability. Final file/byte limits remain.
`outputScale` optionally caps post-normalization density (.25–1); shrinking source images first is not a substitute.
Encoding stays as chosen in the plan. Read `report.budget` for actual per-asset/totals, each trial and exhaustion;
do not turn an estimate into a claimed pass. At most eight trials run in a bounded ten-minute workspace worker.
The host's first execution wait stays 30 seconds: continue the same execution/session, never dispatch duplicates.
0.6.9 fitted sheet dimensions only; its successful sheet fit did not certify the package totals.

0.6.8 removes numerical and visual quality gates from packaging and session progress. It accepts the
existing `required`/`engine-loop` plan names without requiring another approval or rewriting diagnostics.
A direct `requireReview` exception is a diagnostic result, not a full packer or registration result.
Do not run it as a prerequisite, mark missing observations as passed, or generate another animation.

For an explicitly requested packaging repair, obtain the reviewed 0.6.8 kit into a **separate directory**
and install only its locked Node dependencies (`npm ci --ignore-scripts`). Run its
`scripts/pack-fighter.mjs` with the absolute path to the existing plan, using a new output directory.
It resolves game-pack and diagnostic paths relative to that plan. No sprite setup, generation account,
Python measurement run, new workspace binding or replacement of the active runtime is needed.
Use the same selected files and session; preserve the existing runtime, sessions, jobs and outputs.
When recording the new package, the repaired `creation:tool --workspace <existing-workspace>` can
update that session with the actual file-validation result. Quality records may remain unverified/failed.
Registration is a separate action within the user's request; report the actual server response.


If the intermediate `game-pack` itself hit 50 MB, it does not exist yet; `GAME_PACK_UNREADABLE` is
then a downstream missing-file error, not a gait rejection. With this kit's pinned engine, run the
existing request into a new directory using `npm run sprite -- game-pack --request <existing-request>
--out-dir <new-output> --image-format webp`. This writes lossless WebP only and retains every RGBA
pixel, frame, timing and anchor. When the actual single-format intermediate still exceeds 50 MB,
`--max-bytes 200000000` explicitly permits up to 200 MB of intermediate files. The final fighter's
file/size limits do not change. Never trim approved frames, resize artwork or regenerate to fit.
This intermediate-repack step needs the new kit's pinned Python engine installed in its own venv;
it does not need a generation login or a provider call. Preserve the original runtime and source files.
