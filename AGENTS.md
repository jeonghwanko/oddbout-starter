# ODDBOUT creator kit: agent instructions

Codex loads this file automatically, Grok does in a trusted folder (`--trust` for headless runs), and Claude Code
loads it through `CLAUDE.md`'s import. It also ships in the creator kit, where only the creation and Dots parts apply
and the repository-only docs named below are absent. Its rules are product requirements that the code and docs
enforce: keep them when you change either.

## Start here

| Your task | Read first | Then |
| --- | --- | --- |
| The user sent only a repository link | `docs/START-HERE.md` | Its steps, then the row below |
| Create, revise, resume or register a fighter with a user | [Hard rules](#hard-rules), [Creating a fighter](#creating-a-fighter) | `docs/CREATION-UX.md`; `docs/DOT-CREATION.md` and `docs/AUTHORING.md` before the first generation; the live AI Fighter spec before creating a package |
| Set up or resume a Dots workspace | `docs/DOTS-QUICKSTART.md`, `docs/DOTS-START.md` | [Hard rules](#hard-rules), [Dots workspaces](#dots-workspaces), [Workspace, connection and sign-in](#workspace-connection-and-sign-in); to create, the row above |
| Change code, tests or docs here | [Hard rules](#hard-rules), [Changing this repository](#changing-this-repository) | The doc that owns the area ([docs/README.md](docs/README.md)). [Creating a fighter](#creating-a-fighter) states product requirements the code implements: read the part your change touches |
| Deploy or operate the service | [Hard rules](#hard-rules), [Deploys](#deploys) | `docs/CREATOR-HOSTING.md`, `docs/CLOUD-MCP.md`, `docs/GENERATION-HOST.md` |

`docs/research/` and the dated reviews under 기록 in `docs/README.md` record past results, not current procedure,
unless a rule below tells you to read one.

## Hard rules

These apply to every task. Later sections add detail; none of them relaxes these.

1. Never invent hashes, origins, measurements, contact timing, successful generation or registration results.
   Report only what a tool, file or server response returned or what you observed in the actual output; anything
   unobserved stays unverified.
2. An unknown generation outcome is not a confirmed failure, even without a request ID. Inspect existing records and
   outputs before any retry. A generic continuation request does not authorize a potentially duplicate generation,
   and a delivery failure is not permission to regenerate.
3. When generating in a workspace, use only the current user's generation account. Never copy the maintainer's
   credentials, home paths, subscription confirmations or saved choices to another user. No automatic model,
   provider, account or billing switch, and no helper or security-rule bypass: only the user's explicit choice
   changes the route, within the host's rules (Dots allows no API-key fallback). ODDBOUT's hosted route is not an
   account switch ([Providers and subscriptions](#providers-and-subscriptions)).
4. Callback URLs can contain codes or tokens. Never ask users to paste them into ordinary chat or describe that as
   safe, even if tool output suggests a paste mode.
5. A Git URL or research request alone does not authorize generation, and process design/review requests and
   forwarded example characters do not authorize generating a character. Follow the latest direct user intent; stop
   dependent generation when it changes.
6. Never overwrite a registered immutable package or a selected version.
7. Preserve unrelated working-tree changes.

## Creating a fighter

Each user creates their own fighter. Read `docs/DOT-CREATION.md` and `docs/AUTHORING.md` before the first
generation and the live AI Fighter spec before creating a package, and use the bundled sprite-gen workflow.

### Intent and intake

- Read `docs/CREATION-UX.md` for intent, text/image intake, account choices and the process evaluation rubric.
- Explicit creation requests authorize routine preparation within their scope ([hard rule 5](#hard-rules) lists what
  does not authorize generation).
- Accept text, reference images, or both. Ask only about missing reference roles or material conflicts.
- Distinguish user requirements from proposed details; do not make users complete a long character form.
- An explicit edit overrides the reference's existing detail; do not ask again whether to keep what the user said to remove.
- Ask only for missing creative decisions that affect the next preview. Handle installation, extraction, measurement
  and validation within the agreed step without making the user approve each command.

### Providers and subscriptions

- When the connected ODDBOUT tools list `request_hosted_fighter`, ODDBOUT can make the fighter on its own worker with
  no workspace or generation account of the user's. Offer it first when the user wants ODDBOUT to make the fighter or
  has no generation setup, and follow the Hosted route in `plugins/ai-fighter/skills/create-fighter/SKILL.md`; another
  person's generation host needs the user's consent first. The rules below cover generating in a workspace.
- Default recommendation: GPT base + Grok video when both are available, all Grok when only Grok is available, all
  GPT when only GPT is available. Explicit user choices override this product preference.
- Confirm current access in one understandable question. The recommendation never authorizes an automatic runtime provider switch.
- Track image and video access separately. Honor an already chosen stop-on-failure policy without reoffering rejected alternatives.
- Respect capacity stop conditions and the selected model. Preserve upstream provider selection and billing rules.
- Design the default customer flow for one already-owned generation subscription. Separate actual image/video/editor
  capabilities from subscription names and API billing. Do not make a second subscription or a self-hosted
  VACE/ComfyUI GPU server a hidden requirement.
- Remote experiments are research evidence unless explicitly selected as the product path. Read
  `docs/research/MOCHA-LOCOMOTION-HANDOFF.md` before resuming Mocha locomotion research; further VACE generation is
  paused for the requested architecture review.

### Review groups

- Creation is conversational in review groups: appearance (concept/idle), locomotion (fightIdle/walk/run), attacks
  (combo/slam/dash), defense and reactions (block/hit/groggy/fall), then final review.
- Appearance starts with the front (the profile set, `get_fighter_spec` → `profileSet`): the user chooses a full-body front view;
  the side view and the motions are drawn from it, and after registration the front goes up as his profile set. Every generation
  carries the spec's colouring text and attaches its style anchor as the last reference: the house's plain cel colouring.
- When the game context lists the optional style group (skill/entrance/victory clips and the fighting style), offer it
  once after defense and skip it when the user declines. It never blocks final, but each optional clip a package
  carries needs a selected, checked version.
- Complete the agreed group autonomously, show its actual previews together, and wait for feedback at the group
  boundary, not after every motion. Show actual images/animation, not only progress text.
- A positive response advances to the next group without another permission question.
- Skip review boundaries only for groups the user explicitly delegates, and preserve the user's actual delegated
  scope. Delegating later groups does not waive an earlier pending review.
- Reuse choices the user already made. A request to create or register alone does not waive group feedback.
- Read the full feedback: praise with a revision request is a revision; praise of one motion applies to that motion's current version.
- Track acceptance per motion and version. A positive response about the last pending motion completes the group when
  the other current versions are already accepted and the required checks pass; do not ask for those approvals again.
- Preserve selected versions and revise affected assets only. Follow the feedback and work-note rules in `docs/DOT-CREATION.md`.

### Generation and delivery

- "sprite-gen" means the engine and CLI pinned at `vendor/sprite-gen` ([sprite-gen](#sprite-gen)). For local
  generation use the bundled `vendor/sprite-gen/SKILL.md` and its referenced workflow. `npm run sprite:setup` installs
  this checkout's source in its own venv; `npm run sprite -- <command>` runs that environment. Do not update the pin
  or modify vendor code as part of character creation.
- Before generation, follow `docs/DELIVERY.md`: verify generation access and actual image/file delivery to the
  current user conversation separately.
- Supported appearance previews may be generated and displayed directly in the current conversation: for those that
  do not require a PC, check the conversation host's own direct image-generation/display route first, within the
  user's environment/account/model constraints. Packaging and registration use local files.
- Local generation requires a verified delivery route. Tool names visible to the model do not prove that the selected
  Library helper can use them. Run `npm run creation:delivery` when local execution is available.
- Distinguish the Dots conversation model, the Codex CLI `--model` worker and the actual image tool/backend. The
  provider report's copied `model` is not an observed image backend.
- Login, model strings and tool listings do not verify generation: require actual call traces and completed outputs
  in that environment. Keep unobserved backend and account identity unknown. Readiness flags and `creation:delivery`
  record checks are not live generation/display certificates or authorization to generate.
- Keep generation, local save, Library save, conversation display, review and user selection distinct. Queued panels,
  text reports and local paths are not displayed previews, including across delegated chats.
- Recover existing outputs before any retry; a delivery failure is not permission to regenerate. New generation needs
  an explicit new-generation/edit request.

### Workspace, connection and sign-in

- Run creation in a workspace per `docs/EXECUTION-HOST.md` (bot service VM or the user's PC): one user per workspace,
  the user's own login only, no service API keys in the environment, work folders and attempt records preserved
  across sessions, and no pulls of this repository while a character is in progress.
- Call MCP `check_creation_readiness` before a character's first generation, after a workspace restart and before
  registration. Use purpose `generation` only for generation setup; `connection` and `registration` must not ask for
  generation subscriptions or install/update the engine.
- Run the readiness result's kit `nextCommands` (restart when told). Pass `account` only as the user stated it;
  otherwise let the conversation host's form or numbered options ask.
- Follow `docs/CONNECTION-READINESS.md`: present the ODDBOUT connection action, then the user's Google sign-in and
  device approval. Reuse the existing device flow: `connect_oddbout` start/wait; retain pending requests and adopt
  the new session without a login-only restart.
- Use login commands only with a supported secure handoff or the device connection ([hard rule 4](#hard-rules)).
  For a browser on another device, use the device connection (`--device`, then `--device-wait`) only when readiness
  reports `routes.otherDevice` available, which requires the deployed server to advertise `registration.deviceLogin`
  "v1". The link and pairing code are public: tell the user to approve only a request they started and whose code matches.
- If no secure route is supported, report the authentication blocker. Do not implement a bypass or assume a planned flow already exists.
- Keep ODDBOUT API/account, generation access and parent delivery separate. A saved session is not a server-verified account.
- VM CONNECT/network blocks belong to the initial environment preparer; ordinary creators reuse that workspace. The
  kit cannot change VM host allowlists or Republish: report that limitation without claiming success.
- After recovery, inspect existing sessions/jobs and pending device approval before any new action.

### Dots workspaces

- For Dots setup or resume, read `docs/DOTS-QUICKSTART.md` and `docs/DOTS-START.md` first.
- Run the offline `scripts/dots-workspace.mjs doctor` before opt-in probes; `bootstrap --install` is a separate action.
  Inspect existing sessions/jobs before installing.
- Never run the generation readiness tool as a supposedly read-only doctor: its kit path may fetch/fast-forward.
- Keep source and reviewed bundle layouts distinct. The launcher's `--status` is read-only; `--install` requires the
  reviewed manifest hash.
- Block unaudited Codex image-output paths, including an actual Codex still redraw inside `video-set`. Explicit Grok
  image/video commands keep their own engine checks; `video-resume` retrieves an existing request. Do not infer Codex
  use merely from a video command or require Codex readiness for a Grok route.
- Never read or delete protected sessions, relocate `CODEX_HOME`, or claim an invented stdout/file adapter.
- Keep the initial official exec wait at 30000 ms, then recover the same session/cell until completion; an unknown
  outcome must not cause another dispatch.

### Motion quality

- The v1 contract requires all 11 motions. With `gait-frames-1`, preserve the filmed/drawn cycle's distinct frames:
  walk 12–32, run 10–16, with equal per-frame durations. The spec's `frames` (16/12) are authoring defaults, not fixed
  acceptance counts. Do not drop, duplicate or interpolate frames merely to reach those defaults. The review plan
  must cover every actual frame (`index: i`, `phase: i / frameCount`) with its support state; plans are not observations.
  Dots keeps `reviewPolicy: required`, both same-foot stance measurements and visual review. Validate actual motion,
  identity, foot alternation and ground contact; schema/decoder success alone is not visual approval.
- Follow `docs/GAIT-REVIEW.md`: keep one coordinate/scale reference, write the phase plan before generation, run
  `fighter:gait review` with both same-foot stance ROIs, and show its preview before registration. Missing or
  uncertain observations stay unverified. Bind gait reviews to the final game-pack pixels and durations.
- Split heel/forefoot contacts, padded/hoofed/clawed soles and lifted heels (digitigrade) may use
  `docs/FOOT-EVIDENCE.md` only with fresh per-frame outlines of both feet; v2 evidence groups sole lobes per foot and
  tracks the leading ground contact. This is an explicit AI Fighter extension: retain the upstream report and every
  other rejection. Never fabricate foot identity.
- For a requested generation-free gait experiment, use `gait-guide` (`docs/GAIT-REVIEW.md`). Render and review the
  authored phase/IK/foot-lock proxy before any new generation. Proxy joints, depth and contacts are design ground
  truth, never observations of generated artwork. Show actual normal/slow previews and keep visible part masks
  distinct from X-ray joints.
- A numerical flight flag is not visible flight. Check the final projection and exact sample times with
  `screen_audit`, then inspect raster foot contours and occlusion separately. Keep per-foot projected ground
  references; never substitute guide labels for output observations.
- Save video latents before decoding when supported. Isolate temporal decoding artifacts on the same latent; do not
  resample diffusion or silently reduce tile size to diagnose decoding.

### GPT locomotion

GPT locomotion uses the motion engine in the pinned sprite-gen-agent; run it through `npm run sprite --`.

When the user chooses authored joint pose guidance, use the v5 measured `gen-motion` route documented in
`docs/GAIT-REVIEW.md` and `vendor/sprite-gen/docs/pose-motion.md`:

- One whole-body pose per call: target guide + immutable appearance-only identity + reviewed anchors, the authored
  pose route's 16/12-frame plans, then pose and cycle review. These route defaults do not require resampling video cycles.
- Review the actual prepared original/guide pairing in `input-review.json` before generation; a coordinate plan is not
  proof of anatomical fit. Inspect `image_tool_trace` for actual dispatch evidence.
- Structural canvas errors and unknown timeout outcomes must not consume another generation; reconcile existing results.
- New generation requires a version-2 plan with visible original body-landmark calibration. Measure actual body points
  and fresh physical-foot outlines/sole points before visual approval.
- `--measure` and explicit `--register` never generate. Registration permits only a bounded uniform whole-body
  scale/translation inferred from body points, with independent foot/flight checks. It is not bottom alignment: feet
  never drive the transform, wrong anatomy is not repaired, raw pixels remain immutable and corrected pixels require fresh review.
- Geometry failures block retry in contract 3/4 runs. New gait-motion runs are contract 5: semantic pose prompts,
  diagnostic guide geometry, declared hidden points (`unverified_hidden`, never pass), and export gated by sequence
  review plus per-stance-interval `contact-coverage.json` (`docs/GAIT-REVIEW.md`).
- This route exports `sprite-gen-asset` directly and does not use row extraction or `bind-keyposes`.

The existing row route:

- Use `fighter:gait init` for separate key-pose and full-sequence requests. Review both physical legs, hip
  attachments, contacts and whole-body continuity before `fighter:gait bind-keyposes`; missing/failed observations
  remain unverified. The full sequence must carry the actual phase guide and reviewed key-pose image.
- Preserve painted-row source Y with `fit.ground_frames: false`; do not erase flight by bottom-aligning each frame.

Both routes:

- A generic skeleton guide is phase vocabulary, not a measurement of this character's proportions.
- Do not splice a frozen torso onto separate legs, duplicate poses, or label a plan as observed gait.
- `gen-set` success is generation only. Stop after repeated failure of the same anatomy/contact requirement, preserve
  versions and explain the limitation instead of continuing unbounded generation or compositing.

### Packaging and registration

- `examples/sparring-bot` and `npm run example` are geometric test fixtures. They do not satisfy a request for a
  generated character; do not rename or restyle that fixture and call it sprite-gen output.
- Build the package with `npm run sprite -- game-pack`, then `npm run fighter:pack -- <plan.json>` (see
  `docs/DOT-CREATION.md`). It measures scale, frames, origins, contacts and hashes from the pixels: do not
  hand-assemble sheets or type those values. The plan holds contact steps, landmarks and gait review paths.
- Normal authoring uses the default reviewPolicy `required`; `format-only` is for format fixtures, not visual approval.
- Separate get-up art uses `fall.getUpAnimation` (`docs/DOT-CREATION.md`); keep auxiliary cells out of fall playback.
- Any signed-in user may upload without an invitation or manual approval. Submit only within the user's request, and
  distinguish validation failures from post-publication moderation.
- Reuse the same idempotency key for immutable retries; changed package bytes need a new key. A user-requested
  metadata-only final edit followed by an explicit registration request needs fresh validation, but not repeated
  approval of unchanged animations.
- A validated fighter starts in production (제작 중): out of other people's cups, ranked duels and lists while the owner
  previews and practises it. Other people meet it after the owner watches each required motion and enters it (출전,
  on the site's motions page or with `enter_fighter`); a new package returns it to production.

## Changing this repository

### Repository map

| Path | What it is |
| --- | --- |
| `api/` | Server API (registration, accounts, generations) for the Edge functions and the Render worker, plus the client modules the kit ships |
| `supabase/functions/` | Edge functions `ai-fighter` (API), `ai-fighter-mcp` (hosted MCP) and the temporary `client-ip-probe`; `supabase/migrations/` is the database |
| `mcp/` | MCP tools: `stdio.mjs` is the workspace server the kit ships; `cloud.mjs`, `cloud/` and the other `edgeOnlyFiles` in `scripts/build-plugin-bundle.mjs` run only in the hosted MCP; the Render worker imports a few |
| `worker/` | Render validator worker and the `mcp.oddbout.com` gateway |
| `scripts/` | The CLIs behind `npm run`: creation tools, packing, gait, Dots, plugin build and release, deploy helpers |
| `host/` | Generation-host tools that make hosted fighters on a generation PC ([host/README.md](host/README.md)) |
| `contracts/ai-fighter/` | The v1 package contract. The files its `SOURCE.json` lists, and `server/`, are byte copies of the game's ([Type checking](#type-checking)) |
| `deploy/` | Service and creation-environment settings (JSON); several ship in the kit |
| `tools/ai-fighter/` | Package validator, contract builder, gait and contact evidence |
| `plugins/` | Plugin sources: `ai-fighter` (skill `create-fighter`) and `oddbout-cloud` (hosted-MCP plugin) |
| `vendor/sprite-gen` | The pinned generation engine, a Git submodule ([sprite-gen](#sprite-gen)) |
| `website/`, `web/` | Pages `npm run site:build` builds into the creator site (plugin review sites, cloud connect) |
| `examples/sparring-bot` | A geometric test fixture, never a generated character |
| `docs/` | Guides and records; the map is [docs/README.md](docs/README.md) |

### Commands

These exist in this repository's checkout; a creator-kit installation has only the creation scripts.

```sh
npm ci --ignore-scripts             # dependencies; ffmpeg comes from the system
npm run sprite:setup                # pinned sprite-gen in its own venv, plus img2webp and RIFE; heavy tests and generation need it
npm run test:fast                   # every suite except image packing, proxy and Python-engine suites
npm run test:heavy                  # only those slow suites
npm test                            # every suite in test/ and host/, including the strict type check
node --test test/<name>.test.mjs    # one suite (generation-host suites live in host/)
npm run typecheck                   # tsc alone; CI also runs the deno check below and a sprite-gen pin check
deno check --frozen --config supabase/functions/<name>/deno.json supabase/functions/<name>/index.ts
npm run spec:check && npm run validate -- examples/sparring-bot/fighter.json && npm run mcp:smoke
```

### Branches, tests and CI

- `main` is the working branch: branch from it and open pull requests against it. `codex/creator-hosting` was the kit
  and service branch until 2026-10-29 and is frozen at the commit that moved everything to `main`; never push to it.
  `codex/creator-pages` (the published site) and `codex/game-context` (the game's published creation context) are
  written by publishing tools; never commit to them by hand.
- Other sessions may be working in a shared checkout of this repository or the game's: do branch work in a
  `git worktree`, never switch a shared checkout's branch, and leave pulling it to the session working there.
- Run only the relevant tests locally ([Commands](#commands)). Pull requests to `main` and pushes to it run the `test`
  workflow, and a pull request merges only when it passes. Do not dispatch extra runs unless asked.
- Never put `[skip ci]` or another GitHub skip marker (`[ci skip]`, `[no ci]`, `[skip actions]`, `[actions skip]`, a
  `skip-checks: true` trailer) anywhere in a pull request's last commit message, body included, even quoted: the
  required check then never reports.
- Stage files by name. `git add -A`, `git add .`, `git add -u` and `git commit -a` can stage `vendor/sprite-gen` as a
  rollback ([sprite-gen](#sprite-gen)).
- `AGENTS.md` and the docs and scripts listed in `scripts/build-plugin-bundle.mjs` ship in the creator kit, where
  creation agents read them. A rule removed there leaves users who pull `main` at once, and kit users at the next release.

### Type checking

- Every `api/`, `worker/`, `mcp/` and `scripts/` module starts with `// @ts-check` (after a `#!` line, if any);
  `npm run typecheck` (also in `npm test`) runs tsc over them under `strict`. Satisfy it with JSDoc types or casts, not
  runtime changes; a caught value is `catch (/** @type {any} */ error)`.
- Every Edge function's deno.json has the same `strict: true`, so `deno check supabase/functions/<name>/index.ts`
  agrees; the Edge deploy itself does not type-check. Deno's TypeScript is older than this kit's tsc and can infer less
  (an SDK callback's arguments, 2026-10-30), so the `test` workflow also runs `deno check --frozen` on every Edge
  function that has a deno.json; after typing a file an Edge function bundles, run it locally too.
- `scripts/edge-bundle.mjs` reads a JSDoc `import('…')` type as an import: in those files, name only modules the
  bundle already ships or its deno.json maps (an unmapped one makes the `fighter:edge` or `fighter:mcp` plan fail).
  The kit bundle reads imports the same way, so a kit file that names an Edge-only module makes `npm run plugin:bundle` fail.
- `contracts/` and `server/` carry no `// @ts-check` marker; `tsconfig.vendored.json` turns `checkJs` on for them and
  `npm run typecheck` runs it too. For a type error in a byte copy (the files `contracts/ai-fighter/SOURCE.json` lists),
  fix the game repository (`kaito_web/tsconfig.server.json` checks the same files), then copy the files here and run
  `npm run contract:vendored -- --pin`.

### Deploys

Merging to `main` starts no service deploy: the only workflow is `test`, and Render's auto-deploy is off. Creators who
clone or pull `main` from a repository link get the change at once. Each production part carries the import graph of
its entry point, so a shared module (`api/`, `mcp/`, `contracts/`, `server/`, `deploy/`) can reach several parts.
Procedures: `docs/CREATOR-HOSTING.md`.

| Part | Built from | Deployed by |
| --- | --- | --- |
| `ai-fighter` Edge function | `supabase/functions/ai-fighter/` and its imports | the game repository's `npm run fighter:edge` |
| `ai-fighter-mcp` Edge function | `supabase/functions/ai-fighter-mcp/` and its imports, with its own copy of `api/` | the game repository's `npm run fighter:mcp` |
| Database | `supabase/migrations/` | a migration applied on its own, never by a merge |
| Render validator and `mcp.oddbout.com` gateway | `worker/` and its imports, including `api/handler.mjs` | `npm run worker:deploy -- <full commit sha>` with the deploy hook from the user |
| Creator site | the game's private source, `website/`, `web/` and what `scripts/build-creator-site.mjs` imports | `npm run site:build`, then `npm run site:publish` |
| Creator kit and plugin | `plugins/ai-fighter/`, the runtime list and import graph in `scripts/build-plugin-bundle.mjs`, `vendor/sprite-gen` | the next kit release (`docs/PLUGIN-DISTRIBUTION.md`) |
| Generation PCs | the host files (`HOST_FILES` in `scripts/host.mjs`) and this repository at `KIT_REF` in `host/og` | a pull request moving `KIT_REF`; then the operator's `og self-update` and `og setup` on the official PC, and `npm run host:setup` after a pull on community hosts |

- Deploy the production `ai-fighter` Edge function only from the game repository with `npm run fighter:edge -- plan`,
  review its source/engine/live-version changes, then use `deploy --plan <id>` with the same options.
- Never upload this checkout directly through Supabase CLI/MCP or a hand-built payload: its duel engine is a null
  adapter. `scripts/edge-bundle.mjs --list` is inspection only; the game planner imports `edgeFiles` and supplies the
  real and retained engines.
- Verify the deployed release and served engines afterward. Do not overwrite a newer deployment from another session.
- Batch production changes: merge the pull requests that touch any part above together, right before their deploy,
  and deploy each affected part once. Work that reaches no part can merge when it is ready.
- Never write deploy hooks, tokens or their values into this public repository's files, commits or pull requests.

### sprite-gen

`vendor/sprite-gen` pins a commit of [sprite-gen-agent](https://github.com/jeonghwanko/sprite-gen-agent), our fork of
Alex Kim's [sprite-gen](https://github.com/aldegad/sprite-gen) that carries the motion engine. Commands, paths and
the Python package keep the name `sprite-gen`.

- Keep its Apache-2.0 LICENSE and NOTICE. Do not update the pin or modify vendor code as part of ordinary character
  creation. Engine changes are committed to sprite-gen-agent first; then move the pin. Bundling refuses local vendor
  edits, and setup refuses those a moved pin would overwrite. CI refuses a pin that does not move forward along
  sprite-gen-agent main.
- A pull does not move the submodule: set `git config submodule.recurse true` once per clone, or run
  `git submodule update` after each pull. Otherwise the old checkout shows as `M vendor/sprite-gen`, and `git add -A`
  stages it as a rollback.
- The venv holds an editable install of this checkout's path: after moving the checkout, rerun `npm run sprite:setup`,
  or the Python engine suites fail.
