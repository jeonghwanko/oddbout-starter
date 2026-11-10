# ODDBOUT creator kit: agent instructions

Codex loads this file; Grok requires a trusted folder (`--trust` headlessly); Claude Code imports it via `CLAUDE.md`.
Keep these product rules in code and docs. The shipped kit lacks repository-only pages. Owner dummy flow, checkout only, never production: [docs/FLOW-TEST.md](docs/FLOW-TEST.md), `npm run flow:test`.

## Agent quickstart

Workspace agents start here. Detail: [docs/AGENT-QUICKSTART.md](docs/AGENT-QUICKSTART.md), poses: [docs/POSE-GENERATION.md](docs/POSE-GENERATION.md).

Offline check (Node 22.12+): `npm ci --ignore-scripts`, `npm run example`, `npm run validate -- output/sparring-bot/fighter.json`. Generation: ffmpeg and `npm run sprite:setup` (RIFE ~430 MB). Host PCs: Linux.

Cloud registration stays default. Use `fighter:register` only by user choice, with their account and secure CLI login. Cloud/auth failure alone never switches routes. Dry-run needs no login: `npm run fighter:register -- --dir <package>`. Submit on request; reuse its key and record for retries.

`pending` and `pendingStages` are pipeline stage names, never asset ids. Upload each `missingAssets` entry, or every `assets` entry when storage was not confirmed. A successful local validate still lists later stage names in `pending`.

Revise with a new package and `fighterId`; the id stays (rule 6). `revise_hosted_motion` (`request_hosted_fighter` step `revise_motion`) only edits legacy jobs at `motion_ready`. Style-only edits: `update_fighter` kind `style`. Read `get_profile`, then `get_my_fighters` view `list`; report their returned account id, email, `fighterCount` and `fighterLimit`. Missing fields or a null limit stay unknown; 3 is the default, not a verified account limit. Nickname: `ODDBOUT`.

`combat.style` has no super clip. `super` is `slam`, `combo`, `fast` or `dash`. `temper` is an object of optional 1–5 grades: `guard`, `retreat`, `measure`, `patience`. `shockwave`, if present, is `true`. Skill kinds: `stretch`, `pincer`, `flight`, `feint`, `slide`, `counter`, `brace`. The skill clip has no display-name field (`profile.moves` names combo, slam, dash and block). The skill clip, a summon and a shockwave share `extrasBudget` 2. `mix.fast` ≤ `mix.slam` + `mix.combo`, with one of those three above 0. Read `browse_oddbout` view `style_guide` before filling a style.

```json
"style": { "mix": { "slam": 3, "combo": 2, "fast": 1 }, "special": "slam", "super": "dash", "distance": 2, "temper": { "patience": 5 }, "summon": "sportsCar" }
```

Motion frames face right at one scale: standing body height 400, not each pose's extent. Attach `https://oddbout.com/art/oddbout/style-anchor-front.webp` as the last reference. `BORROWED_LANDMARK` warns when a landmark uses another clip's frame; validation still passes. `inspect-motion` `needs-review` without a foot ROI is expected on action clips and is not a packaging gate.

## Start here

| Your task | Read first | Then |
| --- | --- | --- |
| The user sent only a repository link | `docs/START-HERE.md` | Its steps, then the row below |
| Create, revise, resume or register a fighter with a user | [Hard rules](#hard-rules), [Creating a fighter](#creating-a-fighter) | `docs/CREATION-UX.md`; `docs/DOT-CREATION.md` and `docs/AUTHORING.md` before the first generation; the live AI Fighter spec before creating a package |
| Set up or resume a Dots workspace | `docs/DOTS-QUICKSTART.md`, `docs/DOTS-START.md` | [Hard rules](#hard-rules), [Dots workspaces](#dots-workspaces), [Workspace, connection and sign-in](#workspace-connection-and-sign-in); to create, the row above |
| Change code, tests or docs here | [Hard rules](#hard-rules), [Changing this repository](#changing-this-repository) | The doc that owns the area ([docs/README.md](docs/README.md)). [Creating a fighter](#creating-a-fighter) states product requirements the code implements: read the part your change touches |
| Deploy or operate the service | [Hard rules](#hard-rules), [Deploys](#deploys) | `docs/CREATOR-HOSTING.md`, `docs/CLOUD-MCP.md`, `docs/GENERATION-HOST.md` |

`docs/records/` and `docs/research/` are history, not procedure, unless a rule below directs you there.

## Hard rules

These apply to every task; later sections cannot relax them.

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
6. Never delete or overwrite a submitted immutable package or a selected version. A revision of a registered fighter is a new submission with that fighter's id (`fighterId`). It keeps the id and leaves the previous submission immutable.
7. Preserve unrelated working-tree changes.

## Creating a fighter

For each user's fighter, use bundled sprite-gen: read `docs/DOT-CREATION.md` and `docs/AUTHORING.md` before generation,
and the live AI Fighter spec before packaging.

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

- Hosted creation skips workspace motion reviews: after the appearance choice (including delegation), complete motions
  and register into production. Honor holds/edits; await server confirmation before claiming registration. The owner enters on the site.

- Creation is conversational in review groups: appearance (concept/idle), locomotion (fightIdle/walk/run), attacks
  (combo/slam/dash), defense and reactions (block/hit/groggy/fall), then final review.
- Appearance starts with the front (the profile set, `get_fighter_spec` → `profileSet`): the user chooses a full-body front view;
  the side view and the motions are drawn from it, and after registration the front goes up as his profile set. His expression sheet
  (six arena faces, the KO card's defeat face last) is drawn from the chosen front and goes up with it; `npm run fighter:profile-set`
  builds the set's files, never hand-typed values. Every generation carries the spec's colouring text and attaches its style anchor as
  the last reference: the house's plain cel colouring.
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
- Follow `docs/CONNECTION-READINESS.md`: the account and registration belong to the connected ODDBOUT cloud tools
  (`get_profile`, then `prepare_fighter_registration`, `upload_fighter_asset`, `submit_fighter_registration` and
  `get_my_fighters` view `submission`). The workspace tools never read a CLI login; a missing or failing cloud tool is not a
  reason to sign in locally.
- The kit's own login (`npm run login`, used to join a generation host or run admin commands) runs only with a supported
  secure handoff or the device connection ([hard rule 4](#hard-rules)): for a browser on another device, `--device`,
  then `--device-wait`. The link and pairing code are public: tell the user to approve only a request they started and
  whose code matches.
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

- Packaging and registration use required file/contract checks only. Quality diagnostics (gait scores, same-foot
  tracking, visual anatomy/alternation/loop verdicts) are deferred work, never a prerequisite or a reason to regenerate.
  Do not call `requireReview` as a registration gate or demand an explicit visual override to continue.
- The contract still requires all 11 motions, walk 12–32 and run 10–16 distinct frames, valid timing, decodable files,
  correct dimensions, hashes, crops, origins, contacts and the remaining package checks. Keep selected versions and
  review-group user feedback; neither user selection nor a file-check pass certifies animation quality.
- `fighter:pack` defaults to `reviewPolicy: files-only`. Older `required`/`engine-loop` plans also use file checks only.
  Existing reports stay intact as diagnostics; stale/failed/missing reports do not block. Fresh usable measurements
  may supply geometry/stride, but never claim visual approval. Session quality reviews are also non-blocking;
  missing/changed files, unselected versions, requested edits and an unvalidated package still block.
- The following gait procedures are optional later quality work. When explicitly requested, keep one coordinate/scale
  reference, bind observations to the actual pixels and durations, and leave uncertain observations unverified.
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

- For workspace packaging recovery, use cloud `prepare_fighter_packaging` and execute its returned workspace MCP
  `inspect_fighter_packaging` / `pack_fighter_package` calls through the host's normal execution tool. Do not make
  the user relay errors or patch the kit. Cloud preparation is not evidence of file access or a completed package.
- When resolution optimization is within the user's request and the live contract advertises `texture-resolution-1`,
  `fitSheets: true` fits individual sheets and whole-package byte/pixel budgets, with measured bounded trials
  after body normalization. Keep the chosen encoding; use `report.budget` for actual totals and `outputScale` for
  an optional post-normalization density cap. Preserve original files, frame identities,
  timing and marks; `pixelScale` preserves its apparent game size. File/byte limits stay required. Never regenerate.

- `examples/sparring-bot` and `npm run example` are geometric test fixtures. They do not satisfy a request for a
  generated character; do not rename or restyle that fixture and call it sprite-gen output.
- Build the package with `npm run sprite -- game-pack`, then `npm run fighter:pack -- <plan.json>` (see
  `docs/DOT-CREATION.md`). It measures scale, frames, origins, contacts and hashes from the pixels: do not
  hand-assemble sheets or type those values. The plan holds contact steps, landmarks and gait review paths.
- Normal authoring uses `reviewPolicy: files-only`; `format-only` remains a format-fixture label. Neither certifies visual quality.
- Separate get-up art uses `fall.getUpAnimation` (`docs/DOT-CREATION.md`); keep auxiliary cells out of fall playback.
- Any signed-in user may upload without an invitation or manual approval. Submit only within the user's request, and
  distinguish validation failures from post-publication moderation.
- Reuse the same idempotency key for immutable retries; changed package bytes need a new key. A user-requested
  metadata-only final edit followed by an explicit registration request needs fresh validation, but not repeated
  approval of unchanged animations.
- A validated fighter starts in production (제작 중): out of other people's cups, ranked duels and lists while the owner
  previews and practises it. Other people meet it after the owner watches each required motion and enters it (출전,
  on the site's motions page or with `enter_fighter`); a new package returns it to production. Entry also needs its front
  painting (profile set) to pass ODDBOUT's front check — one character, whole from head to soles, facing the viewer —
  or an operator's approval; the fighter's `front` (`get_my_fighters` view `fighter`) says what is missing. Losing its last front returns it to production.

## Changing this repository

### Repository map

| Path | What it is |
| --- | --- |
| `api/` | Registration, accounts, generations. Edge functions, the Render worker, and kit client modules |
| `supabase/functions/` | Edge functions `ai-fighter`, `ai-fighter-mcp`, temporary `client-ip-probe`. `supabase/migrations/` is the database |
| `mcp/` | Workspace tools in `server.mjs` (`scripts/creation-tool.mjs` runs them). `cloud.mjs`, `cloud/` and other `edgeOnlyFiles` in `scripts/build-plugin-bundle.mjs` are hosted MCP only |
| `worker/` | Render validator and the `mcp.oddbout.com` gateway |
| `scripts/` | CLIs behind `npm run` |
| `host/` | Generation-host tools ([host/README.md](host/README.md)) |
| `contracts/ai-fighter/` | v1 contract. `SOURCE.json` files and `server/` are byte copies of the game ([Type checking](#type-checking)) |
| `deploy/` | Service and creation-environment JSON; several ship in the kit |
| `tools/ai-fighter/` | Package validator, contract builder, gait and contact evidence |
| `plugins/` | `ai-fighter` (skill `create-fighter`) and `oddbout-cloud`. `ai-fighter/local-files.mjs` is path confinement, rename retry and hashing |
| `packages/oddbout` | `npx -y oddbout@latest connect` (`docs/CLOUD-MCP.md`) |
| `vendor/sprite-gen` | Pinned generation engine, a Git submodule ([sprite-gen](#sprite-gen)) |
| `website/`, `web/` | Creator site sources (`npm run site:build`) |
| `examples/sparring-bot` | Geometric test fixture, never a generated character |
| `docs/` | Guides and records ([docs/README.md](docs/README.md)) |

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

- Branch from `main` and open pull requests against it. Never push `codex/creator-hosting` (frozen 2026-10-29). Never hand-commit `codex/creator-pages` or `codex/game-context`; publishing tools write them.
- In a shared checkout, use a `git worktree`. Do not switch that checkout's branch or pull it.
- Run the relevant tests locally ([Commands](#commands)). A pull request merges only when `test` passes. Merges to `main` start nothing; `main` runs `test` at most once every three hours, and skips a tree that already passed. Do not dispatch extra runs unless asked.
- One change, one run. Ship an engine pin with its kit version, `host/pins.json` and records in one pull request. Open as a draft while it still changes (a draft runs no tests); `gh pr ready` runs `test` once. A push after that waits four minutes, and a further push in that window replaces it. Fetch `main` first so the head contains the tree it was tested with.
- Never put `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]`, `[actions skip]` or a `skip-checks: true` trailer in the last commit message or body, even quoted.
- Stage files by name. `git add -A`, `git add .`, `git add -u` and `git commit -a` can stage `vendor/sprite-gen` as a rollback ([sprite-gen](#sprite-gen)).
- `AGENTS.md` and the files in `scripts/build-plugin-bundle.mjs` ship in the kit. A rule removed there leaves `main` users at once and kit users at the next release.

### Type checking

- Every `api/`, `worker/`, `mcp/` and `scripts/` module starts with `// @ts-check` (after a `#!` line, if any). `npm run typecheck` runs tsc under `strict`. Use JSDoc, not runtime changes. A caught value is `catch (/** @type {any} */ error)`.
- Each Edge `deno.json` is `strict: true`. `deno check` agrees; the Edge deploy does not type-check. Deno infers less than this tsc, so `test` also runs `deno check --frozen` on every Edge function with a deno.json. Run it locally after typing a file the function bundles.
- `scripts/edge-bundle.mjs` treats a JSDoc `import('…')` type as an import. Name only modules the bundle ships or its deno.json maps. A kit file that names an Edge-only module makes `npm run plugin:bundle` fail.
- `contracts/` and `server/` have no `// @ts-check`; `tsconfig.vendored.json` checks them. For a byte copy (`contracts/ai-fighter/SOURCE.json`), fix the game (`kaito_web/tsconfig.server.json`), copy the files, then `npm run contract:vendored -- --pin`.

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
| Render validator and `mcp.oddbout.com` gateway | `worker/` and its imports (not `api/handler.mjs`); production `dependencies` only | `npm run worker:deploy -- <full commit sha>` with the user's hook |
| Creator site | the game's private source, `website/`, `web/` and what `scripts/build-creator-site.mjs` imports | `npm run site:build`, then `npm run site:publish` |
| Creator kit and plugin | `plugins/ai-fighter/`, the runtime list and import graph in `scripts/build-plugin-bundle.mjs`, `vendor/sprite-gen` | the next kit release (`docs/PLUGIN-DISTRIBUTION.md`) |
| Generation PCs | `HOST_FILES` in `scripts/host.mjs`, and this repo at `KIT_REF` in `host/og` | a pull request moving `KIT_REF`, then `og self-update` and `og setup` on the official PC, and `npm run host:setup` on community hosts |

- Deploy production `ai-fighter` only from the game repository: `npm run fighter:edge -- plan`, review the plan, then `deploy --plan <id>` with the same options.
- Never upload this checkout through Supabase CLI/MCP or a hand-built payload: its duel engine is a null adapter. `scripts/edge-bundle.mjs --list` is inspection only; the game planner supplies the real engines.
- Deploy a `main` commit that passed `test`. If it has not, run `gh workflow run test --ref main` and wait. Verify the deployed release. Do not overwrite a newer deployment from another session.
- Batch production changes: merge the pull requests that touch a part above together, then deploy that part once. Never write deploy hooks or tokens into this repository.

### sprite-gen

`vendor/sprite-gen` pins [sprite-gen-agent](https://github.com/jeonghwanko/sprite-gen-agent), a fork of [sprite-gen](https://github.com/aldegad/sprite-gen). The name stays `sprite-gen`.

- Keep the Apache-2.0 LICENSE and NOTICE. Do not update the pin or edit vendor code while creating a character. Commit engine changes to sprite-gen-agent first, then move the pin. Bundling and setup refuse local edits a moved pin would overwrite. CI refuses a pin that does not move forward on sprite-gen-agent main.
- A pull does not move the submodule. Set `git config submodule.recurse true` once per clone, or run `git submodule update` after each pull. Otherwise `vendor/sprite-gen` shows as modified, and `git add -A` stages a rollback.
- The venv is an editable install of this checkout. After moving the checkout, rerun `npm run sprite:setup` or the Python engine suites fail.
